"use strict";

// Unit suite for punch integrity. The governing constraint: this code must NEVER reject or
// drop a punch — offline check-in depends on the client write landing. Every test below
// therefore asserts a verdict, not a refusal.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assessPunch, istDateOf, distanceMetres, toMillis, DEFAULT_GEOFENCE_M } = require("./punchIntegrity");

// 2026-07-20 09:00 IST == 03:30 UTC
const IST_0900 = Date.UTC(2026, 6, 20, 3, 30);
const site = { latitude: 12.9716, longitude: 77.5946, radiusM: 200 };

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
  const { date, integrity } = assessPunch(punch(), IST_0900, site);
  assert.equal(integrity.trusted, true);
  assert.deepEqual(integrity.flags, []);
  assert.equal(date, undefined, "an unchanged punch must not be rewritten");
  assert.equal(integrity.distanceM, 0);
});

// ── Offline sync is NORMAL and must never be treated as failure ────────────

test("an offline punch syncing hours later is flagged but still accepted", () => {
  const sixHoursLater = IST_0900 + 6 * 60 * 60 * 1000;
  const { integrity } = assessPunch(punch(), sixHoursLater, site);
  assert.ok(integrity.flags.includes("delayed_sync"));
  assert.equal(integrity.clockSkewMinutes, 360);
  // The punch still lands — assessPunch returns a verdict, never a rejection.
});

test("small clock skew is not flagged at all", () => {
  const { integrity } = assessPunch(punch(), IST_0900 + 5 * 60000, site);
  assert.deepEqual(integrity.flags, []);
  assert.equal(integrity.trusted, true);
});

// ── The forgery this exists to catch ───────────────────────────────────────

test("a forged `date` is corrected from the trusted timestamp", () => {
  // The scorer queries by `date`, so a truthful timestamp with a forged date would
  // silently attribute the punch to another day.
  const { date, integrity } = assessPunch(punch({ date: "2026-06-01" }), IST_0900, site);
  assert.equal(date, "2026-07-20");
  assert.ok(integrity.flags.includes("date_mismatch"));
  assert.equal(integrity.trusted, false);
});

test("a future-dated punch is flagged", () => {
  const { integrity } = assessPunch(punch(), IST_0900 - 60 * 60 * 1000, site);
  assert.ok(integrity.flags.includes("future_timestamp"));
});

test("a punch outside the geofence is flagged, NOT rejected", () => {
  // ~1.1 km north. Rejecting would cost a real employee a day's pay on GPS drift.
  const far = punch({ latitude: 12.9816, longitude: 77.5946 });
  const { integrity } = assessPunch(far, IST_0900, site);
  assert.ok(integrity.flags.includes("outside_geofence"));
  assert.ok(integrity.distanceM > 1000 && integrity.distanceM < 1200, `got ${integrity.distanceM}`);
  assert.equal(integrity.trusted, false);
});

test("a punch just inside the radius is clean", () => {
  const near = punch({ latitude: 12.9725, longitude: 77.5946 }); // ~100 m
  const { integrity } = assessPunch(near, IST_0900, site);
  assert.deepEqual(integrity.flags, []);
});

test("mock location is flagged when the app reports it", () => {
  const { integrity } = assessPunch(punch({ isMockLocation: true }), IST_0900, site);
  assert.ok(integrity.flags.includes("mock_location"));
});

test("a MISSING isMockLocation is not suspicious (older app versions)", () => {
  const { integrity } = assessPunch(punch({ isMockLocation: undefined }), IST_0900, site);
  assert.deepEqual(integrity.flags, []);
});

// ── Degenerate input must not throw — a crash would drop the punch ─────────

test("missing site, coords, or timestamp degrade gracefully", () => {
  assert.equal(assessPunch(punch(), IST_0900, null).integrity.distanceM, null);
  assert.equal(assessPunch(punch({ latitude: undefined }), IST_0900, site).integrity.distanceM, null);
  const noTs = assessPunch(punch({ timestamp: null }), IST_0900, site);
  assert.equal(noTs.integrity.clockSkewMinutes, null);
  assert.equal(noTs.date, undefined, "no timestamp → no date correction guess");
  assert.doesNotThrow(() => assessPunch({}, IST_0900, null));
  assert.doesNotThrow(() => assessPunch(null, IST_0900, null));
});

test("a site with no radius uses the default", () => {
  const noRadius = { latitude: 12.9716, longitude: 77.5946 };
  const near = punch({ latitude: 12.9725 }); // ~100 m, inside the 200 m default
  assert.deepEqual(assessPunch(near, IST_0900, noRadius).integrity.flags, []);
  assert.equal(DEFAULT_GEOFENCE_M, 200);
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

test("distanceMetres is symmetric and zero for identical points", () => {
  assert.equal(Math.round(distanceMetres(12.9716, 77.5946, 12.9716, 77.5946)), 0);
  const a = distanceMetres(12.9716, 77.5946, 12.9816, 77.6046);
  const b = distanceMetres(12.9816, 77.6046, 12.9716, 77.5946);
  assert.equal(Math.round(a), Math.round(b));
});
