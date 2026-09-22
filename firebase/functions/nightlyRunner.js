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
 *
 * ── Writes: a HYBRID, on purpose (design §2 Option B, §3.1) ──
 * A day decided by punches cannot be changed by anything outside the start-of-run snapshot, and it
 * never touches `plBalance`, so every such user is still written by ONE bulk batch — the cheap,
 * all-or-nothing path, ~85 % of the company on a normal night.
 *
 * A day that scores `Absent` or `SCHL` is the opposite: it is exactly the day a leave approved
 * DURING the run can flip, and the only kind that draws a balance day. Each of those gets its own
 * Admin-SDK transaction that re-reads the user doc, the day's status doc and the user's approved
 * leave requests inside itself, then writes the status doc and the `plBalance` decrement together.
 * That closes the four verified races the old code had:
 *   (b) `plBalance` read at the top of the run and decremented after the commit — a concurrent
 *       `scoreRetroactiveLeave` could draw the same day, leaving two paid days on one balance day;
 *   (c) an un-merged bulk `set` clobbering a status doc another writer produced mid-run;
 *   (d) a leave approved after IST midnight for a past day, invisible to the stale leave snapshot;
 *   (1.5) a leave approved for TODAY during the run, likewise invisible.
 * There is NO non-transactional fallback when a transaction fails (§6 Q3): it is retried once, and
 * then recorded in the summary's `failures` so `ok` goes false. A missing doc surfaced by an alarm
 * beats a wrong doc written silently.
 *
 * Re-scoring the same date is IDEMPOTENT in the pay decision too, not just the arithmetic: a day
 * already recorded as a paid leave day is re-scored against an EFFECTIVE balance that adds back
 * the day this date already drew, so a retry cannot flip it to unpaid. See the `priorDrewBalance`
 * comment in the transaction.
 *
 * ── A deliberate asymmetry between the two partitions ──
 * Only the Absent/SCHL partition re-checks `markedBy === "admin"` inside its transaction. The FAST
 * partition still full-`set`s over an admin regularization that lands between Phase 1's status
 * read and the batch commit — that day is punch-decided, so the nightly and the admin agree on it
 * far more often, and protecting it would mean giving up the single bulk commit for the ~85 % of
 * users it exists for. This is PRE-EXISTING and unchanged by this branch; it is called out so the
 * asymmetry reads as a choice rather than an oversight. The transactional partition is exactly
 * where an admin decision and the scorer can genuinely disagree about pay, which is why the
 * re-check lives there.
 */

const { resolveRestDayType, shouldDecrementPlBalance } = require("./attendanceRules");
const { scoreUserDay, buildStatusDoc, partitionUsers } = require("./nightlyScoring");
const { resolveHolidayCredit } = require("./holidayCredit");
const { usesFixedWindow } = require("./roleCapabilities");
const { leaveCoversDate } = require("./leaveCoverage");

// Firestore caps a batch at 500 WRITES. Both of this job's bulk paths — the rest-day branch and
// the fast partition — write one document per employee, or two when an ops employee also gets a
// `daily_hours` doc. A single company-wide batch therefore crosses the cap at a few hundred
// employees, and the failure mode is the WHOLE night lost for everyone rather than a part of it.
// 400 leaves headroom under the real limit.
const BULK_BATCH_WRITE_LIMIT = 400;

/**
 * A bulk write stream, committed in chunks of at most `limit` writes.
 *
 * `reserve(n)` closes the current chunk when the next `n` writes would not fit, so a caller's
 * related documents stay in the same chunk whenever they fit — but atomicity across them is NOT
 * guaranteed at a boundary and nothing here relies on it. `flush()` always commits the final
 * chunk, even when it is empty, exactly as the single batch always did.
 *
 * Failure semantics are deliberately unchanged from the single batch: a commit that fails THROWS
 * out of the whole run, the guard records it and the scheduler retries the date. Chunks already
 * committed are simply rewritten by the retry — every write is a `set` on a deterministic id.
 */
