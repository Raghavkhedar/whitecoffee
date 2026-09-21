"use strict";

// Real-database tests for the nightly body (nightlyRunner.js) — the read/score/write wrapper the
// 23:59 IST `computeDailyAttendanceStatus` schedule runs through the guard.
//
// The pure per-user scoring (nightlyScoring.js) is unit-tested by `npm test`; this suite covers
// what that suite cannot: the batch/transaction writes, the PL decrement, the rest-day branch, the
// run-summary contract, and the concurrent writers that race the run. It talks to the Firestore
// emulator with the Admin SDK, so it exercises REAL transaction semantics (real ABORTED, real
// contention, real batch limits). Deliberately NOT named *.test.js — the default `npm test`
// (`node --test`) must not pick it up.
//
//   cd firebase/functions && npm run test:emulator
//
// Requires the firebase CLI + Java (it starts the emulator via `firebase emulators:exec`).

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const { runNightlyScoring } = require("../nightlyRunner");

const PROJECT_ID = "demo-functions-test";
const { FieldValue, Timestamp } = admin.firestore;

const TODAY = "2026-09-21";       // a Monday — an ordinary working day
const SUNDAY = "2026-09-20";      // the rest-day branch
const STARTED_AT = Timestamp.fromMillis(Date.parse("2026-09-21T18:29:00Z"));
const CLOCK_SOURCE = "scheduleTime";

let db;

before(() => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  // Never let this suite touch a real project: it writes and wipes data.
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is not set — run via `npm run test:emulator` (firebase emulators:exec)");
  if (admin.apps.length === 0) admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.firestore();
});

after(async () => {
  await Promise.all(admin.apps.map((a) => a && a.delete()));
});

beforeEach(async () => {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(res.status, 200, "emulator wipe failed");
});

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

let uidSeq = 0;
const newUid = () => `emp${(uidSeq += 1).toString().padStart(4, "0")}`;

/** Seed one user. Returns the uid. */
async function seedUser({ uid = newUid(), role = "office", plBalance = 0, ...rest } = {}) {
  await db.doc(`users/${uid}`).set({
    name: `User ${uid}`, employeeId: `E-${uid}`, role, plBalance, ...rest,
  });
  return uid;
}

/** A punch. `hhmm` is IST wall-clock; the stored Timestamp is the matching UTC instant. */
async function seedPunch(uid, date, type, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const ms = Date.parse(`${date}T00:00:00+05:30`) + (h * 60 + m) * 60000;
  await db.collection(`users/${uid}/attendance`).doc().set({
    userId: uid, date, type, timestamp: Timestamp.fromMillis(ms),
  });
}

async function seedLeave(uid, over = {}) {
  const rid = over.id || "L1";
  delete over.id;
  await db.doc(`users/${uid}/leave_requests/${rid}`).set({
    userId: uid, userName: `User ${uid}`, type: "casual", reason: "family",
    status: "approved", fromDate: TODAY, toDate: TODAY, totalDays: 1, ...over,
  });
  return rid;
}

const seedStatus = (uid, date, data) => db.doc(`users/${uid}/attendance_status/${date}`).set(data);

function spyLog() {
  const calls = { log: [], warn: [], error: [] };
  return {
    calls,
    log: (...a) => calls.log.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
  };
}

/**
 * A delegating wrapper around the real emulator db. The runner only ever reaches Firestore through
 * `db.collection` / `db.collectionGroup` / `db.doc` / `db.batch` / `db.runTransaction`, so a
 * wrapper is enough to (a) count batch writes and commits, (b) count transactions, (c) inject a
 * competing writer that runs BEFORE a given transaction starts (the race injector — it writes with
 * the RAW db, so the runner's transaction genuinely contends with it), and (d) make a given
 * transaction throw.
 *
 * opts:
 *   beforeTransaction(n)  awaited before transaction #n (1-based) delegates. Do competing writes
 *                         here with the RAW db — they land between the start-of-run snapshot and
 *                         this user's transaction, which is the real race window.
 *   failForUser           { [uid]: times } — throw inside the transaction (right after its reads)
 *                         on the first `times` attempts for that user. A thrown non-ABORTED error
 *                         is not retried by Firestore, so one entry = one runner attempt.
 *   failBatchCommit       1-based index of the batch commit that should throw.
 */
