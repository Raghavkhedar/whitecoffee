"use strict";

/**
 * Regularization past-date window — an admin-only global toggle that lets employees file a
 * regularization for a PAST date (normally only today's date is creatable). See
 * docs/superpowers/specs/2026-09-05-regularization-window-design.md.
 *
 * Today-only enforcement was, before this change, a UI-only restriction: the create rule for
 * regularization_requests never inspected `date` at all. These tests cover the real gate.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

// IST "yyyy-MM-dd" for a JS Date, mirroring the +05:30 shift firebase/functions/index.js uses
// and the one the rule itself performs on request.time.
function istDateStr(date) {
  const ist = new Date(date.getTime() + 19800000); // +05:30 in ms
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Pure calendar-day arithmetic on a "yyyy-MM-dd" string (no further timezone shifting needed —
// istDateStr() already resolved the instant to a calendar date).
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

const TODAY = istDateStr(new Date());
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const YESTERDAY_MONTH = YESTERDAY.slice(0, 7);

function req(userId, date) {
  return { userId, status: "pending", date, reason: "test" };
}

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:  { role: "admin", name: "Admin" },
    emp:    { role: "operations", name: "Employee" },
    other:  { role: "operations", name: "Other Employee" },
    regMgr: { role: "office", name: "Regularization Manager", tabAccess: [TABS.REGULARIZATION] },
  });
});

after(async () => { await teardown(); });

// Explicit baseline before every test — never rely on a doc being absent from a previous test.
beforeEach(async () => {
  await seedDocs(env, {
    "config/regularizationWindow": { open: false },
    [`users/emp/settlements/${YESTERDAY_MONTH}`]: { locked: false },
    [`users/other/settlements/${YESTERDAY_MONTH}`]: { locked: false },
  });
});

// Each test below writes to its OWN docId. Firestore rules evaluate a `.set()` against the
// `create` rule only while the target document does not yet exist — a second `.set()` on a
// path a prior test already created would silently become an `update` (a completely different,
// date-blind rule), masking the create-rule behavior these tests exist to exercise.

test("today's date is always creatable, window closed", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/regularization_requests/r-today").set(req("emp", TODAY)));
});

test("a past date is denied when the window is closed", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/regularization_requests/r-past-closed").set(req("emp", YESTERDAY)));
});

test("a past date is allowed when the window is open and the month isn't settled", async () => {
  await seedDocs(env, { "config/regularizationWindow": { open: true } });
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/regularization_requests/r-past-open").set(req("emp", YESTERDAY)));
});

test("a past date is denied when the window is open but that employee's month is locked", async () => {
  await seedDocs(env, {
    "config/regularizationWindow": { open: true },
    [`users/emp/settlements/${YESTERDAY_MONTH}`]: { locked: true },
  });
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/regularization_requests/r-past-locked").set(req("emp", YESTERDAY)));
});

test("another employee's locked month does not block a different employee", async () => {
  await seedDocs(env, {
    "config/regularizationWindow": { open: true },
    [`users/emp/settlements/${YESTERDAY_MONTH}`]: { locked: true },
  });
  const db = asUser(env, "other");
  await assertSucceeds(db.doc("users/other/regularization_requests/r-other").set(req("other", YESTERDAY)));
});

test("a future date is always denied, even with the window open", async () => {
  await seedDocs(env, { "config/regularizationWindow": { open: true } });
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/regularization_requests/r-future").set(req("emp", TOMORROW)));
});

test("any logged-in user can read the window config doc", async () => {
  await seedDocs(env, { "config/regularizationWindow": { open: true } });
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("config/regularizationWindow").get());
});

test("only admin can write the window config doc", async () => {
  await assertFails(asUser(env, "regMgr").doc("config/regularizationWindow").set({ open: true }));
  await assertFails(asUser(env, "emp").doc("config/regularizationWindow").set({ open: true }));
  await assertSucceeds(asUser(env, "admin").doc("config/regularizationWindow").set({ open: true }));
});
