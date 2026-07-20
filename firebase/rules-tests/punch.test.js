"use strict";

/**
 * ATTENDANCE PUNCH BOUNDS — the critical finding.
 *
 * Punches were accepted with NO validation: any type, any timestamp, any GPS, any date,
 * backdated arbitrarily. The nightly scorer trusts them completely, so this was a direct
 * route to "Present every day, unlimited OT" for any employee with their own login.
 *
 * These punches CANNOT move behind a callable — AttendanceRepository writes through the
 * Firestore SDK without awaiting, which is what makes check-in work offline at sites with
 * no signal. Forcing a callable would LOSE punches. So the write stays client-side and is
 * bounded here, with the onPunchWritten trigger scoring what lands.
 */

const { test, before, after } = require("node:test");
const { setup, teardown, seedUsers, asUser, assertSucceeds, assertFails } = require("./helpers");
const { Timestamp } = require("firebase/firestore");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, { emp: { role: "operations" }, admin: { role: "admin" } });
});

after(async () => { await teardown(); });

const MIN = 60 * 1000, HOUR = 60 * MIN;
const punch = (o = {}) => ({
  userId: "emp", employeeId: "EMP", userName: "Employee",
  type: "site_in", date: "2026-07-20",
  timestamp: Timestamp.fromDate(new Date()),
  latitude: 12.9716, longitude: 77.5946, ...o,
});
const at = (offsetMs) => Timestamp.fromDate(new Date(Date.now() + offsetMs));
let n = 0;
const ref = (db) => db.doc(`users/emp/attendance/p${++n}`);

// ── A normal punch still works ─────────────────────────────────────────────

test("an ordinary live punch is accepted", async () => {
  await assertSucceeds(ref(asUser(env, "emp")).set(punch()));
});

test("an OFFLINE punch syncing hours later is still accepted", async () => {
  // The whole reason this validation lives in rules rather than a callable. A punch made
  // 6 hours ago at a site with no signal must land when the phone reconnects.
  await assertSucceeds(ref(asUser(env, "emp")).set(punch({ timestamp: at(-6 * HOUR) })));
  await assertSucceeds(ref(asUser(env, "emp")).set(punch({ timestamp: at(-11.5 * HOUR) })));
});

// ── Backdating: the payroll attack ─────────────────────────────────────────

test("a punch backdated beyond the 12h offline window is REJECTED", async () => {
  // "Mark myself Present for all of last month" — the highest-value forgery.
  await assertFails(ref(asUser(env, "emp")).set(punch({ timestamp: at(-13 * HOUR) })));
  await assertFails(ref(asUser(env, "emp")).set(punch({ timestamp: at(-30 * 24 * HOUR) })));
});

test("a future-dated punch is REJECTED", async () => {
  // Pre-dating tomorrow's shift so it scores while you are elsewhere.
  await assertFails(ref(asUser(env, "emp")).set(punch({ timestamp: at(+2 * HOUR) })));
  // ...but a few minutes of clock skew is tolerated, or honest phones would be blocked.
  await assertSucceeds(ref(asUser(env, "emp")).set(punch({ timestamp: at(+2 * MIN) })));
});

// ── Shape ──────────────────────────────────────────────────────────────────

test("an unknown punch type is rejected", async () => {
  await assertFails(ref(asUser(env, "emp")).set(punch({ type: "admin_override" })));
  await assertFails(ref(asUser(env, "emp")).set(punch({ type: "" })));
});

test("every legitimate punch type is accepted", async () => {
  for (const t of ["office_in", "office_out", "site_in", "site_out",
                   "market_in", "market_out", "home_in", "home_out"]) {
    await assertSucceeds(ref(asUser(env, "emp")).set(punch({ type: t })));
  }
});

test("a missing or malformed timestamp is rejected", async () => {
  await assertFails(ref(asUser(env, "emp")).set(punch({ timestamp: null })));
  await assertFails(ref(asUser(env, "emp")).set(punch({ timestamp: "2026-07-20T09:00:00Z" })));
});

test("a malformed date is rejected", async () => {
  await assertFails(ref(asUser(env, "emp")).set(punch({ date: "20-07-2026" })));
  await assertFails(ref(asUser(env, "emp")).set(punch({ date: 20260720 })));
});

test("non-numeric or absent coordinates are rejected", async () => {
  await assertFails(ref(asUser(env, "emp")).set(punch({ latitude: "12.97" })));
  // Build the payload without the key at all — passing `undefined` would be stripped by
  // the SDK before the rules ever see it, so it would not test what it claims to.
  const noLng = punch();
  delete noLng.longitude;
  await assertFails(ref(asUser(env, "emp")).set(noLng));
});

// ── Ownership and immutability are unchanged ───────────────────────────────

test("an employee cannot write a punch into someone else's record", async () => {
  await assertFails(asUser(env, "emp").doc("users/admin/attendance/x").set(punch({ userId: "admin" })));
});

test("a punch stays immutable after it lands", async () => {
  const db = asUser(env, "emp");
  const d = db.doc("users/emp/attendance/immutable");
  await assertSucceeds(d.set(punch()));
  await assertFails(d.update({ timestamp: at(-6 * HOUR) }));
  await assertFails(d.update({ type: "office_out" }));
  await assertFails(d.delete());
});

test("an employee cannot forge the server's integrity verdict", async () => {
  // The trigger writes `integrity` with the Admin SDK; a client marking itself trusted
  // would defeat the whole verdict. Update is already restricted to the admin-patch
  // fields, so this is denied along with every other client rewrite.
  const db = asUser(env, "emp");
  const d = db.doc("users/emp/attendance/verdict");
  await assertSucceeds(d.set(punch()));
  await assertFails(d.update({ integrity: { trusted: true, flags: [] } }));
});