function wrapDb({ beforeTransaction, failForUser = {}, failBatchCommit } = {}) {
  const rec = { transactions: 0, batches: [], commits: 0, txnWrites: [], txnUsers: [] };
  const remainingFailures = { ...failForUser };
  return {
    rec,
    doc: (p) => db.doc(p),
    collection: (p) => db.collection(p),
    collectionGroup: (p) => db.collectionGroup(p),
    getAll: (...refs) => db.getAll(...refs),
    batch: () => {
      const b = db.batch();
      const entry = { writes: 0, paths: [] };
      rec.batches.push(entry);
      return {
        set: (ref, data, options) => { entry.writes += 1; entry.paths.push(ref.path); return b.set(ref, data, options); },
        update: (ref, data) => { entry.writes += 1; entry.paths.push(ref.path); return b.update(ref, data); },
        commit: async () => {
          rec.commits += 1;
          if (failBatchCommit === rec.commits) throw new Error(`injected batch commit failure #${rec.commits}`);
          return b.commit();
        },
      };
    },
    runTransaction: async (fn, opts) => {
      const n = (rec.transactions += 1);
      if (beforeTransaction) await beforeTransaction(n);
      let attempt = [];
      const result = await db.runTransaction(async (tx) => {
        attempt = [];
        return fn({
          get: (q) => tx.get(q),
          getAll: async (...refs) => {
            const snaps = await tx.getAll(...refs);
            const uid = refs[0] ? refs[0].path.split("/")[1] : undefined;
            if (!rec.txnUsers.includes(uid)) rec.txnUsers.push(uid);
            if (remainingFailures[uid] > 0) {
              remainingFailures[uid] -= 1;
              throw new Error(`injected transaction failure for ${uid}`);
            }
            return snaps;
          },
          set: (ref, data, options) => { attempt.push({ op: "set", path: ref.path, options }); return tx.set(ref, data, options); },
          update: (ref, data) => { attempt.push({ op: "update", path: ref.path, data }); return tx.update(ref, data); },
        });
      }, opts);
      rec.txnWrites.push(...attempt);
      return result;
    },
  };
}

async function run({ today = TODAY, wrapper = wrapDb(), log = spyLog() } = {}) {
  await runNightlyScoring({
    db: wrapper, Timestamp, FieldValue,
    today, startedAt: STARTED_AT, clockSource: CLOCK_SOURCE, log,
  });
  return { rec: wrapper.rec, log };
}

const readStatus = async (uid, date = TODAY) => {
  const s = await db.doc(`users/${uid}/attendance_status/${date}`).get();
  return s.exists ? s.data() : undefined;
};
const readHours = async (uid, date = TODAY) => {
  const s = await db.doc(`users/${uid}/daily_hours/${date}`).get();
  return s.exists ? s.data() : undefined;
};
const readBalance = async (uid) => (await db.doc(`users/${uid}`).get()).data().plBalance;
const readSummary = async (date = TODAY) =>
  (await db.doc(`system/nightly_runs/computeDailyAttendanceStatus/${date}`).get()).data();

// ── 1. An ordinary working night — every branch of the scorer at once ─────────────────────────

