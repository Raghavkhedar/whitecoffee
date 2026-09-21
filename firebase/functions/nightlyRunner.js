"use strict";

/**
 * Body of the `computeDailyAttendanceStatus` nightly (index.js), extracted so it can run against a
 * real Firestore (the emulator suite in emulator-tests/) without deploying — the same split
 * retroLeaveRunner.js uses for the retro-leave trigger. index.js keeps only the `onSchedule`
 * config, the `withNightlyGuard` wrapper and the injection of the firebase-admin handles.
 *
 * Everything environmental is injected: `db` (Firestore), `Timestamp` / `FieldValue` (the
 * firebase-admin classes) and `log` (console-shaped). There is deliberately NO `firebase-admin`
 * require and NO wall clock in this file: the scored date arrives as `today` from the guard
 * (nightlyGuard.js / nightlyClock.js), which derives it from the SCHEDULED time so a retry after
 * IST midnight still scores the date it failed on. A tripwire test (nightlyGuard.test.js) fails
 * the build if either wall-clock constructor reappears anywhere in this file.
 *
 *   runNightlyScoring({ db, Timestamp, FieldValue, today, startedAt, clockSource, log })
 *
 * `today` is the IST "yyyy-MM-dd" the guard resolved; `startedAt` / `clockSource` are echoed into
 * the run summary so it stays self-describing even if the guard's marker write failed.
 *
 * The pure per-user scoring (Present/HalfDay/SL/LNF/SCHL/Absent + the daily_hours numbers) and the
 * attendance_status document builder live in nightlyScoring.js; this file is the read/write
 * wrapper around them.
 */

const { resolveRestDayType, shouldDecrementPlBalance } = require("./attendanceRules");
const { scoreUserDay, buildStatusDoc } = require("./nightlyScoring");
const { resolveHolidayCredit } = require("./holidayCredit");
const { usesFixedWindow } = require("./roleCapabilities");
const { leaveCoversDate } = require("./leaveCoverage");

