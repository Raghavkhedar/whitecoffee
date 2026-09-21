"use strict";

// Real-database tests for the scoreRetroactiveLeave trigger body (retroLeaveRunner.js).
//
// The pure planner (retroLeaveScoring.js) is unit-tested by `npm test`; this suite covers the part
// that suite cannot: the read/write wrapper — one Firestore transaction that reads the user, the
// live leave and the candidate status docs BEFORE it writes, rewrites Absent+auto days to SCHL and
// decrements plBalance atomically. It runs against the Firestore emulator, so it is deliberately NOT
// named *.test.js (the default `npm test` = `node --test` must not pick it up).
//
//   cd firebase/functions && npm run test:emulator
//
// Requires the firebase CLI + Java (it starts the emulator via `firebase emulators:exec`).

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");
const { runRetroLeaveScoring } = require("../retroLeaveRunner");

const PROJECT_ID = "demo-functions-test";
const { FieldValue, Timestamp } = admin.firestore;

// 2026-09-21 12:00 IST. Cloud functions run on UTC, so the runner shifts +05:30 to get the IST date.
const NOW_MS = Date.parse("2026-09-21T12:00:00+05:30");
const SEED_MS = Date.parse("2026-09-20T18:30:00Z"); // fixed updatedAt on every seeded status doc

let db;

before(() => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  // Never let this suite touch a real project: it writes and wipes data.
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is not set — run via `npm run test:emulator` (firebase emulators:exec)");
  admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.firestore();
});

after(async () => {
  await admin.app().delete();
});

// Wipe every document between tests so no test can see another's data.
beforeEach(async () => {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(res.status, 200, "emulator wipe failed");
});

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

let uidSeq = 0;
const newUid = () => `emp${Date.now().toString(36)}${(uidSeq += 1)}`;

/** Status doc shaped like the nightly scorer's (date, userId, userName, employeeId, role, status, markedBy, updatedAt). */
const statusDoc = (uid, date, status, markedBy = "auto", extra = {}) => ({
  date, userId: uid, userName: "Test Employee", employeeId: "E-042", role: "office",
  status, markedBy, updatedAt: Timestamp.fromMillis(SEED_MS), ...extra,
});

const leaveDoc = (uid, over = {}) => ({
  userId: uid, userName: "Test Employee", type: "casual", reason: "family function",
  status: "approved", fromDate: "2026-09-14", toDate: "2026-09-15", totalDays: 2, ...over,
});

const RUN_DATES = ["2026-09-14", "2026-09-15", "2026-09-16"];

/**
 * Seed a user (null user = no user doc), a leave doc, and status docs. `statuses` is
 * [[date, status, markedBy?, extra?], ...]. Returns the ids plus the leave data the event is built from.
 */
async function seed({ uid = newUid(), rid = "L1", user = {}, leave = {}, statuses = [] } = {}) {
  if (user !== null) {
    await db.doc(`users/${uid}`).set({ name: "Test Employee", employeeId: "E-042", role: "office", ...user });
  }
  const leaveData = leaveDoc(uid, leave);
  await db.doc(`users/${uid}/leave_requests/${rid}`).set(leaveData);
  for (const [date, status, markedBy, extra] of statuses) {
    await db.doc(`users/${uid}/attendance_status/${date}`).set(statusDoc(uid, date, status, markedBy, extra));
  }
  return { uid, rid, leaveData };
}

/** The event the trigger receives, built by hand from a leave doc's data. */
const eventFor = (uid, rid, data, exists = true) => ({
  params: { userId: uid, requestId: rid },
  data: { after: { exists, data: () => data } },
});

/** Spy logger with the console shape the runner uses. */
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
 * A db wrapper around the real emulator db that records every write the runner COMMITS (per
 * transaction attempt; an aborted attempt's writes are discarded, only the attempt that ran to
 * completion counts) and how many transactions it ran.
 */