test("1. a normal night writes status docs, daily_hours for ops, and decrements PL for a paid SCHL", async () => {
  const present = await seedUser({ role: "office" });
  const absent  = await seedUser({ role: "office" });
  const onLeave = await seedUser({ role: "office", plBalance: 2 });
  const ops     = await seedUser({ role: "operations" });
  await seedPunch(present, TODAY, "office_in", "10:00");
  await seedPunch(present, TODAY, "office_out", "18:00");
  await seedLeave(onLeave);
  await seedPunch(ops, TODAY, "site_in", "09:30");
  await seedPunch(ops, TODAY, "site_out", "19:00");
  await db.doc(`users/${ops}/planned_hours/${TODAY}`).set({ startTime: "10:00", endTime: "18:00" });

  const { rec, log } = await run();

  assert.equal((await readStatus(present)).status, "Present");
  assert.equal((await readStatus(absent)).status, "Absent");
  assert.equal((await readStatus(onLeave)).status, "SCHL");
  assert.equal((await readStatus(onLeave)).salaryCredit, 1);
  assert.equal((await readStatus(ops)).status, "Present");
  assert.equal(await readBalance(onLeave), 1, "one PL day drawn");
  assert.equal(await readBalance(absent), 0, "an Absent day never draws balance");

  // daily_hours ONLY for the ops user (the role that runs the OT/shortage ledger), and only
  // because the day has both punches.
  assert.deepEqual(await readHours(ops), {
    date: TODAY, userId: ops, role: "operations",
    plannedMins: 480, actualMins: 570, shortageMins: 0, otMins: 60,
    updatedAt: (await readHours(ops)).updatedAt,
  });
  assert.equal(await readHours(present), undefined);
  assert.equal(await readHours(absent), undefined);
  assert.equal(await readHours(onLeave), undefined);

  assert.equal(rec.commits, 1, "one fast batch commit");
  // Punch-decided days ride the batch; Absent and SCHL each get their own transaction.
  assert.equal(rec.transactions, 2);
  assert.deepEqual(rec.txnUsers.sort(), [absent, onLeave].sort());
  assert.equal(log.calls.error.length, 0);
});

// ── 2. The run summary contract ───────────────────────────────────────────────────────────────

test("2. the run summary has EXACTLY its documented key set and values", async () => {
  const present = await seedUser({ role: "office" });
  const onLeave = await seedUser({ role: "office", plBalance: 1 });
  const marked  = await seedUser({ role: "office" });
  await seedPunch(present, TODAY, "office_in", "10:00");
  await seedPunch(present, TODAY, "office_out", "18:00");
  await seedLeave(onLeave);
  await seedStatus(marked, TODAY, { status: "WO", markedBy: "admin", date: TODAY, userId: marked });

  await run();
  const s = await readSummary();

  assert.deepEqual(Object.keys(s).sort(), [
    "activeUsers", "adminMarked", "clockSource", "date", "expected", "failures",
    "ok", "plAttempted", "plDeducted", "plFailures", "ranAt", "scored", "startedAt",
  ]);
  assert.equal(s.date, TODAY);
  assert.equal(s.activeUsers, 3);
  assert.equal(s.adminMarked, 1);
  assert.equal(s.expected, 2);
  assert.equal(s.scored, 2);
  assert.equal(s.plAttempted, 1);
  assert.equal(s.plDeducted, 1);
  assert.deepEqual(s.failures, []);
  assert.deepEqual(s.plFailures, []);
  assert.equal(s.ok, true);
  assert.equal(s.startedAt.toMillis(), STARTED_AT.toMillis());
  assert.equal(s.clockSource, CLOCK_SOURCE);
  // The admin-marked day is untouched.
  assert.equal((await readStatus(marked)).status, "WO");
});

// ── 3. Rest days ──────────────────────────────────────────────────────────────────────────────

test("3a. Sunday: every doc-less user gets a Sunday doc, the run returns early with NO summary", async () => {
  const a = await seedUser();
  const b = await seedUser();
  await seedStatus(b, SUNDAY, { status: "Present", markedBy: "auto", date: SUNDAY, userId: b });

  const { rec } = await run({ today: SUNDAY });

  assert.equal((await readStatus(a, SUNDAY)).status, "Sunday");
  assert.equal((await readStatus(a, SUNDAY)).markedBy, "auto");
  assert.equal((await readStatus(a, SUNDAY)).salaryCredit, undefined, "a Sunday doc carries no credit field");
  assert.equal((await readStatus(b, SUNDAY)).status, "Present", "an existing doc wins, auto or admin");
  assert.equal(await readSummary(SUNDAY), undefined, "the rest-day branch writes no summary");
  assert.equal(rec.commits, 1);
});

