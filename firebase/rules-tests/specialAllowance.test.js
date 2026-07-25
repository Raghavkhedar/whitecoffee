"use strict";

/**
 * SPECIAL ALLOWANCE — users/{uid}/specialAllowance/{month}
 *
 * A monthly per-employee rupee amount that lands directly in payroll TOTAL DUE, so it
 * carries the SAME self-deal risk as settlements.settlementCash and is scoped identically:
 * read by the employee, admin, and a manager holding OT Settlements; write by admin or that
 * same manager, EXCEPT on their own record (notSelf).
 *
 * The collectionGroup path (`{path=**}/specialAllowance/{month}`) is READ-ONLY on purpose —
 * a collectionGroup match cannot bind {userId}, so it cannot enforce notSelf. Granting write
 * there would be the exact second-door hole that once reopened self-approval on
 * attendance_status. See the rules file and CLAUDE.md's "Security boundary" section.
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
    admin:    { role: "admin" },
    emp:      { role: "operations" },
    setMgr:   { role: "office", tabAccess: [TABS.OT_SETTLEMENTS] },
    leaveMgr: { role: "office", tabAccess: [TABS.LEAVES] },
  });
});

after(async () => { await teardown(); });

const sa = (o = {}) => ({
  month: "2026-07", amount: 12000, date: "2026-07-28",
  locked: false, lockedBy: null, lockedAt: null, ...o,
});

beforeEach(async () => {
  await seedDocs(env, {
    "users/emp/specialAllowance/2026-07": sa(),
    "users/setMgr/specialAllowance/2026-07": sa(),
  });
});

// ── Admin: full access ──────────────────────────────────────────────────────

test("admin can read and write any employee's SA", async () => {
  const db = asUser(env, "admin");
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-07").get());
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-07").set(sa({ amount: 15000 })));
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-08").set(sa({ month: "2026-08" })));
});

// ── A Settlements manager: full access on others, never on themselves ──────

test("a Settlements manager can read and write another employee's SA", async () => {
  const db = asUser(env, "setMgr");
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-07").get());
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-07").set(sa({ amount: 8000 })));
});

test("a Settlements manager CANNOT write their OWN SA (notSelf)", async () => {
  // The important one: SA lands straight in TOTAL DUE, exactly like settlementCash — a
  // manager granting themselves a Special Allowance is the identical self-deal, modeled on
  // self-approval.test.js's "a Settlements manager CANNOT settle their own month".
  const db = asUser(env, "setMgr");
  await assertFails(db.doc("users/setMgr/specialAllowance/2026-07").set(sa({ amount: 99999 })));
  await assertFails(db.doc("users/setMgr/specialAllowance/2026-07").update({ amount: 99999 }));
  // ...but they can still read it (read is not notSelf-gated).
  await assertSucceeds(db.doc("users/setMgr/specialAllowance/2026-07").get());
  // ...and can still do their actual job on someone else's record.
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-07").set(sa({ amount: 500 })));
});

// ── A manager holding an unrelated single tab: no access at all ────────────

test("a manager holding an unrelated tab (Leaves) can neither read nor write SA", async () => {
  const db = asUser(env, "leaveMgr");
  await assertFails(db.doc("users/emp/specialAllowance/2026-07").get());
  await assertFails(db.doc("users/emp/specialAllowance/2026-07").set(sa({ amount: 500 })));
});

// ── An employee: can read their own, cannot write it ────────────────────────

test("an employee can read their own SA but cannot write it", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/specialAllowance/2026-07").get());
  await assertFails(db.doc("users/emp/specialAllowance/2026-07").set(sa({ amount: 99999 })));
  await assertFails(db.doc("users/emp/specialAllowance/2026-07").update({ amount: 1 }));
});

test("an employee cannot read someone else's SA", async () => {
  await assertFails(asUser(env, "emp").doc("users/setMgr/specialAllowance/2026-07").get());
});

// ── The collectionGroup path is a read-only second door ─────────────────────

test("collectionGroup SA read is scoped identically to the per-doc rule", async () => {
  const { collectionGroup, getDocs } = require("firebase/firestore");
  await assertSucceeds(getDocs(collectionGroup(asUser(env, "admin"), "specialAllowance")));
  await assertSucceeds(getDocs(collectionGroup(asUser(env, "setMgr"), "specialAllowance")));
  await assertFails(getDocs(collectionGroup(asUser(env, "leaveMgr"), "specialAllowance")));
  await assertFails(getDocs(collectionGroup(asUser(env, "emp"), "specialAllowance")));
});

test("the collectionGroup rule itself grants no write — even a caller with full collectionGroup READ access still can't write their own SA", async () => {
  // The sharpest evidence that the collectionGroup match has no `allow write` clause: setMgr
  // satisfies the collectionGroup read condition (isAdmin() || canAccessSettlements()) yet
  // still cannot write their own doc, because that write is governed ONLY by the per-doc
  // rule's notSelf — there is no broader grant leaking in from the {path=**} match. If the
  // collectionGroup rule ever gained a write clause mirroring its read clause, this is
  // exactly the test that would catch it (the same second door that once reopened
  // self-approval on attendance_status).
  const db = asUser(env, "setMgr");
  await assertSucceeds(db.doc("users/setMgr/specialAllowance/2026-07").get()); // collectionGroup-eligible reader
  await assertFails(db.doc("users/setMgr/specialAllowance/2026-07").set(sa({ amount: 77777 })));
});
