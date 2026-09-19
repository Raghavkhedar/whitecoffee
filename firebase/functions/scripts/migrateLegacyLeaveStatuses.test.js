"use strict";

// Tests for the one-off legacy PL/LWP -> SCHL/USCHL migration script. Run by `npm test`
// (`node --test`). No emulator and no credentials: the runner takes an injected Firestore
// handle, and the fake below implements ONLY the API surface the runner is allowed to use.
// (It deliberately has no collectionGroup(), no transactions and no ref.set(): if the runner
// reached for any of those the tests would blow up rather than pass silently.)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  planLegacyStatusMigration,
  runMigration,
  runRestore,
  parseArgs,
  exitCodeForMigration,
  exitCodeForRestore,
  bannerLines,
  encodeValue,
  decodeValue,
} = require("./migrateLegacyLeaveStatuses");

// ─────────────────────────────── fake Firestore ───────────────────────────────

class FakeTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static fromDate(d) {
    const ms = d.getTime();
    return new FakeTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toDate() {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }
}

const DELETE = { __fakeFieldValueDelete: true };
const FakeFieldValue = { delete: () => DELETE };

function clone(v) {
  if (v instanceof FakeTimestamp) return v; // immutable
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = clone(x);
    return o;
  }
  return v;
}

class FakeSnap {
  constructor(db, path_, data) {
    this.ref = new FakeRef(db, path_);
    this.id = this.ref.id;
    this.exists = data !== undefined;
    this._data = data;
  }
  data() {
    return this._data === undefined ? undefined : clone(this._data);
  }
}

class FakeRef {
  constructor(db, path_) {
    this._db = db;
    this.path = path_;
    this.id = path_.split("/").pop();
  }
  collection(name) {
    return new FakeCollection(this._db, `${this.path}/${name}`);
  }
  async get() {
    return new FakeSnap(this._db, this.path, this._db.store.get(this.path));
  }
}

