"use strict";

/**
 * Body of the `scoreRetroactiveLeave` trigger (index.js), extracted so it can run against a real
 * Firestore (the emulator suite in emulator-tests/) without deploying. The decision logic is the
 * pure planner in retroLeaveScoring.js; this is the read/write wrapper around it.
 *
 * Everything environmental is injected: `db` (Firestore), `FieldValue` and `Timestamp` (the
 * firebase-admin classes), `now` (clock, epoch ms) and `log` (console-shaped logger). The trigger
 * in index.js passes the real ones; the emulator tests pass a fixed clock and a spy logger.
 *
 * `event` is the shape the trigger receives:
 *   { params: { userId, requestId }, data: { after: { exists, data() } } }
 */

const { pastGrantedDates, planRetroLeaveScoring, leaveSpanTooLong, leaveDatesInvalid } = require("./retroLeaveScoring");

// Failure: an error is logged with its context and RE-THROWN, and the trigger has `retry: true`,
// so a transient failure is redelivered instead of silently leaving pay-affecting days Absent.
// Retrying is correctness-safe: each attempt is a fresh transaction that re-reads the status
// docs AND the leave doc itself (the event snapshot is only used to pick candidate dates, so a
// retry never acts on a stale leave — e.g. one an admin has since cancelled a day of), and the
// planner is idempotent (an already-SCHL day is no longer Absent; a candidate date with no status
// doc is skipped). The planner never throws on a malformed leave doc (it returns nothing), so a
// deterministic failure cannot turn retry into a storm.
//
// The two races this comment used to list as deliberately unfixed are now BOTH CLOSED — every
// writer of `attendance_status/{date}` + `plBalance` is a transaction that reads and writes the
// same documents, so they serialize instead of racing (design
// docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-design.md §3.1, §3.4):
//  (a) `cancelLeave` (admin/src/lib/firestore.ts) used to read day statuses BEFORE an
//      unconditional batch, so a cancel landing while this trigger was mid-flight could leave a
//      cancelled day scored as paid SCHL with a PL day burned. It is now a client-SDK
//      `runTransaction` that reads the leave, the day's status docs and the user doc inside
//      itself, so whichever of the two commits second aborts and re-runs against fresh data:
//      trigger first → the cancel reverts the SCHL day and refunds; cancel first → this
//      transaction's own live re-read of the leave (below) sees `cancelledDates` and scores nothing.
//  (b) `computeDailyAttendanceStatus` used to read plBalance up front and decrement it after its
//      bulk batch, so an approval landing during the run could score two paid days against one
//      balance day (plBalance −1). Every Absent/SCHL user is now scored in a per-user transaction
//      that re-reads the user doc, so this trigger and the nightly serialize on `users/{uid}`
//      (nightlyRunner.js).
async function runRetroLeaveScoring({ db, FieldValue, Timestamp, event, now = Date.now, log = console }) {
  const userId = event.params.userId;
  const requestId = event.params.requestId;
  let candidateDates = 0;
  try {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
    const leave = after.data();
    if (leave.status !== "approved") return;

    // IST "yyyy-MM-dd" string — same expression computeDailyAttendanceStatus uses for `today`.
    const todayIST = new Date(now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (leaveSpanTooLong(leave)) {
      // Rules bound totalDays, not fromDate…toDate, so this is a malformed doc: refuse, don't truncate.
      log.warn(`scoreRetroactiveLeave: REFUSED oversize leave range for user ${userId} leave ${requestId} (${leave.fromDate} → ${leave.toDate})`);
      return;
    }
    const dates = pastGrantedDates(leave, todayIST);
    candidateDates = dates.length;
    if (dates.length === 0) {
      // Log-only: an approved leave whose dates are not a real ordered range scores nothing (the
      // planner returns []), which would otherwise be silent. Must never throw: retry: true would loop.
      if (leaveDatesInvalid(leave)) {
        log.warn(`scoreRetroactiveLeave: SKIPPED malformed leave dates for user ${userId} leave ${requestId} (fromDate=${JSON.stringify(leave.fromDate)}, toDate=${JSON.stringify(leave.toDate)})`);
      }
      return;
    }

    const userRef = db.doc(`users/${userId}`);
    const statusRefs = dates.map((d) => db.doc(`users/${userId}/attendance_status/${d}`));

    const leaveRef = db.doc(`users/${userId}/leave_requests/${requestId}`);

    // Candidate dates that had no status doc at read time (log-only; reset on every txn attempt).
    let missingStatusDates = 0;
    const plan = await db.runTransaction(async (tx) => {
      missingStatusDates = 0; // reset on every attempt: the callback may re-run on contention
      // Every read before any write (Firestore transaction rule).
      const [userSnap, leaveSnap, ...statusSnaps] = await tx.getAll(userRef, leaveRef, ...statusRefs);
      if (!userSnap.exists) return { updates: [], paidDays: 0 };
      // Plan from the leave as it is NOW, not the event snapshot (which may be stale on a retry).
      const liveLeave = leaveSnap.exists ? leaveSnap.data() : null;
      if (!liveLeave || liveLeave.status !== "approved") return { updates: [], paidDays: 0 };
      const statusByDate = new Map();
      statusSnaps.forEach((snap, i) => { if (snap.exists) statusByDate.set(dates[i], snap.data()); });
      missingStatusDates = dates.length - statusByDate.size;
      const result = planRetroLeaveScoring({ leave: liveLeave, todayIST, statusByDate, plBalance: userSnap.data().plBalance });
      result.updates.forEach((u) => {
        tx.set(db.doc(`users/${userId}/attendance_status/${u.date}`), {
          status: u.status,
          salaryCredit: u.salaryCredit,
          markedBy: "auto",
          updatedAt: Timestamp.now(),
        }, { merge: true });
      });
      if (result.paidDays > 0) {
        tx.update(userRef, { plBalance: FieldValue.increment(-result.paidDays) });
      }
      return result;
    });

    // Log-only: a past granted day with no status doc is left untouched (nothing to convert).
    // Surfaced so a gap in the nightly run's history does not pass silently; never throws, writes nothing.
    if (missingStatusDates > 0) {
      log.warn(`scoreRetroactiveLeave: ${missingStatusDates} of ${candidateDates} candidate date(s) had no status doc for user ${userId} leave ${requestId}`);
    }
    if (plan.updates.length > 0) {
      log.log(`scoreRetroactiveLeave: ${userId} leave ${requestId} → ${plan.updates.length} past day(s) scored SCHL (${plan.paidDays} paid)`);
    }
  } catch (err) {
    log.error(`scoreRetroactiveLeave: FAILED for user ${userId} leave ${requestId} (${candidateDates} candidate date(s)):`, err);
    throw err; // re-throw so the platform retries (retry: true)
  }
}

module.exports = { runRetroLeaveScoring };
