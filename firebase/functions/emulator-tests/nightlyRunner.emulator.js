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
 *   beforeTransaction(n)  awaited before transaction #n (1-based) delegates. Do competing writes here.
 *   failTransaction       { [n]: times } — throw on the first `times` attempts of transaction #n.
 *   failBatchCommit       1-based index of the batch commit that should throw.
 */
function wrapDb({ beforeTransaction, failTransaction = {}, failBatchCommit } = {}) {
  const rec = { transactions: 0, batches: [], commits: 0, txnWrites: [] };
  const remainingFailures = { ...failTransaction };
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
      if (remainingFailures[n] > 0) {
        remainingFailures[n] -= 1;
        throw new Error(`injected transaction failure #${n}`);
      }
      let attempt = [];
      const result = await db.runTransaction(async (tx) => {
        attempt = [];
        return fn({
          get: (q) => tx.get(q),
          getAll: (...refs) => tx.getAll(...refs),
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