class FakeQuery {
  constructor(coll, filter) {
    this._coll = coll;
    this._filter = filter;
  }
  async get() {
    const db = this._coll._db;
    if (db.opts.failQuery) throw new Error("simulated query failure");
    const docs = this._coll._children()
      .filter(([, d]) => this._filter(d))
      .map(([p, d]) => new FakeSnap(db, p, d));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection extends FakeQuery {
  constructor(db, path_) {
    super(null, () => true);
    this._coll = this;
    this._db = db;
    this.path = path_;
  }
  _children() {
    const prefix = `${this.path}/`;
    return [...this._db.store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .sort(([a], [b]) => (a < b ? -1 : 1));
  }
  doc(id) {
    return new FakeRef(this._db, `${this.path}/${id}`);
  }
  where(field, op, value) {
    // Only the shape the migration is allowed to use.
    assert.equal(field, "status");
    assert.equal(op, "in");
    assert.ok(Array.isArray(value));
    this._db.queries.push({ path: this.path, field, op, value: [...value] });
    return new FakeQuery(this, (d) => value.includes(d.status));
  }
  // Like the real listDocuments(): includes parents that have no document of their own
  // (a users/{uid} that only exists because it has subcollection docs).
  async listDocuments() {
    const prefix = `${this.path}/`;
    const ids = new Set();
    for (const p of this._db.store.keys()) {
      if (p.startsWith(prefix)) ids.add(p.slice(prefix.length).split("/")[0]);
    }
    return [...ids].sort().map((id) => this.doc(id));
  }
}

// The only write path the runner may use: a transaction. There is deliberately NO db.batch():
// a blind batch.set would overwrite a doc that changed after the scan, so any regression to it
// fails these tests with a TypeError instead of passing silently.
class FakeTx {
  constructor() {
    this.ops = [];
  }
  async getAll(...refs) {
    // Firestore rejects a transaction that reads after it has written.
    assert.equal(this.ops.length, 0, "all transaction reads must come before any write");
    return refs.map((ref) => {
      assert.ok(ref instanceof FakeRef);
      return new FakeSnap(ref._db, ref.path, ref._db.store.get(ref.path));
    });
  }
  set(ref, data, options) {
    assert.ok(ref instanceof FakeRef);
    if (options !== undefined) assert.deepEqual(options, { merge: true });
    this.ops.push({ path: ref.path, data, merge: options !== undefined });
    return this;
  }
}

class FakeDb {
  // opts.beforeTransaction(db, n): runs just before the n-th (1-based) transaction body reads
  //   anything, i.e. AFTER the scan — the hook is how a test plays "someone edited the doc in between".
  // opts.reexecute: run the callback twice and discard the first run, as Firestore does on contention.
  // opts.failOnCommit: the n-th commit throws.  opts.failQuery: every query throws.
  constructor(seed, opts = {}) {
    this.store = new Map(Object.entries(seed).map(([p, d]) => [p, clone(d)]));
    this.opts = opts;
    this.batchSizes = []; // writes per committed transaction
    this.commitCalls = 0;
    this.txCalls = 0;
    this.queries = [];
  }
  collection(p) { return new FakeCollection(this, p); }
  doc(p) { return new FakeRef(this, p); }
  async runTransaction(fn) {
    this.txCalls += 1;
    if (this.opts.beforeTransaction) this.opts.beforeTransaction(this, this.txCalls);
    let tx = new FakeTx();
    if (this.opts.reexecute) {
      await fn(tx);
      tx = new FakeTx(); // first run's writes are discarded
    }
    const result = await fn(tx);
    this.commitCalls += 1;
    if (this.opts.failOnCommit === this.commitCalls) throw new Error("simulated commit failure");
    this.batchSizes.push(tx.ops.length);
    for (const { path: p, data, merge } of tx.ops) {
      if (!merge) {
        this.store.set(p, clone(data));
        continue;
      }
      const cur = clone(this.store.get(p) || {});
      for (const [k, v] of Object.entries(data)) {
        assert.ok(!(v && typeof v === "object" && !(v instanceof FakeTimestamp) && v !== DELETE && !Array.isArray(v)),
          "fake supports only shallow merges");
        if (v === DELETE) delete cur[k];
        else cur[k] = clone(v);
      }
      this.store.set(p, cur);
    }
    return result;
  }
  dump() { return Object.fromEntries([...this.store.entries()].map(([p, d]) => [p, clone(d)])); }
}

// ─────────────────────────────────── fixtures ───────────────────────────────────

const NOW = new Date("2026-09-20T04:30:15.250Z");
const T = (s) => new FakeTimestamp(s, 123000000);
const ACTOR = "system:migrateLegacyLeaveStatuses";

function seed() {
  return {
    "users/u1": { name: "Asha", role: "office", plBalance: 4 },
    "users/u1/attendance_status/2026-01-05": { status: "PL", markedBy: "auto", date: "2026-01-05", salaryCredit: 1, updatedAt: T(1000), extra: { list: [1, { at: T(7) }] } },
    "users/u1/attendance_status/2026-01-06": { status: "PL", markedBy: "admin", date: "2026-01-06", updatedAt: T(1001) },
    "users/u1/attendance_status/2026-02-10": { status: "LWP", markedBy: "auto", date: "2026-02-10", salaryCredit: 0, updatedAt: T(1002) },
    "users/u1/attendance_status/2026-02-11": { status: "LWP", markedBy: "admin", date: "2026-02-11", salaryCredit: 0, updatedAt: T(1003), note: "unpaid, approved by HR" },
    "users/u1/attendance_status/2026-02-12": { status: "Present", markedBy: "auto", date: "2026-02-12", updatedAt: T(1004) },
    "users/u1/attendance_status/2026-02-13": { status: "SCHL", markedBy: "auto", date: "2026-02-13", salaryCredit: 1, migratedFrom: "PL", updatedAt: T(1005) },
    "users/u1/other_collection/2026-01-05": { status: "PL" }, // decoy: not attendance_status
    "users/u2": { name: "Bala", role: "sales" },
    "users/u2/attendance_status/2026-03-01": { status: "LWP", markedBy: "backfill", date: "2026-03-01", updatedAt: T(2000) },
    "users/u2/attendance_status/2026-03-02": { status: "LWP", date: "2026-03-02", updatedAt: T(2001) }, // no markedBy
    "users/u2/attendance_status/2026-03-03": { status: "PL", date: "2026-03-03", updatedAt: T(2002) }, // no markedBy
    "users/u2/attendance_status/2026-03-04": { status: "Absent", markedBy: "auto", date: "2026-03-04" },
    "users/u2/attendance_status/2026-03-05": { status: "USCHL", markedBy: "admin", date: "2026-03-05" },
    "users/u3": { name: "Chetan", role: "operations" },
    "users/u3/attendance_status/2026-03-01": { status: "Holiday", date: "2026-03-01", salaryCredit: 1 },
    "users/u3/attendance_status/2026-03-08": { status: "Sunday", date: "2026-03-08" },
    "audit_log/x1": { path: "users/u1/attendance_status/2026-01-05", status: "PL" },
    "top_level_attendance/a": { status: "LWP" },
  };
}

// 7 legacy docs in seed(): u1 x4, u2 x3.
const SEED_COUNTS = { PL: 3, LWP_auto: 3, LWP_admin: 1 };

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-migration-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "out"); // does not exist yet: the runner must create it
}

function opts(db, outDir, over = {}) {
  return {
    db, FieldValue: FakeFieldValue, Timestamp: FakeTimestamp, now: NOW,
    projectId: "demo-test", apply: false, outDir, log: () => {}, ...over,
  };
}

function readJsonl(file) {
  const raw = fs.readFileSync(file, "utf8");
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const migratedDoc = (orig, fields, migratedFrom) => ({
  ...orig, ...fields, migratedFrom, migratedAt: FakeTimestamp.fromDate(NOW), lastModifiedBy: ACTOR,
});

function seedLegacy(n) {
  const s = {};
  for (let u = 1; u <= 3; u++) s[`users/u${u}`] = { name: `U${u}` };
  for (let i = 0; i < n; i++) {
    const u = (i % 3) + 1;
    const kind = i % 3;
    const date = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const p = `users/u${u}/attendance_status/${date}-${i}`;
    s[p] = kind === 0 ? { status: "PL", markedBy: "auto", updatedAt: T(i) }
      : kind === 1 ? { status: "LWP", markedBy: "admin", salaryCredit: 0, updatedAt: T(i) }
        : { status: "LWP", markedBy: "auto", salaryCredit: 0, updatedAt: T(i) };
  }
  return s;
}

// ───────────────────────────────── the planner ─────────────────────────────────

test("planner: PL -> SCHL with salaryCredit 1, whatever markedBy is", () => {
  for (const markedBy of ["auto", "admin", "backfill", undefined]) {
    const doc = markedBy === undefined ? { status: "PL" } : { status: "PL", markedBy };
    assert.deepEqual(planLegacyStatusMigration(doc), {
      patch: { status: "SCHL", salaryCredit: 1 }, migratedFrom: "PL",
    }, `markedBy=${markedBy}`);
  }
});

test("planner: LWP not marked by an admin -> SCHL with salaryCredit 0", () => {
  for (const markedBy of ["auto", "backfill", "system", "", null, undefined]) {
    const doc = { status: "LWP", markedBy };
    assert.deepEqual(planLegacyStatusMigration(doc), {
      patch: { status: "SCHL", salaryCredit: 0 }, migratedFrom: "LWP",
    }, `markedBy=${markedBy}`);
  }
  assert.deepEqual(planLegacyStatusMigration({ status: "LWP" }), {
    patch: { status: "SCHL", salaryCredit: 0 }, migratedFrom: "LWP",
  });
});

test("planner: admin-marked LWP -> USCHL and salaryCredit is deleted, not set", () => {
  const plan = planLegacyStatusMigration({ status: "LWP", markedBy: "admin", salaryCredit: 0 });
  assert.deepEqual(plan, { patch: { status: "USCHL", deleteSalaryCredit: true }, migratedFrom: "LWP" });
  assert.ok(!("salaryCredit" in plan.patch));
});

test("planner: every other status is untouched (exact, case-sensitive match)", () => {
  const untouched = ["Present", "Absent", "SCHL", "USCHL", "Holiday", "Sunday", "WO", "SL", "HalfDay", "LNF", "", "pl", "lwp", "Pl", "Lwp", " PL", "PL "];
  for (const status of untouched) {
    assert.equal(planLegacyStatusMigration({ status, markedBy: "admin" }), null, JSON.stringify(status));
  }
  assert.equal(planLegacyStatusMigration({ status: undefined, markedBy: "admin" }), null);
  assert.equal(planLegacyStatusMigration({ markedBy: "admin" }), null);
  assert.equal(planLegacyStatusMigration({}), null);
  assert.equal(planLegacyStatusMigration(undefined), null);
  assert.equal(planLegacyStatusMigration(null), null);
  assert.equal(planLegacyStatusMigration("PL"), null);
});

test("planner: an already-migrated doc is untouched; the input is never mutated", () => {
  assert.equal(planLegacyStatusMigration({ status: "SCHL", salaryCredit: 1, migratedFrom: "PL" }), null);
  assert.equal(planLegacyStatusMigration({ status: "USCHL", migratedFrom: "LWP" }), null);
  const doc = Object.freeze({ status: "LWP", markedBy: "admin", salaryCredit: 0 });
  planLegacyStatusMigration(doc); // would throw in strict mode if it tried to write
  assert.deepEqual(doc, { status: "LWP", markedBy: "admin", salaryCredit: 0 });
});

// ─────────────────────────────── value encoding ───────────────────────────────

test("encode/decode: Timestamps (nested) round-trip exactly; plain JSON values pass through", () => {
  const v = { a: T(5), b: [1, "x", null, true, { c: new FakeTimestamp(-3, 999999999) }], d: { e: {} }, s: "" };
  const enc = encodeValue(v);
  assert.deepEqual(enc.a, { __timestamp: true, seconds: 5, nanoseconds: 123000000 });
  const back = decodeValue(JSON.parse(JSON.stringify(enc)), FakeTimestamp);
  assert.deepEqual(back, v);
  assert.ok(back.a instanceof FakeTimestamp);
});

test("encode: refuses anything it cannot restore faithfully", () => {
  assert.throws(() => encodeValue({ n: NaN }), /non-finite/i);
  assert.throws(() => encodeValue({ n: Infinity }), /non-finite/i);
  assert.throws(() => encodeValue({ d: new Date() }), /unsupported/i);
  assert.throws(() => encodeValue({ s: new Set([1]) }), /unsupported/i);
  assert.throws(() => encodeValue({ f: () => 1 }), /unsupported/i);
  assert.throws(() => encodeValue({ u: undefined }), /unsupported/i);
  assert.throws(() => encodeValue({ __timestamp: true, seconds: 1, nanoseconds: 2 }), /reserved/i);
});

// ────────────────────────────────── the runner ──────────────────────────────────

test("runner DRY RUN: writes nothing to the store, but does write the backup file", async (t) => {
  const db = new FakeDb(seed());
  const before = db.dump();
  const out = tmpDir(t);
  const summary = await runMigration(opts(db, out));

  assert.deepEqual(db.dump(), before, "store must be byte-identical");
  assert.equal(db.commitCalls, 0);
  assert.deepEqual(db.batchSizes, []);
  assert.equal(summary.users, 3);
  assert.deepEqual(summary.found, SEED_COUNTS);
  assert.equal(summary.planned, 7);
  assert.equal(summary.written, 0);
  assert.equal(summary.apply, false);
  assert.equal(summary.remaining, 7, "dry run leaves every legacy doc in place");
  assert.deepEqual(summary.errors, []);
  assert.ok(summary.backupFile.startsWith(out));
  assert.ok(fs.existsSync(summary.backupFile), "plan/backup file is written even on a dry run");
  assert.equal(readJsonl(summary.backupFile).length, 7);
});

test("runner only ever issues per-user collection queries with where(status in [PL, LWP])", async (t) => {
  const db = new FakeDb(seed());
  assert.equal(typeof db.collectionGroup, "undefined", "the fake has no collectionGroup: the runner must not use one");
  await runMigration(opts(db, tmpDir(t)));
  assert.ok(db.queries.length >= 3);
  for (const q of db.queries) {
    assert.match(q.path, /^users\/[^/]+\/attendance_status$/);
    assert.deepEqual(q.value, ["PL", "LWP"]);
  }
});

test("runner APPLY: writes exactly the mapped patches, preserving markedBy/updatedAt/everything else", async (t) => {
  const s = seed();
  const db = new FakeDb(s);
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  const after = db.dump();

  const expected = { ...s };
  const a = "users/u1/attendance_status/";
  const b = "users/u2/attendance_status/";
  expected[`${a}2026-01-05`] = migratedDoc(s[`${a}2026-01-05`], { status: "SCHL", salaryCredit: 1 }, "PL");
  expected[`${a}2026-01-06`] = migratedDoc(s[`${a}2026-01-06`], { status: "SCHL", salaryCredit: 1 }, "PL");
  expected[`${a}2026-02-10`] = migratedDoc(s[`${a}2026-02-10`], { status: "SCHL", salaryCredit: 0 }, "LWP");
  const adminLwp = migratedDoc(s[`${a}2026-02-11`], { status: "USCHL" }, "LWP");
  delete adminLwp.salaryCredit;
  expected[`${a}2026-02-11`] = adminLwp;
  expected[`${b}2026-03-01`] = migratedDoc(s[`${b}2026-03-01`], { status: "SCHL", salaryCredit: 0 }, "LWP");
  expected[`${b}2026-03-02`] = migratedDoc(s[`${b}2026-03-02`], { status: "SCHL", salaryCredit: 0 }, "LWP");
  expected[`${b}2026-03-03`] = migratedDoc(s[`${b}2026-03-03`], { status: "SCHL", salaryCredit: 1 }, "PL");
  assert.deepEqual(after, expected);

  // spot-checks that matter most for pay
  assert.equal(after[`${a}2026-01-06`].markedBy, "admin");
  assert.deepEqual(after[`${a}2026-01-05`].updatedAt, T(1000));
  assert.ok(!("salaryCredit" in after[`${a}2026-02-11`]), "USCHL never carries salaryCredit");
  assert.equal(after["users/u1"].plBalance, 4, "plBalance is never touched");

  assert.equal(summary.written, 7);
  assert.equal(summary.remaining, 0);
  assert.deepEqual(summary.errors, []);
});

test("runner APPLY: a second apply plans nothing and writes nothing", async (t) => {
  const db = new FakeDb(seed());
  const out = tmpDir(t);
  await runMigration(opts(db, out, { apply: true }));
  const afterFirst = db.dump();
  const commits = db.commitCalls;
  const again = await runMigration(opts(db, out, { apply: true, now: new Date("2027-01-01T00:00:00Z") }));
  assert.equal(again.planned, 0);
  assert.equal(again.written, 0);
  assert.equal(again.remaining, 0);
  assert.deepEqual(again.found, { PL: 0, LWP_auto: 0, LWP_admin: 0 });
  assert.equal(db.commitCalls, commits);
  assert.deepEqual(db.dump(), afterFirst);
});

test("runner --user filtering only touches that user's docs", async (t) => {
  const s = seed();
  const db = new FakeDb(s);
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true, userId: "u2" }));
  const after = db.dump();
  assert.equal(summary.users, 1);
  assert.equal(summary.planned, 3);
  assert.equal(summary.written, 3);
  assert.equal(summary.remaining, 0);
  for (const p of Object.keys(s)) {
    if (p.startsWith("users/u2/attendance_status/") && ["LWP", "PL"].includes(s[p].status)) {
      assert.equal(after[p].migratedFrom, s[p].status, p);
    } else {
      assert.deepEqual(after[p], s[p], `${p} must be untouched`);
    }
  }
});

