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
  // The day the trigger already paid for stays PAID: the transaction scores against an effective
  // balance that adds back the day this date has already drawn, so the spend is not counted twice.
  assert.equal(s.salaryCredit, 1, "the already-paid day is left paid, not silently rewritten unpaid");
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

// ── Re-scoring a date is IDEMPOTENT, including the paid/unpaid decision ───────────────────────
//
// `scoreUserDay` derives `salaryCredit` from the balance it is handed. On a re-run of a date that
// was ALREADY scored as a paid leave day, the balance day that funded it is already spent, so
// re-deriving from the live balance would count that spend twice and the full `set` would rewrite
// the day UNPAID — a silent pay cut on a scheduler retry, which Step A made a real scenario
// (a retry now re-scores the SAME date D). The transaction therefore scores against an EFFECTIVE
// balance that adds the drawn day back, keyed on the same predicate that guards the decrement.

test("(a) balance 1: a same-date re-run keeps the paid day PAID and draws nothing more", async () => {
  const uid = await seedUser({ plBalance: 1 });
  await seedLeave(uid);

  await run();
  assert.equal((await readStatus(uid)).salaryCredit, 1, "run 1: paid, funded by the last balance day");
  assert.equal(await readBalance(uid), 0);

  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 1, "run 2 re-scores the SAME decision, it does not reverse it");
  assert.equal(await readBalance(uid), 0, "and draws nothing more");
  assert.equal((await readSummary()).plDeducted, 0);
});

test("(b) balance 2: two consecutive same-date runs leave credit 1 and exactly one day drawn", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);

  await run();
  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 1);
  assert.equal(await readBalance(uid), 1, "one draw in total across both runs");
});

test("(c) an UNPAID prior SCHL stays unpaid while the balance is still 0", async () => {
  const uid = await seedUser({ plBalance: 0 });
  await seedLeave(uid);

  await run();
  assert.equal((await readStatus(uid)).salaryCredit, 0);

  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 0, "nothing funded it, so nothing is added back");
  assert.equal(await readBalance(uid), 0);
});

// INTENDED, and a deliberate DIVERGENCE from scoreRetroactiveLeave — see the report note.
// The day was unpaid only for want of balance; once balance exists, a re-score of that date pays
// it and draws exactly one day. The retro-leave trigger would NOT do this: planRetroLeaveScoring
// only converts `Absent` + `auto` days (retroLeaveScoring.js: `existing.status !== "Absent"` →
// continue), so it never upgrades an existing unpaid SCHL. Pinned here, not reconciled.
test("(c2) an UNPAID prior SCHL is UPGRADED to paid once the balance is topped up, drawing once", async () => {
  const uid = await seedUser({ plBalance: 0 });
  await seedLeave(uid);

  await run();
  assert.equal((await readStatus(uid)).salaryCredit, 0);

  // e.g. accrueMonthlyLeave lands between the two attempts.
  await db.doc(`users/${uid}`).update({ plBalance: 1 });
  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 1);
  assert.equal(await readBalance(uid), 0, "drawn exactly once");
  assert.equal((await readSummary()).plDeducted, 1);
});

// The nightly never refunds: `cancelLeave` owns the refund, and it does it in its own transaction
// (admin/src/lib/firestore.ts). If the nightly added a day back here it would double-refund a
// cancellation that already refunded. So the day is rewritten Absent and the balance is left alone.
test("(d) a paid prior SCHL whose leave no longer covers the date becomes Absent, with NO refund here", async () => {
  const uid = await seedUser({ plBalance: 2 });
  await seedLeave(uid);

  await run();
  assert.equal((await readStatus(uid)).salaryCredit, 1);
  assert.equal(await readBalance(uid), 1);

  await db.doc(`users/${uid}/leave_requests/L1`).update({ cancelledDates: [TODAY] });
  await run();

  const s = await readStatus(uid);
  assert.equal(s.status, "Absent");
  assert.equal("salaryCredit" in s, false, "the full set clears the stale credit");
  assert.equal(await readBalance(uid), 1, "the nightly does not refund — cancelLeave owns that");
});

