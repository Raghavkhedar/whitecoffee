"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createdAfter, parseArgs, validateDate, makeBackfillDb, istDateOf } = require("./backfillNightlyDate");

const ts = (iso) => ({ toDate: () => new Date(iso) });

test("createdAfter: hired after the date is hidden, on/before is kept, no createdAt is kept", () => {
  assert.equal(createdAfter({ createdAt: ts("2026-09-15T10:00:00Z") }, "2026-09-07"), true);
  assert.equal(createdAfter({ createdAt: ts("2026-09-07T05:00:00Z") }, "2026-09-07"), false);
  assert.equal(createdAfter({ createdAt: ts("2026-08-01T00:00:00Z") }, "2026-09-07"), false);
  assert.equal(createdAfter({}, "2026-09-07"), false);
  assert.equal(createdAfter({ createdAt: "garbage" }, "2026-09-07"), false);
});

test("createdAfter uses the IST calendar day, not UTC", () => {
  // 20:00Z on 09-07 is 01:30 IST on 09-08 -> created AFTER 09-07 in IST.
  assert.equal(createdAfter({ createdAt: ts("2026-09-07T20:00:00Z") }, "2026-09-07"), true);
  // 17:00Z on 09-07 is 22:30 IST on 09-07 -> same IST day, kept.
  assert.equal(createdAfter({ createdAt: ts("2026-09-07T17:00:00Z") }, "2026-09-07"), false);
});

test("validateDate refuses today, the future, junk, and impossible dates", () => {
  const now = Date.parse("2026-09-21T10:00:00Z");
  assert.doesNotThrow(() => validateDate("2026-09-07", now));
  assert.throws(() => validateDate("2026-09-21", now), /only PAST/);
  assert.throws(() => validateDate("2026-09-30", now), /only PAST/);
  assert.throws(() => validateDate("2026-02-30", now), /not a calendar date/);
  assert.throws(() => validateDate("09-07-2026", now), /required/);
  assert.throws(() => validateDate(undefined, now), /required/);
  // 19:00Z on 09-21 is already 00:30 IST on 09-22: 09-21 is then a past IST day.
  assert.doesNotThrow(() => validateDate("2026-09-21", Date.parse("2026-09-21T19:00:00Z")));
});

test("parseArgs rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--project", "p", "--date", "2026-09-07"]), { apply: false, project: "p", date: "2026-09-07" });
  assert.equal(parseArgs(["--apply"]).apply, true);
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
});

function fakeDb() {
  const calls = [];
  const users = [
    { id: "old", data: () => ({ name: "Old", employeeId: "S1", createdAt: ts("2026-01-01T00:00:00Z") }) },
    { id: "new", data: () => ({ name: "New", employeeId: "S9", createdAt: ts("2026-09-15T00:00:00Z") }) },
    { id: "legacy", data: () => ({ name: "Legacy", employeeId: "S0" }) },
  ];
  const db = {
    collection: (n) => ({ get: async () => ({ docs: n === "users" ? users : [] }), _n: n }),
    doc: (path) => ({ path, get: async () => ({ exists: false }), set: async () => { calls.push(["REAL set", path]); } }),
    batch: () => ({ set: () => calls.push(["REAL batch.set"]), commit: async () => calls.push(["REAL commit"]) }),
    runTransaction: async () => calls.push(["REAL txn"]),
    getAll: async (...refs) => refs.map(() => ({ exists: false, data: () => undefined })),
  };
  return { db, calls };
}

test("the wrapped db hides late hires from users().get() and reports them", async () => {
  const { db } = fakeDb();
  const skipped = [];
  const w = makeBackfillDb(db, { date: "2026-09-07", dryRun: false, sink: () => {}, skipped });
  const snap = await w.collection("users").get();
  assert.deepEqual(snap.docs.map((d) => d.id), ["old", "legacy"]);
  assert.deepEqual(skipped.map((s) => s.id), ["new"]);
});

test("dry run: batch, transaction and doc().set are recorded and NEVER reach the real db", async () => {
  const { db, calls } = fakeDb();
  const sink = [];
  const w = makeBackfillDb(db, { date: "2026-09-07", dryRun: true, sink: (x) => sink.push(x), skipped: [] });

  const b = w.batch();
  b.set({ path: "users/a/attendance_status/2026-09-07" }, { status: "Present" });
  await b.commit();
  await w.doc("system/nightly_runs/x/2026-09-07").set({ ok: true });
  await w.runTransaction(async (tx) => {
    await tx.getAll({ path: "u" }, { path: "s" });
    tx.set({ path: "users/b/attendance_status/2026-09-07" }, { status: "SCHL" });
    tx.update({ path: "users/b" }, { plBalance: 1 });
  });

  assert.deepEqual(calls, [], "nothing may reach the real Firestore in a dry run");
  assert.deepEqual(sink.map((s) => `${s.op} ${s.path}`), [
    "set users/a/attendance_status/2026-09-07",
    "set system/nightly_runs/x/2026-09-07",
    "tx.set users/b/attendance_status/2026-09-07",
    "tx.update users/b",
  ]);
});

test("apply mode leaves batch/runTransaction/doc untouched (real writes)", () => {
  const { db } = fakeDb();
  const w = makeBackfillDb(db, { date: "2026-09-07", dryRun: false, sink: () => {}, skipped: [] });
  assert.equal(w.batch, db.batch);
  assert.equal(w.runTransaction, db.runTransaction);
  assert.equal(w.doc, db.doc);
});

test("istDateOf shifts by +05:30", () => {
  assert.equal(istDateOf(new Date("2026-09-07T18:29:00Z")), "2026-09-07");
  assert.equal(istDateOf(new Date("2026-09-07T18:30:00Z")), "2026-09-08");
});