test("runner leaves other statuses, other collections and non-legacy users byte-identical", async (t) => {
  const s = seed();
  const db = new FakeDb(s);
  await runMigration(opts(db, tmpDir(t), { apply: true }));
  const after = db.dump();
  for (const p of [
    "users/u1", "users/u2", "users/u3",
    "users/u1/attendance_status/2026-02-12", "users/u1/attendance_status/2026-02-13",
    "users/u1/other_collection/2026-01-05",
    "users/u2/attendance_status/2026-03-04", "users/u2/attendance_status/2026-03-05",
    "users/u3/attendance_status/2026-03-01", "users/u3/attendance_status/2026-03-08",
    "audit_log/x1", "top_level_attendance/a",
  ]) {
    assert.deepEqual(after[p], s[p], p);
  }
  assert.deepEqual(Object.keys(after).sort(), Object.keys(s).sort(), "no doc created or removed");
});

test("runner finds legacy docs under a user whose parent doc does not exist", async (t) => {
  const db = new FakeDb({ "users/ghost/attendance_status/2026-04-01": { status: "PL", markedBy: "auto" } });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.equal(summary.users, 1);
  assert.equal(summary.written, 1);
  assert.equal(db.dump()["users/ghost/attendance_status/2026-04-01"].status, "SCHL");
  assert.ok(!db.store.has("users/ghost"), "must not create the parent doc");
});

