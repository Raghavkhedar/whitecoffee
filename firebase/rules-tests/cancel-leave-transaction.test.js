"use strict";

/**
 * cancelLeave AS A TRANSACTION — run against the real firestore.rules on the emulator.
 *
 * WHY THIS LIVES HERE. `cancelLeave` (admin/src/lib/firestore.ts) used to read the leave, the day
 * statuses and the holidays with plain reads and then commit an UNCONDITIONAL batch. The
 * `scoreRetroactiveLeave` Cloud Function (a transaction on users/{uid}, the leave and the status
 * docs) could commit in the gap, leaving a PAID SCHL day on a cancelled leave and a PL day consumed
 * with no refund. `cancelLeave` is now a client-SDK `runTransaction` that reads AND writes the same
 * docs, so whichever writer commits second aborts and re-runs on fresh data (design:
 * docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-design.md §1.1, §3.4).
 *
 * THE CODE UNDER TEST IS THE REAL CODE. The transactional core is
 * `admin/src/lib/cancelLeaveTransaction.ts` — no app-init import, the firestore function set and
 * `stamped()` are injected — and this file loads that very file (TypeScript, via `tsx/cjs`) and
 * hands it this suite's own `firebase/firestore` plus a Firestore bound to an authenticated
 * emulator context. Nothing is re-implemented here.
 *
 * THE RACE IS DETERMINISTIC. The core takes an optional `onAfterReads` hook, called on every
 * attempt after all reads and before any write. On attempt 1 the hook commits the competing
 * writer's change (what the trigger does) through a rules-DISABLED context — i.e. strictly after
 * cancelLeave's reads and strictly before its commit. The client SDK's commit carries
 * read-version preconditions, so it aborts and the callback re-executes.
 *
 * Test dates (2031 — no other suite in this directory touches that year; verified weekdays):
 *   2031-03-03 Mon … 2031-03-08 Sat, 2031-03-09 Sun
 *   2031-04-04 Fri, 04-05 Sat, 04-06 Sun, 04-07 Mon (seeded HOLIDAY), 04-08 Tue
 *   2031-05-05 Mon, 05-06 Tue, 05-07 Wed
 * Every test uses its own users (unique uid), because `node --test` runs the suite files
 * concurrently against one emulator and this file must not clear it.
 */

require("tsx/cjs"); // lets node load the admin portal's .ts source directly
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fsm = require("firebase/firestore");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser,
} = require("./helpers");
const {
  runCancelLeaveTransaction,
} = require("../../admin/src/lib/cancelLeaveTransaction.ts");
const { MAX_CANCEL_DATES } = require("../../admin/src/lib/leaveCancellation.ts");

let env;
let seq = 0;

before(async () => { env = await setup(); });
after(async () => { await teardown(); });

// ── harness ───────────────────────────────────────────────────────────────

/** A fresh employee + a fresh admin + a fresh Leaves/Attendance manager for one test. */
async function fixture({ plBalance = 5 } = {}) {
  const n = ++seq;
  const emp = `emp${n}`, admin = `adm${n}`, mgr = `mgr${n}`;
  await seedUsers(env, {
    [admin]: { role: "admin" },
    [emp]:   { role: "operations" },
    [mgr]:   { role: "office", tabAccess: [TABS.LEAVES, TABS.ATTENDANCE] },
  });
  await seedDocs(env, { [`users/${emp}`]: { name: emp, role: "operations", active: true, plBalance } });
  return { emp, admin, mgr, leave: `L${n}` };
}

const leavePath  = (emp, id) => `users/${emp}/leave_requests/${id}`;
const statusPath = (emp, d) => `users/${emp}/attendance_status/${d}`;

function seedLeave(emp, id, over = {}) {
  return seedDocs(env, {
    [leavePath(emp, id)]: {
      userId: emp, status: "approved", leaveType: "Casual", ...over,
    },
  });
}

/** An auto-scored status doc, as the nightly function / retro trigger writes it. */
function autoDoc(emp, date, status, salaryCredit) {
  return {
    date, userId: emp, userName: emp, employeeId: emp.toUpperCase(), role: "operations",
    status, markedBy: "auto",
    ...(salaryCredit === undefined ? {} : { salaryCredit }),
  };
}

async function read(path) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().doc(path).get();
    out = snap.exists ? snap.data() : undefined;
  });
  return out;
}

