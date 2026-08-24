"use strict";

// Boundary suite for the pure per-day OT/shortage/WO ledger math.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDayLedger, netLedgerMins, istMinuteOfDay,
  WO_DEBIT_MINS, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");

const shift = { shiftStartMin: 600, shiftEndMin: 1080, declaredOtMins: 0, isRestDay: false, otAuthorized: false };

test("constants", () => {
  assert.equal(WO_DEBIT_MINS, 480);
  assert.equal(DEFAULT_SHIFT_START_MIN, 600);
  assert.equal(DEFAULT_SHIFT_END_MIN, 1080);
});

test("late-out earns OT, split by declared", () => {
  // in 10:00 (600), out 19:00 (1140): 60 OT; declared 30 → auto 30, pending 30
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 1140, declaredOtMins: 30 });
  assert.equal(led.autoOtMins, 30);
  assert.equal(led.pendingExtraMins, 30);
  assert.equal(led.shortageMins, 0);
});

test("early-in earns nothing; early-out is shortage", () => {
  // in 09:50 (590) → early-in ignored; out 17:56 (1076) → 4 shortage
  const led = computeDayLedger({ ...shift, inMin: 590, outMin: 1076 });
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 4);
});

test("late-in and early-out both accrue shortage", () => {
  // in 10:30 (630) → 30 late; out 17:00 (1020) → 60 early = 90 shortage
  const led = computeDayLedger({ ...shift, inMin: 630, outMin: 1020 });
  assert.equal(led.shortageMins, 90);
  assert.equal(led.autoOtMins, 0);
});

test("late-out pays off late-in before any OT is credited", () => {
  // in 11:00 (660) = 60 late; out 18:30 (1110) = 30 late-out. The 30 covers 30 of the
  // 60 → 30 shortage left, NO OT. The reported bug showed 30 OT + 60 shortage here.
  const led = computeDayLedger({ ...shift, inMin: 660, outMin: 1110, declaredOtMins: 30 });
  assert.equal(led.shortageMins, 30);
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
});

test("late-in made up exactly: neither shortage nor OT", () => {
  // in 10:30 (630) = 30 late; out 18:30 (1110) = 30 late-out → square.
  const led = computeDayLedger({ ...shift, inMin: 630, outMin: 1110, declaredOtMins: 30 });
  assert.equal(led.shortageMins, 0);
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
});

test("only the surplus past break-even is OT", () => {
  // in 10:20 (620) = 20 late; out 18:30 (1110) = 30 late-out → 10 net OT, 0 shortage.
  const led = computeDayLedger({ ...shift, inMin: 620, outMin: 1110 });
  assert.equal(led.shortageMins, 0);
  assert.equal(led.pendingExtraMins, 10);
});

test("declared ceiling applies to the NET OT, not raw late-out", () => {
  // in 10:30 (630) = 30 late; out 19:00 (1140) = 60 late-out → 30 net, all within declared 30.
  const led = computeDayLedger({ ...shift, inMin: 630, outMin: 1140, declaredOtMins: 30 });
  assert.equal(led.autoOtMins, 30);
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 0);
});

test("net OT beyond the declared ceiling still splits auto/pending", () => {
  // in 10:15 (615) = 15 late; out 19:00 (1140) = 60 late-out → 45 net → 30 auto + 15 pending.
  const led = computeDayLedger({ ...shift, inMin: 615, outMin: 1140, declaredOtMins: 30 });
  assert.equal(led.autoOtMins, 30);
  assert.equal(led.pendingExtraMins, 15);
  assert.equal(led.shortageMins, 0);
});

test("authorized rest day: all worked minutes are OT", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 900, isRestDay: true, otAuthorized: true });
  assert.equal(led.restDayOtMins, 300);
  assert.equal(led.unauthorizedRestDay, false);
  assert.equal(led.shortageMins, 0);
});

test("unauthorized rest day: 0 OT, flagged", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 900, isRestDay: true, otAuthorized: false });
  assert.equal(led.restDayOtMins, 0);
  assert.equal(led.unauthorizedRestDay, true);
});

test("no valid shift (end <= start) and not rest day: nothing accrues", () => {
  const led = computeDayLedger({ ...shift, shiftStartMin: 600, shiftEndMin: 600, inMin: 600, outMin: 1140 });
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 0);
});

test("netLedgerMins nets approved OT minus shortage minus WO debit", () => {
  assert.equal(netLedgerMins({ autoOtMins: 30, restDayOtMins: 0, approvedGrantedMins: 30, shortageMins: 0, woDebitMins: 0 }), 60);
  assert.equal(netLedgerMins({ autoOtMins: 0, restDayOtMins: 0, approvedGrantedMins: 0, shortageMins: 0, woDebitMins: 480 }), -480);
  assert.equal(netLedgerMins({ autoOtMins: 0, restDayOtMins: 300, approvedGrantedMins: 0, shortageMins: 0, woDebitMins: 480 }), -180);
});

test("istMinuteOfDay converts epoch seconds to IST minute-of-day", () => {
  // 2026-06-01 10:00:00 +05:30
  const secs = Math.floor(new Date("2026-06-01T10:00:00+05:30").getTime() / 1000);
  assert.equal(istMinuteOfDay(secs), 600);
});
