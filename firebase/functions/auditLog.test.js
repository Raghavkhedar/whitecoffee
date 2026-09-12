"use strict";

// Unit suite for the audit log. The load-bearing test is the self-trigger guard: an audit
// trigger that audits its own writes recurses without bound and bills for every cycle.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isAuditable, changeType, changedKeys, redact, resolveActor, classifyOrigin, buildEntry,
} = require("./auditLog");

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
  assert.deepEqual(resolveActor(null, { approvedBy: "Admin One" }),
    { actor: "Admin One", actorSource: "businessField" });
  assert.deepEqual(resolveActor(null, { markedBy: "admin" }),
    { actor: "admin", actorSource: "businessField" });
  assert.deepEqual(resolveActor(null, { settledBy: "Finance" }),
    { actor: "Finance", actorSource: "businessField" });
  // correctedByUid outranks the display name — a uid is unambiguous.
  assert.deepEqual(resolveActor(null, { correctedByUid: "uid1", approvedBy: "Someone" }),
    { actor: "uid1", actorSource: "businessField" });
});

test("lastModifiedBy is reported as the authoritative source, not a business field", () => {
  // The distinction is the whole point of actorSource: `lastModifiedBy` names the account
  // that performed the write; `approvedBy` names a decision that may predate it.
  assert.deepEqual(resolveActor(null, { lastModifiedBy: "uid9", approvedBy: "Admin One" }),
    { actor: "uid9", actorSource: "lastModifiedBy" });
});

test("actor falls back to the BEFORE state on a delete", () => {
  assert.deepEqual(resolveActor({ approvedBy: "Admin One" }, null),
    { actor: "Admin One", actorSource: "businessField" });
});

test("actor is 'unknown' rather than a guess", () => {
  // A wrong name in an audit log is worse than an honest gap.
  const gap = { actor: "unknown", actorSource: "none" };
  assert.deepEqual(resolveActor(null, { status: "approved" }), gap);
  assert.deepEqual(resolveActor(null, { approvedBy: "   " }), gap);
  assert.deepEqual(resolveActor(null, { approvedBy: 42 }), gap);
  assert.deepEqual(resolveActor(null, null), gap);
});

// ── Origin: did a person write this, or did a Cloud Function? ──────────────
//
// Firestore triggers carry no auth context, so origin is recovered from tells the
// system write leaves in the document itself. Getting this wrong is not cosmetic: before
// this existed, the `integrity` patch written by onPunchWritten inherited the employee's
// own `lastModifiedBy` from the punch, and the audit trail credited the EMPLOYEE with a
// server write. A log that names the wrong actor is worse than one that says nothing.

test("the punch-integrity patch is a system write, NOT the employee's", () => {
  const punch = { type: "office_in", lastModifiedBy: "empUid", date: "2026-09-09" };
  const o = classifyOrigin("users/empUid/attendance/p1", punch,
    { ...punch, integrity: { trusted: true, flags: [] } }, ["integrity"]);
  assert.equal(o.origin, "system");
  assert.equal(o.systemJob, "punch-integrity");
});

test("a human edit to a punch that ALSO touches integrity stays a user write", () => {
  // The tell is that `integrity` was the ONLY thing that changed. Once a business field
  // moves too, a person is involved and the entry must not be filed away as machine noise.
  const punch = { type: "office_in", siteId: "s1", lastModifiedBy: "empUid" };
  const o = classifyOrigin("users/empUid/attendance/p1", punch,
    { ...punch, siteId: "s2", integrity: { trusted: true } }, ["integrity", "siteId"]);
  assert.equal(o.origin, "user");
});

test("the nightly attendance_status job is a system write on re-runs too", () => {
  // batch.set() re-runs as an UPDATE once the doc exists, so `create` is not the tell.
  // `markedBy: 'auto'` with no client stamp is: every portal write carries lastModifiedBy.
  const auto = { date: "2026-09-09", status: "Absent", markedBy: "auto" };
  for (const before of [null, { date: "2026-09-09", status: "Present", markedBy: "auto" }]) {
    const o = classifyOrigin("users/u1/attendance_status/2026-09-09", before, auto, ["status"]);
    assert.equal(o.origin, "system");
    assert.equal(o.systemJob, "nightly-attendance-status");
  }
});

test("an admin overriding a day is a user write even though the doc was machine-made", () => {
  // The portal writes markedBy:'admin' AND stamps lastModifiedBy — either alone is enough.
  const o = classifyOrigin("users/u1/attendance_status/2026-09-09",
    { status: "Absent", markedBy: "auto" },
    { status: "Present", markedBy: "admin", lastModifiedBy: "adminUid" }, ["markedBy", "status"]);
  assert.equal(o.origin, "user");
  assert.equal(o.systemJob, null);
});