/** The firebase v11 MODULAR Firestore behind an authenticated emulator context. */
const modularDb = (uid) => asUser(env, uid)._delegate;

/** Same shape as the portal's `stamped()`, with a fixed uid instead of auth.currentUser. */
const stampAs = (uid) => (data) => ({ ...data, lastModifiedBy: uid, lastModifiedAt: fsm.Timestamp.now() });

const FNS = {
  doc: fsm.doc, runTransaction: fsm.runTransaction, increment: fsm.increment,
  deleteField: fsm.deleteField, Timestamp: fsm.Timestamp,
};

/** Run the real core as `uid`. `onAfterReads` is the test hook. */
function cancel(uid, { emp, leave }, datesToCancel, { onAfterReads } = {}) {
  return runCancelLeaveTransaction(
    { db: modularDb(uid), fns: FNS, stamp: stampAs(uid) },
    {
      userId: emp, leaveId: leave, datesToCancel,
      cancelledBy: "Ada Admin", cancelComment: "plans changed", onAfterReads,
    },
  );
}

/** The trigger's competing commit: Absent/auto -> SCHL credit 1, plus a plBalance decrement. */
async function triggerScoresPaidSchl(emp, date) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()._delegate;
    await fsm.setDoc(fsm.doc(db, statusPath(emp, date)), {
      status: "SCHL", salaryCredit: 1, markedBy: "auto",
    }, { merge: true });
    await fsm.updateDoc(fsm.doc(db, `users/${emp}`), { plBalance: fsm.increment(-1) });
  });
}

// ── 1. happy path ─────────────────────────────────────────────────────────

test("reverts scored leave days, refunds only the days that drew from plBalance, merges cancelledDates", async () => {
  const f = await fixture({ plBalance: 5 });
  const [D1, D2, D3, D4, D5, D6] = ["2031-03-03", "2031-03-04", "2031-03-05", "2031-03-06", "2031-03-07", "2031-03-08"];
  await seedLeave(f.emp, f.leave, { fromDate: D1, toDate: D6, cancelledDates: [D6] });
  await seedDocs(env, {
    [statusPath(f.emp, D1)]: autoDoc(f.emp, D1, "SCHL", 1),   // paid    -> revert + refund
    [statusPath(f.emp, D2)]: autoDoc(f.emp, D2, "SCHL", 1),   // paid    -> revert + refund
    [statusPath(f.emp, D3)]: autoDoc(f.emp, D3, "SCHL", 0),   // unpaid  -> revert, NO refund
    [statusPath(f.emp, D4)]: { ...autoDoc(f.emp, D4, "Absent"), markedBy: "admin" }, // admin-claimed -> skipped
    // D5: no doc at all (never scored) -> silent no-op
  });

  let hookCalls = 0;
  const res = await cancel(f.admin, f, [D1, D2, D3, D4, D5], { onAfterReads: () => { hookCalls++; } });

  assert.deepEqual(res, {
    cancelled: [D1, D2, D3, D4, D5], skippedDates: [D4], refundedDays: 2,
  });
  assert.equal(hookCalls, 1, "no contention -> exactly one attempt");

  for (const d of [D1, D2, D3]) {
    const s = await read(statusPath(f.emp, d));
    assert.equal(s.status, "Absent", `${d} reverted to Absent`);
    assert.equal(s.markedBy, "admin");
    assert.equal("salaryCredit" in s, false, `${d}: salaryCredit cleared with the revert`);
    assert.equal(s.userId, f.emp, `${d}: merge keeps the rest of the doc`);
    assert.equal(s.lastModifiedBy, f.admin, `${d}: stamped`);
  }
  const d4 = await read(statusPath(f.emp, D4));
  assert.deepEqual([d4.status, d4.markedBy], ["Absent", "admin"], "the admin-claimed day is left as it was");
  assert.equal("lastModifiedBy" in d4, false, "and was not written at all");
  assert.equal(await read(statusPath(f.emp, D5)), undefined, "a never-scored day stays doc-less");

  const user = await read(`users/${f.emp}`);
  assert.equal(user.plBalance, 7, "5 + 2 refunded (paid days only)");
  assert.equal(user.lastModifiedBy, f.admin, "user update stamped");

  const leave = await read(leavePath(f.emp, f.leave));
  assert.deepEqual(leave.cancelledDates, [D1, D2, D3, D4, D5, D6], "union with the earlier cancellation, sorted");
  assert.equal(leave.cancelledBy, "Ada Admin");
  assert.equal(leave.cancelComment, "plans changed");
  assert.ok(leave.lastCancelledAt, "lastCancelledAt written");
  assert.equal(leave.lastModifiedBy, f.admin, "leave update stamped");
  assert.equal(leave.status, "approved", "status stays approved");
});

