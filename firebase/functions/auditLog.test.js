"use strict";

// Unit suite for the audit log. The load-bearing test is the self-trigger guard: an audit
// trigger that audits its own writes recurses without bound and bills for every cycle.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isAuditable, changeType, changedKeys, redact, resolveActor, buildEntry } = require("./auditLog");

const AT = Date.UTC(2026, 6, 20, 3, 30);

// ── The infinite-loop guard ────────────────────────────────────────────────

test("audit_log writes are NEVER audited (self-trigger guard)", () => {
  assert.equal(isAuditable("audit_log/x1"), false);
  assert.equal(buildEntry("audit_log/x1", null, { a: 1 }, AT), null);
});

test("ordinary paths are auditable at every depth", () => {
  assert.equal(isAuditable("users/u1"), true);
  assert.equal(isAuditable("users/u1/attendance/e1"), true);
  assert.equal(isAuditable("conveyance/c1"), true);
  assert.equal(isAuditable(""), false);
});

// ── Change classification ──────────────────────────────────────────────────

test("create / update / delete are classified from the snapshots", () => {
  assert.equal(changeType(null, { a: 1 }), "create");
  assert.equal(changeType({ a: 1 }, { a: 2 }), "update");
  assert.equal(changeType({ a: 1 }, null), "delete");
});

test("changedKeys reports only fields that actually differ, sorted", () => {
  assert.deepEqual(changedKeys({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, c: 3 }), ["b"]);
  assert.deepEqual(changedKeys({ a: 1 }, { a: 1, z: 1, b: 1 }), ["b", "z"]);
  assert.deepEqual(changedKeys({ a: { x: 1 } }, { a: { x: 1 } }), [], "deep-equal values are unchanged");
  assert.deepEqual(changedKeys(null, { a: 1 }), ["a"]);
  assert.deepEqual(changedKeys({ a: 1 }, null), ["a"]);
});

// ── Redaction ──────────────────────────────────────────────────────────────

test("credentials are redacted, but pay is NOT", () => {
  const r = redact({ fcmToken: "tok", activeSessionToken: "sess", salaryRate: 1000, name: "A" });
  assert.equal(r.fcmToken, "[redacted]");
  assert.equal(r.activeSessionToken, "[redacted]");
  // "who changed a salary from what to what" is precisely what this log is for.
  assert.equal(r.salaryRate, 1000);
  assert.equal(r.name, "A");
  assert.equal(redact(null), null);
});

// ── Actor resolution (best effort, honest about gaps) ──────────────────────

test("actor comes from whichever identity field the document records", () => {
  assert.equal(resolveActor(null, { approvedBy: "Admin One" }), "Admin One");
  assert.equal(resolveActor(null, { markedBy: "admin" }), "admin");
  assert.equal(resolveActor(null, { settledBy: "Finance" }), "Finance");
  // correctedByUid outranks the display name — a uid is unambiguous.
  assert.equal(resolveActor(null, { correctedByUid: "uid1", approvedBy: "Someone" }), "uid1");
});

test("actor falls back to the BEFORE state on a delete", () => {
  assert.equal(resolveActor({ approvedBy: "Admin One" }, null), "Admin One");
});

test("actor is 'unknown' rather than a guess", () => {
  // A wrong name in an audit log is worse than an honest gap.
  assert.equal(resolveActor(null, { status: "approved" }), "unknown");
  assert.equal(resolveActor(null, { approvedBy: "   " }), "unknown");
  assert.equal(resolveActor(null, { approvedBy: 42 }), "unknown");
  assert.equal(resolveActor(null, null), "unknown");
});

// ── Entry shape ────────────────────────────────────────────────────────────

test("an entry carries path, owner, diff and both snapshots", () => {
  const e = buildEntry(
    "users/u1/leave_requests/lr1",
    { status: "pending", totalDays: 5 },
    { status: "approved", totalDays: 5, approvedBy: "Admin One" },
    AT,
  );
  assert.equal(e.collection, "leave_requests");
  assert.equal(e.docId, "lr1");
  assert.equal(e.userId, "u1", "owner is extracted from the path for a subcollection");
  assert.equal(e.changeType, "update");
  assert.deepEqual(e.changedKeys, ["approvedBy", "status"]);
  assert.equal(e.before.status, "pending");
  assert.equal(e.after.status, "approved");
  assert.equal(e.actor, "Admin One");
  assert.equal(e.atMillis, AT);
});

test("a top-level document has no owning user", () => {
  assert.equal(buildEntry("conveyance/c1", null, { userId: "u1" }, AT).userId, null);
});

test("a no-op write is still recorded", () => {
  // Knowing a write happened at all is forensically meaningful, even with no diff.
  const e = buildEntry("users/u1", { a: 1 }, { a: 1 }, AT);
  assert.deepEqual(e.changedKeys, []);
  assert.equal(e.changeType, "update");
});

test("a deletion keeps the full before-image", () => {
  const e = buildEntry("users/u1/attendance/e1", { type: "site_in", latitude: 12.9 }, null, AT);
  assert.equal(e.changeType, "delete");
  assert.equal(e.before.type, "site_in");
  assert.equal(e.after, null);
});