test("3b. Holiday: an ops employee who worked it has the +1 withdrawn (paid via OT instead)", async () => {
  const worked = await seedUser({ role: "operations" });
  const idle   = await seedUser({ role: "operations" });
  await db.doc(`holidays/${TODAY}`).set({ name: "Test Holiday" });
  await seedPunch(worked, TODAY, "site_in", "10:00");
  await seedPunch(worked, TODAY, "site_out", "18:00");

  await run();

  assert.equal((await readStatus(worked)).status, "Holiday");
  assert.equal((await readStatus(worked)).salaryCredit, 0);
  assert.equal((await readStatus(idle)).status, "Holiday");
  assert.equal((await readStatus(idle)).salaryCredit, 1);
  assert.equal(await readSummary(), undefined);
});

// ── 4. Ops with no planned_hours falls back to the 10:00–18:00 default ─────────────────────────

test("4. an ops user with no planned_hours is scored (and its hours computed) on the default window", async () => {
  const ops = await seedUser({ role: "operations" });
  await seedPunch(ops, TODAY, "site_in", "10:30");
  await seedPunch(ops, TODAY, "site_out", "17:30");

  await run();

  assert.equal((await readStatus(ops)).status, "HalfDay", "30 late + 30 early = 60 off-minutes");
  assert.deepEqual(
    (({ plannedMins, actualMins, shortageMins, otMins }) => ({ plannedMins, actualMins, shortageMins, otMins }))(await readHours(ops)),
    { plannedMins: 480, actualMins: 420, shortageMins: 60, otMins: 0 },
  );
});

// ── 5. Offboarded / partially-approved leave ──────────────────────────────────────────────────

test("5a. an offboarded user (active:false) is skipped entirely — no doc, no Absent penalty", async () => {
  const gone = await seedUser({ active: false });
  const here = await seedUser();

  await run();

  assert.equal(await readStatus(gone), undefined);
  assert.equal((await readStatus(here)).status, "Absent");
  assert.equal((await readSummary()).activeUsers, 1);
});

test("5b. a partially-approved leave that does NOT grant today scores Absent", async () => {
  const uid = await seedUser({ plBalance: 3 });
  await seedLeave(uid, { fromDate: TODAY, toDate: "2026-09-22", totalDays: 2, approvedDates: ["2026-09-22"] });

  await run();

  assert.equal((await readStatus(uid)).status, "Absent");
  assert.equal(await readBalance(uid), 3, "an ungranted date never draws balance");
});

test("5c. SCHL with a zero balance is unpaid and draws nothing", async () => {
  const uid = await seedUser({ plBalance: 0 });
  await seedLeave(uid);

  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 0);
  assert.equal(await readBalance(uid), 0);
  assert.equal((await readSummary()).plAttempted, 0);
});

// ── 6. Idempotency: a second run of the same date must not draw the balance twice ──────────────

test("6a. a re-run over a paid SCHL doc does not decrement again", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);

  await run();
  assert.equal(await readBalance(uid), 1);
  const first = await readStatus(uid);

  await run();
  const second = await readStatus(uid);

  assert.equal(await readBalance(uid), 1, "exactly one decrement across two runs");
  assert.equal(second.status, first.status);
  assert.equal(second.salaryCredit, 1);
  assert.equal((await readSummary()).plAttempted, 0, "the second run attempts nothing");
});

test("6b. a LEGACY `PL` prior doc (no salaryCredit field) also blocks the decrement", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, { status: "PL", markedBy: "auto", date: TODAY, userId: uid });

  await run();

  assert.equal(await readBalance(uid), 2, "a legacy PL day already drew its balance day");
  assert.equal((await readStatus(uid)).status, "SCHL");
});

// ── 7. The status doc is a FULL set: a stale salaryCredit does not survive a rewrite ───────────