function recordingDb() {
  const rec = { writes: [], transactions: 0 };
  return {
    rec,
    doc: (p) => db.doc(p),
    runTransaction: async (fn, opts) => {
      rec.transactions += 1;
      let attempt = [];
      const result = await db.runTransaction(async (tx) => {
        attempt = [];
        return fn({
          getAll: (...refs) => tx.getAll(...refs),
          set: (ref, data, options) => { attempt.push({ op: "set", path: ref.path, data, options }); return tx.set(ref, data, options); },
          update: (ref, data) => { attempt.push({ op: "update", path: ref.path, data }); return tx.update(ref, data); },
        });
      }, opts);
      rec.writes.push(...attempt);
      return result;
    },
  };
}

/** A db that throws on ANY access — proves an early exit happens before Firestore I/O. */
const forbiddenDb = () => new Proxy({}, {
  get(_t, prop) {
    if (prop === "rec") return undefined; // the test harness reads this; the runner never does
    throw new Error(`Firestore was touched (db.${String(prop)}) on a path that must not do I/O`);
  },
});

/** Run the runner against the emulator with a fixed clock and spy logger. */
async function run(event, { now = () => NOW_MS, log = spyLog(), dbWrapper = recordingDb() } = {}) {
  const result = await runRetroLeaveScoring({ db: dbWrapper, FieldValue, Timestamp, event, now, log });
  return { result, log, rec: dbWrapper.rec };
}

const plain = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (v && typeof v.toMillis === "function" ? { ms: v.toMillis() } : v)));

async function readStatuses(uid) {
  const snap = await db.collection(`users/${uid}/attendance_status`).get();
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = plain(d.data()); });
  return out;
}
const readBalance = async (uid) => (await db.doc(`users/${uid}`).get()).data().plBalance;
const seededMs = { ms: SEED_MS };

const paths = (rec) => rec.writes.map((w) => w.path);

// ── 1. Approved leave over 2 past Absent+auto days ────────────────────────────────────────────

test("1. two past Absent/auto days become SCHL credit 1, other fields preserved, balance decremented", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 },
    statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const { result, rec, log } = await run(eventFor(uid, rid, leaveData));

  assert.equal(result, undefined);
  const s = await readStatuses(uid);
  for (const date of ["2026-09-14", "2026-09-15"]) {
    assert.equal(s[date].status, "SCHL");
    assert.equal(s[date].salaryCredit, 1);
    assert.equal(s[date].markedBy, "auto", "markedBy stays auto so the nightly run still treats it as its own");
    assert.equal(s[date].userName, "Test Employee");
    assert.equal(s[date].employeeId, "E-042");
    assert.equal(s[date].role, "office");
    assert.equal(s[date].userId, uid);
    assert.equal(s[date].date, date);
    assert.notDeepEqual(s[date].updatedAt, seededMs, "updatedAt is refreshed on a rewrite");
  }
  assert.equal(await readBalance(uid), 0);
  // exactly one transaction: 2 status merges + 1 balance update, nothing else
  assert.equal(rec.transactions, 1);
  assert.deepEqual(rec.writes.map((w) => [w.op, w.path]), [
    ["set", `users/${uid}/attendance_status/2026-09-14`],
    ["set", `users/${uid}/attendance_status/2026-09-15`],
    ["update", `users/${uid}`],
  ]);
  assert.ok(rec.writes.filter((w) => w.op === "set").every((w) => w.options && w.options.merge === true));
  assert.equal(log.calls.error.length, 0);
  assert.equal(log.calls.log.length, 1);
  assert.match(log.calls.log[0][0], /2 past day\(s\) scored SCHL \(2 paid\)/);
});

// ── 2. Balance shorter than the leave ─────────────────────────────────────────────────────────

