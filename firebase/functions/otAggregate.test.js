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

test("beyond-declared +30 approved via ot_approvals → net 60", () => {
  const appr = [{ id: "2026-06-01", userId: U, date: "2026-06-01", approvedMins: 30, status: "approved" }];
  const r = computeRangeLedger(U, evNormal, planNormal, appr, [], noHol);
  assert.equal(r.grantedOtMins, 30);
  assert.equal(r.pendingDates.length, 0);
  assert.equal(r.netMins, 60);
});

test("authorized Sunday rest-day work (2026-06-07) 300 min → net 300", () => {
  const planSun = [{ id: "2026-06-07", userId: U, date: "2026-06-07", startTime: "", endTime: "", otAuthorized: true }];
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const r = computeRangeLedger(U, evSun, planSun, [], [], noHol);
  assert.equal(r.restDayOtMins, 300);
  assert.equal(r.netMins, 300);
  assert.equal(r.unauthorizedRestDates.length, 0);
});

test("unauthorized Sunday work → net 0, flagged", () => {
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const r = computeRangeLedger(U, evSun, [], [], [], noHol);
  assert.equal(r.restDayOtMins, 0);
  assert.equal(r.unauthorizedRestDates.length, 1);
  assert.equal(r.netMins, 0);
});

test("WO status counted: woDates 1, woDebit 480, net -480", () => {
  const woStatus = [{ id: "2026-06-02", userId: U, date: "2026-06-02", status: "WO" }];
  const r = computeRangeLedger(U, [], [], [], woStatus, noHol);
  assert.equal(r.woDates.length, 1);
  assert.equal(r.woDebitMins, 480);
  assert.equal(r.netMins, -480);
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
  const manualAppr = [{ id: "2026-06-04", userId: U, date: "2026-06-04", approvedMins: 120, status: "approved", manual: true }];
  const r = computeRangeLedger(U, [], [], manualAppr, [], noHol);
  assert.equal(r.grantedOtMins, 120);
  assert.equal(r.netMins, 120);
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

test("settlementCash (rate 800)", () => {
  assert.equal(settlementCash(800, 1, -480), 0);   // unworked WO
  assert.equal(settlementCash(800, 1, 0), 800);    // WO worked off
  assert.equal(settlementCash(800, 1, -180), 500); // WO + 300 rest-day
  assert.equal(settlementCash(800, 0, 480), 800);  // pure OT
  assert.equal(settlementCash(800, 0, -240), -400); // pure shortage
});
