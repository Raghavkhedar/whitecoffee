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

test("dailyTotal: includes sa", () => {
  assert.equal(
    dailyTotal({ salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5, sa: 2000 }),
    3342.5,
  );
});

test("dailyTotal: missing sa is treated as 0", () => {
  assert.equal(
    dailyTotal({ salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5 }),
    dailyTotal({ salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5, sa: 0 }),
  );
});

test("dailyDeductions: output is unaffected by sa — sa is not a parameter and not in the base", () => {
  const withoutSa = dailyDeductions({ salary: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 });
  const withSa = dailyDeductions({ salary: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5, sa: 50000 });
  assert.deepEqual(withSa, withoutSa);
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

// ── SA reconciliation (Pass 1 freeze-finalization + the nightly backstop) ────────────
const { saIsReflected, saRowPatch } = require("./dailySpend");

test("saIsReflected: true only when the row carries that exact amount", () => {
  assert.equal(saIsReflected({ sa: 12000 }, 12000), true);
  assert.equal(saIsReflected({ sa: 12000 }, 9000), false);
  assert.equal(saIsReflected({ sa: 0 }, 12000), false);
  assert.equal(saIsReflected({}, 12000), false);      // legacy row with no sa field
  assert.equal(saIsReflected({ sa: 0 }, 0), true);
});

test("saIsReflected: a missing row never reflects an SA (the backstop's alarm case)", () => {
  assert.equal(saIsReflected(null, 12000), false);
  assert.equal(saIsReflected(undefined, 12000), false);
});

test("saRowPatch: null when the row already carries the SA — no write, no re-freeze churn", () => {
  assert.equal(saRowPatch({ salary: 1000, sa: 12000, totalSpend: 13000 }, 12000), null);
});

test("saRowPatch: sets sa and re-derives totalSpend from the row's OWN components", () => {
  const row = { salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5, sa: 0, totalSpend: 1342.5 };
  assert.deepEqual(saRowPatch(row, 12000), { sa: 12000, totalSpend: 13342.5 });
});

test("saRowPatch: patches ONLY sa/totalSpend — a locked month's other components are untouched", () => {
  const row = { salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5, sa: 0 };
  assert.deepEqual(Object.keys(saRowPatch(row, 500)).sort(), ["sa", "totalSpend"]);
});

test("saRowPatch: replacing an existing SA re-derives the total, never stacks", () => {
  const row = { salary: 1000, conveyance: 0, imprest: 0, otWo: 0, pf: 0, esi: 0, sa: 5000, totalSpend: 6000 };
  assert.deepEqual(saRowPatch(row, 12000), { sa: 12000, totalSpend: 13000 });
});

test("saRowPatch: no row → an SA-only row (every other component 0, total == sa)", () => {
  assert.deepEqual(saRowPatch(null, 12000), { sa: 12000, totalSpend: 12000 });
});

// ₹0 is a REAL amount (the Users page accepts it), so "corrected to ₹0" must never be
// conflated with "nothing entered" — that conflation freezes a stale nonzero sa forever.
test("saRowPatch: a correction to ₹0 patches an existing nonzero row (not skipped as falsy)", () => {
  const row = { salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5, sa: 5000, totalSpend: 6342.5 };
  assert.deepEqual(saRowPatch(row, 0), { sa: 0, totalSpend: 1342.5 });
});

test("saRowPatch: ₹0 against a row already at 0 is a no-op", () => {
  assert.equal(saRowPatch({ salary: 1000, sa: 0, totalSpend: 1000 }, 0), null);
});

test("saRowPatch: ₹0 with no row → null (an SA of ₹0 must not conjure an all-zero row)", () => {
  assert.equal(saRowPatch(null, 0), null);
});
