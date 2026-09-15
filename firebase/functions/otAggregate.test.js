"use strict";

// Boundary suite for the range/month OT aggregation. Run: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeRangeLedger, settlementCash } = require("./otAggregate");

// An attendance event at a real IST wall-clock time (the ledger reads timestamps as IST).
const ev = (userId, date, type, hhmm) => ({
  id: `${date}-${type}-${hhmm}`, userId, date, type,
  timestamp: { seconds: Math.floor(new Date(`${date}T${hhmm}:00+05:30`).getTime() / 1000) },
});

const U = "u1";
const noHol = new Set();

// 2026-06-01 Monday. Shift 10:00–18:00 + declared 30. Worked 10:00–19:00 → 60 OT (auto 30, pending 30).
const planNormal = [{ id: "2026-06-01", userId: U, date: "2026-06-01", startTime: "10:00", endTime: "18:00", declaredOtMins: 30 }];
const evNormal = [ev(U, "2026-06-01", "site_in", "10:00"), ev(U, "2026-06-01", "site_out", "19:00")];

test("normal day: auto 30, pending 30, net 30 (pending not credited)", () => {
  const r = computeRangeLedger(U, evNormal, planNormal, [], [], noHol);
  assert.equal(r.autoOtMins, 30);
  assert.equal(r.pendingOtMins, 30);
  assert.equal(r.pendingDates.length, 1);
  assert.equal(r.shortageMins, 0);
  assert.equal(r.netMins, 30);
});

test("beyond-declared +30 approved via ot_approvals (ordinary flow: requestedMins = pendingExtraMins = 30) → net 60", () => {
  const appr = [{ id: "2026-06-01", userId: U, date: "2026-06-01", requestedMins: 30, approvedMins: 30, status: "approved" }];
  const r = computeRangeLedger(U, evNormal, planNormal, appr, [], noHol);
  assert.equal(r.grantedOtMins, 30);
  assert.equal(r.pendingDates.length, 0); // remaining = 30 - 30 = 0
  assert.equal(r.netMins, 60);
});

test("Sunday rest-day work (2026-06-07) with no approval → net 0, pending 300", () => {
  // Protocol 1: rest-day work is never auto-credited. The whole worked window becomes a
  // pending OT request; net stays 0 and the date shows up in pendingDates until an admin acts.
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const r = computeRangeLedger(U, evSun, [], [], [], noHol);
  assert.equal(r.netMins, 0);
  assert.equal(r.pendingOtMins, 300);
  assert.equal(r.pendingDates.length, 1);
  assert.equal(r.pendingDates[0], "2026-06-07");
});

test("Sunday rest-day work, admin partially approves 120 of 300 pending (ordinary flow: requestedMins = the full 300 asked) → net 120, not pending", () => {
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const apprSun = [{ id: "2026-06-07", userId: U, date: "2026-06-07", requestedMins: 300, approvedMins: 120, status: "approved" }];
  const r = computeRangeLedger(U, evSun, [], apprSun, [], noHol);
  assert.equal(r.grantedOtMins, 120);
  assert.equal(r.netMins, 120);
  assert.equal(r.pendingDates.length, 0); // remaining = 300 - 300 = 0; the full ask was decided
});

// ── Task 6 bug-fix suite: pending must be tracked by remaining amount, not by ──
// ── ot_approvals doc presence. See docs/superpowers/specs/                    ──
// ── 2026-09-14-ot-redesign-design.md "Protocol 1 fix" addendum.               ──

test("[BUG FIX] unrelated manual grant (requestedMins=60) under-covers 300 pending → 240 still pending, not swallowed", () => {
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const manualUnrelated = [{ id: "2026-06-07", userId: U, date: "2026-06-07", requestedMins: 60, approvedMins: 60, status: "approved", manual: true }];
  const r = computeRangeLedger(U, evSun, [], manualUnrelated, [], noHol);
  assert.equal(r.grantedOtMins, 60);
  assert.equal(r.pendingOtMins, 240); // remaining = 300 - 60
  assert.equal(r.pendingDates.length, 1);
  assert.equal(r.pendingDates[0], "2026-06-07");
  assert.equal(r.netMins, 60); // auto 0 + granted 60; the pending 240 is not credited
});