test("runner writes 950 legacy docs in batches of at most 400", async (t) => {
  const s = seedLegacy(950);
  const db = new FakeDb(s);
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.deepEqual(db.batchSizes, [400, 400, 150]);
  assert.ok(db.batchSizes.every((n) => n <= 400));
  assert.equal(summary.planned, 950);
  assert.equal(summary.written, 950);
  assert.equal(summary.remaining, 0);
  assert.equal(readJsonl(summary.backupFile).length, 950);
  for (const [p, d] of Object.entries(db.dump())) {
    if (p.includes("attendance_status")) assert.ok(["SCHL", "USCHL"].includes(d.status), p);
  }
});

test("backup: one line per changed doc, faithful full 'before', patch as 'after'", async (t) => {
  const s = seed();
  const db = new FakeDb(s);
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  const lines = readJsonl(summary.backupFile);
  assert.equal(lines.length, 7);
  const byPath = Object.fromEntries(lines.map((l) => [l.path, l]));
  assert.equal(Object.keys(byPath).length, 7, "no duplicate paths");

  for (const l of lines) {
    assert.deepEqual(decodeValue(l.before, FakeTimestamp), s[l.path], `before for ${l.path}`);
    assert.equal(l.after.migratedFrom, l.before.status);
    assert.equal(l.after.lastModifiedBy, ACTOR);
    assert.deepEqual(l.after.migratedAt, { __timestamp: true, seconds: Math.floor(NOW.getTime() / 1000), nanoseconds: 250000000 });
  }
  // raw JSON keeps Timestamps as tagged objects, not strings / Dates
  assert.deepEqual(byPath["users/u1/attendance_status/2026-01-05"].before.updatedAt, { __timestamp: true, seconds: 1000, nanoseconds: 123000000 });
  assert.deepEqual(byPath["users/u1/attendance_status/2026-01-05"].before.extra.list[1].at, { __timestamp: true, seconds: 7, nanoseconds: 123000000 });
  assert.equal(byPath["users/u1/attendance_status/2026-01-05"].after.status, "SCHL");
  assert.equal(byPath["users/u1/attendance_status/2026-01-05"].after.salaryCredit, 1);
  const adm = byPath["users/u1/attendance_status/2026-02-11"].after;
  assert.equal(adm.status, "USCHL");
  assert.deepEqual(adm.salaryCredit, { __delete: true });
});