test("2a. plBalance 1: first day paid, second unpaid, balance 0", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 1 },
    statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].salaryCredit, 1);
  assert.equal(s["2026-09-15"].salaryCredit, 0);
  assert.equal(s["2026-09-14"].status, "SCHL");
  assert.equal(s["2026-09-15"].status, "SCHL");
  assert.equal(await readBalance(uid), 0);
});

test("2b. plBalance 0: both days unpaid SCHL, balance stays 0 and is not written", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 0 },
    statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const { rec } = await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].salaryCredit, 0);
  assert.equal(s["2026-09-15"].salaryCredit, 0);
  assert.equal(s["2026-09-14"].status, "SCHL");
  assert.equal(await readBalance(uid), 0);
  assert.ok(!paths(rec).includes(`users/${uid}`), "no balance write when nothing was paid");
});

// ── 3. Idempotent on duplicate delivery ───────────────────────────────────────────────────────

test("3. running the same event again changes nothing and writes nothing", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const event = eventFor(uid, rid, leaveData);
  await run(event);
  const statusesAfterFirst = await readStatuses(uid);
  const balanceAfterFirst = await readBalance(uid);
  assert.equal(balanceAfterFirst, 3);

  const { result, rec, log } = await run(event);

  assert.equal(result, undefined);
  assert.deepEqual(await readStatuses(uid), statusesAfterFirst, "statuses (incl. updatedAt) identical");
  assert.equal(await readBalance(uid), balanceAfterFirst);
  assert.deepEqual(rec.writes, [], "no additional write of any kind");
  assert.equal(log.calls.log.length, 0, "nothing scored, nothing logged as scored");
});

// ── 4. Days that must not be touched ──────────────────────────────────────────────────────────

test("4a. only Absent+auto past days are scored; every other kind of day is left byte-identical", async () => {
  const untouched = [
    ["2026-09-01", "Present"], ["2026-09-02", "HalfDay"], ["2026-09-03", "LNF"],
    ["2026-09-04", "Absent", "admin"],
    ["2026-09-05", "Sunday"], ["2026-09-06", "Holiday", "auto", { salaryCredit: 1 }],
    ["2026-09-07", "SCHL", "auto", { salaryCredit: 1 }], ["2026-09-08", "USCHL", "auto", { salaryCredit: 0 }],
    ["2026-09-09", "WO"],
    // 2026-09-10 deliberately has NO status doc
    ["2026-09-21", "Absent"], // today: the nightly run's job, never this trigger's
    ["2026-09-22", "Absent"], // future
  ];
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    leave: { fromDate: "2026-09-01", toDate: "2026-09-30", totalDays: 30 },
    statuses: [...untouched, ["2026-09-11", "Absent"], ["2026-09-12", "Absent"]],
  });
  const before = await readStatuses(uid);
  const { rec, log } = await run(eventFor(uid, rid, leaveData));
  const after = await readStatuses(uid);

  for (const [date] of untouched) assert.deepEqual(after[date], before[date], `${date} must be untouched`);
  assert.equal(after["2026-09-10"], undefined, "a covered date with no status doc must not be created");
  for (const date of ["2026-09-11", "2026-09-12"]) {
    assert.equal(after[date].status, "SCHL");
    assert.equal(after[date].salaryCredit, 1);
  }
  assert.equal(await readBalance(uid), 3);
  assert.deepEqual(paths(rec).sort(), [
    `users/${uid}`, `users/${uid}/attendance_status/2026-09-11`, `users/${uid}/attendance_status/2026-09-12`,
  ].sort());
  // the gaps (09-10 and 09-13..09-20) are logged, not fixed
  assert.equal(log.calls.warn.length, 1);
  assert.match(log.calls.warn[0][0], /9 of 20 candidate date\(s\) had no status doc/);
});