test("(e) a legacy `PL` prior doc with a ZERO balance stays PAID and draws nothing", async () => {
  const uid = await seedUser({ plBalance: 0 });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, { status: "PL", markedBy: "auto", date: TODAY, userId: uid });

  await run();

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(s.salaryCredit, 1, "a legacy PL day already drew its balance day, so it stays paid");
  assert.equal(await readBalance(uid), 0, "and it is not drawn again");
  assert.equal((await readSummary()).plDeducted, 0);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The 400-write chunking of the fast batch (Firestore's cap is 500 per batch, and a fast user
// costs 1 write, or 2 when they also get a daily_hours doc — so one bulk batch used to fail the
// WHOLE night at ~250 employees).
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Seed `n` punched users in bulk (raw batches, not the runner's). Returns their uids. */
async function seedPunchedCrowd({ office, ops }) {
  const uids = [];
  const writes = [];
  for (let i = 0; i < office + ops; i++) {
    const isOps = i >= office;
    const uid = newUid();
    uids.push(uid);
    writes.push([db.doc(`users/${uid}`), {
      name: `User ${uid}`, employeeId: `E-${uid}`, role: isOps ? "operations" : "office", plBalance: 0,
    }]);
    for (const [type, hhmm] of [[isOps ? "site_in" : "office_in", "10:00"], [isOps ? "site_out" : "office_out", "18:00"]]) {
      const [h, m] = hhmm.split(":").map(Number);
      writes.push([db.collection(`users/${uid}/attendance`).doc(), {
        userId: uid, date: TODAY, type, timestamp: Timestamp.fromMillis(Date.parse(`${TODAY}T00:00:00+05:30`) + (h * 60 + m) * 60000),
      }]);
    }
  }
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    writes.slice(i, i + 400).forEach(([ref, data]) => b.set(ref, data));
    await b.commit();
  }
  return uids;
}

const countDocs = async (collectionId) => (await db.collectionGroup(collectionId).where("date", "==", TODAY).get()).size;

test("450 fast users (600 writes) land in chunks of at most 400, all docs written", async () => {
  // 300 office (1 write each) + 150 operations with both punches (2 writes each) = 600 writes:
  // over the 400 chunk limit and over the 500 cap production Firestore enforces. NOTE: the
  // emulator does NOT enforce that cap, so this test proves the CHUNKING (sizes counted through
  // the db wrapper), not the rejection — an unchunked batch would pass here and fail in prod.
  const uids = await seedPunchedCrowd({ office: 300, ops: 150 });

  const { rec } = await run();

  assert.equal(await countDocs("attendance_status"), 450, "every status doc landed");
  assert.equal(await countDocs("daily_hours"), 150, "every ops daily_hours doc landed");

  const totalWrites = rec.batches.reduce((n, b) => n + b.writes, 0);
  assert.equal(totalWrites, 600);
  assert.ok(rec.batches.every((b) => b.writes <= 400), `every chunk is <= 400 writes: ${rec.batches.map((b) => b.writes)}`);
  assert.equal(rec.commits, rec.batches.length, "every chunk is committed exactly once");
  assert.equal(rec.commits, 2, "600 writes at a 400 limit = 2 chunks");
  assert.equal(rec.transactions, 0, "punched users never enter a transaction");

  // A user's two documents are never split across chunks by this packing: the boundary check
  // reserves room for both before opening the user.
  const statusOwners = new Set();
  rec.batches.forEach((b) => b.paths.forEach((p) => {
    if (p.includes("/attendance_status/")) statusOwners.add(p.split("/")[1]);
  }));
  assert.equal(statusOwners.size, 450);

  const s = await readSummary();
  assert.equal(s.scored, 450);
  assert.equal(s.expected, 450);
  assert.equal(s.ok, true);
  assert.equal((await readStatus(uids[0])).status, "Present");
  assert.equal((await readStatus(uids[449])).status, "Present");
});

test("exactly 400 writes still commits as ONE chunk (the limit is inclusive)", async () => {
  await seedPunchedCrowd({ office: 400, ops: 0 });

  const { rec } = await run();

  assert.equal(rec.commits, 1);
  assert.equal(rec.batches[0].writes, 400);
  assert.equal(await countDocs("attendance_status"), 400);
});

test("401 writes split 400 + 1", async () => {
  await seedPunchedCrowd({ office: 401, ops: 0 });

  const { rec } = await run();

  assert.equal(rec.commits, 2);
  assert.deepEqual(rec.batches.map((b) => b.writes), [400, 1]);
  assert.equal(await countDocs("attendance_status"), 401);
});

test("a mid-way chunk commit failure THROWS (nothing swallowed) and a retry converges", async () => {
  await seedPunchedCrowd({ office: 300, ops: 150 });

  // The SECOND chunk fails: the first has already landed, so this is the genuinely partial case.
  const wrapper = wrapDb({ failBatchCommit: 2 });
  await assert.rejects(run({ wrapper }), /injected batch commit failure #2/,
    "an infra failure on any chunk aborts the run so the scheduler retries the date");

  const partial = await countDocs("attendance_status");
  assert.ok(partial > 0 && partial < 450, `the first chunk landed and the second did not (${partial})`);
  assert.equal(await readSummary(), undefined, "no summary is written for a run that threw");

  // The retry: every write is a `set` on a deterministic id, so the already-committed chunk is
  // simply rewritten.
  const { rec } = await run();
  assert.equal(await countDocs("attendance_status"), 450);
  assert.equal(await countDocs("daily_hours"), 150);
  assert.equal(rec.commits, 2);
  const s = await readSummary();
  assert.equal(s.scored, 450);
  assert.equal(s.ok, true);
});

// ── The effective balance counts only a PL DRAW, not any prior `salaryCredit: 1` ──────────────
//
// A Holiday doc also carries `salaryCredit: 1` (the rest-day branch writes it via
// resolveHolidayCredit), but that credit is the holiday's own pay — it is NOT a drawn PL day. If
// the effective balance added a day back for it, a leave day re-scored over a stale Holiday doc
// would be paid out of thin air. Reachable: the holiday doc is scored first, an admin then
// removes `holidays/{date}` (wrong date entered), and the date is re-scored as a working day.

test("F1 a stale HOLIDAY prior (credit 1) is NOT a PL draw: with balance 0 the leave day is UNPAID", async () => {
  const uid = await seedUser({ plBalance: 0 });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "office",
    status: "Holiday", salaryCredit: 1, markedBy: "auto", updatedAt: Timestamp.now(),
  });
  // holidays/{TODAY} deliberately absent — the date is scored as an ordinary working day now.

  await run();

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(s.salaryCredit, 0, "no balance funded this day, so it must not be paid");
  assert.equal(await readBalance(uid), 0, "and nothing is minted");
  assert.equal((await readSummary()).plDeducted, 0);
});

