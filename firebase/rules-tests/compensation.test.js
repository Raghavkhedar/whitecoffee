"use strict";

/**
 * PAY ISOLATION — users/{uid}/compensation/current
 *
 * Firestore rules are DOCUMENT-level. While salaryRate sat on users/{uid}, every tab that
 * read a user doc merely to resolve an employee name — nine of the ten grantable tabs, via
 * canReadUsers() — could also enumerate the whole company's pay. A Conveyance-only or
 * Notifications-only manager read every salary in the business.
 *
 * These tests pin the new boundary: pay is readable by admin and /ot-settlements only,
 * writable by admin only, and NOT readable by the employee it describes.
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
    setMgr:  { role: "office", tabAccess: [TABS.OT_SETTLEMENTS] },
    convMgr: { role: "office", tabAccess: [TABS.CONVEYANCE] },
    notifMgr:{ role: "office", tabAccess: [TABS.NOTIFICATIONS] },
    hoursMgr:{ role: "office", tabAccess: [TABS.HOURS] },
    leaveMgr:{ role: "office", tabAccess: [TABS.LEAVES] },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  await seedDocs(env, {
    "users/emp/compensation/current": {
      salaryRate: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5,
    },
  });
});

// ── Who may read pay ───────────────────────────────────────────────────────

test("admin can read pay", async () => {
  await assertSucceeds(asUser(env, "admin").doc("users/emp/compensation/current").get());
});

test("an OT Settlements manager can read pay (settlementCash needs salaryRate)", async () => {
  await assertSucceeds(asUser(env, "setMgr").doc("users/emp/compensation/current").get());
});

test("THE FIX: managers holding non-pay tabs CANNOT read pay", async () => {
  // Each of these could read every salary in the company before the split.
  for (const uid of ["convMgr", "notifMgr", "hoursMgr", "leaveMgr"]) {
    await assertFails(asUser(env, uid).doc("users/emp/compensation/current").get());
  }
});

test("a plain employee cannot read anyone's pay — including their OWN", async () => {
  // Deliberate: isOwner would hand every employee a live salary endpoint. Pay reaches
  // them through the payroll exports instead.
  await assertFails(asUser(env, "emp").doc("users/emp/compensation/current").get());
  await assertFails(asUser(env, "emp").doc("users/setMgr/compensation/current").get());
});

// ── Who may write pay ──────────────────────────────────────────────────────

test("only admin writes pay — not even the settlements manager who reads it", async () => {
  await assertSucceeds(asUser(env, "admin").doc("users/emp/compensation/current").set({ salaryRate: 1200 }, { merge: true }));
  await assertFails(asUser(env, "setMgr").doc("users/emp/compensation/current").set({ salaryRate: 9999 }, { merge: true }));
});

test("an employee cannot raise their own pay", async () => {
  await assertFails(asUser(env, "emp").doc("users/emp/compensation/current").set({ salaryRate: 999999 }, { merge: true }));
  await assertFails(asUser(env, "emp").doc("users/emp/compensation/current").delete());
});

// ── The collectionGroup path must not be a second door ─────────────────────

test("collectionGroup read is scoped identically to the per-doc rule", async () => {
  // getCompensationMap() uses collectionGroup("compensation"); a looser rule here would
  // defeat the per-doc rule entirely — the mistake caught earlier on attendance_status.
  const { collectionGroup, getDocs } = require("firebase/firestore");
  await assertSucceeds(getDocs(collectionGroup(asUser(env, "admin"), "compensation")));
  await assertSucceeds(getDocs(collectionGroup(asUser(env, "setMgr"), "compensation")));
  await assertFails(getDocs(collectionGroup(asUser(env, "convMgr"), "compensation")));
  await assertFails(getDocs(collectionGroup(asUser(env, "emp"), "compensation")));
});