async function runNightlyScoring({ db, Timestamp, FieldValue, today, startedAt, clockSource, log = console }) {
  const usersSnap   = await db.collection("users").get();
  // Offboarded users (active === false) are skipped entirely — no status doc, no
  // Absent penalty. Legacy users have no `active` field (missing = active).
  const allUsers    = usersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.active !== false);

  const attendSnap = await db.collectionGroup("attendance").where("date", "==", today).get();
  const eventsByUser = new Map();
  attendSnap.docs.forEach((doc) => {
    const d = doc.data();
    if (!eventsByUser.has(d.userId)) eventsByUser.set(d.userId, []);
    eventsByUser.get(d.userId).push(d);
  });

  const leavesSnap = await db.collectionGroup("leave_requests").get();
  const leavesToday = new Map();
  leavesSnap.docs.forEach((doc) => {
    const d = doc.data();
    // A partially-approved leave grants only its `approvedDates`. An ungranted
    // date is simply absent from this map, so the day scores as a normal
    // working day (→ Absent when unpunched) through the existing path.
    if (leaveCoversDate(d, today)) leavesToday.set(d.userId, d);
  });

  // Skip users whose attendance_status was manually set by admin (regularization approvals)
  // Read per-user docs directly to avoid needing a collectionGroup index on date.
  const adminOverrides = new Set();
  const priorStatus    = new Map(); // userId → { status, salaryCredit } already recorded for today
  const statusChecks = allUsers.map(async (user) => {
    const statusDoc = await db.doc(`users/${user.id}/attendance_status/${today}`).get();
    if (statusDoc.exists) {
      const d = statusDoc.data();
      if (d.markedBy === "admin") adminOverrides.add(user.id);
      priorStatus.set(user.id, { status: d.status, salaryCredit: d.salaryCredit });
    }
  });

  // Operations have variable shifts: admin sets a planned start/end per day.
  // Status is evaluated against that window. No plan → day left unmarked.
  const plannedHours = new Map(); // userId → { startTime, endTime }
  const planChecks = allUsers
    .filter((u) => !usesFixedWindow(u.role)) // planned-shift roles (operations) only
    .map(async (user) => {
      const planDoc = await db.doc(`users/${user.id}/planned_hours/${today}`).get();
      if (planDoc.exists) {
        const p = planDoc.data();
        if (p.startTime && p.endTime) plannedHours.set(user.id, p);
      }
    });

  await Promise.all([...statusChecks, ...planChecks]);

  // Sundays and company-wide holidays get a payroll-neutral Sunday/Holiday status
  // instead of being left doc-less: same zero salary effect, but now visible in the
  // portal and Sheets export instead of a blank cell. `today` is the IST date string;
  // resolveRestDayType reads the weekday in UTC to avoid the runtime's UTC timezone
  // shifting a "+05:30 midnight" back to the prior day (which made Mondays read as
  // Sundays and vice-versa).
  const holidayDoc = await db.doc(`holidays/${today}`).get();
  const restDayType = resolveRestDayType(today, holidayDoc.exists);

  if (restDayType) {
    const restDayBatch = db.batch();
    let restDayCount = 0;
    let holidayWithdrawn = 0;
    for (const user of allUsers) {
      if (priorStatus.has(user.id)) continue; // any existing doc (auto or admin) wins
      // Holiday only: an operations employee who actually worked it is paid through the
      // OT-approval flow instead (all rest-day work is raised as pending OT), so the +1 day
      // is withdrawn (salaryCredit 0). A Sunday doc carries no credit field.
      const holidayCredit = restDayType === "Holiday"
        ? resolveHolidayCredit(user.role, eventsByUser.get(user.id) || [])
        : undefined;
      if (holidayCredit === 0) holidayWithdrawn++;
      restDayBatch.set(db.doc(`users/${user.id}/attendance_status/${today}`), {
        status: restDayType,
        ...(holidayCredit !== undefined ? { salaryCredit: holidayCredit } : {}),
        markedBy: "auto",
        date: today,
        userId: user.id,
        userName: user.name || "",
        employeeId: user.employeeId || "",
        role: user.role || "",
        updatedAt: FieldValue.serverTimestamp(),
      });
      restDayCount++;
    }
    await restDayBatch.commit();
    log.log(`computeDailyAttendanceStatus: marked ${restDayType} for ${today} (${restDayCount}/${allUsers.length} users; ${allUsers.length - restDayCount} already had a doc)${restDayType === "Holiday" ? ` (${holidayWithdrawn} holiday +1 withdrawn: worked, paid via OT)` : ""}`);
    return;
  }

  const batch           = db.batch();
  const plDeductions    = [];
  // Per-user scoring failures. A single malformed user doc must NOT cost every other
  // employee their day: all writes accumulate into ONE batch committed after the loop,
  // so an uncaught throw here used to mean nobody got scored at all — and since this
  // function only ever writes *today*, the following night would not repair it. That is
  // the failure mode behind the 2026-07-17 backfill. Collect and continue instead.
  const failures        = [];
  let   scored          = 0;

  for (const user of allUsers) {
    if (adminOverrides.has(user.id)) continue;
    try {
      // The classification is pure and lives in nightlyScoring.js (unit-tested there):
      // first-in/last-out → Present/HalfDay/SL/LNF, unpunched + leave → SCHL, else Absent, plus
      // the daily_hours numbers for roles that run the OT/shortage ledger. Everything with a
      // side effect stays here.
      const { status, salaryCredit, dailyHours } = scoreUserDay({
        role: user.role,
        events: eventsByUser.get(user.id) || [],
        plan: plannedHours.get(user.id),
        leave: leavesToday.get(user.id),
        plBalance: user.plBalance,
      });

      // Only deduct when today wasn't already recorded as a paid day (SCHL credit 1, or a
      // legacy PL doc), so a re-run (manual trigger / retry) doesn't decrement twice.
      // `salaryCredit` is only ever defined for SCHL, so this is a no-op for every other day.
      if (shouldDecrementPlBalance(salaryCredit, priorStatus.get(user.id))) {
        plDeductions.push(user.id);
      }

      batch.set(
        db.doc(`users/${user.id}/attendance_status/${today}`),
        buildStatusDoc({ user, today, status, salaryCredit, now: () => Timestamp.now() })
      );

      // Per-day worked hours (`dailyHours` is set only on fully-worked days of roles that
      // run the OT/shortage ledger — operations). Per-day canonical record: the OT/shortage
      // ledger reads this, not a lifetime counter.
      if (dailyHours) {
        batch.set(db.doc(`users/${user.id}/daily_hours/${today}`), {
          date: today, userId: user.id, role: user.role,
          ...dailyHours, // plannedMins, actualMins, shortageMins, otMins
          updatedAt: Timestamp.now(),
        });
      }
      scored++;
    } catch (err) {
      // Deterministic per-user data problem (malformed timestamp, unexpected null).
      // Retrying the whole run will not fix it, so we do NOT rethrow — we record it,
      // finish scoring everyone else, and surface it in the run summary below.
      failures.push({ userId: user.id, employeeId: user.employeeId || "", message: String(err && err.message || err) });
      log.error(`computeDailyAttendanceStatus: FAILED to score user ${user.id} (${user.employeeId || "no empId"}) for ${today}:`, err);
    }
  }

  // Commit and PL deductions stay OUTSIDE the per-user guard: a failure here is
  // infrastructural, not per-user, and SHOULD throw so Cloud Scheduler retries it.
  await batch.commit();

  // PL decrements are individual writes, so one failure must not strand the rest.
  // Re-runs are safe: `priorStatus` is re-read each run and a user already recorded
  // as PL today is never decremented twice.
  const plFailures = [];
  for (const uid of plDeductions) {
    try {
      await db.doc(`users/${uid}`).update({ plBalance: FieldValue.increment(-1) });
    } catch (err) {
      plFailures.push({ userId: uid, message: String(err && err.message || err) });
      log.error(`computeDailyAttendanceStatus: FAILED PL decrement for ${uid} on ${today}:`, err);
    }
  }

  const expected = allUsers.length - adminOverrides.size;
  log.log(
    `computeDailyAttendanceStatus: ${today} — scored ${scored}/${expected} ` +
    `(${allUsers.length} active, ${adminOverrides.size} admin-marked), ` +
    `PL deducted ${plDeductions.length - plFailures.length}/${plDeductions.length}, ` +
    `failures ${failures.length}`
  );

  // Run summary — makes a partial night DETECTABLE. Without this a silent shortfall
  // only surfaces when an employee queries their payslip. Alert on `ok === false`.
  await db.doc(`system/nightly_runs/computeDailyAttendanceStatus/${today}`).set({
    date: today,
    ranAt: Timestamp.now(),
    activeUsers: allUsers.length,
    adminMarked: adminOverrides.size,
    expected,
    scored,
    plDeducted: plDeductions.length - plFailures.length,
    plAttempted: plDeductions.length,
    failures,
    plFailures,
    ok: failures.length === 0 && plFailures.length === 0 && scored === expected,
    startedAt,
    clockSource,
  }, { merge: true });
}

module.exports = { runNightlyScoring };