test("a leave with nothing scored yet cancels with a leave-doc write only (no refund, no user write)", async () => {
  const f = await fixture({ plBalance: 3 });
  await seedLeave(f.emp, f.leave, { fromDate: "2031-03-03", toDate: "2031-03-04" });
  const res = await cancel(f.admin, f, ["2031-03-03", "2031-03-04"]);
  assert.deepEqual(res, { cancelled: ["2031-03-03", "2031-03-04"], skippedDates: [], refundedDays: 0 });
  const user = await read(`users/${f.emp}`);
  assert.equal(user.plBalance, 3);
  assert.equal("lastModifiedBy" in user, false, "refundedDays 0 -> the user doc is not written");
});

// ── 2. validation that needs the in-transaction copy ─────────────────────

test("a missing leave, a non-approved leave and a fully-cancelled selection are rejected with today's messages", async () => {
  const f = await fixture();
  await assert.rejects(cancel(f.admin, f, ["2031-03-03"]), /cancelLeave: leave request not found\./);

  await seedLeave(f.emp, f.leave, { fromDate: "2031-03-03", toDate: "2031-03-03", status: "pending" });
  await assert.rejects(cancel(f.admin, f, ["2031-03-03"]), /cancelLeave: only an approved leave can be cancelled\./);

  await seedLeave(f.emp, f.leave, { fromDate: "2031-03-03", toDate: "2031-03-03", status: "approved" });
  await assert.rejects(
    cancel(f.admin, f, ["2031-04-01"]),
    /cancelLeave: none of those dates are currently granted by this leave\./,
  );
});

// ── 3. rest days ─────────────────────────────────────────────────────────

test("a Sunday and a holiday inside the range are skipped silently — the transaction is NOT denied by the rest-day rule", async () => {
  const f = await fixture({ plBalance: 5 });
  const [FRI, SAT, SUN, HOL, TUE] = ["2031-04-04", "2031-04-05", "2031-04-06", "2031-04-07", "2031-04-08"];
  await seedDocs(env, { [`holidays/${HOL}`]: { title: "Test Holiday", description: "" } });
  await seedLeave(f.emp, f.leave, { fromDate: FRI, toDate: TUE });
  await seedDocs(env, {
    [statusPath(f.emp, FRI)]: autoDoc(f.emp, FRI, "SCHL", 1),
    [statusPath(f.emp, SUN)]: autoDoc(f.emp, SUN, "SCHL", 1), // LEGACY doc on a Sunday
    [statusPath(f.emp, HOL)]: autoDoc(f.emp, HOL, "SCHL", 1), // LEGACY doc on a holiday
    [statusPath(f.emp, TUE)]: autoDoc(f.emp, TUE, "SCHL", 1),
  });

  const res = await cancel(f.admin, f, [FRI, SAT, SUN, HOL, TUE]);

  assert.deepEqual(res, {
    cancelled: [FRI, SAT, SUN, HOL, TUE], skippedDates: [], refundedDays: 2,
  }, "rest dates are neither reported as skipped nor refunded");
  assert.equal((await read(statusPath(f.emp, FRI))).status, "Absent");
  assert.equal((await read(statusPath(f.emp, TUE))).status, "Absent");
  assert.equal((await read(statusPath(f.emp, SUN))).status, "SCHL", "the Sunday doc is not touched");
  assert.equal((await read(statusPath(f.emp, HOL))).status, "SCHL", "the holiday doc is not touched");
  assert.equal((await read(`users/${f.emp}`)).plBalance, 7);
  assert.deepEqual(
    (await read(leavePath(f.emp, f.leave))).cancelledDates, [FRI, SAT, SUN, HOL, TUE],
    "every requested date is still recorded as cancelled",
  );
});

// ── 4. THE RACE ──────────────────────────────────────────────────────────