test("[BUG FIX — exact brief scenario] Sunday (2026-06-28) worked 09:00–19:00 (600 min pending); unrelated 60-min manual grant leaves 540 pending", () => {
  const evSun2 = [ev(U, "2026-06-28", "site_in", "09:00"), ev(U, "2026-06-28", "site_out", "19:00")];
  const manualGrant60 = [{ id: "2026-06-28", userId: U, date: "2026-06-28", requestedMins: 60, approvedMins: 60, status: "approved", manual: true }];
  const r = computeRangeLedger(U, evSun2, [], manualGrant60, [], noHol);
  assert.equal(r.pendingOtMins, 540);
  assert.equal(r.pendingDates.length, 1);
  assert.equal(r.grantedOtMins, 60);
});

test("decision requestedMins EXCEEDS pendingExtraMins → remaining clamped to 0, not negative", () => {
  const evSun3 = [ev(U, "2026-06-14", "site_in", "10:00"), ev(U, "2026-06-14", "site_out", "12:00")]; // 120 min pending
  const overCover = [{ id: "2026-06-14", userId: U, date: "2026-06-14", requestedMins: 500, approvedMins: 120, status: "approved" }];
  const r = computeRangeLedger(U, evSun3, [], overCover, [], noHol);
  assert.equal(r.pendingDates.length, 0);
  assert.equal(r.pendingOtMins, 0);
  assert.equal(r.grantedOtMins, 120);
});

test("rejected day: requestedMins covers the full original ask, approvedMins=0 → 0 granted OT, correctly NOT pending", () => {
  const evSun4 = [ev(U, "2026-06-21", "site_in", "10:00"), ev(U, "2026-06-21", "site_out", "13:00")]; // 180 min pending
  const rejected = [{ id: "2026-06-21", userId: U, date: "2026-06-21", requestedMins: 180, approvedMins: 0, status: "rejected" }];
  const r = computeRangeLedger(U, evSun4, [], rejected, [], noHol);
  assert.equal(r.grantedOtMins, 0);
  assert.equal(r.netMins, 0);
  assert.equal(r.pendingDates.length, 0); // remaining = 180 - 180 = 0; fully decided as rejected
});

test("WO day alone: woDates counted, but WO debt no longer touches netMins (Protocol 3)", () => {
  const woStatus = [{ id: "2026-06-02", userId: U, date: "2026-06-02", status: "WO" }];
  const r = computeRangeLedger(U, [], [], [], woStatus, noHol);
  assert.equal(r.woDates.length, 1);
  assert.equal(r.netMins, 0);
});

test("WO day with partial punches: no shortage, worked window becomes pending (Protocol 3)", () => {
  const planWo = [{ id: "2026-06-16", userId: U, date: "2026-06-16", startTime: "10:00", endTime: "18:00", declaredOtMins: 30 }];
  const evWo = [ev(U, "2026-06-16", "site_in", "10:00"), ev(U, "2026-06-16", "site_out", "14:00")];
  const woStatusPartial = [{ id: "2026-06-16", userId: U, date: "2026-06-16", status: "WO" }];
  const r = computeRangeLedger(U, evWo, planWo, [], woStatusPartial, noHol);
  assert.equal(r.shortageMins, 0);
  assert.equal(r.pendingOtMins, 240);
  assert.equal(r.pendingDates[0], "2026-06-16");
  assert.equal(r.netMins, 0);
});

test("settledMins excludes already-spent OT from payable cash (Protocol 3)", () => {
  const apprSettled = [{ id: "2026-06-17", userId: U, date: "2026-06-17", requestedMins: 120, approvedMins: 120, settledMins: 50, status: "approved" }];
  const r = computeRangeLedger(U, [], [], apprSettled, [], noHol);
  assert.equal(r.grantedOtMins, 70);
  assert.equal(r.netMins, 70);
});

test("regularized-to-Present in/out with no events accrues shortage (net -90)", () => {
  const planReg = [{ id: "2026-06-03", userId: U, date: "2026-06-03", startTime: "10:00", endTime: "18:00" }];
  const statusReg = [{ id: "2026-06-03", userId: U, date: "2026-06-03", status: "Present", inTime: "10:00", outTime: "16:30" }];
  const r = computeRangeLedger(U, [], planReg, [], statusReg, noHol);
  assert.equal(r.shortageMins, 90);
  assert.equal(r.netMins, -90);
});