test("backup is on disk BEFORE the first write transaction even starts", async (t) => {
  const seen = [];
  const out = tmpDir(t);
  const db = new FakeDb(seed(), {
    beforeTransaction: () => {
      const files = fs.readdirSync(out);
      seen.push(files.map((f) => readJsonl(path.join(out, f)).length));
    },
  });
  await runMigration(opts(db, out, { apply: true }));
  assert.deepEqual(seen, [[7]], "the complete 7-line backup already existed at the first transaction");
});

test("backup files are never overwritten", async (t) => {
  const out = tmpDir(t);
  const db = new FakeDb(seed());
  const one = await runMigration(opts(db, out));
  const two = await runMigration(opts(db, out, { now: new Date(NOW.getTime() + 1) }));
  assert.notEqual(one.backupFile, two.backupFile);
  assert.equal(fs.readdirSync(out).length, 2);
  // same instant and same mode -> refuses rather than clobbering the first backup
  await assert.rejects(() => runMigration(opts(db, out)), /EEXIST|exists/i);
});

test("a scan failure aborts before anything is written or created", async (t) => {
  const db = new FakeDb(seed(), { failQuery: true });
  const out = tmpDir(t);
  await assert.rejects(() => runMigration(opts(db, out, { apply: true })), /simulated query failure/);
  assert.equal(db.commitCalls, 0);
  assert.equal(fs.existsSync(out), false, "no output dir before the scan has succeeded");
});

test("a doc that cannot be backed up faithfully aborts the whole run before ANY write", async (t) => {
  const s = seed();
  s["users/u3/attendance_status/2026-05-05"] = { status: "PL", markedBy: "auto", weird: NaN };
  const db = new FakeDb(s);
  const before = db.dump();
  await assert.rejects(() => runMigration(opts(db, tmpDir(t), { apply: true })), /non-finite/i);
  assert.equal(db.commitCalls, 0);
  assert.deepEqual(db.dump(), before);
});

test("a failed batch commit stops the run, is surfaced, and remaining > 0 is reported", async (t) => {
  const db = new FakeDb(seedLegacy(950), { failOnCommit: 2 });
  const out = tmpDir(t);
  const summary = await runMigration(opts(db, out, { apply: true }));
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0], /simulated commit failure/);
  assert.equal(summary.written, 400, "only the first batch committed; the run stopped at the failure");
  assert.equal(summary.remaining, 550);
  assert.equal(db.commitCalls, 2, "no further batches are attempted after a failure");
  assert.equal(readJsonl(summary.backupFile).length, 950, "backup still covers everything that was planned");
  assert.equal(exitCodeForMigration(summary), 1);
  assert.equal(summary.apply, true);
});

test("exit codes: non-zero on errors or on remaining > 0 after an apply; zero otherwise", () => {
  const ok = { apply: true, errors: [], remaining: 0 };
  assert.equal(exitCodeForMigration(ok), 0);
  assert.equal(exitCodeForMigration({ ...ok, remaining: 2 }), 1);
  assert.equal(exitCodeForMigration({ ...ok, errors: ["x"] }), 1);
  assert.equal(exitCodeForMigration({ ...ok, remaining: null }), 1, "unknown remaining after an apply is a failure");
  // a dry run legitimately leaves docs in place
  assert.equal(exitCodeForMigration({ apply: false, errors: [], remaining: 7 }), 0);
  assert.equal(exitCodeForMigration({ apply: false, errors: ["x"], remaining: 7 }), 1);
  assert.equal(exitCodeForRestore({ errors: [] }), 0);
  assert.equal(exitCodeForRestore({ errors: ["x"] }), 1);
});

test("summary carries per-month counts by legacy status", async (t) => {
  const db = new FakeDb(seed());
  const summary = await runMigration(opts(db, tmpDir(t)));
  assert.deepEqual(summary.byMonth, {
    "2026-01": { PL: 2, LWP: 0 },
    "2026-02": { PL: 0, LWP: 2 },
    "2026-03": { PL: 1, LWP: 2 },
  });
});

// ─────────────── the race: a doc changes between the scan and the write ───────────────
// The scan is not a lock. Every write goes through a transaction that re-reads the doc and
// refuses to write if it is gone, no longer legacy, or differs at all from what the scan saw.

const P1 = "users/u1/attendance_status/2026-01-05"; // PL auto
const P2 = "users/u1/attendance_status/2026-02-10"; // LWP auto
const P3 = "users/u2/attendance_status/2026-03-03"; // PL, no markedBy
const editOnce = (p, edit) => (d, n) => { if (n === 1) d.store.set(p, edit(clone(d.store.get(p)))); };

test("race: a doc edited after the scan is NOT overwritten, is counted, and the rest are written", async (t) => {
  const s = seed();
  const db = new FakeDb(s, { beforeTransaction: editOnce(P1, (d) => ({ ...d, note: "edited mid-run" })) });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  const after = db.dump();
  assert.deepEqual(after[P1], { ...s[P1], note: "edited mid-run" }, "the edited doc is exactly as the other writer left it");
  assert.deepEqual(summary.skippedChanged, [P1]);
  assert.equal(summary.written, 6, "the six unchanged docs ARE written");
  assert.equal(summary.planned, 7);
  assert.equal(summary.remaining, 1, "the skipped doc is still PL");
  assert.equal(exitCodeForMigration(summary), 1, "so the run exits non-zero and the operator re-runs");
  assert.deepEqual(summary.errors, []);
  for (const p of ["users/u1/attendance_status/2026-01-06", P2, "users/u2/attendance_status/2026-03-01", P3]) {
    assert.ok(after[p].migratedFrom, `${p} was migrated`);
  }
  assert.equal(readJsonl(summary.backupFile).length, 7, "the backup line for the skipped doc stays in the file");
});