test("THE RACE: the trigger scores the day paid AFTER cancelLeave read it -> the transaction retries and reverts + refunds", async () => {
  const f = await fixture({ plBalance: 5 });
  const D = "2031-05-06";
  await seedLeave(f.emp, f.leave, { fromDate: D, toDate: D });
  // Approved late: the nightly already scored the day Absent/auto; the trigger has not run yet.
  await seedDocs(env, { [statusPath(f.emp, D)]: autoDoc(f.emp, D, "Absent") });

  let hookCalls = 0;
  const res = await cancel(f.admin, f, [D], {
    onAfterReads: async () => {
      hookCalls++;
      if (hookCalls === 1) await triggerScoresPaidSchl(f.emp, D);
    },
  });

  assert.equal(hookCalls, 2, "the callback must have re-executed exactly once");
  assert.deepEqual(res, { cancelled: [D], skippedDates: [], refundedDays: 1 });

  const s = await read(statusPath(f.emp, D));
  assert.equal(s.status, "Absent", "NOT a paid SCHL on a cancelled leave");
  assert.equal(s.markedBy, "admin");
  assert.equal("salaryCredit" in s, false);
  // The trigger burned 1 day (5 -> 4); the cancel refunds it (4 -> 5). Net unchanged.
  assert.equal((await read(`users/${f.emp}`)).plBalance, 5, "decrement + 1 refund: net unchanged");
  assert.deepEqual((await read(leavePath(f.emp, f.leave))).cancelledDates, [D]);
});

test("re-execution safety: after a forced retry neither refundedDays nor skippedDates is doubled or stale", async () => {
  const f = await fixture({ plBalance: 5 });
  const [D1, D2] = ["2031-05-05", "2031-05-06"];
  await seedLeave(f.emp, f.leave, { fromDate: D1, toDate: D2 });
  await seedDocs(env, {
    [statusPath(f.emp, D1)]: autoDoc(f.emp, D1, "SCHL", 1),   // paid on BOTH attempts (refund would double)
    [statusPath(f.emp, D2)]: autoDoc(f.emp, D2, "Absent"),    // attempt 1: a skip; attempt 2: a paid revert
  });

  let hookCalls = 0;
  const res = await cancel(f.admin, f, [D1, D2], {
    onAfterReads: async () => {
      hookCalls++;
      if (hookCalls === 1) await triggerScoresPaidSchl(f.emp, D2);
    },
  });

  assert.equal(hookCalls, 2);
  // Attempt 1 saw D1 paid (refund 1) and D2 Absent/auto (a skip); attempt 2 saw both paid.
  assert.deepEqual(res, {
    cancelled: [D1, D2],
    skippedDates: [],     // D2's attempt-1 skip must NOT leak into the result
    refundedDays: 2,      // not 3: attempt 1's refund of D1 must NOT carry over
  });
  assert.equal((await read(`users/${f.emp}`)).plBalance, 6, "5 - 1 (trigger) + 2 refunds");
  for (const d of [D1, D2]) assert.equal((await read(statusPath(f.emp, d))).status, "Absent");
});

test("another admin cancels the same day mid-flight -> the retry re-derives what is still granted from the IN-TRANSACTION leave and refuses to double-refund", async () => {
  const f = await fixture({ plBalance: 5 });
  const D = "2031-05-07";
  await seedLeave(f.emp, f.leave, { fromDate: D, toDate: D });
  await seedDocs(env, { [statusPath(f.emp, D)]: autoDoc(f.emp, D, "SCHL", 1) });

  let hookCalls = 0;
  await assert.rejects(
    cancel(f.admin, f, [D], {
      onAfterReads: async () => {
        hookCalls++;
        if (hookCalls > 1) return;
        // The OTHER admin's completed cancellation: revert + refund + record the date as cancelled.
        await env.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore()._delegate;
          await fsm.setDoc(fsm.doc(db, statusPath(f.emp, D)), { status: "Absent", markedBy: "admin", salaryCredit: fsm.deleteField() }, { merge: true });
          await fsm.updateDoc(fsm.doc(db, `users/${f.emp}`), { plBalance: fsm.increment(1) });
          await fsm.updateDoc(fsm.doc(db, leavePath(f.emp, f.leave)), { cancelledDates: [D] });
        });
      },
    }),
    /none of those dates are currently granted by this leave/,
  );

  // Attempt 1 read the day as granted + paid and reached the hook; the competing commit aborted it;
  // attempt 2 read the leave again, found the day already cancelled and threw BEFORE reaching the hook.
  assert.equal(hookCalls, 1);
  assert.equal((await read(`users/${f.emp}`)).plBalance, 6, "exactly ONE refund happened (the other admin's)");
});