test("regularized in/out OVERRIDES raw events for the same date", () => {
  const statusReg2 = [{ id: "2026-06-01", userId: U, date: "2026-06-01", status: "Present", inTime: "10:00", outTime: "18:30" }];
  const r = computeRangeLedger(U, evNormal, planNormal, [], statusReg2, noHol);
  assert.equal(r.autoOtMins, 30);
  assert.equal(r.pendingOtMins, 0);
  assert.equal(r.shortageMins, 0);
});

test("manual OT grant on a day with no events counts as granted (net 120)", () => {
  const manualAppr = [{ id: "2026-06-04", userId: U, date: "2026-06-04", requestedMins: 120, approvedMins: 120, status: "approved", manual: true }];
  const r = computeRangeLedger(U, [], [], manualAppr, [], noHol);
  assert.equal(r.grantedOtMins, 120);
  assert.equal(r.netMins, 120);
});

test("early-in earns nothing (2026-06-08 Mon, shift 10:00–18:00, in 09:50 out 17:56)", () => {
  // Early-in 10m → ignored (no OT); early-out 4m → shortage.
  const evDev = [ev(U, "2026-06-08", "site_in", "09:50"), ev(U, "2026-06-08", "site_out", "17:56")];
  const planDev = [{ id: "2026-06-08", userId: U, date: "2026-06-08", startTime: "10:00", endTime: "18:00", declaredOtMins: 0 }];
  const r = computeRangeLedger(U, evDev, planDev, [], [], noHol);
  assert.equal(r.pendingOtMins, 0);
  assert.equal(r.shortageMins, 4);
  assert.equal(r.netMins, -4);
});

test("ops with no plan falls back to default 10:00–18:00", () => {
  const evNoPlan = [ev(U, "2026-06-09", "site_in", "10:00"), ev(U, "2026-06-09", "site_out", "19:00")];
  const r = computeRangeLedger(U, evNoPlan, [], [], [], noHol);
  assert.equal(r.pendingOtMins, 60);
  assert.equal(r.shortageMins, 0);
});

test("inverted window (end<=start) treated as no plan → default", () => {
  const evInv = [ev(U, "2026-06-10", "site_in", "09:50"), ev(U, "2026-06-10", "site_out", "17:56")];
  const planInv = [{ id: "2026-06-10", userId: U, date: "2026-06-10", startTime: "10:00", endTime: "06:00", declaredOtMins: 0 }];
  const r = computeRangeLedger(U, evInv, planInv, [], [], noHol);
  assert.equal(r.pendingOtMins, 0);
  assert.equal(r.shortageMins, 4);
});

test("settlementCash (rate 800) — pure function, unchanged formula", () => {
  assert.equal(settlementCash(800, 1, 0), 800);    // 1 WO day, no other activity: pays unconditionally
  assert.equal(settlementCash(800, 1, 480), 1600);  // 1 WO day + 480 min of separately-tracked OT elsewhere
  assert.equal(settlementCash(800, 0, 480), 800);
  assert.equal(settlementCash(800, 0, -240), -400);
});

const { dailyOtWoCash } = require("./otAggregate");

test("dailyOtWoCash: per-date values sum to the monthly settlementCash exactly", () => {
  const rate = 1000; // ₹/day → ₹/min = 1000/480
  // Day 1 (Mon): shift 10–18, worked 10–19 with declared 60 → 60 auto OT.
  // Day 2 (Tue): worked 10–17 → 60 shortage (left early).
  // Day 3 (Sun): rest day, worked 10–14 → 240 min pending OT, admin approves 100 of it.
  // Day 4 (Wed): WO status, unworked → nets to 0.
  const planned = [
    { userId: U, date: "2026-06-01", startTime: "10:00", endTime: "18:00", declaredOtMins: 60 },
    { userId: U, date: "2026-06-02", startTime: "10:00", endTime: "18:00", declaredOtMins: 0 },
  ];
  const events = [
    ev(U, "2026-06-01", "site_in", "10:00"), ev(U, "2026-06-01", "site_out", "19:00"),
    ev(U, "2026-06-02", "site_in", "10:00"), ev(U, "2026-06-02", "site_out", "17:00"),
    ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "14:00"),
  ];
  const statuses = [{ userId: U, date: "2026-06-04", status: "WO" }];
  const approvals = [{ userId: U, date: "2026-06-07", approvedMins: 100, status: "approved" }];

  const cash = dailyOtWoCash(U, rate, events, planned, approvals, statuses, noHol);
  const sum = [...cash.values()].reduce((s, v) => s + v, 0);

  const led = computeRangeLedger(U, events, planned, approvals, statuses, noHol);
  const monthly = settlementCash(rate, led.woDates.length, led.netMins);

  assert.equal(Math.round(sum * 100) / 100, monthly);
});