test("auto-filed regularizations and auto-logout punches are system writes", () => {
  assert.equal(classifyOrigin("users/u1/regularization_requests/auto-2026-09-09", null,
    { status: "pending", autoFiled: true }, ["autoFiled", "status"]).systemJob, "auto-regularization");
  assert.equal(classifyOrigin("users/u1/attendance/x1", null,
    { type: "home_out", autoLogout: true }, ["autoLogout", "type"]).systemJob, "auto-logout");
});

test("a client stamp beats a marker field that merely SURVIVED the write", () => {
  // An admin editing an auto-filed request must not be laundered into a system write just
  // because `autoFiled: true` is still sitting on the document.
  const o = classifyOrigin("users/u1/regularization_requests/auto-2026-09-09",
    { status: "pending", autoFiled: true },
    { status: "approved", autoFiled: true, lastModifiedBy: "adminUid" }, ["status"]);
  assert.equal(o.origin, "user");
});

test("function-owned locations are system writes with no marker needed", () => {
  assert.equal(classifyOrigin("system/nightly_runs/computeDailyAttendanceStatus/2026-09-09",
    null, { ok: true }, ["ok"]).origin, "system");
  assert.equal(classifyOrigin("users/u1/daily_hours/2026-09-09", null,
    { otMins: 30 }, ["otMins"]).systemJob, "nightly-hours");
});

test("an explicit system: stamp names its own job", () => {
  const o = classifyOrigin("users/u1", null, { lastModifiedBy: "system:backfill" }, ["lastModifiedBy"]);
  assert.equal(o.origin, "system");
  assert.equal(o.systemJob, "backfill");
});

test("an ordinary employee write is a user write", () => {
  assert.deepEqual(
    classifyOrigin("users/u1/attendance/p1", null,
      { type: "office_in", lastModifiedBy: "u1" }, ["lastModifiedBy", "type"]),
    { origin: "user", systemJob: null });
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

// ── Entry-level attribution ────────────────────────────────────────────────

test("an entry records how its actor was determined", () => {
  const e = buildEntry("users/u1/compensation/current",
    { basicPay: 18000 }, { basicPay: 20000, lastModifiedBy: "adminUid" }, AT);
  assert.equal(e.actor, "adminUid");
  assert.equal(e.actorSource, "lastModifiedBy");
  assert.equal(e.origin, "user");
  assert.equal(e.systemJob, null);
});

test("a system entry names the job instead of borrowing the employee's identity", () => {
  const punch = { type: "office_in", lastModifiedBy: "empUid" };
  const e = buildEntry("users/empUid/attendance/p1", punch,
    { ...punch, integrity: { trusted: true } }, AT);
  assert.equal(e.origin, "system");
  assert.equal(e.systemJob, "punch-integrity");
  assert.equal(e.actor, "system:punch-integrity");
  assert.equal(e.actorSource, "system");
  assert.notEqual(e.actor, "empUid", "the employee did not write this");
});

// ── Owner inference — the narrow rescue for an unstamped client ────────────
//
// Devices running a build older than the lastModifiedBy stamp write nothing that names
// them, so those entries read "unknown". For a SELF-SERVICE CREATE the writer is not
// really in doubt: the document sits under the employee's own path and carries their own
// userId. That inference is marked as an inference and never presented as fact.

test("a self-service create under the owner's own path is attributed to the owner", () => {
  const e = buildEntry("users/u1/regularization_requests/r1", null,
    { userId: "u1", status: "pending", approvedBy: "" }, AT);
  assert.equal(e.actor, "u1");
  assert.equal(e.actorSource, "owner", "flagged as inferred, not as a recorded fact");
});

test("owner inference NEVER applies to an update", () => {
  // An admin approving someone's request writes into that employee's path. Inferring the
  // owner there would name the wrong person — precisely the failure this log must avoid.
  const e = buildEntry("users/u1/leave_requests/l1",
    { userId: "u1", status: "pending" }, { userId: "u1", status: "approved" }, AT);
  assert.equal(e.actor, "unknown");
  assert.equal(e.actorSource, "none");
});

test("owner inference requires the document's own userId to match the path", () => {
  const e = buildEntry("users/u1/leave_requests/l1", null, { userId: "u2", status: "pending" }, AT);
  assert.equal(e.actor, "unknown");
});

test("owner inference never overrides a recorded actor", () => {
  const e = buildEntry("users/u1/leave_requests/l1", null,
    { userId: "u1", status: "pending", lastModifiedBy: "u1" }, AT);
  assert.equal(e.actorSource, "lastModifiedBy");
});

test("a system create is never re-attributed to the path owner", () => {
  const e = buildEntry("users/u1/regularization_requests/auto-2026-09-09", null,
    { userId: "u1", status: "pending", autoFiled: true }, AT);
  assert.equal(e.actor, "system:auto-regularization");
});
