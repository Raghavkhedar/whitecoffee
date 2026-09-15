"use strict";

/**
 * Protocol 3 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): wo_ledger and its
 * settlements subcollection mirror ot_approvals' access pattern exactly. These tests lock in
 * the settlements-subcollection's extra "OT source's month must not be locked" guard, since
 * that is the one rule new to this collection (ot_approvals itself has no such guard on its
 * own writes).
 *
 * Dates: 2026-09-15/16 (Tuesday/Wednesday) — ordinary weekdays, not Sundays, so Protocol 1's
 * rest-day immutability never interferes with these tests.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser, assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:  { role: "admin", name: "Admin" },
    otMgr:  { role: "office", tabAccess: [TABS.OT_SHORTAGE] },
    emp:    { role: "operations", name: "Employee" },
    other:  { role: "operations", name: "Other" },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  await seedDocs(env, {
    "users/emp/wo_ledger/2026-09-15": {
      date: "2026-09-15", userId: "emp", debitMins: 480, remainingMins: 480, status: "outstanding",
    },
    "users/emp/ot_approvals/2026-09-16": {
      date: "2026-09-16", userId: "emp", approvedMins: 120, settledMins: 0, status: "approved",
    },
    "users/emp/settlements/2026-09": { locked: false },
  });
});

test("an OT & Shortage manager can create a wo_ledger doc", async () => {
  const db = asUser(env, "otMgr");
  await assertSucceeds(
    db.doc("users/other/wo_ledger/2026-09-15").set({
      date: "2026-09-15", userId: "other", debitMins: 480, remainingMins: 480, status: "outstanding",
    }),
  );
});

test("a manager without Attendance or OT & Shortage cannot create a wo_ledger doc", async () => {
  const db = asUser(env, "emp"); // no tabAccess at all
  await assertFails(
    db.doc("users/other/wo_ledger/2026-09-15").set({
      date: "2026-09-15", userId: "other", debitMins: 480, remainingMins: 480, status: "outstanding",
    }),
  );
});

test("an OT & Shortage manager can create a settlement entry against an unlocked month", async () => {
  const db = asUser(env, "otMgr");
  await assertSucceeds(
    db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "OT Manager",
    }),
  );
});

test("a settlement entry against an already-LOCKED month is denied", async () => {
  await seedDocs(env, { "users/emp/settlements/2026-09": { locked: true } });
  const db = asUser(env, "otMgr");
  await assertFails(
    db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "OT Manager",
    }),
  );
});

test("a settlement entry is denied for a manager settling their own WO (notSelf)", async () => {
  await seedUsers(env, { otMgrSelf: { role: "office", tabAccess: [TABS.OT_SHORTAGE] } });
  await seedDocs(env, {
    "users/otMgrSelf/wo_ledger/2026-09-15": {
      date: "2026-09-15", userId: "otMgrSelf", debitMins: 480, remainingMins: 480, status: "outstanding",
    },
    "users/otMgrSelf/ot_approvals/2026-09-16": {
      date: "2026-09-16", userId: "otMgrSelf", approvedMins: 120, settledMins: 0, status: "approved",
    },
  });
  const db = asUser(env, "otMgrSelf");
  await assertFails(
    db.collection("users/otMgrSelf/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "OT Manager",
    }),
  );
});

test("full admin can create a wo_ledger doc and a settlement entry with no tabAccess at all", async () => {
  const db = asUser(env, "admin");
  await assertSucceeds(
    db.doc("users/other/wo_ledger/2026-09-16").set({
      date: "2026-09-16", userId: "other", debitMins: 480, remainingMins: 480, status: "outstanding",
    }),
  );
  await assertSucceeds(
    db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "Admin",
    }),
  );
});

test("a settlement entry is immutable — update and delete are both denied", async () => {
  const db = asUser(env, "admin");
  const ref = await db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
    otDate: "2026-09-16", minsApplied: 50, appliedBy: "Admin",
  });
  await assertFails(ref.update({ minsApplied: 100 }));
  await assertFails(ref.delete());
});

test("an employee can read their own wo_ledger doc but not another employee's", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/wo_ledger/2026-09-15").get());
  await assertFails(db.doc("users/other/wo_ledger/2026-09-15").get());
});
