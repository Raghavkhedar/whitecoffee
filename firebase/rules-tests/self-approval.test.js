"use strict";

/**
 * SEPARATION OF DUTIES — a scoped manager must never action their OWN record.
 *
 * Before this fix, holding a tab was self-service. A manager with /leaves approved their
 * own leave; /ot-shortage granted their own overtime; /ot-settlements wrote their own
 * settlementCash straight into TOTAL DUE; /attendance marked themselves Present and
 * authorized their own rest-day OT. Every one of those pays the holder real money with
 * no second pair of eyes, and nothing in the rules prevented any of it.
 *
 * Admin is deliberately exempt — see the notSelf() comment in firestore.rules.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

// Each manager below holds a tab AND is an employee with their own records —
// the exact overlap the attack depends on.
before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:    { role: "admin", name: "Admin" },
    victim:   { role: "operations", name: "Victim" },
    leaveMgr: { role: "office", tabAccess: [TABS.LEAVES] },
    attMgr:   { role: "office", tabAccess: [TABS.ATTENDANCE] },
    otMgr:    { role: "office", tabAccess: [TABS.OT_SHORTAGE] },
    setMgr:   { role: "office", tabAccess: [TABS.OT_SETTLEMENTS] },
    regMgr:   { role: "office", tabAccess: [TABS.REGULARIZATION] },
    subMgr:   { role: "office", tabAccess: [TABS.SUBMISSIONS] },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  const leave = (uid) => ({
    userId: uid, status: "pending", fromDate: "2026-07-21", toDate: "2026-07-25", totalDays: 5,
  });
  const reg = (uid) => ({ userId: uid, status: "pending", date: "2026-07-21" });
  await seedDocs(env, {
    "users/leaveMgr/leave_requests/own": leave("leaveMgr"),
    "users/victim/leave_requests/other": leave("victim"),
    "users/regMgr/regularization_requests/own": reg("regMgr"),
    "users/victim/regularization_requests/other": reg("victim"),
    "users/subMgr/material_requests/own": { userId: "subMgr", photoUrls: [] },
    "users/victim/material_requests/other": { userId: "victim", photoUrls: [] },
    "users/admin/leave_requests/own": leave("admin"),
  });
});

// ── The attack, per tab ────────────────────────────────────────────────────

test("a Leaves manager CANNOT approve their own leave", async () => {
  const db = asUser(env, "leaveMgr");
  await assertFails(db.doc("users/leaveMgr/leave_requests/own").update({ status: "approved" }));
  // ...but still does their actual job on someone else's request.
  await assertSucceeds(db.doc("users/victim/leave_requests/other").update({ status: "approved" }));
});

test("a Leaves manager CANNOT self-approve through the collectionGroup path either", async () => {
  // The Android approvals screen writes through {path=**}/leave_requests — an unguarded
  // second door would defeat the per-doc rule completely.
  const db = asUser(env, "leaveMgr");
  await assertFails(db.doc("users/leaveMgr/leave_requests/own").update({ approvedDates: ["2026-07-21"], status: "approved" }));
});

test("an OT manager CANNOT grant themselves overtime", async () => {
  const db = asUser(env, "otMgr");
  await assertFails(db.doc("users/otMgr/ot_approvals/2026-07-21").set({ approvedMins: 480, status: "approved" }));
  await assertSucceeds(db.doc("users/victim/ot_approvals/2026-07-21").set({ approvedMins: 60, status: "approved" }));
});

test("a Settlements manager CANNOT settle their own month", async () => {
  const db = asUser(env, "setMgr");
  await assertFails(db.doc("users/setMgr/settlements/2026-07").set({ settlementCash: 99999, locked: true }));
  await assertSucceeds(db.doc("users/victim/settlements/2026-07").set({ settlementCash: 500, locked: true }));
});

test("an Attendance manager CANNOT mark themselves Present or set their own shift", async () => {
  const db = asUser(env, "attMgr");
  await assertFails(db.doc("users/attMgr/attendance_status/2026-07-21").set({ status: "Present", markedBy: "admin" }));
  await assertFails(db.doc("users/attMgr/attendance_status/2026-07-21").set({ status: "WO", markedBy: "admin" }));
  // otAuthorized turns a rest day into all-hours OT — self-authorizing it is self-paying.
  await assertFails(db.doc("users/attMgr/planned_hours/2026-07-21").set({ startTime: "10:00", endTime: "18:00", otAuthorized: true }));
  await assertSucceeds(db.doc("users/victim/attendance_status/2026-07-21").set({ status: "Present", markedBy: "admin" }));
});

test("a Regularization manager CANNOT approve their own regularization", async () => {
  const db = asUser(env, "regMgr");
  await assertFails(db.doc("users/regMgr/regularization_requests/own").update({ status: "approved" }));
  await assertSucceeds(db.doc("users/victim/regularization_requests/other").update({ status: "approved" }));
});

test("a Submissions manager CANNOT approve their own submission", async () => {
  const db = asUser(env, "subMgr");
  await assertFails(db.doc("users/subMgr/material_requests/own").update({ status: "approved" }));
  await assertSucceeds(db.doc("users/victim/material_requests/other").update({ status: "approved" }));
});

// ── Admin exemption is deliberate ──────────────────────────────────────────

test("admin MAY still approve their own leave (documented exemption)", async () => {
  // Not an oversight: an admin can edit salaryRate directly, so blocking this buys
  // nothing, and a single-admin company could otherwise never approve its own leave.
  await assertSucceeds(asUser(env, "admin").doc("users/admin/leave_requests/own").update({ status: "approved" }));
});

// ── The guard must not break ordinary owner access ─────────────────────────

test("a manager can still read and submit their own records", async () => {
  const db = asUser(env, "leaveMgr");
  await assertSucceeds(db.doc("users/leaveMgr/leave_requests/own").get());
  await assertSucceeds(db.doc("users/leaveMgr/leave_requests/new").set({
    userId: "leaveMgr", status: "pending", fromDate: "2026-09-01", toDate: "2026-09-02", totalDays: 2,
  }));
});