test("4b. a skipped day does not consume balance (Present, Absent, Absent with balance 2 -> 1,1)", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 },
    leave: { fromDate: "2026-09-14", toDate: "2026-09-16", totalDays: 3 },
    statuses: [["2026-09-14", "Present"], ["2026-09-15", "Absent"], ["2026-09-16", "Absent"]],
  });
  await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].status, "Present");
  assert.equal(s["2026-09-15"].salaryCredit, 1);
  assert.equal(s["2026-09-16"].salaryCredit, 1);
  assert.equal(await readBalance(uid), 0);
});

test("4c. a leave lying entirely in the future scores nothing and does no Firestore I/O", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 },
    leave: { fromDate: "2026-09-21", toDate: "2026-09-25", totalDays: 5 },
    statuses: [["2026-09-21", "Absent"]],
  });
  const log = spyLog();
  const { result } = await run(eventFor(uid, rid, leaveData), { dbWrapper: forbiddenDb(), log });
  assert.equal(result, undefined);
  assert.equal(log.calls.warn.length, 0, "a valid future leave is not malformed");
  assert.equal(await readBalance(uid), 2);
});

test("4d. 'today' is the IST date: at 01:30 IST on 09-22 (20:00 UTC on 09-21) 09-21 is already past", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 },
    leave: { fromDate: "2026-09-21", toDate: "2026-09-22", totalDays: 2 },
    statuses: [["2026-09-21", "Absent"], ["2026-09-22", "Absent"]],
  });
  await run(eventFor(uid, rid, leaveData), { now: () => Date.parse("2026-09-21T20:00:00Z") });
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-21"].status, "SCHL");
  assert.equal(s["2026-09-22"].status, "Absent", "IST today is 09-22: still the nightly run's");
  assert.equal(await readBalance(uid), 1);
});

// ── 5. Partial approval and cancellation ──────────────────────────────────────────────────────

test("5a. approvedDates subset: only the granted days are scored", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    leave: { fromDate: "2026-09-14", toDate: "2026-09-16", totalDays: 3, approvedDates: ["2026-09-14", "2026-09-16"] },
    statuses: RUN_DATES.map((d) => [d, "Absent"]),
  });
  await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].status, "SCHL");
  assert.equal(s["2026-09-15"].status, "Absent", "not granted -> stays Absent");
  assert.equal(s["2026-09-16"].status, "SCHL");
  assert.equal(await readBalance(uid), 3);
});

test("5b. cancelledDates: a cancelled granted day is not scored", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    leave: { fromDate: "2026-09-14", toDate: "2026-09-16", totalDays: 3, cancelledDates: ["2026-09-15"] },
    statuses: RUN_DATES.map((d) => [d, "Absent"]),
  });
  await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].status, "SCHL");
  assert.equal(s["2026-09-15"].status, "Absent");
  assert.equal(s["2026-09-16"].status, "SCHL");
  assert.equal(await readBalance(uid), 3);
});

test("5c. approvedDates plus cancelledDates together", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    leave: {
      fromDate: "2026-09-14", toDate: "2026-09-16", totalDays: 3,
      approvedDates: ["2026-09-14", "2026-09-15"], cancelledDates: ["2026-09-14"],
    },
    statuses: RUN_DATES.map((d) => [d, "Absent"]),
  });
  await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].status, "Absent");
  assert.equal(s["2026-09-15"].status, "SCHL");
  assert.equal(s["2026-09-16"].status, "Absent");
  assert.equal(await readBalance(uid), 4);
});

// ── 6. Non-approved leave / deleted leave ─────────────────────────────────────────────────────

for (const status of ["pending", "rejected", "cancelled"]) {
  test(`6. leave status '${status}': no writes, balance unchanged, no Firestore I/O`, async () => {
    const { uid, rid, leaveData } = await seed({
      user: { plBalance: 2 }, leave: { status },
      statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
    });
    const { result, log } = await run(eventFor(uid, rid, leaveData), { dbWrapper: forbiddenDb() });
    assert.equal(result, undefined);
    const s = await readStatuses(uid);
    assert.equal(s["2026-09-14"].status, "Absent");
    assert.equal(s["2026-09-15"].status, "Absent");
    assert.equal(await readBalance(uid), 2);
    assert.equal(log.calls.error.length + log.calls.warn.length, 0);
  });
}

