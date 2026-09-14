"use strict";

/**
 * REST DAYS ARE IMMUTABLE — Protocol 1
 * (docs/superpowers/specs/2026-09-14-ot-redesign-design.md)
 *
 * Sundays and company holidays are system-owned and final: no admin, manager,
 * regularization, or backfill may write, change, or override an attendance_status doc on
 * those dates. WO is illegal there too — a WO exists to be worked off against a debit, and
 * a rest day already carries no obligation. Work performed on a rest day instead raises a
 * pending OT request (Tasks 1/2, already in place); this suite only proves the write is
 * blocked at the door.
 *
 * `isRestDate(date)` in firestore.rules is `isSundayDate(date) || exists(holidays/$(date))`
 * — both halves need their own test. The Cloud Function's own Sunday/Holiday status write
 * uses the Admin SDK and bypasses rules entirely, so it is deliberately NOT exercised here.
 *
 * Test dates (all 2026, verified against the UTC calendar):
 *   2026-09-13 — a Sunday
 *   2026-08-19 — a plain Wednesday, marked as a holiday doc for these tests
 *   2026-09-16 — a plain Wednesday, no holiday — the control weekday
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

const SUNDAY       = "2026-09-13";
const HOLIDAY      = "2026-08-19";
const WEEKDAY      = "2026-09-16";

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:   { role: "admin", name: "Admin" },
    emp:     { role: "operations", name: "Employee" },
    attMgr:  { role: "office", name: "Attendance Manager", tabAccess: [TABS.ATTENDANCE] },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  await seedDocs(env, {
    [`holidays/${HOLIDAY}`]: { title: "Test Holiday", description: "" },
  });
});

// ── Sunday ───────────────────────────────────────────────────────────────

test("WO on a Sunday is denied, even for admin", async () => {
  await assertFails(
    asUser(env, "admin").doc(`users/emp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "emp", status: "WO", markedBy: "admin" })
  );
});

test("Present on a Sunday is denied, even for admin", async () => {
  await assertFails(
    asUser(env, "admin").doc(`users/emp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "emp", status: "Present", markedBy: "admin" })
  );
});

// ── Holiday ──────────────────────────────────────────────────────────────

test("WO on a holiday is denied, even for admin", async () => {
  await assertFails(
    asUser(env, "admin").doc(`users/emp/attendance_status/${HOLIDAY}`)
      .set({ date: HOLIDAY, userId: "emp", status: "WO", markedBy: "admin" })
  );
});

test("Present on a holiday is denied, even for admin", async () => {
  await assertFails(
    asUser(env, "admin").doc(`users/emp/attendance_status/${HOLIDAY}`)
      .set({ date: HOLIDAY, userId: "emp", status: "Present", markedBy: "admin" })
  );
});

// ── Plain weekday still works ────────────────────────────────────────────

test("any status on a plain weekday is still allowed for admin", async () => {
  await assertSucceeds(
    asUser(env, "admin").doc(`users/emp/attendance_status/${WEEKDAY}`)
      .set({ date: WEEKDAY, userId: "emp", status: "WO", markedBy: "admin" })
  );
  await assertSucceeds(
    asUser(env, "admin").doc(`users/emp/attendance_status/${WEEKDAY}`)
      .set({ date: WEEKDAY, userId: "emp", status: "Present", markedBy: "admin" })
  );
});

// ── A non-admin manager holding /attendance ─────────────────────────────

test("a manager holding /attendance is denied on a rest day but allowed on a weekday", async () => {
  const db = asUser(env, "attMgr");
  await assertFails(
    db.doc(`users/emp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "emp", status: "Present", markedBy: "admin" })
  );
  await assertFails(
    db.doc(`users/emp/attendance_status/${HOLIDAY}`)
      .set({ date: HOLIDAY, userId: "emp", status: "WO", markedBy: "admin" })
  );
  await assertSucceeds(
    db.doc(`users/emp/attendance_status/${WEEKDAY}`)
      .set({ date: WEEKDAY, userId: "emp", status: "Present", markedBy: "admin" })
  );
});

// ── Reads are untouched ──────────────────────────────────────────────────

test("reading a rest-day status doc is unaffected by the write guard", async () => {
  await seedDocs(env, {
    [`users/emp/attendance_status/${SUNDAY}`]: { date: SUNDAY, userId: "emp", status: "Sunday", markedBy: "auto" },
  });
  await assertSucceeds(asUser(env, "admin").doc(`users/emp/attendance_status/${SUNDAY}`).get());
  await assertSucceeds(asUser(env, "attMgr").doc(`users/emp/attendance_status/${SUNDAY}`).get());
});