test("F1 a stale HOLIDAY prior (credit 1) with balance 1: paid, and the balance IS drawn once", async () => {
  const uid = await seedUser({ plBalance: 1 });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "office",
    status: "Holiday", salaryCredit: 1, markedBy: "auto", updatedAt: Timestamp.now(),
  });

  await run();

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(s.salaryCredit, 1);
  assert.equal(await readBalance(uid), 0, "paid AND drawn — never paid while keeping the day");
  assert.equal((await readSummary()).plDeducted, 1);
});

test("F1 a stale HOLIDAY prior with credit 0 (ops who worked it) behaves the same way", async () => {
  const uid = await seedUser({ role: "operations", plBalance: 1 });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "operations",
    status: "Holiday", salaryCredit: 0, markedBy: "auto", updatedAt: Timestamp.now(),
  });

  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 1);
  assert.equal(await readBalance(uid), 0, "drawn exactly once");
});

test("F1 a stale SUNDAY prior (no credit field) is not a PL draw either", async () => {
  const uid = await seedUser({ plBalance: 1 });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "office",
    status: "Sunday", markedBy: "auto", updatedAt: Timestamp.now(),
  });

  await run();

  assert.equal((await readStatus(uid)).status, "SCHL");
  assert.equal((await readStatus(uid)).salaryCredit, 1);
  assert.equal(await readBalance(uid), 0, "drawn exactly once");
});

// ── F2: the plBalance coercion is load-bearing ────────────────────────────────────────────────