test("race: a doc deleted after the scan is skipped and NOT re-created", async (t) => {
  const db = new FakeDb(seed(), { beforeTransaction: (d, n) => { if (n === 1) d.store.delete(P2); } });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.ok(!db.store.has(P2), "a merge-set would have resurrected it as a stub doc");
  assert.deepEqual(summary.skippedChanged, [P2]);
  assert.equal(summary.written, 6);
  assert.equal(summary.remaining, 0, "a deleted doc is not legacy any more");
  assert.equal(exitCodeForMigration(summary), 0);
});

test("race: markedBy flipping auto -> admin is skipped (never written under the stale mapping); a re-run maps it correctly", async (t) => {
  const s = seed();
  const db = new FakeDb(s, { beforeTransaction: editOnce(P2, (d) => ({ ...d, markedBy: "admin" })) });
  const out = tmpDir(t);
  const first = await runMigration(opts(db, out, { apply: true }));
  assert.deepEqual(db.dump()[P2], { ...s[P2], markedBy: "admin" }, "not rewritten to SCHL/0 from the stale scan");
  assert.deepEqual(first.skippedChanged, [P2]);
  assert.equal(first.remaining, 1);
  assert.equal(exitCodeForMigration(first), 1);

  db.opts = {};
  const second = await runMigration(opts(db, out, { apply: true, now: new Date(NOW.getTime() + 1) }));
  const fixed = db.dump()[P2];
  assert.equal(fixed.status, "USCHL", "now an admin LWP -> USCHL, as it should be");
  assert.ok(!("salaryCredit" in fixed));
  assert.equal(fixed.migratedFrom, "LWP");
  assert.equal(fixed.markedBy, "admin");
  assert.equal(second.planned, 1);
  assert.equal(second.written, 1);
  assert.deepEqual(second.skippedChanged, []);
  assert.equal(second.remaining, 0);
  assert.equal(exitCodeForMigration(second), 0);
  // the second run's backup captured the doc as it stood then (markedBy admin), so restore is faithful
  const line = readJsonl(second.backupFile)[0];
  assert.equal(line.before.markedBy, "admin");
});

test("race: a doc that stopped being legacy is skipped and does not count as remaining", async (t) => {
  const s = seed();
  const db = new FakeDb(s, { beforeTransaction: editOnce(P3, (d) => ({ ...d, status: "Present" })) });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.deepEqual(db.dump()[P3], { ...s[P3], status: "Present" });
  assert.deepEqual(summary.skippedChanged, [P3]);
  assert.equal(summary.written, 6);
  assert.equal(summary.remaining, 0);
});

test("race: a doc whose only change is an unrelated field (or a Timestamp) is still skipped", async (t) => {
  const db = new FakeDb(seed(), { beforeTransaction: editOnce(P1, (d) => ({ ...d, updatedAt: T(99999) })) });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.deepEqual(summary.skippedChanged, [P1]);
  assert.equal(db.dump()[P1].status, "PL");
  assert.deepEqual(db.dump()[P1].updatedAt, T(99999));
});

test("race: fresh data the backup could not encode counts as changed instead of crashing the chunk", async (t) => {
  const db = new FakeDb(seed(), { beforeTransaction: editOnce(P1, (d) => ({ ...d, weird: NaN })) });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.deepEqual(summary.skippedChanged, [P1]);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.written, 6);
});

test("race: the transaction callback is safe to re-execute (counts come from its return value)", async (t) => {
  const db = new FakeDb(seed(), {
    reexecute: true,
    beforeTransaction: editOnce(P1, (d) => ({ ...d, note: "edited" })),
  });
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.equal(summary.written, 6, "not 12");
  assert.deepEqual(summary.skippedChanged, [P1], "listed once, not twice");
  assert.equal(db.commitCalls, 1);
  assert.deepEqual(db.batchSizes, [6]);
});

test("writes go through transactions only (the fake has no batch()), one per chunk of at most 400", async (t) => {
  const db = new FakeDb(seedLegacy(950));
  assert.equal(typeof db.batch, "undefined");
  const summary = await runMigration(opts(db, tmpDir(t), { apply: true }));
  assert.equal(db.txCalls, 3);
  assert.deepEqual(db.batchSizes, [400, 400, 150]);
  assert.equal(summary.written, 950);
  assert.deepEqual(summary.skippedChanged, []);
});

test("a dry run reports no skips and starts no transaction", async (t) => {
  const db = new FakeDb(seed());
  const summary = await runMigration(opts(db, tmpDir(t)));
  assert.deepEqual(summary.skippedChanged, []);
  assert.equal(db.txCalls, 0);
});

// ────────────────────────────────── the restore ──────────────────────────────────

test("restore: apply then restore returns the store to its ORIGINAL contents exactly", async (t) => {
  const s = seed();
  const db = new FakeDb(s);
  const original = db.dump();
  const out = tmpDir(t);
  const mig = await runMigration(opts(db, out, { apply: true }));
  assert.notDeepEqual(db.dump(), original);

  const res = await runRestore({ db, Timestamp: FakeTimestamp, file: mig.backupFile, apply: true, log: () => {} });
  assert.deepEqual(db.dump(), original);
  assert.equal(res.entries, 7);
  assert.equal(res.restored, 7);
  assert.deepEqual(res.errors, []);
  assert.ok(db.dump()["users/u1/attendance_status/2026-02-11"].salaryCredit === 0, "deleted salaryCredit is back");
  assert.ok(db.dump()["users/u1/attendance_status/2026-01-05"].updatedAt instanceof FakeTimestamp);
});