test("6. deleted leave (after.exists === false) and a missing event payload: no writes, no I/O", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 }, statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const log = spyLog();
  await run(eventFor(uid, rid, leaveData, false), { dbWrapper: forbiddenDb(), log });
  await run({ params: { userId: uid, requestId: rid }, data: undefined }, { dbWrapper: forbiddenDb(), log });
  await run({ params: { userId: uid, requestId: rid }, data: { after: undefined } }, { dbWrapper: forbiddenDb(), log });
  assert.equal((await readStatuses(uid))["2026-09-14"].status, "Absent");
  assert.equal(await readBalance(uid), 2);
  assert.equal(log.calls.error.length + log.calls.warn.length, 0);
});

// ── 7. Refusals never throw and never write ───────────────────────────────────────────────────

test("7a. oversize span (2020 -> 2030): resolves, no I/O, warns", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 9 }, leave: { fromDate: "2020-01-01", toDate: "2030-12-31", totalDays: 366 },
    statuses: [["2020-01-01", "Absent"], ["2026-09-14", "Absent"]],
  });
  const { result, log } = await run(eventFor(uid, rid, leaveData), { dbWrapper: forbiddenDb() });
  assert.equal(result, undefined);
  assert.equal(log.calls.warn.length, 1);
  assert.match(log.calls.warn[0][0], /REFUSED oversize/);
  assert.equal(log.calls.error.length, 0);
  const s = await readStatuses(uid);
  assert.equal(s["2020-01-01"].status, "Absent");
  assert.equal(s["2026-09-14"].status, "Absent");
  assert.equal(await readBalance(uid), 9);
});

const MALFORMED = [
  ["month 13", { fromDate: "2025-13-01", toDate: "2026-09-15" }],
  ["2026-02-31 (calendar overflow)", { fromDate: "2026-02-31", toDate: "2026-03-05" }],
  ["toDate not a date", { fromDate: "2026-09-14", toDate: "2026-02-31" }],
  ["from after to", { fromDate: "2026-09-16", toDate: "2026-09-14" }],
];
for (const [label, dates] of MALFORMED) {
  test(`7b. malformed dates (${label}): resolves, no I/O, warns`, async () => {
    const { uid, rid, leaveData } = await seed({
      user: { plBalance: 9 }, leave: { ...dates },
      statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
    });
    const { result, log } = await run(eventFor(uid, rid, leaveData), { dbWrapper: forbiddenDb() });
    assert.equal(result, undefined);
    assert.equal(log.calls.warn.length, 1);
    assert.match(log.calls.warn[0][0], /SKIPPED malformed leave dates/);
    assert.equal(log.calls.error.length, 0);
    assert.equal((await readStatuses(uid))["2026-09-14"].status, "Absent");
    assert.equal(await readBalance(uid), 9);
  });
}

// ── 8. Stale event snapshot ───────────────────────────────────────────────────────────────────

test("8. the plan comes from the LIVE leave: a day cancelled after the event was built is not scored", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    leave: { fromDate: "2026-09-14", toDate: "2026-09-16", totalDays: 3 },
    statuses: RUN_DATES.map((d) => [d, "Absent"]),
  });
  const event = eventFor(uid, rid, leaveData); // the event still says all 3 days are granted
  assert.equal(event.data.after.data().cancelledDates, undefined);
  await db.doc(`users/${uid}/leave_requests/${rid}`).update({ cancelledDates: ["2026-09-15"] });

  await run(event);
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].status, "SCHL");
  assert.equal(s["2026-09-15"].status, "Absent", "cancelled since the event: must not be scored from the stale snapshot");
  assert.equal(s["2026-09-16"].status, "SCHL");
  assert.equal(await readBalance(uid), 3);
});