test("dailyOtWoCash: a shortage-only day is negative", () => {
  const planned = [{ userId: U, date: "2026-06-02", startTime: "10:00", endTime: "18:00", declaredOtMins: 0 }];
  const events = [ev(U, "2026-06-02", "site_in", "10:00"), ev(U, "2026-06-02", "site_out", "17:00")];
  const cash = dailyOtWoCash(U, 480, events, planned, [], [], noHol); // rate 480 → ₹1/min
  assert.equal(cash.get("2026-06-02"), -60); // 60 min shortage × ₹1/min
});

test("[BUG FIX] dailyOtWoCash invariant still holds with an under-covering decision doc present (pending derivation is unaffected)", () => {
  // Same mix as above, but the Sunday's decision doc under-covers its pending window
  // (requestedMins 100 of 240) — exactly the shape this task's fix changes the PENDING
  // reporting for. dailyOtWoCash has no pending concept at all (confirmed: it only sums
  // autoOtMins/shortageMins/approvedMins/woDebit into netMins), so its cash — and the
  // sum(dailyOtWoCash) === settlementCash(...) invariant — must be byte-for-byte identical
  // to before the fix.
  const rate = 1000;
  const planned = [
    { userId: U, date: "2026-06-01", startTime: "10:00", endTime: "18:00", declaredOtMins: 60 },
    { userId: U, date: "2026-06-02", startTime: "10:00", endTime: "18:00", declaredOtMins: 0 },
  ];
  const events = [
    ev(U, "2026-06-01", "site_in", "10:00"), ev(U, "2026-06-01", "site_out", "19:00"),
    ev(U, "2026-06-02", "site_in", "10:00"), ev(U, "2026-06-02", "site_out", "17:00"),
    ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "14:00"),
  ];
  const statuses = [{ userId: U, date: "2026-06-04", status: "WO" }];
  // requestedMins (100) under-covers the Sunday's 240-min pendingExtraMins — the bug scenario.
  const approvals = [{ userId: U, date: "2026-06-07", requestedMins: 100, approvedMins: 100, status: "approved" }];

  const cash = dailyOtWoCash(U, rate, events, planned, approvals, statuses, noHol);
  const sum = [...cash.values()].reduce((s, v) => s + v, 0);

  const led = computeRangeLedger(U, events, planned, approvals, statuses, noHol);
  // The date is still pending (remaining = 240 - 100 = 140) but netMins/settlementCash must
  // be untouched by that — grantedOtMins is still Σ approvedMins (100) regardless.
  assert.equal(led.pendingDates.length, 1);
  assert.equal(led.pendingOtMins, 140);
  const monthly = settlementCash(rate, led.woDates.length, led.netMins);

  assert.equal(Math.round(sum * 100) / 100, monthly);
});

test("dailyOtWoCash: rest-day date is 0 when unapproved, equals approved minutes' cash when approved", () => {
  // 2026-06-07 is a Sunday. Worked 10:00–14:00 → 240 min pending; nothing auto-credited.
  const events = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "14:00")];
  const rate = 480; // ₹1/min

  const unapproved = dailyOtWoCash(U, rate, events, [], [], [], noHol);
  assert.equal(unapproved.get("2026-06-07"), 0);

  const approvals = [{ userId: U, date: "2026-06-07", approvedMins: 90, status: "approved" }];
  const approved = dailyOtWoCash(U, rate, events, [], approvals, [], noHol);
  assert.equal(approved.get("2026-06-07"), 90); // 90 approved mins × ₹1/min
});
