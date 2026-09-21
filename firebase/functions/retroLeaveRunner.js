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
// Two KNOWN, deliberately-unfixed races (each needs another write to land within one invocation):
//  (a) `cancelLeave` (admin/src/lib/firestore.ts) reads day statuses BEFORE its batch, so a
//      cancel landing while this trigger is mid-flight can leave a cancelled day scored as
//      paid SCHL and a PL day burned (window ≈ one invocation). Re-reading the leave inside
//      the transaction NARROWS this — a cancel whose `cancelledDates` write commits before this
//      transaction commits makes the transaction retry and see the cancel — but does NOT close
//      it: `cancelLeave`'s batch is unconditional, so a cancel whose batch commits AFTER this
//      transaction still leaves the day scored.
//  (b) At ~23:59–00:00 IST the nightly run reads plBalance up front and decrements it
//      non-transactionally, so an approval landing in that window can score two paid days
//      against one day of balance and leave plBalance at −1 (self-heals at the next monthly
//      accrual).
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