test("8b. the live leave no longer approved (event stale) or deleted: nothing is scored", async () => {
  for (const mutate of [
    (ref) => ref.update({ status: "rejected" }),
    (ref) => ref.delete(),
  ]) {
    const { uid, rid, leaveData } = await seed({
      user: { plBalance: 5 }, statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
    });
    const event = eventFor(uid, rid, leaveData);
    await mutate(db.doc(`users/${uid}/leave_requests/${rid}`));
    const { rec } = await run(event);
    assert.deepEqual(rec.writes, []);
    assert.equal((await readStatuses(uid))["2026-09-14"].status, "Absent");
    assert.equal(await readBalance(uid), 5);
  }
});

// ── 9. User doc missing / no plBalance ────────────────────────────────────────────────────────

test("9a. missing user doc: resolves, no status writes, no error", async () => {
  const { uid, rid, leaveData } = await seed({
    user: null, statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const { result, rec, log } = await run(eventFor(uid, rid, leaveData));
  assert.equal(result, undefined);
  assert.deepEqual(rec.writes, []);
  assert.equal(log.calls.error.length, 0);
  assert.equal((await readStatuses(uid))["2026-09-14"].status, "Absent");
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false, "the user doc is not created either");
});

test("9b. a user with no plBalance field is treated as 0: unpaid SCHL, no balance write", async () => {
  const { uid, rid, leaveData } = await seed({
    user: {}, statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const { rec } = await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].status, "SCHL");
  assert.equal(s["2026-09-14"].salaryCredit, 0);
  assert.equal(s["2026-09-15"].salaryCredit, 0);
  assert.equal((await db.doc(`users/${uid}`).get()).data().plBalance, undefined, "no plBalance invented");
  assert.ok(!paths(rec).includes(`users/${uid}`));
});

// ── 10. Real contention ───────────────────────────────────────────────────────────────────────

const RACE_ITERATIONS = Number(process.env.RACE_ITERATIONS) || 5; // each iteration costs ~3s of real transaction contention/backoff

test(`10a. two concurrent runs of one event, balance 2 and 2 eligible days (x${RACE_ITERATIONS}): exactly 2 paid, balance 0, each doc written once`, async () => {
  for (let i = 0; i < RACE_ITERATIONS; i += 1) {
    const { uid, rid, leaveData } = await seed({
      user: { plBalance: 2 },
      statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
    });
    const event = eventFor(uid, rid, leaveData);
    const a = recordingDb();
    const b = recordingDb();
    const [ra, rb] = await Promise.all([
      run(event, { dbWrapper: a }),
      run(event, { dbWrapper: b }),
    ]);
    assert.equal(ra.result, undefined);
    assert.equal(rb.result, undefined);

    const s = await readStatuses(uid);
    const credits = Object.values(s).map((d) => d.salaryCredit);
    assert.deepEqual(Object.values(s).map((d) => d.status), ["SCHL", "SCHL"], `iteration ${i}`);
    assert.equal(credits.reduce((x, y) => x + y, 0), 2, `iteration ${i}: exactly 2 paid days in total`);
    assert.equal(await readBalance(uid), 0, `iteration ${i}: balance exactly 0, never -2`);

    const committed = [...a.rec.writes, ...b.rec.writes];
    for (const date of ["2026-09-14", "2026-09-15"]) {
      assert.equal(committed.filter((w) => w.path === `users/${uid}/attendance_status/${date}`).length, 1, `iteration ${i}: ${date} written once`);
    }
    assert.equal(committed.filter((w) => w.path === `users/${uid}`).length, 1, `iteration ${i}: balance decremented once`);
    assert.equal(log_errors(ra, rb), 0);
  }
});

test(`10b. two concurrent runs, balance 1 and 3 eligible days (x${RACE_ITERATIONS}): exactly 1 paid, balance 0`, async () => {
  for (let i = 0; i < RACE_ITERATIONS; i += 1) {
    const { uid, rid, leaveData } = await seed({
      user: { plBalance: 1 },
      leave: { fromDate: "2026-09-14", toDate: "2026-09-16", totalDays: 3 },
      statuses: RUN_DATES.map((d) => [d, "Absent"]),
    });
    const event = eventFor(uid, rid, leaveData);
    const a = recordingDb();
    const b = recordingDb();
    await Promise.all([run(event, { dbWrapper: a }), run(event, { dbWrapper: b })]);

    const s = await readStatuses(uid);
    assert.deepEqual(RUN_DATES.map((d) => s[d].status), ["SCHL", "SCHL", "SCHL"]);
    assert.equal(RUN_DATES.reduce((n, d) => n + s[d].salaryCredit, 0), 1, `iteration ${i}: exactly 1 paid day`);
    assert.equal(await readBalance(uid), 0, `iteration ${i}`);
    const committed = [...a.rec.writes, ...b.rec.writes];
    assert.equal(committed.filter((w) => w.path === `users/${uid}`).length, 1);
    assert.equal(committed.filter((w) => w.op === "set").length, 3, `iteration ${i}: each status doc written once`);
  }
});

test("10c. three concurrent runs (duplicate deliveries) still pay exactly once", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 },
    statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const event = eventFor(uid, rid, leaveData);
  const dbs = [recordingDb(), recordingDb(), recordingDb()];
  await Promise.all(dbs.map((d) => run(event, { dbWrapper: d })));
  assert.equal(await readBalance(uid), 0);
  const s = await readStatuses(uid);
  assert.equal(Object.values(s).reduce((n, d) => n + d.salaryCredit, 0), 2);
  assert.equal(dbs.flatMap((d) => d.rec.writes).filter((w) => w.op === "update").length, 1);
});