test("F2 a user with NO plBalance field re-scored over a paid SCHL stays paid, with no NaN written", async () => {
  const uid = newUid();
  // Deliberately no plBalance key at all — legacy user docs look like this.
  await db.doc(`users/${uid}`).set({ name: `User ${uid}`, employeeId: `E-${uid}`, role: "office" });
  await seedLeave(uid);
  await seedStatus(uid, TODAY, {
    date: TODAY, userId: uid, userName: `User ${uid}`, employeeId: `E-${uid}`, role: "office",
    status: "SCHL", salaryCredit: 1, markedBy: "auto", updatedAt: Timestamp.now(),
  });

  await run();

  const s = await readStatus(uid);
  assert.equal(s.status, "SCHL");
  assert.equal(s.salaryCredit, 1, "undefined + 1 must be 1, not NaN");
  assert.equal(Number.isNaN(s.salaryCredit), false);
  const user = (await db.doc(`users/${uid}`).get()).data();
  assert.equal("plBalance" in user, false, "the balance was never written, so no NaN landed on the user doc");
  assert.equal((await readSummary()).plDeducted, 0);
});

// ── F3: more transactional users than the concurrency chunk (CHUNK = 10) ─────────────────────

test("F3 30 transactional users (3x the concurrency chunk) are every one scored, exactly once", async () => {
  const paid = [];    // approved leave + balance  -> SCHL credit 1, one draw each
  const unpaid = [];  // approved leave, balance 0 -> SCHL credit 0, no draw
  const absent = [];  // no leave                  -> Absent
  for (let i = 0; i < 30; i++) {
    const bucket = i % 3;
    const uid = await seedUser({ plBalance: bucket === 0 ? 2 : 0 });
    if (bucket === 0) { await seedLeave(uid); paid.push(uid); }
    else if (bucket === 1) { await seedLeave(uid); unpaid.push(uid); }
    else absent.push(uid);
  }

  const { rec } = await run();

  assert.equal(rec.transactions, 30, "one transaction per user, none run twice");
  assert.equal(new Set(rec.txnUsers).size, 30);
  for (const uid of paid) {
    assert.equal((await readStatus(uid)).salaryCredit, 1, `${uid} paid`);
    assert.equal(await readBalance(uid), 1, `${uid} drawn exactly once`);
  }
  for (const uid of unpaid) {
    assert.equal((await readStatus(uid)).salaryCredit, 0);
    assert.equal(await readBalance(uid), 0);
  }
  for (const uid of absent) assert.equal((await readStatus(uid)).status, "Absent");

  const s = await readSummary();
  assert.equal(s.scored, 30);
  assert.equal(s.expected, 30);
  assert.equal(s.plDeducted, paid.length, "one decrement per paid SCHL user and no more");
  assert.equal(s.plAttempted, paid.length);
  assert.equal(s.ok, true);
});

// ── M1: identity fields come from the IN-TXN user doc ─────────────────────────────────────────

test("M1 a name/employeeId/role edited mid-run lands on the status doc, without changing the status", async () => {
  const uid = await seedUser({ role: "office", plBalance: 0, name: "Old Name", employeeId: "E-OLD" });

  const wrapper = wrapDb({
    beforeTransaction: async () => {
      await db.doc(`users/${uid}`).update({ name: "New Name", employeeId: "E-NEW", role: "operations" });
    },
  });
  await run({ wrapper });

  const s = await readStatus(uid);
  assert.equal(s.userName, "New Name", "identity comes from the in-transaction user doc");
  assert.equal(s.employeeId, "E-NEW");
  assert.equal(s.role, "operations");
  assert.equal(s.userId, uid, "the doc id still comes from the snapshot — `live` has no id field");
  // The STATUS is still scored from the snapshot's role/events/plan, so a mid-run role change
  // cannot move a user out of the Absent/SCHL partition (which would need a daily_hours doc).
  assert.equal(s.status, "Absent");
  assert.equal(await readHours(uid), undefined);
});

// ── F5: the REST-DAY branch is chunked too ────────────────────────────────────────────────────
//
// Same 500-cap hazard as the fast partition: one status doc per doc-less employee in a single
// batch, so every Sunday and every holiday would fail wholesale past a few hundred employees.
// As above, the emulator does not enforce the cap — chunk sizes are asserted through the db
// wrapper, which is what actually protects production.