test("7. rewriting an SCHL day as Absent removes the stale salaryCredit (full set, no merge)", async () => {
  const uid = await seedUser({ plBalance: 0 });
  await seedStatus(uid, TODAY, {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "office",
    status: "SCHL", salaryCredit: 1, markedBy: "auto", updatedAt: Timestamp.now(),
  });
  // No leave doc this run → the day scores Absent.

  await run();

  const s = await readStatus(uid);
  assert.equal(s.status, "Absent");
  assert.equal("salaryCredit" in s, false, "the credit field is GONE, not left at 1");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The races (design §4.2). Every injection below happens with the RAW db BETWEEN the
// start-of-run snapshot and the racing user's transaction — the real window, and the one the
// old code could not survive.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// ── (b) plBalance drawn by another writer during the run ──────────────────────────────────────

test("(b) a competing decrement between the scan and the txn: the day scores UNPAID, balance never goes -1", async () => {
  const uid = await seedUser({ plBalance: 1 });
  await seedLeave(uid);

  // Exactly what a concurrent scoreRetroactiveLeave transaction does: draw the last balance day.
  const wrapper = wrapDb({
    beforeTransaction: async () => { await db.doc(`users/${uid}`).update({ plBalance: FieldValue.increment(-1) }); },
  });
  await run({ wrapper });

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(s.salaryCredit, 0, "the balance was gone by the time this transaction read it");
  assert.equal(await readBalance(uid), 0, "never -1: two paid days can no longer be drawn from one balance day");
  const summary = await readSummary();
  assert.equal(summary.plAttempted, 0);
  assert.equal(summary.plDeducted, 0);
  assert.equal(summary.ok, true);
});

// ── (c) another writer produced the day's status doc during the run ───────────────────────────

test("(c) a trigger-written SCHL landing mid-run is READ by the transaction — no second draw", async () => {
  const uid = await seedUser({ plBalance: 1 });
  await seedLeave(uid);

  const wrapper = wrapDb({
    beforeTransaction: async () => {
      // scoreRetroactiveLeave's shape: markedBy 'auto', so the old adminOverrides skip missed it.
      await db.doc(`users/${uid}/attendance_status/${TODAY}`).set(
        { status: "SCHL", salaryCredit: 1, markedBy: "auto", updatedAt: Timestamp.now() }, { merge: true },
      );
      await db.doc(`users/${uid}`).update({ plBalance: FieldValue.increment(-1) });
    },
  });
  await run({ wrapper });

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(await readBalance(uid), 0, "decremented exactly ONCE overall — the nightly did not draw it again");
  assert.equal((await readSummary()).plDeducted, 0);
  // ⚠ PRE-EXISTING SCORING BUG, pinned here rather than fixed (it is a payroll policy decision,
  // not part of this change): `salaryCredit` is re-derived from the balance as it is NOW, and the
  // balance that funded THIS day has already been spent — so a day that is already recorded paid
  // is rewritten unpaid. See the dedicated test at the end of this file for the plain (no-race)
  // reproduction and the reasoning. The old code had the identical rule; it just reached it less
  // often, because it was busy double-drawing the balance instead (this was race (b)).
  assert.equal(s.salaryCredit, 0, "PINNED, NOT ENDORSED: the already-paid day is rewritten unpaid");
});

test("(c-contention) two concurrent full runs of the same date draw the balance exactly once", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);

  // Two real runs against one emulator: their per-user transactions genuinely contend on
  // users/{uid} and attendance_status/{today}, and Firestore serializes them.
  await Promise.all([run(), run()]);

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(s.salaryCredit, 1);
  assert.equal(await readBalance(uid), 1, "exactly one decrement, never 0 and never -1");
});

