"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dayWeight, dailySalary } = require("./dailySpend");

test("dayWeight: each status maps to its payroll multiplier", () => {
  assert.equal(dayWeight("Present"), 1);
  assert.equal(dayWeight("SL"), 0.75);
  assert.equal(dayWeight("HalfDay"), 0.5);
  assert.equal(dayWeight("LNF"), 0.5);
  assert.equal(dayWeight("SLNF"), 0.5);
  assert.equal(dayWeight("PL"), 1);
  assert.equal(dayWeight("LWP"), 0);
  assert.equal(dayWeight("Absent"), -2);
  assert.equal(dayWeight("Unknown"), 0); // unmapped → 0
});

test("dailySalary: rate × weight, negative on an Absent day", () => {
  assert.equal(dailySalary(1000, "Present"), 1000);
  assert.equal(dailySalary(1000, "SL"), 750);
  assert.equal(dailySalary(1000, "Absent"), -2000);
  assert.equal(dailySalary(0, "Present"), 0);
});

const { dailyDeductions, dailyTotal } = require("./dailySpend");

test("dailyDeductions: flat % of the day's salary, no floor", () => {
  const d = dailyDeductions({ salary: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 });
  assert.equal(d.pf, 120);
  assert.equal(d.esi, 7.5);
  assert.equal(d.imprest, 50);
});

test("dailyDeductions: negative salary yields negative components (exact reconciliation)", () => {
  const d = dailyDeductions({ salary: -2000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 });
  assert.equal(d.pf, -240);
  assert.equal(d.esi, -15);
  assert.equal(d.imprest, -100);
});

test("dailyDeductions: missing percents → 0; missing efficiency → 1; explicit 0 honoured", () => {
  assert.deepEqual(dailyDeductions({ salary: 1000 }), { pf: 0, esi: 0, imprest: 0 });
  assert.equal(dailyDeductions({ salary: 1000, imprestPercent: 5 }).imprest, 50); // eff defaults 1
  assert.equal(dailyDeductions({ salary: 1000, imprestPercent: 5, efficiency: 0 }).imprest, 0);
});

test("dailyTotal: mirrors TOTAL DUE (salary + covy + imprest + otWo − pf − esi)", () => {
  assert.equal(dailyTotal({ salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5 }), 1342.5);
});

const { addMonths, openWindowMonths } = require("./dailySpend");

test("addMonths: rolls year boundaries both directions", () => {
  assert.equal(addMonths("2026-07", -1), "2026-06");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("openWindowMonths: steady state = current month only", () => {
  const locked = new Set(["2026-06", "2026-05"]);
  assert.deepEqual(openWindowMonths("2026-07", locked), ["2026-07"]);
});

test("openWindowMonths: a lagging unlocked prior month is included", () => {
  const locked = new Set(["2026-05"]); // June not yet settled
  assert.deepEqual(openWindowMonths("2026-07", locked), ["2026-06", "2026-07"]);
});

test("openWindowMonths: stops at cap even if priors stay unlocked", () => {
  const locked = new Set(); // nothing locked
  assert.deepEqual(openWindowMonths("2026-07", locked, 2), ["2026-05", "2026-06", "2026-07"]);
});