function makeChunkedBatch(db, limit) {
  let batch = db.batch();
  let writes = 0;
  return {
    async reserve(n) {
      if (writes > 0 && writes + n > limit) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    },
    set(ref, data) { batch.set(ref, data); writes++; },
    flush() { return batch.commit(); },
  };
}

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

  // Only leaves whose toDate >= today can possibly cover today — earlier leaves are already closed
  // and leaveCoversDate() would reject them anyway. Filtering in the query keeps this read
  // O(open-leaves) instead of O(all-time). Requires the COLLECTION_GROUP fieldOverride on
  // leave_requests.toDate (firestore.indexes.json) — deploy the indexes BEFORE the functions.
  const leavesSnap = await db.collectionGroup("leave_requests").where("toDate", ">=", today).get();
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
    // Chunked for the same reason the fast partition is: one doc per doc-less employee in a single
    // batch crosses Firestore's 500-write cap at a few hundred employees, and every rest day would
    // then fail wholesale.
    const restDayBatch = makeChunkedBatch(db, BULK_BATCH_WRITE_LIMIT);
    let restDayCount = 0;
    let holidayWithdrawn = 0;
    for (const user of allUsers) {
      if (priorStatus.has(user.id)) continue; // any existing doc (auto or admin) wins
      await restDayBatch.reserve(1);
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
    await restDayBatch.flush();
    log.log(`computeDailyAttendanceStatus: marked ${restDayType} for ${today} (${restDayCount}/${allUsers.length} users; ${allUsers.length - restDayCount} already had a doc)${restDayType === "Holiday" ? ` (${holidayWithdrawn} holiday +1 withdrawn: worked, paid via OT)` : ""}`);
    return;
  }

  // ── Phase 4: classify every user from the start-of-run snapshot ────────────────────────────
  // Per-user scoring failures. A single malformed user doc must NOT cost every other
  // employee their day: an uncaught throw here used to mean nobody got scored at all — and since
  // this function only ever writes *today*, the following night would not repair it. That is
  // the failure mode behind the 2026-07-17 backfill. Collect and continue instead.
  const failures = [];
  const scoredItems = [];

  for (const user of allUsers) {
    if (adminOverrides.has(user.id)) continue;
    try {
      // The classification is pure and lives in nightlyScoring.js (unit-tested there):
      // first-in/last-out → Present/HalfDay/SL/LNF, unpunched + leave → SCHL, else Absent, plus
      // the daily_hours numbers for roles that run the OT/shortage ledger. Everything with a
      // side effect stays here.
      const events = eventsByUser.get(user.id) || [];
      const plan   = plannedHours.get(user.id);
      const { status, salaryCredit, dailyHours } = scoreUserDay({
        role: user.role, events, plan,
        leave: leavesToday.get(user.id),
        plBalance: user.plBalance,
      });
      scoredItems.push({ user, events, plan, status, salaryCredit, dailyHours });
    } catch (err) {
      // Deterministic per-user data problem (malformed timestamp, unexpected null).
      // Retrying the whole run will not fix it, so we do NOT rethrow — we record it,
      // finish scoring everyone else, and surface it in the run summary below.
      failures.push({ userId: user.id, employeeId: user.employeeId || "", message: String(err && err.message || err) });
      log.error(`computeDailyAttendanceStatus: FAILED to score user ${user.id} (${user.employeeId || "no empId"}) for ${today}:`, err);
    }
  }

  // ── Phase 5: partition (design §3.1) ───────────────────────────────────────────────────────
  // `fast`: the day is decided entirely by punches. Nothing outside this snapshot can change it —
  // leave never overrides punches (the leave branch is only reached with zero punches) and these
  // days never touch plBalance — so one bulk batch is both correct and the cheapest thing to do.
  // `txn`: Absent / SCHL. These are exactly the days a leave approved DURING the run can flip and
  // the only ones that draw a balance day, so each gets its own transaction below.
  const { fast, txn } = partitionUsers(scoredItems);

  // ── Phase 6a: the fast partition, in bulk batches of at most 400 writes ────────────────────
  // A fast user costs one status doc, plus a second write for the `daily_hours` doc of an ops user
  // who worked a full day. The limit is counted in WRITES, not users; a user's two documents go in
  // the same chunk whenever they fit, and nothing relies on them being atomic together (they are
  // separate documents with separate readers, and a re-run rewrites both deterministically from
  // the same scored item). See makeChunkedBatch for the cap and the failure semantics.
  const batch  = makeChunkedBatch(db, BULK_BATCH_WRITE_LIMIT);
  let   scored = 0;
  for (const item of fast) {
    const { user, status, salaryCredit, dailyHours } = item;
    await batch.reserve(dailyHours ? 2 : 1);

    batch.set(
      db.doc(`users/${user.id}/attendance_status/${today}`),
      buildStatusDoc({ user, today, status, salaryCredit, now: () => Timestamp.now() })
    );

    // Per-day worked hours (`dailyHours` is set only on fully-worked days of roles that
    // run the OT/shortage ledger — operations). Per-day canonical record: the OT/shortage
    // ledger reads this, not a lifetime counter. It can only ever appear in this partition:
    // it needs both punches, and any day with punches is decided by them.
    if (dailyHours) {
      batch.set(db.doc(`users/${user.id}/daily_hours/${today}`), {
        date: today, userId: user.id, role: user.role,
        ...dailyHours, // plannedMins, actualMins, shortageMins, otMins
        updatedAt: Timestamp.now(),
      });
    }
    scored++;
  }

  // The commit stays OUTSIDE any per-user guard: a failure here is infrastructural, not
  // per-user, and SHOULD throw so Cloud Scheduler retries the night.
  await batch.flush();

  // ── Phase 6b: one transaction per Absent/SCHL user (design §3.1 Phase 6) ───────────────────
  // Each transaction re-reads, INSIDE itself, the three things the snapshot can be stale about:
  // the user doc (plBalance), the day's status doc (a regularization or a trigger-written SCHL
  // that landed after Phase 1) and the user's approved leave requests (an approval that landed
  // after Phase 1 — races (d) and §1.5). Because the status doc is read in the same transaction,
  // the full `set` below is safe: a writer that beats us to it aborts and re-runs this callback
  // against its document. Full set, NOT merge — it is what clears a stale `salaryCredit` when a
  // day is rewritten from SCHL to Absent (§3.3).
  //
  // NOTHING is accumulated inside the callback: Firestore re-executes it on contention, so every
  // count below is derived from the transaction's RETURN VALUE, outside it.
  const runUserTxn = (item) => db.runTransaction(async (tx) => {
    const userRef   = db.doc(`users/${item.user.id}`);
    const statusRef = db.doc(`users/${item.user.id}/attendance_status/${today}`);

    // ── every read first (Firestore transaction rule) ──
    const [userSnap, statusSnap] = await tx.getAll(userRef, statusRef);
    const leaveSnap = await tx.get(userRef.collection("leave_requests").where("status", "==", "approved"));
    if (!userSnap.exists) return { skipped: "no-user" };

    const prior = statusSnap.exists ? statusSnap.data() : undefined;
    // Re-check the admin gate inside the transaction: a regularization approved after Phase 1's
    // read used to be clobbered by the batch. An admin decision is never silently rewritten.
    if (prior && prior.markedBy === "admin") return { skipped: "admin" };

    const live  = userSnap.data();
    const leave = leaveSnap.docs.map((d) => d.data()).find((l) => leaveCoversDate(l, today));

    // Re-scoring a date must reach the SAME paid/unpaid decision it reached the first time —
    // §3.5's "a same-date re-run is now safe" is a promise about the pay decision, not only about
    // the arithmetic. If this date is already recorded as a paid leave day, the balance day that
    // funded it is already spent, so re-deriving `salaryCredit` from the live balance would count
    // that spend twice and the full `set` would silently rewrite the day UNPAID. Step A made that
    // reachable for real: a scheduler retry now re-scores the SAME date D, so a retry after a
    // partial first attempt would cut an employee's pay for a day their balance genuinely bought.
    // Add the drawn day back for the scoring decision only — nothing is written to the balance.
    //
    // "Has this date already drawn a balance day?" is a question only a LEAVE day can answer, so
    // `shouldDecrementPlBalance` is asked about `leavePrior` — the prior doc if and only if it is
    // one — and never about a prior of some other kind. The guard keys on `salaryCredit`, and a
    // `Holiday` doc also carries `salaryCredit: 1` (the rest-day branch writes it via
    // resolveHolidayCredit) even though that credit is the holiday's own pay and not a PL draw.
    // Handing such a doc to the guard mints money both ways: the day is scored paid out of nothing
    // (effective balance) AND the draw is suppressed (decrement). Reachable whenever a date is
    // re-scored as a working day after being scored as a rest day — e.g. an admin removes a
    // `holidays/{date}` entered by mistake. Sanitising at the call site keeps the fix here;
    // attendanceRules.js is a three-way-mirrored rule module and is untouched.
    //
    // `priorDrewBalance` is then DERIVED from the guard rather than restating its condition, so
    // the two can never drift: `shouldDecrementPlBalance(1, leavePrior)` answers "would a paid day
    // draw balance given this prior?", and its negation is exactly "this date already drew one" —
    // an SCHL doc with `salaryCredit: 1`.
    //
    // Note what this deliberately does NOT do: it never adds a day back to the stored balance.
    // A cancellation refunds through `cancelLeave`'s own transaction; if the leave no longer
    // covers the date, the day is rewritten Absent with no credit and the balance is left alone.
    const leavePrior = prior && prior.status === "SCHL" ? prior : undefined;
    const priorDrewBalance = !shouldDecrementPlBalance(1, leavePrior);
    const effectiveBalance = priorDrewBalance ? (Number(live.plBalance) || 0) + 1 : live.plBalance;
    // Punches are NOT re-read: `events`/`plan`/`role` stay the snapshot's, so this rescoring can
    // only ever land back in {Absent, SCHL} — the partition invariant holds, and a transactional
    // user therefore never has a daily_hours doc (that needs both punches). Only the two things
    // the snapshot can be stale about come from inside the transaction: the live leave set and
    // the live plBalance (as the effective balance above).
    const { status, salaryCredit } = scoreUserDay({
      role: item.user.role, events: item.events, plan: item.plan, leave, plBalance: effectiveBalance,
    });

    // ── writes ──
    // Identity fields come from the in-transaction user doc (a name/employeeId edited during the
    // run should land), with the doc id from the snapshot — `live` has no `id` field of its own.
    tx.set(statusRef, buildStatusDoc({
      user: { ...item.user, ...live, id: item.user.id },
      today, status, salaryCredit, now: () => Timestamp.now(),
    }));
    // Same single decision point as before — but `leavePrior` was read in THIS transaction, so it
    // is no longer advisory: a concurrent scoreRetroactiveLeave that drew the same day is now
    // serialized against us instead of racing us (race (b)). Same sanitised prior as above, so
    // the scoring decision and the draw decision can never disagree about this date's history.
    if (shouldDecrementPlBalance(salaryCredit, leavePrior)) {
      tx.update(userRef, { plBalance: FieldValue.increment(-1) });
      return { status, decremented: true };
    }
    return { status, decremented: false };
  });

  // Counts for the summary, all derived from return values.
  //
  // RULING on the two in-transaction skips, so `ok` stays meaningful:
  //  • `admin` — an admin marked the day BETWEEN Phase 1's read and this transaction. The user is
  //    counted into `adminMarked` and therefore REMOVED from `expected`, exactly as if the admin's
  //    write had landed two seconds earlier (before Phase 1). `ok` stays true: the day is not
  //    unscored, it is scored by a human, which is the one decision this job must never overrule.
  //  • `no-user` — the user doc disappeared mid-run (a deletion during the run). The user is NOT
  //    counted as admin-marked and stays in `expected`, so `scored !== expected` and `ok` goes
  //    FALSE. Somebody who should have been scored was not, and that must alarm.
  let txnAdminMarked = 0;
  let plDeducted     = 0;
  const CHUNK = 10; // bounds the pathological night (everyone absent) without serializing it

  for (let i = 0; i < txn.length; i += CHUNK) {
    const outcomes = await Promise.all(txn.slice(i, i + CHUNK).map(async (item) => {
      try {
        return { item, result: await runUserTxn(item) };
      } catch (firstErr) {
        // Retry ONCE. Firestore ABORTED under contention is the expected failure here, and one
        // retry turns it into a scored employee instead of a day with no document. There is
        // deliberately NO non-transactional fallback (design §6 Q3): it would reintroduce the
        // unguarded write this whole change removes, and it would fire precisely when another
        // writer is mid-flight.
        try {
          return { item, result: await runUserTxn(item) };
        } catch (err) {
          return { item, error: err, firstErr };
        }
      }
    }));

    for (const outcome of outcomes) {
      const { user } = outcome.item;
      if (outcome.error) {
        // A per-user failure NEVER throws — the rest of the company still gets scored, and the
        // summary's ok:false is the signal. Same failure shape as before.
        failures.push({ userId: user.id, employeeId: user.employeeId || "", message: String(outcome.error && outcome.error.message || outcome.error) });
        log.error(`computeDailyAttendanceStatus: FAILED to score user ${user.id} (${user.employeeId || "no empId"}) for ${today} after one retry (first attempt: ${String(outcome.firstErr && outcome.firstErr.message || outcome.firstErr)}):`, outcome.error);
        continue;
      }
      if (outcome.result.skipped === "admin") { txnAdminMarked++; continue; }
      if (outcome.result.skipped === "no-user") {
        log.error(`computeDailyAttendanceStatus: user ${user.id} (${user.employeeId || "no empId"}) disappeared during the run for ${today} — NOT scored`);
        continue;
      }
      scored++;
      if (outcome.result.decremented) plDeducted++;
    }
  }

  const adminMarked = adminOverrides.size + txnAdminMarked;
  const expected    = allUsers.length - adminMarked;
  // `plAttempted` is counted at the decision point INSIDE the transaction and read off its return
  // value, so it only ever counts decrements that actually committed — which makes it equal to
  // `plDeducted` by construction. That is the point: status and balance now move together, so the
  // old "status written but the balance update failed" gap no longer exists. Both keys are kept
  // because the summary's key set is a contract (§3.2).
  const plAttempted = plDeducted;
  // Retained for compatibility only: a PL decrement can no longer fail on its own (it is part of
  // the user's transaction, and a failed transaction is recorded in `failures` instead).
  const plFailures = [];

  log.log(
    `computeDailyAttendanceStatus: ${today} — scored ${scored}/${expected} ` +
    `(${allUsers.length} active, ${adminMarked} admin-marked), ` +
    `${txn.length} in transactions, PL deducted ${plDeducted}/${plAttempted}, ` +
    `failures ${failures.length}`
  );

  // Run summary — makes a partial night DETECTABLE. Without this a silent shortfall
  // only surfaces when an employee queries their payslip. Alert on `ok === false`.
  await db.doc(`system/nightly_runs/computeDailyAttendanceStatus/${today}`).set({
    date: today,
    ranAt: Timestamp.now(),
    activeUsers: allUsers.length,
    adminMarked,
    expected,
    scored,
    plDeducted,
    plAttempted,
    failures,
    plFailures,
    ok: failures.length === 0 && plFailures.length === 0 && scored === expected,
    startedAt,
    clockSource,
  }, { merge: true });
}

module.exports = { runNightlyScoring };
