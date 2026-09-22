"use strict";

/**
 * Account suspension (`isActive()`) — defense-in-depth for the admin's setUserActive Cloud
 * Function (`active: false` on users/{uid}).
 *
 * The Android app already live-blocks a suspended employee's UI (MainViewModel watches
 * observeAccount() and MainActivity renders a full-screen, non-dismissable AccountSuspendedBlock
 * over everything). That is client-side only. Per this repo's security model, firestore.rules is
 * the real boundary — anything the rules permit, a suspended employee can still do directly
 * against the API with their own still-valid Firebase Auth session, bypassing the app entirely.
 *
 * `isActive()` gates every owner-create rule an employee's ordinary app use exercises: raising a
 * new attendance punch, leave request, regularization request, or M&T/tool/work-progress
 * submission. It does NOT touch reads (a suspended employee's phone still needs to read their own
 * user doc to render the block screen and their own history), and does NOT touch the narrow
 * self-patches already carved out elsewhere (users/{uid} activeSessionToken/fcmToken,
 * notifications isRead, submission photoUrls) — those are harmless housekeeping, not "using the
 * app", and finishing an upload begun before suspension is a judgment call left alone here.
 */

const { test, before, after } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser, asAnon,
  assertSucceeds, assertFails,
} = require("./helpers");
const { Timestamp } = require("firebase/firestore");

function istDateStr(date) {
  const ist = new Date(date.getTime() + 19800000); // +05:30 in ms
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const TODAY = istDateStr(new Date());

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    suspended: { role: "operations", active: false },
    active:    { role: "operations", active: true },
    admin:     { role: "admin" },
  });
  // A user doc predating the `active` field at all (legacy doc) — written with rules disabled
  // so it can omit the field entirely, unlike seedUsers which always writes it explicitly.
  await seedDocs(env, {
    "users/legacy": { name: "legacy", employeeId: "LEGACY", role: "operations", salaryRate: 1000 },
    "config/regularizationWindow": { open: false },
  });
});

after(async () => { await teardown(); });

const punch = (uid) => ({
  userId: uid, employeeId: uid.toUpperCase(), userName: uid,
  type: "site_in", date: TODAY, timestamp: Timestamp.fromDate(new Date()),
  latitude: 12.9716, longitude: 77.5946,
});
const leave = (uid) => ({
  userId: uid, status: "pending", fromDate: "2031-08-01", toDate: "2031-08-05", totalDays: 5,
});
const reg = (uid) => ({ userId: uid, status: "pending", date: TODAY, reason: "test" });
const submission = (uid) => ({ userId: uid });

let n = 0;
const next = () => `d${++n}`;

// ── A suspended employee cannot create any of the owner-write collections ─────────────────────

test("a suspended employee cannot raise an attendance punch", async () => {
  const db = asUser(env, "suspended");
  await assertFails(db.doc(`users/suspended/attendance/${next()}`).set(punch("suspended")));
});

test("a suspended employee cannot submit a leave request", async () => {
  const db = asUser(env, "suspended");
  await assertFails(db.doc(`users/suspended/leave_requests/${next()}`).set(leave("suspended")));
});

test("a suspended employee cannot file a regularization request", async () => {
  const db = asUser(env, "suspended");
  await assertFails(db.doc(`users/suspended/regularization_requests/${next()}`).set(reg("suspended")));
});

test("a suspended employee cannot create an M&T request/purchase, a material/tool transfer, or work progress", async () => {
  const db = asUser(env, "suspended");
  await assertFails(db.doc(`users/suspended/material_requests/${next()}`).set(submission("suspended")));
  await assertFails(db.doc(`users/suspended/material_purchases/${next()}`).set(submission("suspended")));
  await assertFails(db.doc(`users/suspended/material_transfers/${next()}`).set(submission("suspended")));
  await assertFails(db.doc(`users/suspended/tool_transfers/${next()}`).set(submission("suspended")));
  await assertFails(db.doc(`users/suspended/work_progress/${next()}`).set(submission("suspended")));
});

// ── An active employee is unaffected (the gate does not over-block) ───────────────────────────

test("an active employee's writes are unaffected by the isActive() gate", async () => {
  const db = asUser(env, "active");
  await assertSucceeds(db.doc(`users/active/attendance/${next()}`).set(punch("active")));
  await assertSucceeds(db.doc(`users/active/leave_requests/${next()}`).set(leave("active")));
  await assertSucceeds(db.doc(`users/active/regularization_requests/${next()}`).set(reg("active")));
  await assertSucceeds(db.doc(`users/active/material_requests/${next()}`).set(submission("active")));
});

// ── A legacy user doc with no `active` field at all defaults to active (never blocked) ────────

test("a user doc with no `active` field is treated as active, not suspended", async () => {
  const db = asUser(env, "legacy");
  await assertSucceeds(db.doc(`users/legacy/attendance/${next()}`).set(punch("legacy")));
  await assertSucceeds(db.doc(`users/legacy/leave_requests/${next()}`).set(leave("legacy")));
});

// ── Reads are never gated — a suspended phone must still be able to render the block + history ──

test("a suspended employee can still read their own profile, attendance and leave history", async () => {
  const db = asUser(env, "suspended");
  await assertSucceeds(db.doc("users/suspended").get());
  await assertSucceeds(db.collection("users/suspended/attendance").get());
  await assertSucceeds(db.collection("users/suspended/leave_requests").get());
});

// ── Admin is unaffected — isActive() only gates the isOwner() branch ──────────────────────────

test("admin can still write on the suspended employee's behalf (e.g. approve a leave filed before suspension)", async () => {
  await seedDocs(env, {
    "users/suspended/leave_requests/pre-suspension": leave("suspended"),
  });
  await assertSucceeds(
    asUser(env, "admin").doc("users/suspended/leave_requests/pre-suspension").update({ status: "approved" })
  );
});

// ── Anonymous is unaffected by this change — still denied by isLoggedIn(), as before ──────────

test("an anonymous caller is still denied outright, isActive() never even evaluated", async () => {
  await assertFails(asAnon(env).doc(`users/suspended/attendance/${next()}`).set(punch("suspended")));
});
