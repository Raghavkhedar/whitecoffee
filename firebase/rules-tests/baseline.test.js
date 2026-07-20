"use strict";

/**
 * BASELINE — the guarantees firestore.rules already makes today.
 *
 * These tests exist so the security patches that follow cannot silently break something
 * that already worked. Every assertion here passed BEFORE any hardening was applied; if
 * one of them starts failing, a patch went too far and locked out a legitimate user.
 *
 * The vulnerability-specific tests live alongside this file, one per fix.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser, asAnon,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

// The cast, reused across the whole suite:
//   admin   — role 'admin', unrestricted
//   emp     — a plain operations employee, NO tabAccess (the primary threat actor)
//   emp2    — a second plain employee, used to prove cross-user isolation
//   leaveMgr / otMgr / convMgr — scoped managers holding exactly one tab each
before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:    { role: "admin", name: "Admin" },
    emp:      { role: "operations", name: "Employee One" },
    emp2:     { role: "operations", name: "Employee Two" },
    leaveMgr: { role: "office", name: "Leave Manager", tabAccess: [TABS.LEAVES] },
    otMgr:    { role: "office", name: "OT Manager", tabAccess: [TABS.OT_SHORTAGE] },
    convMgr:  { role: "office", name: "Conveyance Manager", tabAccess: [TABS.CONVEYANCE] },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  await seedDocs(env, {
    "users/emp/leave_requests/lr1": {
      userId: "emp", status: "pending", fromDate: "2026-07-21", toDate: "2026-07-25", totalDays: 5,
    },
    "users/emp/attendance_status/2026-07-21": { date: "2026-07-21", status: "Present", markedBy: "auto" },
    "users/emp/material_requests/mr1": { userId: "emp", photoUrls: [] },
  });
});

// ── Unauthenticated ─────────────────────────────────────────────────────────

test("anonymous is denied everywhere", async () => {
  const db = asAnon(env);
  await assertFails(db.doc("users/emp").get());
  await assertFails(db.doc("users/emp/attendance/x").set({ type: "office_in" }));
  await assertFails(db.doc("sites/s1").get());
  await assertFails(db.doc("holidays/2026-07-21").get());
});

// ── Self-promotion: the crown-jewel guarantee ───────────────────────────────

test("an employee CANNOT promote themselves to admin", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp").update({ role: "admin" }));
});

test("an employee CANNOT grant themselves tabAccess", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp").update({ tabAccess: [TABS.LEAVES] }));
});

test("an employee CANNOT raise their own salaryRate", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp").update({ salaryRate: 999999 }));
});

test("an employee MAY update only their own session/FCM token", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp").update({ fcmToken: "tok-123" }));
});

test("an employee cannot touch another user's profile", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp2").update({ fcmToken: "tok" }));
  await assertFails(db.doc("users/emp2").get());
});

test("only admin creates and deletes users", async () => {
  await assertFails(asUser(env, "emp").doc("users/newbie").set({ role: "operations" }));
  await assertFails(asUser(env, "leaveMgr").doc("users/newbie").set({ role: "operations" }));
  await assertSucceeds(asUser(env, "admin").doc("users/newbie").set({ role: "operations" }));
});

// ── Owner access to own records ────────────────────────────────────────────

test("an employee reads their own profile and their own records", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp").get());
  await assertSucceeds(db.doc("users/emp/leave_requests/lr1").get());
  await assertSucceeds(db.doc("users/emp/attendance_status/2026-07-21").get());
});

// ── Self-approval of one's OWN submitted work ──────────────────────────────

test("a leave request must be created pending — no self-approval at create", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/leave_requests/lr2").set({
    userId: "emp", status: "approved", fromDate: "2026-08-01", toDate: "2026-08-05", totalDays: 5,
  }));
  await assertSucceeds(db.doc("users/emp/leave_requests/lr3").set({
    userId: "emp", status: "pending", fromDate: "2026-08-01", toDate: "2026-08-05", totalDays: 5,
  }));
});

test("an employee cannot flip their own leave to approved after creating it", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/leave_requests/lr1").update({ status: "approved" }));
});

test("an employee cannot self-approve a submission at create or after", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/material_requests/mr2").set({ userId: "emp", status: "approved" }));
  await assertFails(db.doc("users/emp/material_requests/mr1").update({ status: "approved" }));
  // ...but may still attach photos to their own submission
  await assertSucceeds(db.doc("users/emp/material_requests/mr1").update({ photoUrls: ["a.jpg"] }));
});

test("an employee cannot write their own computed attendance status", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/attendance_status/2026-07-22").set({ status: "Present" }));
  await assertFails(db.doc("users/emp/attendance_status/2026-07-21").update({ status: "Present" }));
});

test("an employee cannot set their own planned shift or OT approval", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/planned_hours/2026-07-22").set({ startTime: "10:00", endTime: "23:00" }));
  await assertFails(db.doc("users/emp/ot_approvals/2026-07-22").set({ approvedMins: 480, status: "approved" }));
  await assertFails(db.doc("users/emp/settlements/2026-07").set({ settlementCash: 99999, locked: true }));
});

// ── Audit logs are immutable ───────────────────────────────────────────────

test("attendance events cannot be deleted or rewritten by their owner", async () => {
  await seedDocs(env, {
    "users/emp/attendance/e1": { userId: "emp", type: "office_in", date: "2026-07-21" },
  });
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/attendance/e1").delete());
  await assertFails(db.doc("users/emp/attendance/e1").update({ type: "office_out" }));
  await assertFails(db.doc("users/emp/attendance/e1").update({ timestamp: new Date() }));
});

test("correction audit log is admin-only and never mutable", async () => {
  await seedDocs(env, { "users/emp/attendance_corrections/c1": { reason: "test" } });
  await assertFails(asUser(env, "emp").doc("users/emp/attendance_corrections/c1").get());
  await assertSucceeds(asUser(env, "admin").doc("users/emp/attendance_corrections/c1").get());
  await assertFails(asUser(env, "admin").doc("users/emp/attendance_corrections/c1").update({ reason: "x" }));
  await assertFails(asUser(env, "admin").doc("users/emp/attendance_corrections/c1").delete());
});

// ── Tab scoping: a manager may use their tab and nothing else ──────────────

test("a Leaves manager can action leave, but not OT or settlements", async () => {
  const db = asUser(env, "leaveMgr");
  await assertSucceeds(db.doc("users/emp/leave_requests/lr1").get());
  await assertSucceeds(db.doc("users/emp/leave_requests/lr1").update({ status: "approved" }));
  await assertFails(db.doc("users/emp/ot_approvals/2026-07-21").set({ approvedMins: 60 }));
  await assertFails(db.doc("users/emp/settlements/2026-07").set({ settlementCash: 500 }));
});

test("an OT manager cannot action leave", async () => {
  const db = asUser(env, "otMgr");
  await assertFails(db.doc("users/emp/leave_requests/lr1").update({ status: "approved" }));
});

test("a plain employee holding no tabs cannot action anyone else's records", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp2/leave_requests/lr1").get());
  await assertFails(db.doc("users/emp2/attendance_status/2026-07-21").set({ status: "Present" }));
  await assertFails(db.doc("users/emp2/ot_approvals/2026-07-21").set({ approvedMins: 480 }));
});

// ── Admin retains full access ──────────────────────────────────────────────

test("admin can read and write across users", async () => {
  const db = asUser(env, "admin");
  await assertSucceeds(db.doc("users/emp").get());
  await assertSucceeds(db.doc("users/emp").update({ salaryRate: 1200 }));
  await assertSucceeds(db.doc("users/emp/attendance_status/2026-07-23").set({ status: "WO", markedBy: "admin" }));
  await assertSucceeds(db.doc("users/emp/leave_requests/lr1").update({ status: "approved" }));
});
