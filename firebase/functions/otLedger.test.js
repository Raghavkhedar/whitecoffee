"use strict";

// Boundary suite for the pure per-day OT/shortage/WO ledger math.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDayLedger, netLedgerMins, istMinuteOfDay,
  WO_DEBIT_MINS, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");

const shift = { shiftStartMin: 600, shiftEndMin: 1080, declaredOtMins: 0, isRestDay: false, isWoDay: false };

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

test("rest day: whole worked window is pending, never auto-credited", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 900, isRestDay: true });
  assert.equal(led.pendingExtraMins, 300);
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.shortageMins, 0);
});

test("rest day never yields shortage, whatever the in/out times", () => {
  // "Early-in"/"early-out" relative to a normal shift window is meaningless on a rest day.
  const led = computeDayLedger({ ...shift, inMin: 540, outMin: 570, isRestDay: true });
  assert.equal(led.pendingExtraMins, 30);
  assert.equal(led.shortageMins, 0);
});

test("rest day: declared-OT ceiling does not apply — all worked mins are pending regardless", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 900, isRestDay: true, declaredOtMins: 30 });
  assert.equal(led.pendingExtraMins, 300);
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.shortageMins, 0);
});

test("rest day ignores shift window, even when out extends past what would be late-out", () => {
  // out 20:00 (1200) is 2h past shiftEndMin (1080) — on a normal day that would be late-out
  // OT capped/split by declaredOtMins; on a rest day it is just more of the same pending window.
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 1200, isRestDay: true });
  assert.equal(led.pendingExtraMins, 600);
  assert.equal(led.shortageMins, 0);
});

test("WO day mirrors rest-day treatment: worked window becomes pending, not shortage", () => {
  // Told to leave at 2pm on a 10:00–18:00 shift, day marked WO: the 4h worked (in 600, out
  // 840) becomes pending OT, not an early-out shortage.
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 840, isWoDay: true, declaredOtMins: 30 });
  assert.equal(led.pendingExtraMins, 240);
  assert.equal(led.shortageMins, 0);
  assert.equal(led.autoOtMins, 0);
});

test("WO day with no punches accrues nothing", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 600, isWoDay: true });
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 0);
  assert.equal(led.autoOtMins, 0);
});

test("no valid shift (end <= start) and not rest day: nothing accrues", () => {
  const led = computeDayLedger({ ...shift, shiftStartMin: 600, shiftEndMin: 600, inMin: 600, outMin: 1140 });
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 0);
});

test("netLedgerMins nets approved OT minus shortage; WO debt no longer participates (Protocol 3)", () => {
  assert.equal(netLedgerMins({ autoOtMins: 30, approvedGrantedMins: 30, shortageMins: 0 }), 60);
  assert.equal(netLedgerMins({ autoOtMins: 0, approvedGrantedMins: 300, shortageMins: 0 }), 300);
});

test("istMinuteOfDay converts epoch seconds to IST minute-of-day", () => {
  // 2026-06-01 10:00:00 +05:30
  const secs = Math.floor(new Date("2026-06-01T10:00:00+05:30").getTime() / 1000);
  assert.equal(istMinuteOfDay(secs), 600);
});
