"use strict";

// Unit suite for auto-filed regularization of unclosed (LNF) days. The governing constraint:
// this code must be NARROW. It files a request against an employee's payroll day without
// anyone asking it to, so every test below is really about what it must REFUSE to touch —
// legitimate absences, admin rulings, and days already in the workflow.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  needsAutoRegularization,
  buildAutoRegularization,
  AUTO_FILED_REASON,
} = require("./unclosedDay");

const DATE = "2026-08-07";

const scored = (o = {}) => ({ status: "LNF", markedBy: "auto", date: DATE, ...o });
const req = (o = {}) => ({ date: DATE, status: "pending", ...o });

// ── The case this module exists for ────────────────────────────────────────

test("an auto-scored LNF day with no existing request is auto-filed", () => {
  assert.equal(needsAutoRegularization(scored(), []), true);
});

// ── An admin ruling is sacred (key decision #28) ────────────────────────────

test("an admin-marked LNF day is NEVER auto-filed", () => {
  // A human already decided this day; re-filing asks them to overturn themselves.
  assert.equal(needsAutoRegularization(scored({ markedBy: "admin" }), []), false);
});

test("a backfilled LNF day is not auto-filed either", () => {
  // `backfill` is a deliberate human-run correction, not a machine verdict.
  assert.equal(needsAutoRegularization(scored({ markedBy: "backfill" }), []), false);
  assert.equal(needsAutoRegularization(scored({ markedBy: undefined }), []), false);
});

// ── Scope: LNF only. This is the noise-control boundary ────────────────────

test("Absent is NOT auto-filed — that is the noise trap", () => {
  // Absent means no punches at all: every genuine absence, leave gap and new joiner would
  // land in the admin queue. LNF specifically means punched-in-never-out.
  assert.equal(needsAutoRegularization(scored({ status: "Absent" }), []), false);
});

test("no other scored status is auto-filed", () => {
  for (const st of ["Present", "SL", "HalfDay", "PL", "LWP", "WO", "", "lnf"]) {
    assert.equal(
      needsAutoRegularization(scored({ status: st }), []), false,
      `${st} must not auto-file`
    );
  }
});

// ── Duplicate suppression mirrors the client's submitRequest check ──────────

test("an existing PENDING request blocks a second filing", () => {
  assert.equal(needsAutoRegularization(scored(), [req({ status: "pending" })]), false);
});

test("an existing APPROVED request blocks a second filing", () => {
  assert.equal(needsAutoRegularization(scored(), [req({ status: "approved" })]), false);
});

test("a REJECTED request does NOT block — a rejection is not a permanent bar", () => {
  assert.equal(needsAutoRegularization(scored(), [req({ status: "rejected" })]), true);
});

test("a blocking request for a DIFFERENT date does not block this day", () => {
  const otherDay = req({ date: "2026-08-01", status: "approved" });
  assert.equal(needsAutoRegularization(scored(), [otherDay]), true);
  // ...but mixed in with a same-day pending one, the same-day one still wins.
  assert.equal(needsAutoRegularization(scored(), [otherDay, req()]), false);
});

// ── Degenerate input must not throw — a crash aborts the whole nightly pass ─

test("missing or malformed arguments never throw", () => {
  assert.doesNotThrow(() => needsAutoRegularization(undefined, undefined));
  assert.equal(needsAutoRegularization(null, null), false);
  assert.equal(needsAutoRegularization({}, []), false);
  assert.equal(needsAutoRegularization(scored(), undefined), true);
  assert.equal(needsAutoRegularization(scored(), null), true);
  assert.equal(needsAutoRegularization(scored(), "not-an-array"), true);
  assert.equal(needsAutoRegularization(scored(), [null, undefined]), true);
});

// ── The document that gets written ─────────────────────────────────────────

const NOW = Date.UTC(2026, 7, 8, 2, 30); // 08:00 IST on 2026-08-08, the morning after

const user = { userId: "u1", name: "Ravi Kumar", employeeId: "EMP007" };

test("buildAutoRegularization produces every field the schema requires", () => {
  const doc = buildAutoRegularization({
    user, date: DATE, status: scored(), nowMillis: NOW,
  });

  assert.equal(doc.userId, "u1");
  assert.equal(doc.userName, "Ravi Kumar");   // denormalised for the collectionGroup read
  assert.equal(doc.employeeId, "EMP007");     // denormalised for the collectionGroup read
  assert.equal(doc.date, DATE);
  assert.equal(doc.originalStatus, "LNF");
  assert.equal(doc.reason, AUTO_FILED_REASON);
  assert.equal(doc.status, "pending");        // rules only permit creation as pending
  assert.equal(doc.autoFiled, true);          // distinguishes system-filed from employee-filed
  assert.equal(doc.submittedAt, new Date(NOW).toISOString());
});

test("the auto-filed reason explains itself to the admin who reads it", () => {
  assert.ok(AUTO_FILED_REASON.includes("check-out"), "must name the missing punch");
  assert.ok(AUTO_FILED_REASON.includes("LNF"), "must name the status that was scored");
  assert.ok(AUTO_FILED_REASON.length > 60, "a bare code is not an explanation");
});

test("the admin's decision fields are ABSENT, not blank — nobody has reviewed this", () => {
  const doc = buildAutoRegularization({
    user, date: DATE, status: scored(), nowMillis: NOW,
  });
  for (const k of ["approvedBy", "approverComment", "approvedStatus", "reviewedAt"]) {
    assert.equal(k in doc, false, `${k} belongs to the admin decision, which has not happened`);
  }
});

test("submittedAt comes from the injected clock, never a real one", () => {
  const a = buildAutoRegularization({ user, date: DATE, status: scored(), nowMillis: 0 });
  const b = buildAutoRegularization({ user, date: DATE, status: scored(), nowMillis: 0 });
  assert.equal(a.submittedAt, b.submittedAt, "must be deterministic for a fixed clock");
  assert.equal(a.submittedAt, "1970-01-01T00:00:00.000Z");
  // No usable clock → null rather than a silently invented timestamp.
  assert.equal(
    buildAutoRegularization({ user, date: DATE, status: scored() }).submittedAt, null
  );
});

test("buildAutoRegularization degrades instead of throwing on thin input", () => {
  assert.doesNotThrow(() => buildAutoRegularization());
  assert.doesNotThrow(() => buildAutoRegularization({}));
  const doc = buildAutoRegularization({});
  assert.equal(doc.userId, "");
  assert.equal(doc.status, "pending");
  assert.equal(doc.autoFiled, true);
  // `date` falls back to the status doc's own day key — never guessed from a clock.
  const fromStatus = buildAutoRegularization({ user, status: scored(), nowMillis: NOW });
  assert.equal(fromStatus.date, DATE);
  // A user doc keyed `id` (document ID) instead of `userId` still resolves.
  assert.equal(buildAutoRegularization({ user: { id: "u9" } }).userId, "u9");
});
