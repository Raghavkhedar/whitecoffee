"use strict";

/**
 * SUPERADMIN — users/{uid}.superAdmin === true
 * (docs/superpowers/specs/2026-09-22-superadmin-role-design.md)
 *
 * A superadmin bypasses every wall in firestore.rules EXCEPT audit_log. The 5 walls
 * exercised here are the only ones that block even isAdmin() today: attendance_corrections
 * update/delete, wo_ledger/{date}/settlements update/delete, dailySpend write, system/**
 * write (including the PL-accrual idempotency marker), and the Sunday/holiday rest-day
 * guard on attendance_status. This file also proves the bypass does NOT leak to an
 * ordinary admin (no flag) or to a non-admin employee — the catch-all's isSuperAdmin()
 * check must be doing real work, not accidentally always-true.
 *
 * SUNDAY = 2026-09-20, a Sunday distinct from the one rest-day.test.js already uses
 * (2026-09-13), so this file's fixtures never collide with another file's.
 */

const { test, before, after } = require("node:test");
const {
  setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

const SUNDAY = "2026-09-20";

before(async () => {
  env = await setup();
  await seedUsers(env, {
    superadmin: { role: "admin", name: "Superadmin", superAdmin: true },
    // role: 'office', NOT 'admin' — isolates the catch-all's OWN behavior from isAdmin()'s
    // pre-existing grants. Every LIST test below originally passed against a buggy rule
    // because `superadmin` above is ALSO role:'admin', and isAdmin() already grants list
    // access to most of these collections independently — that masking is exactly how the
    // list bug shipped in PR #45 unnoticed. This fixture has no admin-role fallback.
    pureSuperadmin: { role: "office", name: "Pure Superadmin", superAdmin: true },
    plainAdmin: { role: "admin", name: "Plain Admin" },
    plainEmp:   { role: "operations", name: "Plain Employee" },
  });
  await seedDocs(env, {
    "users/saEmp/attendance_corrections/c1": { reason: "test correction" },
    "users/saEmp/wo_ledger/2026-09-16": {
      date: "2026-09-16", userId: "saEmp", debitMins: 480, remainingMins: 480, status: "outstanding",
    },
    "users/saEmp/wo_ledger/2026-09-16/settlements/s1": {
      otDate: "2026-09-17", minsApplied: 50, appliedBy: "Admin",
    },
    "dailySpend/saEmp__2026-07-30": {
      userId: "saEmp", employeeId: "SAEMP", name: "SA Employee", role: "operations",
      date: "2026-07-30", month: "2026-07",
      salary: 1000, conveyance: 0, pf: 120, esi: 0, otWo: 0, imprest: 50,
      totalSpend: 830, frozen: false, computedAt: new Date().toISOString(),
    },
    "system/nightly_runs/computeDailyAttendanceStatus/2026-08-09": {
      date: "2026-08-09", activeUsers: 5, adminMarked: 0,
      expected: 5, scored: 5, plDeducted: 0, plAttempted: 0,
      failures: [], plFailures: [], ok: true,
    },
    "system/accruals/monthly/2026-08": { month: "2026-08", appliedTo: 5 },
    "audit_log/a1": { path: "users/saEmp", changeType: "update", actor: "saEmp" },
  });
});

after(async () => { await teardown(); });

// ── The 5 walls, bypassed for superadmin ────────────────────────────────

test("superadmin can update AND delete an attendance_corrections entry (immutable log for everyone else)", async () => {
  const db = asUser(env, "superadmin");
  await assertSucceeds(db.doc("users/saEmp/attendance_corrections/c1").update({ reason: "edited" }));
  await assertSucceeds(db.doc("users/saEmp/attendance_corrections/c1").delete());
});

test("superadmin can update AND delete a wo_ledger settlement entry (immutable log for everyone else)", async () => {
  const db = asUser(env, "superadmin");
  const ref = db.doc("users/saEmp/wo_ledger/2026-09-16/settlements/s1");
  await assertSucceeds(ref.update({ minsApplied: 999 }));
  await assertSucceeds(ref.delete());
});

test("superadmin can write dailySpend (Cloud-Function-only for everyone else)", async () => {
  await assertSucceeds(
    asUser(env, "superadmin").doc("dailySpend/saEmp__2026-07-30").set({ salary: 1 }, { merge: true })
  );
});

test("superadmin can write system/** including the PL-accrual idempotency marker", async () => {
  const db = asUser(env, "superadmin");
  await assertSucceeds(
    db.doc("system/nightly_runs/computeDailyAttendanceStatus/2026-08-09").set({ ok: false }, { merge: true })
  );
  // Deleting the accrual marker is exactly the double-pay hole this doc's immutability
  // exists to close — superadmin can open it, per the explicit design decision.
  await assertSucceeds(db.doc("system/accruals/monthly/2026-08").delete());
});

test("superadmin can write attendance_status on a Sunday (Protocol 1 rest-day guard, immutable for everyone else)", async () => {
  await assertSucceeds(
    asUser(env, "superadmin").doc(`users/saEmp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "saEmp", status: "Present", markedBy: "admin" })
  );
});

// ── LIST (collection-query) access — the bug this file's original version missed ──
// The original catch-all (`match /{document=**} { ... document[0] != 'audit_log' ... }`)
// worked for get/set/delete (a concrete document path) but threw "Variable is not bound
// in path template" for LIST/collection-query requests, where Firestore evaluates the
// rule against the query itself before any concrete path exists. Fixed by switching to
// `match /{collectionId}/{document=**}` — a plain (non-recursive) first-segment wildcard
// plus a recursive tail, which binds cleanly for both get and list. Every case below uses
// pureSuperadmin (role:'office') specifically so isAdmin() can't mask a still-broken list.

test("pureSuperadmin can LIST a collection with no other rule granting access (the exact bug scenario)", async () => {
  // An arbitrary, uncatalogued subcollection under a real document — precisely what the
  // /superadmin page's "browse a subcollection of this document" control reaches for.
  await assertSucceeds(
    asUser(env, "pureSuperadmin")
      .collection("users/saEmp/attendance_status/2026-09-16/arbitrarySubcollection")
      .get()
  );
});

test("pureSuperadmin can LIST a top-level collection that isAdmin() alone would also grant (system)", async () => {
  await assertSucceeds(asUser(env, "pureSuperadmin").collection("system").get());
});

test("pureSuperadmin can LIST a nested employee subcollection (attendance_status)", async () => {
  await assertSucceeds(asUser(env, "pureSuperadmin").collection("users/saEmp/attendance_status").get());
});

test("pureSuperadmin CANNOT list audit_log — the catch-all's own exclusion holds for LIST too, not just get/set", async () => {
  await assertFails(asUser(env, "pureSuperadmin").collection("audit_log").get());
});

// ── audit_log — the one wall that stays closed, even for superadmin ─────

test("superadmin CANNOT write audit_log — the one exception", async () => {
  const db = asUser(env, "superadmin");
  await assertFails(db.doc("audit_log/a2").set({ path: "forged" }));
  await assertFails(db.doc("audit_log/a1").update({ actor: "someone else" }));
  await assertFails(db.doc("audit_log/a1").delete());
});

// ── Regression: the bypass must not leak to non-superadmin roles ────────

test("an ordinary admin (no superAdmin flag) is still blocked from all 5 walls, exactly as before", async () => {
  const db = asUser(env, "plainAdmin");
  await assertFails(db.doc("users/saEmp/attendance_corrections/c1").update({ reason: "x" }));
  await assertFails(db.doc("users/saEmp/wo_ledger/2026-09-16/settlements/s1").update({ minsApplied: 1 }));
  await assertFails(db.doc("dailySpend/saEmp__2026-07-30").set({ salary: 1 }, { merge: true }));
  await assertFails(db.doc("system/accruals/monthly/2026-08").delete());
  await assertFails(
    db.doc(`users/saEmp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "saEmp", status: "WO", markedBy: "admin" })
  );
});

test("a non-admin, non-superadmin employee is still blocked from an arbitrary path they never had access to", async () => {
  // compensation/current is the pay document — normally admin/settlements-manager only.
  await seedDocs(env, {
    "users/saEmp/compensation/current": { salaryRate: 5000, pfPercent: 12, esiPercent: 0, imprestPercent: 0 },
  });
  await assertFails(asUser(env, "plainEmp").doc("users/saEmp/compensation/current").get());
  await assertFails(
    asUser(env, "plainEmp").doc("users/saEmp/compensation/current").set({ salaryRate: 1 }, { merge: true })
  );
});