test("(c') an admin doc written mid-run survives byte-for-byte and the user is not scored", async () => {
  const uid   = await seedUser({ plBalance: 2 });
  const other = await seedUser({ plBalance: 2 });
  await seedLeave(uid);
  await seedLeave(other);

  const adminDoc = {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "office",
    status: "WO", markedBy: "admin", updatedAt: Timestamp.fromMillis(Date.parse("2026-09-21T10:00:00Z")),
  };
  const wrapper = wrapDb({
    beforeTransaction: async () => {
      const existing = await db.doc(`users/${uid}/attendance_status/${TODAY}`).get();
      if (!existing.exists) await db.doc(`users/${uid}/attendance_status/${TODAY}`).set(adminDoc);
    },
  });
  await run({ wrapper });

  assert.deepEqual(await readStatus(uid), adminDoc, "the admin's decision is never silently rewritten");
  assert.equal(await readBalance(uid), 2, "and it draws no balance");
  assert.equal((await readStatus(other)).status, "SCHL", "everyone else is still scored");

  // RULING: an admin marking a day DURING the run is counted as admin-marked and drops out of
  // `expected`, so `ok` stays true — the day is scored, by a human.
  const s = await readSummary();
  assert.equal(s.activeUsers, 2);
  assert.equal(s.adminMarked, 1);
  assert.equal(s.expected, 1);
  assert.equal(s.scored, 1);
  assert.equal(s.ok, true, "an admin decision landing mid-run must NOT make the night look broken");
});

// ── (d) / (1.5) the leave set is re-read inside the transaction ───────────────────────────────

test("(d)/(1.5) a leave approved DURING the run is seen: the day scores SCHL and draws once", async () => {
  const uid = await seedUser({ plBalance: 2 });
  // No leave at snapshot time → the snapshot scores Absent.

  const wrapper = wrapDb({
    beforeTransaction: async () => { await seedLeave(uid); },
  });
  await run({ wrapper });

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL", "the stale leave snapshot no longer decides the day");
  assert.equal(s.salaryCredit, 1);
  assert.equal(await readBalance(uid), 1, "drawn exactly once");
  assert.equal((await readSummary()).plDeducted, 1);
});

test("(d-mirror) a leave cancelled DURING the run is seen too: the day scores Absent, nothing drawn", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);

  const wrapper = wrapDb({
    beforeTransaction: async () => { await db.doc(`users/${uid}/leave_requests/L1`).update({ cancelledDates: [TODAY] }); },
  });
  await run({ wrapper });

  const s = await readStatus(uid);
  assert.equal(s.status, "Absent");
  assert.equal("salaryCredit" in s, false);
  assert.equal(await readBalance(uid), 2);
});

test("(d-mirror2) a leave DELETED during the run scores Absent", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);

  const wrapper = wrapDb({
    beforeTransaction: async () => { await db.doc(`users/${uid}/leave_requests/L1`).delete(); },
  });
  await run({ wrapper });

  assert.equal((await readStatus(uid)).status, "Absent");
  assert.equal(await readBalance(uid), 2);
});

test("(d) only APPROVED leave counts: a pending request landing mid-run leaves the day Absent", async () => {
  const uid = await seedUser({ plBalance: 2 });

  const wrapper = wrapDb({
    beforeTransaction: async () => { await seedLeave(uid, { status: "pending" }); },
  });
  await run({ wrapper });

  assert.equal((await readStatus(uid)).status, "Absent");
  assert.equal(await readBalance(uid), 2);
});

// ── A punched day never enters a transaction, even with an approved leave ─────────────────────

test("a user with an approved leave for today WHO PUNCHED is Present, on the fast path, drawing nothing", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);
  await seedPunch(uid, TODAY, "office_in", "10:00");
  await seedPunch(uid, TODAY, "office_out", "18:00");

  const { rec } = await run();

  assert.equal((await readStatus(uid)).status, "Present");
  assert.equal(rec.transactions, 0, "punch-decided days never pay for a transaction");
  assert.equal(await readBalance(uid), 2);
});

