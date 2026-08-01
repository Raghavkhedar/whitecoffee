"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DASHBOARD_HEADER, DASHBOARD_CATEGORIES, colLetter, buildDashboardRows,
} = require("./forecastDashboard");
const forecast = require("./forecastSpend");

test("DASHBOARD_HEADER has the six expected columns", () => {
  assert.deepEqual(DASHBOARD_HEADER,
    ["Month", "Category", "Actual (Month)", "Forecast", "Variance", "Variance %"]);
});

test("DASHBOARD_CATEGORIES is Manpower Expense followed by forecast.STANDALONE_CATEGORIES, no drift", () => {
  assert.deepEqual(DASHBOARD_CATEGORIES, ["Manpower Expense", ...forecast.STANDALONE_CATEGORIES]);
});

test("colLetter converts 0-based column index to Sheets letters", () => {
  assert.equal(colLetter(0), "A");
  assert.equal(colLetter(25), "Z");
  assert.equal(colLetter(26), "AA");
  assert.equal(colLetter(27), "AB");
  assert.equal(colLetter(51), "AZ");
  assert.equal(colLetter(52), "BA");
});

test("buildDashboardRows produces one row per month x category, row numbers starting at 2", () => {
  const rows = buildDashboardRows(["April 2026", "May 2026"], ["Manpower Expense", "Electricity"]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].slice(0, 2), ["April 2026", "Manpower Expense"]);
  assert.deepEqual(rows[1].slice(0, 2), ["April 2026", "Electricity"]);
  assert.deepEqual(rows[2].slice(0, 2), ["May 2026", "Manpower Expense"]);
  assert.equal(rows[0][2], "=SUMIFS('Daily Snapshot'!G:G,'Daily Snapshot'!B:B,B2,'Daily Snapshot'!F:F,A2)");
  assert.equal(rows[0][3],
    "=SUMIFS('Forecast FY26-27'!C:C,'Forecast FY26-27'!D:D,\"SUBTOTAL\",'Forecast FY26-27'!B:B,A2,'Forecast FY26-27'!A:A,B2&\" —Total\")");
  assert.equal(rows[0][4], "=C2-D2");
  assert.equal(rows[0][5], "=IF(D2=0,\"\",E2/D2)");
  // Second row (row 3 in the sheet) formulas reference row 3, not row 2.
  assert.equal(rows[1][2], "=SUMIFS('Daily Snapshot'!G:G,'Daily Snapshot'!B:B,B3,'Daily Snapshot'!F:F,A3)");
});