function log_errors(...runs) {
  return runs.reduce((n, r) => n + r.log.calls.error.length, 0);
}

// ── 11. Error path ────────────────────────────────────────────────────────────────────────────

test("11a. a failing transaction is logged with context and RE-THROWN (so the platform retries)", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 }, statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  for (const make of [
    (err) => () => { throw err; },                 // synchronous throw
    (err) => async () => { throw err; },           // rejected promise
  ]) {
    const boom = new Error("transient firestore failure");
    const failingDb = { doc: (p) => db.doc(p), runTransaction: make(boom) };
    const log = spyLog();
    await assert.rejects(
      runRetroLeaveScoring({ db: failingDb, FieldValue, Timestamp, event: eventFor(uid, rid, leaveData), now: () => NOW_MS, log }),
      (e) => e === boom,
    );
    assert.equal(log.calls.error.length, 1);
    assert.match(log.calls.error[0][0], new RegExp(`FAILED for user ${uid} leave ${rid} \\(2 candidate date\\(s\\)\\)`));
    assert.equal(log.calls.error[0][1], boom, "the original error is attached to the log line");
  }
  assert.equal((await readStatuses(uid))["2026-09-14"].status, "Absent", "a failed run wrote nothing");
  assert.equal(await readBalance(uid), 2);
});

test("11b. a redelivery after a failed attempt converges to the right state", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 2 }, statuses: [["2026-09-14", "Absent"], ["2026-09-15", "Absent"]],
  });
  const event = eventFor(uid, rid, leaveData);
  const failingDb = { doc: (p) => db.doc(p), runTransaction: async () => { throw new Error("blip"); } };
  await assert.rejects(runRetroLeaveScoring({ db: failingDb, FieldValue, Timestamp, event, now: () => NOW_MS, log: spyLog() }), /blip/);
  const { result } = await run(event);
  assert.equal(result, undefined);
  const s = await readStatuses(uid);
  assert.equal(s["2026-09-14"].salaryCredit, 1);
  assert.equal(s["2026-09-15"].salaryCredit, 1);
  assert.equal(await readBalance(uid), 0);
});

