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

const {
  CHECKLIST_FIRST_ROW, buildChecklistRows, MONTH_ORDER_RANGE,
  MONTHLY_GRID_HEADER_ROW, MONTHLY_GRID_FIRST_DATA_ROW,
  buildMonthlyHeaderRow, buildMonthlyGridRows,
} = require("./forecastDashboard");

test("CHECKLIST_FIRST_ROW is row 2 (row 1 is the header)", () => {
  assert.equal(CHECKLIST_FIRST_ROW, 2);
});

test("buildChecklistRows defaults every category to checked", () => {
  const rows = buildChecklistRows(["Manpower Expense", "Electricity"]);
  assert.deepEqual(rows, [[true, "Manpower Expense"], [true, "Electricity"]]);
});

test("buildMonthlyHeaderRow alternates Actual/Forecast per category", () => {
  const row = buildMonthlyHeaderRow(["Manpower Expense", "Electricity"]);
  assert.deepEqual(row, [
    "Month", "Manpower Expense - Actual", "Manpower Expense - Forecast",
    "Electricity - Actual", "Electricity - Forecast",
  ]);
});

test("buildMonthlyGridRows: month/checkbox range-gated SUMIFS lookup against Dashboard", () => {
  const rows = buildMonthlyGridRows(["April 2026", "May 2026"], ["Manpower Expense", "Electricity"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "April 2026");
  // category 0 (Manpower Expense) checkbox lives at B2 (CHECKLIST_FIRST_ROW + 0)
  assert.equal(rows[0][1],
    '=IF(AND(MATCH($A28,' + MONTH_ORDER_RANGE + ',0)>=MATCH($E$1,' + MONTH_ORDER_RANGE + ',0),' +
    'MATCH($A28,' + MONTH_ORDER_RANGE + ',0)<=MATCH($E$2,' + MONTH_ORDER_RANGE + ',0),$B$2=TRUE),' +
    'SUMIFS(Dashboard!$C:$C,Dashboard!$A:$A,$A28,Dashboard!$B:$B,"Manpower Expense"),"")');
  assert.equal(rows[0][2],
    '=IF(AND(MATCH($A28,' + MONTH_ORDER_RANGE + ',0)>=MATCH($E$1,' + MONTH_ORDER_RANGE + ',0),' +
    'MATCH($A28,' + MONTH_ORDER_RANGE + ',0)<=MATCH($E$2,' + MONTH_ORDER_RANGE + ',0),$B$2=TRUE),' +
    'SUMIFS(Dashboard!$D:$D,Dashboard!$A:$A,$A28,Dashboard!$B:$B,"Manpower Expense"),"")');
  // category 1 (Electricity) checkbox lives at B3, row 2 of the grid is sheet row 29
  assert.match(rows[1][3], /\$B\$3=TRUE/);
  assert.match(rows[1][3], /\$A29/);
});

const {
  DAILY_GRID_HEADER_ROW, DAILY_GRID_FIRST_DATA_ROW,
  fiscalYearDates, buildDailyHeaderRow, buildDailyGridRows,
} = require("./forecastDashboard");

test("fiscalYearDates spans April 1 of the FY start year through March 31 of the next year", () => {
  const dates = fiscalYearDates("2026-08-01"); // FY2026-27, containing today per the design
  assert.equal(dates[0], "2026-04-01");
  assert.equal(dates[dates.length - 1], "2027-03-31");
  assert.equal(dates.length, 365); // 2027 is not a leap year
});

test("fiscalYearDates: an anchor date in Jan-Mar belongs to the FY that started the previous April", () => {
  const dates = fiscalYearDates("2027-02-15");
  assert.equal(dates[0], "2026-04-01");
  assert.equal(dates[dates.length - 1], "2027-03-31");
});

test("buildDailyHeaderRow: one Cumulative column per category", () => {
  const row = buildDailyHeaderRow(["Manpower Expense", "Electricity"]);
  assert.deepEqual(row, ["Date", "Manpower Expense - Cumulative", "Electricity - Cumulative"]);
});

test("buildDailyGridRows: date/range/checkbox-gated cumulative SUMIFS against Daily Snapshot", () => {
  const rows = buildDailyGridRows(["2026-04-01", "2026-04-02"], ["Manpower Expense", "Electricity"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "2026-04-01");
  assert.equal(rows[0][1],
    '=IF(AND($A43>=$H$1,$A43<=$H$2,$B$2=TRUE),' +
    "SUMIFS('Daily Snapshot'!$G:$G,'Daily Snapshot'!$B:$B,\"Manpower Expense\",'Daily Snapshot'!$A:$A,\"<=\"&$A43),\"\")");
  // category 1 checkbox is $B$3, second row is sheet row 44
  assert.match(rows[1][2], /\$B\$3=TRUE/);
  assert.match(rows[1][2], /\$A44/);
});