test("restore: dry-run is the default and writes nothing", async (t) => {
  const db = new FakeDb(seed());
  const mig = await runMigration(opts(db, tmpDir(t), { apply: true }));
  const migrated = db.dump();
  const commits = db.commitCalls;
  const res = await runRestore({ db, Timestamp: FakeTimestamp, file: mig.backupFile, log: () => {} });
  assert.equal(res.apply, false);
  assert.equal(res.restored, 0);
  assert.equal(res.toRestore, 7);
  assert.equal(db.commitCalls, commits);
  assert.deepEqual(db.dump(), migrated);
});

test("restore: running it twice is a no-op the second time", async (t) => {
  const s = seed();
  const db = new FakeDb(s);
  const original = db.dump();
  const mig = await runMigration(opts(db, tmpDir(t), { apply: true }));
  await runRestore({ db, Timestamp: FakeTimestamp, file: mig.backupFile, apply: true, log: () => {} });
  const commits = db.commitCalls;
  const again = await runRestore({ db, Timestamp: FakeTimestamp, file: mig.backupFile, apply: true, log: () => {} });
  assert.equal(again.toRestore, 0);
  assert.equal(again.alreadyOriginal, 7);
  assert.equal(again.restored, 0);
  assert.equal(db.commitCalls, commits, "nothing committed the second time");
  assert.deepEqual(db.dump(), original);
});

test("restore: full set() replaces the doc, so fields added by the migration disappear", async (t) => {
  const file = path.join(path.dirname(tmpDir(t)), "b.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const p = "users/u1/attendance_status/2026-01-05";
  const after = { status: "SCHL", salaryCredit: 1, migratedFrom: "PL" };
  fs.writeFileSync(file, JSON.stringify({ path: p, before: { status: "PL", markedBy: "auto" }, after }) + "\n");
  const db = new FakeDb({ [p]: { markedBy: "auto", ...after } }); // exactly the migrated state
  await runRestore({ db, Timestamp: FakeTimestamp, file, apply: true, log: () => {} });
  assert.deepEqual(db.dump()[p], { status: "PL", markedBy: "auto" });
});

// Restore has the same race as the migration: an edit made AFTER the migration must not be
// silently reverted. Only docs still in exactly the migrated state are put back.

async function migrated(t, dbOpts) {
  const s = seed();
  const db = new FakeDb(s);
  const mig = await runMigration(opts(db, tmpDir(t), { apply: true }));
  db.opts = dbOpts || {};
  db.txCalls = 0; db.commitCalls = 0; db.batchSizes.length = 0; // count only what restore does
  return { s, db, mig, migratedState: db.dump() };
}
const restore = (db, file, apply = true) => runRestore({ db, Timestamp: FakeTimestamp, file, apply, log: () => {} });

test("restore: a doc edited since the migration is skipped and listed, not reverted", async (t) => {
  const { s, db, mig } = await migrated(t);
  const edited = "users/u1/attendance_status/2026-01-05";
  db.store.set(edited, { ...db.store.get(edited), status: "Present", note: "regularized by HR" }); // a real later edit
  const editedState = db.dump()[edited];
  const res = await restore(db, mig.backupFile);
  assert.deepEqual(db.dump()[edited], editedState, "the later edit must survive");
  assert.deepEqual(res.skippedChanged, [edited]);
  assert.equal(res.restored, 6);
  for (const p of Object.keys(s)) if (p !== edited) assert.deepEqual(db.dump()[p], s[p], p);
  assert.equal(exitCodeForRestore(res), 0, "a deliberate skip is reported, not an error");
});

test("restore: a doc deleted since the migration is skipped, not re-created", async (t) => {
  const { db, mig } = await migrated(t);
  const gone = "users/u2/attendance_status/2026-03-01";
  db.store.delete(gone);
  const res = await restore(db, mig.backupFile);
  assert.ok(!db.store.has(gone));
  assert.deepEqual(res.skippedChanged, [gone]);
  assert.equal(res.restored, 6);
});

test("restore: dry run classifies the same way and writes nothing", async (t) => {
  const { db, mig } = await migrated(t);
  const edited = "users/u1/attendance_status/2026-02-10";
  db.store.set(edited, { ...db.store.get(edited), markedBy: "admin" });
  const before = db.dump();
  const res = await restore(db, mig.backupFile, false);
  assert.deepEqual(db.dump(), before);
  assert.equal(res.toRestore, 6);
  assert.deepEqual(res.skippedChanged, [edited]);
  assert.equal(res.restored, 0);
});

test("restore: a doc edited between the classification and the transaction is skipped too", async (t) => {
  const edited = "users/u1/attendance_status/2026-01-06";
  const { db, mig } = await migrated(t, {
    beforeTransaction: (d, n) => { if (n === 1) d.store.set(edited, { ...d.store.get(edited), note: "edited mid-restore" }); },
  });
  const res = await restore(db, mig.backupFile);
  assert.equal(db.dump()[edited].note, "edited mid-restore");
  assert.equal(db.dump()[edited].status, "SCHL", "still the migrated status, not reverted");
  assert.deepEqual(res.skippedChanged, [edited]);
  assert.equal(res.restored, 6);
});

test("restore: a backup taken by a dry run (nothing migrated) restores nothing", async (t) => {
  const db = new FakeDb(seed());
  const dry = await runMigration(opts(db, tmpDir(t)));
  const res = await restore(db, dry.backupFile);
  assert.equal(res.alreadyOriginal, 7);
  assert.equal(res.toRestore, 0);
  assert.deepEqual(res.skippedChanged, []);
  assert.equal(db.commitCalls, 0);
});

test("restore: batches of at most 400", async (t) => {
  const db = new FakeDb(seedLegacy(950));
  const mig = await runMigration(opts(db, tmpDir(t), { apply: true }));
  db.batchSizes.length = 0;
  const res = await runRestore({ db, Timestamp: FakeTimestamp, file: mig.backupFile, apply: true, log: () => {} });
  assert.deepEqual(db.batchSizes, [400, 400, 150]);
  assert.equal(res.restored, 950);
});

test("restore: refuses a backup that points anywhere but users/*/attendance_status/*, before writing anything", async (t) => {
  const dir = path.dirname(tmpDir(t));
  fs.mkdirSync(dir, { recursive: true });
  const good = "users/u1/attendance_status/2026-01-05";
  for (const bad of ["users/u1", "users/u1/compensation/current", "audit_log/x", "users/u1/attendance_status/a/b", "../x", "users//attendance_status/d"]) {
    const file = path.join(dir, "bad.jsonl");
    fs.writeFileSync(file,
      JSON.stringify({ path: good, before: { status: "PL" }, after: {} }) + "\n" +
      JSON.stringify({ path: bad, before: { pay: 1 }, after: {} }) + "\n");
    const db = new FakeDb({ [good]: { status: "SCHL" } });
    await assert.rejects(() => runRestore({ db, Timestamp: FakeTimestamp, file, apply: true, log: () => {} }), /path/i, bad);
    assert.equal(db.commitCalls, 0, bad);
    assert.equal(db.dump()[good].status, "SCHL", "the valid line must not have been applied either");
  }
});

test("restore: a malformed line aborts before any write; a missing file is an error", async (t) => {
  const dir = path.dirname(tmpDir(t));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "trunc.jsonl");
  const p = "users/u1/attendance_status/2026-01-05";
  fs.writeFileSync(file, JSON.stringify({ path: p, before: { status: "PL" }, after: {} }) + "\n" + '{"path": "users/u1/attendance_st');
  const db = new FakeDb({ [p]: { status: "SCHL" } });
  await assert.rejects(() => runRestore({ db, Timestamp: FakeTimestamp, file, apply: true, log: () => {} }), /line 2|JSON/i);
  assert.equal(db.commitCalls, 0);
  await assert.rejects(() => runRestore({ db, Timestamp: FakeTimestamp, file: path.join(dir, "nope.jsonl"), apply: true, log: () => {} }));
});