// ── 5. the cap ───────────────────────────────────────────────────────────

/** `n` consecutive dates from 2031-01-01. */
function datesFrom2031(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(2031, 0, 1 + i)).toISOString().slice(0, 10));
  return out;
}

test("MAX_CANCEL_DATES + 1 dates are rejected before ANY write — nothing changes", async () => {
  const f = await fixture({ plBalance: 5 });
  await seedLeave(f.emp, f.leave, { fromDate: "2031-01-01", toDate: "2031-12-31" });
  await seedDocs(env, { [statusPath(f.emp, "2031-01-01")]: autoDoc(f.emp, "2031-01-01", "SCHL", 1) });

  await assert.rejects(
    cancel(f.admin, f, datesFrom2031(MAX_CANCEL_DATES + 1)),
    /cancel them in chunks of at most 200 dates/,
  );

  const s = await read(statusPath(f.emp, "2031-01-01"));
  assert.deepEqual([s.status, s.salaryCredit, s.markedBy], ["SCHL", 1, "auto"], "the scored day is untouched");
  assert.equal((await read(`users/${f.emp}`)).plBalance, 5);
  const leave = await read(leavePath(f.emp, f.leave));
  assert.equal("cancelledDates" in leave, false);
  assert.equal("cancelledBy" in leave, false);
});

test("exactly MAX_CANCEL_DATES dates are accepted (the cap is inclusive)", async () => {
  const f = await fixture({ plBalance: 5 });
  await seedLeave(f.emp, f.leave, { fromDate: "2031-01-01", toDate: "2031-12-31" });
  await seedDocs(env, { [statusPath(f.emp, "2031-01-02")]: autoDoc(f.emp, "2031-01-02", "SCHL", 1) });

  const dates = datesFrom2031(MAX_CANCEL_DATES);
  const res = await cancel(f.admin, f, dates);

  assert.equal(res.cancelled.length, MAX_CANCEL_DATES);
  assert.equal(res.refundedDays, 1);
  assert.equal((await read(`users/${f.emp}`)).plBalance, 6);
  assert.equal((await read(leavePath(f.emp, f.leave))).cancelledDates.length, MAX_CANCEL_DATES);
});

// ── 6. a non-admin Leaves manager ────────────────────────────────────────

test("a manager (Leaves + Attendance, not admin) cancelling a day that needs a refund is denied ATOMICALLY: nothing changes", async () => {
  const f = await fixture({ plBalance: 5 });
  const [D1, D2] = ["2031-03-03", "2031-03-04"];
  await seedLeave(f.emp, f.leave, { fromDate: D1, toDate: D2 });
  await seedDocs(env, {
    [statusPath(f.emp, D1)]: autoDoc(f.emp, D1, "SCHL", 1),
    [statusPath(f.emp, D2)]: autoDoc(f.emp, D2, "SCHL", 1),
  });

  await assert.rejects(cancel(f.mgr, f, [D1, D2]), (err) => err.code === "permission-denied");

  for (const d of [D1, D2]) {
    const s = await read(statusPath(f.emp, d));
    assert.deepEqual([s.status, s.salaryCredit, s.markedBy], ["SCHL", 1, "auto"], `${d} not reverted`);
  }
  assert.equal((await read(`users/${f.emp}`)).plBalance, 5, "no refund");
  assert.equal("cancelledDates" in (await read(leavePath(f.emp, f.leave))), false, "the leave is not cancelled either");
});

test("the same manager CAN cancel days that need no refund (unpaid SCHL) — the gate only bites on the user-doc write", async () => {
  const f = await fixture({ plBalance: 5 });
  const D = "2031-03-05";
  await seedLeave(f.emp, f.leave, { fromDate: D, toDate: D });
  await seedDocs(env, { [statusPath(f.emp, D)]: autoDoc(f.emp, D, "SCHL", 0) });

  const res = await cancel(f.mgr, f, [D]);

  assert.deepEqual(res, { cancelled: [D], skippedDates: [], refundedDays: 0 });
  assert.equal((await read(statusPath(f.emp, D))).status, "Absent");
  assert.equal((await read(`users/${f.emp}`)).plBalance, 5);
});
