"use strict";

// Unit suite for punch integrity. The governing constraint: this code must NEVER reject or
// drop a punch — offline check-in depends on the client write landing. Every test below
// therefore asserts a verdict, not a refusal.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assessPunch, istDateOf, toMillis } = require("./punchIntegrity");

// 2026-07-20 09:00 IST == 03:30 UTC
const IST_0900 = Date.UTC(2026, 6, 20, 3, 30);

const punch = (o = {}) => ({
  userId: "u1", type: "site_in", date: "2026-07-20",
  timestamp: { toMillis: () => IST_0900 },
  latitude: 12.9716, longitude: 77.5946, ...o,
});

// ── IST date derivation (UTC clock — see root CLAUDE.md) ───────────────────

test("istDateOf shifts +05:30 and reads UTC parts", () => {
  assert.equal(istDateOf(Date.UTC(2026, 6, 20, 3, 30)), "2026-07-20"); // 09:00 IST
  // 23:00 UTC on the 19th is already 04:30 IST on the 20th — the off-by-one-day trap.
  assert.equal(istDateOf(Date.UTC(2026, 6, 19, 23, 0)), "2026-07-20");
  // 18:00 UTC on the 20th is 23:30 IST the same day — still the 20th.
  assert.equal(istDateOf(Date.UTC(2026, 6, 20, 18, 0)), "2026-07-20");
  // 18:31 UTC crosses into the 21st IST.
  assert.equal(istDateOf(Date.UTC(2026, 6, 20, 18, 31)), "2026-07-21");
});

// ── The happy path ─────────────────────────────────────────────────────────

test("an honest punch is trusted, with no date correction", () => {
  const { date, integrity } = assessPunch(punch(), IST_0900);
  assert.equal(integrity.trusted, true);
  assert.deepEqual(integrity.flags, []);
  assert.equal(date, undefined, "an unchanged punch must not be rewritten");
});

// ── Offline sync is NORMAL and must never be treated as failure ────────────

test("an offline punch syncing hours later is flagged but still accepted", () => {
  const sixHoursLater = IST_0900 + 6 * 60 * 60 * 1000;
  const { integrity } = assessPunch(punch(), sixHoursLater);
  assert.ok(integrity.flags.includes("delayed_sync"));
  assert.equal(integrity.clockSkewMinutes, 360);
  // The punch still lands — assessPunch returns a verdict, never a rejection.
});

test("small clock skew is not flagged at all", () => {
  const { integrity } = assessPunch(punch(), IST_0900 + 5 * 60000);
  assert.deepEqual(integrity.flags, []);
  assert.equal(integrity.trusted, true);
});

// ── The forgery this exists to catch ───────────────────────────────────────

test("a forged `date` is corrected from the trusted timestamp", () => {
  // The scorer queries by `date`, so a truthful timestamp with a forged date would
  // silently attribute the punch to another day.
  const { date, integrity } = assessPunch(punch({ date: "2026-06-01" }), IST_0900);
  assert.equal(date, "2026-07-20");
  assert.ok(integrity.flags.includes("date_mismatch"));
  assert.equal(integrity.trusted, false);
});

test("a future-dated punch is flagged", () => {
  const { integrity } = assessPunch(punch(), IST_0900 - 60 * 60 * 1000);
  assert.ok(integrity.flags.includes("future_timestamp"));
});

test("mock location is flagged when the app reports it", () => {
  const { integrity } = assessPunch(punch({ isMockLocation: true }), IST_0900);
  assert.ok(integrity.flags.includes("mock_location"));
});

test("a MISSING isMockLocation is not suspicious (older app versions)", () => {
  const { integrity } = assessPunch(punch({ isMockLocation: undefined }), IST_0900);
  assert.deepEqual(integrity.flags, []);
});

// ── Degenerate input must not throw — a crash would drop the punch ─────────

test("missing coords or timestamp degrade gracefully", () => {
  const noTs = assessPunch(punch({ timestamp: null }), IST_0900);
  assert.equal(noTs.integrity.clockSkewMinutes, null);
  assert.equal(noTs.date, undefined, "no timestamp → no date correction guess");
  assert.doesNotThrow(() => assessPunch({}, IST_0900));
  assert.doesNotThrow(() => assessPunch(null, IST_0900));
});

// ── Timestamp shape tolerance ──────────────────────────────────────────────

test("toMillis accepts every timestamp shape Firestore hands back", () => {
  assert.equal(toMillis({ toMillis: () => 123 }), 123);
  assert.equal(toMillis(new Date(456)), 456);
  assert.equal(toMillis(789), 789);
  assert.equal(toMillis({ _seconds: 2 }), 2000);
  assert.equal(toMillis({ seconds: 3 }), 3000);
  assert.equal(toMillis(null), null);
  assert.equal(toMillis({}), null);
});