test("an all-fast night runs ZERO transactions and writes exactly the batch it always did", async () => {
  const a = await seedUser({ role: "office" });
  const b = await seedUser({ role: "operations" });
  await seedPunch(a, TODAY, "office_in", "10:00");
  await seedPunch(a, TODAY, "office_out", "18:00");
  await seedPunch(b, TODAY, "site_in", "10:00");
  await seedPunch(b, TODAY, "site_out", "18:00");

  const { rec } = await run();

  assert.equal(rec.transactions, 0);
  assert.equal(rec.commits, 1);
  assert.equal(rec.batches[0].writes, 3, "2 status docs + 1 daily_hours for the ops user");
  assert.equal((await readStatus(a)).status, "Present");
  assert.equal((await readStatus(b)).status, "Present");
  assert.ok(await readHours(b));
  assert.equal(await readHours(a), undefined);
  const s = await readSummary();
  assert.equal(s.scored, 2);
  assert.equal(s.expected, 2);
  assert.equal(s.ok, true);
});

test("a transactional user never gets a daily_hours doc", async () => {
  const absent  = await seedUser({ role: "operations" });
  const onLeave = await seedUser({ role: "operations", plBalance: 1 });
  await seedLeave(onLeave);
  await db.doc(`users/${absent}/planned_hours/${TODAY}`).set({ startTime: "09:00", endTime: "17:00" });

  const { rec } = await run();

  assert.equal(rec.transactions, 2);
  assert.equal(await readHours(absent), undefined);
  assert.equal(await readHours(onLeave), undefined);
  assert.equal(rec.txnWrites.filter((w) => w.path.includes("daily_hours")).length, 0);
});

// ── Failure and retry ─────────────────────────────────────────────────────────────────────────

test("a transaction that fails TWICE puts that user in `failures`; everyone else is still scored", async () => {
  const doomed = await seedUser({ plBalance: 1 });
  const ok1    = await seedUser({ plBalance: 1 });
  const ok2    = await seedUser({ role: "office" });
  await seedLeave(doomed);
  await seedLeave(ok1);

  const wrapper = wrapDb({ failForUser: { [doomed]: 2 } });
  const { log } = await run({ wrapper });

  assert.equal(await readStatus(doomed), undefined, "no partial doc: there is deliberately NO non-transactional fallback");
  assert.equal(await readBalance(doomed), 1, "and no balance was drawn");
  assert.equal((await readStatus(ok1)).status, "SCHL");
  assert.equal((await readStatus(ok2)).status, "Absent");

  const s = await readSummary();
  assert.equal(s.failures.length, 1);
  assert.equal(s.failures[0].userId, doomed);
  assert.equal(s.failures[0].employeeId, `E-${doomed}`);
  assert.match(s.failures[0].message, /injected transaction failure/);
  assert.deepEqual(Object.keys(s.failures[0]).sort(), ["employeeId", "message", "userId"]);
  assert.equal(s.scored, 2);
  assert.equal(s.expected, 3);
  assert.notEqual(s.scored, s.expected);
  assert.equal(s.ok, false);
  assert.equal(s.plDeducted, 1, "only ok1 drew a day");
  assert.ok(log.calls.error.some((a) => String(a[0]).includes(doomed)));
});

test("a transaction that fails ONCE is retried and succeeds — no failure recorded", async () => {
  const flaky = await seedUser({ plBalance: 1 });
  await seedLeave(flaky);

  const wrapper = wrapDb({ failForUser: { [flaky]: 1 } });
  const { log } = await run({ wrapper });

  assert.equal((await readStatus(flaky)).status, "SCHL");
  assert.equal((await readStatus(flaky)).salaryCredit, 1);
  assert.equal(await readBalance(flaky), 0, "drawn exactly once across the failed attempt and the retry");
  const s = await readSummary();
  assert.deepEqual(s.failures, []);
  assert.equal(s.scored, 1);
  assert.equal(s.ok, true);
  assert.equal(log.calls.error.length, 0);
});