/** Seed `n` bare users in bulk (no punches). Returns their uids. */
async function seedBareCrowd(n, over = {}) {
  const uids = [];
  for (let i = 0; i < n; i += 400) {
    const b = db.batch();
    for (let j = i; j < Math.min(i + 400, n); j++) {
      const uid = newUid();
      uids.push(uid);
      b.set(db.doc(`users/${uid}`), {
        name: `User ${uid}`, employeeId: `E-${uid}`, role: "office", plBalance: 0, ...over,
      });
    }
    await b.commit();
  }
  return uids;
}

test("F5 450 doc-less users on a SUNDAY land in chunks of at most 400", async () => {
  const uids = await seedBareCrowd(450);

  const { rec } = await run({ today: SUNDAY });

  const landed = (await db.collectionGroup("attendance_status").where("date", "==", SUNDAY).get()).size;
  assert.equal(landed, 450, "every Sunday doc landed");
  assert.ok(rec.batches.every((b) => b.writes <= 400), `chunk sizes: ${rec.batches.map((b) => b.writes)}`);
  assert.deepEqual(rec.batches.map((b) => b.writes), [400, 50]);
  assert.equal(rec.commits, 2);
  assert.equal(rec.transactions, 0, "the rest-day branch returns before the scoring phases");
  assert.equal((await readStatus(uids[0], SUNDAY)).status, "Sunday");
  assert.equal((await readStatus(uids[449], SUNDAY)).status, "Sunday");
  assert.equal(await readSummary(SUNDAY), undefined, "still no summary on a rest day");
});

test("F5 450 doc-less users on a HOLIDAY chunk the same way, credits intact", async () => {
  const uids = await seedBareCrowd(450);
  await db.doc(`holidays/${TODAY}`).set({ name: "Test Holiday" });

  const { rec } = await run();

  assert.equal((await db.collectionGroup("attendance_status").where("date", "==", TODAY).get()).size, 450);
  assert.deepEqual(rec.batches.map((b) => b.writes), [400, 50]);
  assert.equal((await readStatus(uids[0])).status, "Holiday");
  assert.equal((await readStatus(uids[0])).salaryCredit, 1, "nobody worked it, so the +1 stands");
  assert.equal((await readStatus(uids[449])).salaryCredit, 1);
});

test("F5 exactly 400 doc-less users is ONE chunk; 401 splits 400 + 1", async () => {
  await seedBareCrowd(400);
  const first = await run({ today: SUNDAY });
  assert.deepEqual(first.rec.batches.map((b) => b.writes), [400]);
  assert.equal(first.rec.commits, 1);

  await seedBareCrowd(1); // 401st user, same emulator state
  const second = await run({ today: SUNDAY });
  // The 400 already-written users are skipped (any existing doc wins), so only the new one is
  // written — which is itself the rest-day branch's own idempotency, asserted here for free.
  assert.deepEqual(second.rec.batches.map((b) => b.writes), [1]);
});

test("F5 users who already have a doc are skipped, so a re-run of a rest day writes nothing", async () => {
  const uids = await seedBareCrowd(5);

  await run({ today: SUNDAY });
  const { rec } = await run({ today: SUNDAY });

  assert.deepEqual(rec.batches.map((b) => b.writes), [0], "the empty final chunk is still committed, as before");
  assert.equal(rec.commits, 1);
  for (const uid of uids) assert.equal((await readStatus(uid, SUNDAY)).status, "Sunday");
});

test("F5 a rest-day chunk commit failure THROWS and a retry converges", async () => {
  await seedBareCrowd(450);

  const wrapper = wrapDb({ failBatchCommit: 2 });
  await assert.rejects(run({ today: SUNDAY, wrapper }), /injected batch commit failure #2/);

  const partial = (await db.collectionGroup("attendance_status").where("date", "==", SUNDAY).get()).size;
  assert.equal(partial, 400, "the first chunk landed, the second did not");

  await run({ today: SUNDAY });
  assert.equal((await db.collectionGroup("attendance_status").where("date", "==", SUNDAY).get()).size, 450);
});