test("11c. refusal paths never reject, even when the transaction machinery is broken", async () => {
  const brokenDb = { doc: () => { throw new Error("must not be used"); }, runTransaction: () => { throw new Error("must not be used"); } };
  const { uid, rid } = await seed({ user: { plBalance: 2 } });
  const cases = [
    leaveDoc(uid, { fromDate: "2020-01-01", toDate: "2030-12-31" }),      // oversize
    leaveDoc(uid, { fromDate: "2025-13-01", toDate: "2026-09-15" }),      // malformed
    leaveDoc(uid, { fromDate: "2026-02-31", toDate: "2026-03-05" }),      // malformed
    leaveDoc(uid, { fromDate: "2026-09-16", toDate: "2026-09-14" }),      // inverted
    leaveDoc(uid, { status: "pending" }),                                  // not approved
  ];
  for (const data of cases) {
    const log = spyLog();
    await runRetroLeaveScoring({ db: brokenDb, FieldValue, Timestamp, event: eventFor(uid, rid, data), now: () => NOW_MS, log });
    assert.equal(log.calls.error.length, 0);
  }
  await runRetroLeaveScoring({ db: brokenDb, FieldValue, Timestamp, event: eventFor(uid, rid, cases[0], false), now: () => NOW_MS, log: spyLog() });
});

// ── 12. Candidate dates with no status doc ────────────────────────────────────────────────────

test("12. covered dates with no status doc: warned with the count, nothing created for them", async () => {
  const { uid, rid, leaveData } = await seed({
    user: { plBalance: 5 },
    leave: { fromDate: "2026-09-14", toDate: "2026-09-17", totalDays: 4 },
    statuses: [["2026-09-15", "Absent"]], // 09-14, 09-16, 09-17 have no doc
  });
  const { log, rec } = await run(eventFor(uid, rid, leaveData));
  const s = await readStatuses(uid);
  assert.deepEqual(Object.keys(s), ["2026-09-15"], "no status doc was created for the gaps");
  assert.equal(s["2026-09-15"].status, "SCHL");
  assert.equal(log.calls.warn.length, 1);
  assert.match(log.calls.warn[0][0], /3 of 4 candidate date\(s\) had no status doc/);
  assert.equal(rec.writes.filter((w) => w.op === "set").length, 1);
  assert.equal(await readBalance(uid), 4);
});

test("12b. every candidate date missing: warns, writes nothing", async () => {
  const { uid, rid, leaveData } = await seed({ user: { plBalance: 5 } });
  const { log, rec } = await run(eventFor(uid, rid, leaveData));
  assert.deepEqual(rec.writes, []);
  assert.deepEqual(await readStatuses(uid), {});
  assert.equal(await readBalance(uid), 5);
  assert.equal(log.calls.warn.length, 1);
  assert.match(log.calls.warn[0][0], /2 of 2 candidate date\(s\) had no status doc/);
});

// ── Wiring guard ──────────────────────────────────────────────────────────────────────────────

test("index.js still wires scoreRetroactiveLeave to the runner with retry: true", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const start = src.indexOf("exports.scoreRetroactiveLeave = ");
  assert.notEqual(start, -1, "scoreRetroactiveLeave export not found");
  const next = src.indexOf("\nexports.", start + 1);
  const block = src.slice(start, next === -1 ? undefined : next);
  assert.match(block, /onDocumentWritten\(/);
  assert.match(block, /document:\s*"users\/\{userId\}\/leave_requests\/\{requestId\}"/);
  assert.match(block, /retry:\s*true/, "retry: true is what makes a thrown error be redelivered");
  assert.match(block, /runRetroLeaveScoring\(\{[\s\S]*\bevent\b[\s\S]*\}\)/, "the handler delegates the event to the runner");
  assert.match(src, /require\("\.\/retroLeaveRunner"\)/);
});
