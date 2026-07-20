"use strict";

/**
 * Remaining hardening: holidays blast radius, conveyance self-dealing, and leave payload
 * validation. Each of these was reachable by an ordinary employee or a single-tab manager.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:   { role: "admin" },
    emp:     { role: "operations" },
    attMgr:  { role: "office", tabAccess: [TABS.ATTENDANCE] },
    convMgr: { role: "office", tabAccess: [TABS.CONVEYANCE] },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  await seedDocs(env, {
    "conveyance/own": { userId: "convMgr", month: "2026-07", totalKm: 10, conveyance: 100 },
    "conveyance/other": { userId: "emp", month: "2026-07", totalKm: 10, conveyance: 100 },
  });
});

// ── Holidays: the largest blast radius in the system ───────────────────────

test("marking a holiday is ADMIN-ONLY", async () => {
  // A holiday makes the nightly scorer skip that day for EVERY employee. That is a
  // company-wide payroll decision and must not ride on a per-tab grant.
  await assertSucceeds(asUser(env, "admin").doc("holidays/2026-08-15").set({ title: "Independence Day" }));
  await assertFails(asUser(env, "attMgr").doc("holidays/2026-08-16").set({ title: "Fake Holiday" }));
  await assertFails(asUser(env, "emp").doc("holidays/2026-08-17").set({ title: "Fake Holiday" }));
});

test("every signed-in user can still READ holidays", async () => {
  await assertSucceeds(asUser(env, "emp").doc("holidays/2026-08-15").get());
});

// ── Conveyance: money, so separation of duties applies ─────────────────────

test("a Conveyance manager CANNOT write their own conveyance", async () => {
  const db = asUser(env, "convMgr");
  await assertFails(db.doc("conveyance/own").update({ conveyance: 99999 }));
  await assertFails(db.doc("conveyance/new-own").set({ userId: "convMgr", month: "2026-07", conveyance: 99999 }));
  await assertFails(db.doc("conveyance/own").delete());
});

test("a Conveyance manager CAN still do their job on other people's records", async () => {
  const db = asUser(env, "convMgr");
  await assertSucceeds(db.doc("conveyance/other").update({ conveyance: 250 }));
  await assertSucceeds(db.doc("conveyance/new-other").set({ userId: "emp", month: "2026-07", conveyance: 250 }));
});

test("an employee cannot touch conveyance at all", async () => {
  await assertFails(asUser(env, "emp").doc("conveyance/other").update({ conveyance: 99999 }));
  await assertFails(asUser(env, "emp").doc("conveyance/other").get());
});

// ── Leave payload validation ───────────────────────────────────────────────

const leave = (o = {}) => ({
  userId: "emp", status: "pending", fromDate: "2026-08-01", toDate: "2026-08-05", totalDays: 5, ...o,
});

test("a well-formed leave request is still accepted", async () => {
  await assertSucceeds(asUser(env, "emp").doc("users/emp/leave_requests/ok").set(leave()));
});

test("an inverted date range is rejected", async () => {
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad1").set(
    leave({ fromDate: "2026-08-05", toDate: "2026-08-01" })));
});

test("an absurd totalDays is rejected", async () => {
  // Previously accepted: a 5-day range claiming 500 days.
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad2").set(leave({ totalDays: 500 })));
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad3").set(leave({ totalDays: 0 })));
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad4").set(leave({ totalDays: -5 })));
});

test("malformed or missing dates are rejected", async () => {
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad5").set(leave({ fromDate: "01-08-2026" })));
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad6").set(leave({ toDate: "not-a-date" })));
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad7").set({
    userId: "emp", status: "pending", reason: "no dates at all",
  }));
});

test("a non-integer totalDays is rejected", async () => {
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad8").set(leave({ totalDays: "5" })));
  await assertFails(asUser(env, "emp").doc("users/emp/leave_requests/bad9").set(leave({ totalDays: 2.5 })));
});

// ── Notifications: no self-injection, no post-delivery rewriting ───────────

test("a user CANNOT inject notifications into their own feed", async () => {
  // Forged messages that look like they came from the company. Android only reads this
  // collection; the real senders are the portal and the Admin SDK (which bypasses rules).
  await assertFails(asUser(env, "emp").doc("users/emp/notifications/forged").set({
    title: "Bonus approved", body: "You have been awarded a bonus.", isRead: false,
  }));
});

test("a user may mark their own notification read, but not rewrite it", async () => {
  await seedDocs(env, {
    "users/emp/notifications/n1": { title: "Real notice", body: "From HR", isRead: false },
  });
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/notifications/n1").update({ isRead: true }));
  await assertFails(db.doc("users/emp/notifications/n1").update({ title: "Rewritten" }));
  await assertFails(db.doc("users/emp/notifications/n1").update({ isRead: true, body: "Rewritten" }));
});

test("an admin can still send a notification", async () => {
  await assertSucceeds(asUser(env, "admin").doc("users/emp/notifications/n2").set({
    title: "Payroll", body: "Payslip available", isRead: false,
  }));
});

test("a Leaves manager can notify an employee (partial-approval message)", async () => {
  // The partial-approval flow tells the employee which dates were granted and which days
  // they are still expected at work. Without this grant that notification silently fails.
  await seedUsers(env, { leaveMgr2: { role: "office", tabAccess: ["/leaves"] } });
  await assertSucceeds(asUser(env, "leaveMgr2").doc("users/emp/notifications/n3").set({
    title: "Leave partially approved", body: "3 of your 5 days were approved.", isRead: false,
  }));
});