test("a user deleted mid-run is skipped, NOT admin-marked, and the night alarms (ok:false)", async () => {
  const vanishing = await seedUser({ plBalance: 1 });
  const staying   = await seedUser({ plBalance: 1 });
  await seedLeave(vanishing);
  await seedLeave(staying);

  const wrapper = wrapDb({
    beforeTransaction: async () => { await db.doc(`users/${vanishing}`).delete(); },
  });
  const { log } = await run({ wrapper });

  assert.equal(await readStatus(vanishing), undefined);
  assert.equal((await readStatus(staying)).status, "SCHL");
  const s = await readSummary();
  assert.equal(s.activeUsers, 2);
  assert.equal(s.adminMarked, 0, "a vanished user is NOT counted as admin-marked");
  assert.equal(s.expected, 2);
  assert.equal(s.scored, 1);
  assert.equal(s.ok, false, "somebody who should have been scored was not — that must alarm");
  assert.deepEqual(s.failures, [], "it is a skip, not a failure");
  assert.ok(log.calls.error.some((a) => String(a[0]).includes("disappeared during the run")));
});

// ── Back-to-back full runs of the same date (a retry of D after a completed D) ────────────────

test("a second full run of the same date is idempotent: identical statuses, one decrement in total", async () => {
  const present = await seedUser({ role: "office" });
  const absent  = await seedUser({ role: "office", plBalance: 1 });
  // plBalance 2, so the draw leaves 1 behind. With exactly 1 the day would be rewritten UNPAID on
  // the second run — a pre-existing scoring rule, pinned by the next test.
  const onLeave = await seedUser({ role: "office", plBalance: 2 });
  await seedPunch(present, TODAY, "office_in", "10:00");
  await seedPunch(present, TODAY, "office_out", "18:00");
  await seedLeave(onLeave);

  await run();
  const after1 = {
    present: await readStatus(present), absent: await readStatus(absent), onLeave: await readStatus(onLeave),
  };
  assert.equal(await readBalance(onLeave), 1);

  await run();
  const after2 = {
    present: await readStatus(present), absent: await readStatus(absent), onLeave: await readStatus(onLeave),
  };

  for (const k of ["present", "absent", "onLeave"]) {
    assert.equal(after2[k].status, after1[k].status, `${k} status identical across runs`);
    assert.equal(after2[k].salaryCredit, after1[k].salaryCredit, `${k} salaryCredit identical across runs`);
  }
  assert.equal(await readBalance(onLeave), 1, "decremented exactly once in total, never below the true value");
  assert.equal(await readBalance(absent), 1);
  const s = await readSummary();
  assert.equal(s.plDeducted, 0, "the second run draws nothing");
  assert.equal(s.ok, true);
});

// ── A PRE-EXISTING scoring bug this work surfaced. PINNED, NOT FIXED. ─────────────────────────
//
// `scoreUserDay` derives `salaryCredit` from the balance it is handed, and the nightly writes the
// status doc with a FULL set. On a re-run of a date that has ALREADY been scored as a paid leave
// day, the balance that funded that day is already gone, so the day is re-derived as UNPAID and
// the full set overwrites `salaryCredit: 1` with `salaryCredit: 0`. The employee silently loses a
// day of pay that their balance genuinely paid for, and the balance day is not returned.
//
// This is NOT introduced here — the rule is identical in the pre-transaction code (verify:
// `scoreUserDay({role:'office', events:[], leave:{}, plBalance:0})` → `salaryCredit: 0`, and the
// batch write was already a full `set`). This change makes it slightly more reachable, because the
// same-date re-run that used to corrupt the balance to −1 (race (b)) now lands here instead.
//
// The fix is a payroll policy decision and deliberately out of scope: the natural candidate is to
// score with `plBalance + 1` when `prior` already recorded this date as paid (exactly the
// condition `shouldDecrementPlBalance` tests), which would make the rescoring exactly idempotent.
// Raised for the owner rather than taken unilaterally.
test("KNOWN BUG (pinned, pre-existing): a re-run whose draw emptied the balance rewrites the paid day UNPAID", async () => {
  const uid = await seedUser({ plBalance: 1 });
  await seedLeave(uid);

  await run();
  assert.equal((await readStatus(uid)).salaryCredit, 1, "run 1: paid, funded by the last balance day");
  assert.equal(await readBalance(uid), 0);

  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 0,
    "run 2 rewrites the SAME day unpaid — the balance that paid for it is already spent");
  assert.equal(await readBalance(uid), 0, "at least the balance is not drawn twice (that part IS fixed)");
});
