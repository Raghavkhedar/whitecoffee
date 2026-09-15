"use strict";

/**
 * Protocol 2 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): a regularization
 * approval's batch can now include a conveyance write. These tests lock in the assumption the
 * design depends on — the existing conveyance rule (firestore.rules:677-683) was never
 * exercised inside a multi-collection batch before, and a Firestore batch fails ATOMICALLY if
 * any single write in it fails its rule.
 *
 * Date note: the plan's brief used 2026-09-13 for the last case below, but rest-day.test.js
 * establishes 2026-09-13 as a Sunday, and firestore.rules:443-444 blocks ANY attendance_status
 * write on a rest date unconditionally (admin included, via !isRestDate(date), no exemption).
 * Using it here would fail for the wrong reason (rest-day immutability, not tabAccess), so that
 * case uses 2026-09-14 (the following Monday, unused by any other test file) instead.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const {
  TABS, setup, teardown, seedUsers, asUser, assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:   { role: "admin", name: "Admin" },
    regMgr:  { role: "office", tabAccess: [TABS.REGULARIZATION] },
    convMgr: { role: "office", tabAccess: [TABS.CONVEYANCE] },
    both:    { role: "office", tabAccess: [TABS.REGULARIZATION, TABS.CONVEYANCE] },
    emp:     { role: "operations", name: "Employee" },
  });
});

after(async () => { await teardown(); });

test("a Regularization-only manager's batch WITHOUT a conveyance write still succeeds", async () => {
  const db = asUser(env, "regMgr");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-10"), {
    date: "2026-09-10", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  await assertSucceeds(batch.commit());
});

test("a Regularization-only manager's batch WITH a conveyance write fails atomically", async () => {
  const db = asUser(env, "regMgr");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-11"), {
    date: "2026-09-11", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  batch.set(db.doc("conveyance/emp__2026-09-11"), {
    userId: "emp", date: "2026-09-11", month: "2026-09", totalKm: 10, conveyance: 25, markedBy: "admin",
  });
  await assertFails(batch.commit());

  // Confirm the status write did NOT partially apply.
  const check = await db.doc("users/emp/attendance_status/2026-09-11").get();
  assert.strictEqual(check.exists, false);
});

test("a manager holding BOTH tabs can batch both writes together", async () => {
  const db = asUser(env, "both");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-12"), {
    date: "2026-09-12", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  batch.set(db.doc("conveyance/emp__2026-09-12"), {
    userId: "emp", date: "2026-09-12", month: "2026-09", totalKm: 10, conveyance: 25, markedBy: "admin",
  });
  await assertSucceeds(batch.commit());
});

test("full admin can batch both writes with no tabAccess at all", async () => {
  const db = asUser(env, "admin");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-14"), {
    date: "2026-09-14", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  batch.set(db.doc("conveyance/emp__2026-09-14"), {
    userId: "emp", date: "2026-09-14", month: "2026-09", totalKm: 10, conveyance: 25, markedBy: "admin",
  });
  await assertSucceeds(batch.commit());
});