// ───────────────────────────────── the CLI parsing ─────────────────────────────────

test("parseArgs: --project is required", () => {
  assert.match(parseArgs([]).error, /--project/);
  assert.match(parseArgs(["--apply"]).error, /--project/);
  assert.match(parseArgs(["--project"]).error, /--project/);
  assert.match(parseArgs(["--project", "--apply"]).error, /--project/, "a flag is not a project id");
});

test("parseArgs: --apply absent means dry run; defaults", () => {
  assert.deepEqual(parseArgs(["--project", "p1"]).options, {
    project: "p1", apply: false, user: null, out: "./migration-out", restore: null,
  });
  assert.equal(parseArgs(["--project", "p1", "--apply"]).options.apply, true);
  assert.equal(parseArgs(["--project=p1"]).options.project, "p1");
});

test("parseArgs: --user and --out", () => {
  const o = parseArgs(["--project", "p", "--user", "abc", "--out", "/tmp/x"]).options;
  assert.equal(o.user, "abc");
  assert.equal(o.out, "/tmp/x");
  assert.match(parseArgs(["--project", "p", "--user"]).error, /--user/);
});

test("parseArgs: --restore parsing, dry-run by default, same --apply rule", () => {
  const dry = parseArgs(["--project", "p", "--restore", "b.jsonl"]).options;
  assert.equal(dry.restore, "b.jsonl");
  assert.equal(dry.apply, false);
  assert.equal(parseArgs(["--project", "p", "--restore", "b.jsonl", "--apply"]).options.apply, true);
  assert.match(parseArgs(["--project", "p", "--restore"]).error, /--restore/);
  assert.match(parseArgs(["--project", "p", "--restore", "b.jsonl", "--user", "u"]).error, /--user/);
  assert.match(parseArgs(["--project", "p", "--restore", "b.jsonl", "--out", "o"]).error, /--out/);
});

test("parseArgs: unknown flags, stray arguments and repeated flags are errors; --help is recognised", () => {
  assert.match(parseArgs(["--project", "p", "--bogus"]).error, /unknown/i);
  assert.match(parseArgs(["--project", "p", "--force"]).error, /unknown/i);
  assert.match(parseArgs(["--project", "p", "stray"]).error, /unexpected|unknown/i);
  assert.match(parseArgs(["--project", "p", "--project", "q"]).error, /twice|repeat|more than once/i);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("banner: dry run says plainly that NOTHING was written; emulator is loud; apply names the project", () => {
  const dry = bannerLines({ apply: false, emulator: false, projectId: "white-coffee-92c27", restore: false }).join("\n");
  assert.match(dry, /DRY RUN/);
  assert.match(dry, /NOTHING will be written to Firestore/);
  assert.match(dry, /white-coffee-92c27/);
  assert.doesNotMatch(dry, /EMULATOR/);
  const emu = bannerLines({ apply: false, emulator: true, projectId: "demo-x", restore: false }).join("\n");
  assert.match(emu, /EMULATOR/);
  const live = bannerLines({ apply: true, emulator: false, projectId: "white-coffee-92c27", restore: false }).join("\n");
  assert.match(live, /APPLY/);
  assert.match(live, /white-coffee-92c27/);
  assert.doesNotMatch(live, /NOTHING will be written/);
  const rest = bannerLines({ apply: false, emulator: false, projectId: "p", restore: true }).join("\n");
  assert.match(rest, /RESTORE/);
  assert.match(rest, /NOTHING will be written to Firestore/);
});
