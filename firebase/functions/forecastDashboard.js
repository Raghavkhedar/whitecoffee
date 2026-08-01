"use strict";

const forecast = require("./forecastSpend");

const DASHBOARD_HEADER = ["Month", "Category", "Actual (Month)", "Forecast", "Variance", "Variance %"];
const DASHBOARD_CATEGORIES = ["Manpower Expense", ...forecast.STANDALONE_CATEGORIES];

// 0-based column index -> Sheets column letters ("A", "Z", "AA", ...).
function colLetter(n) {
  let i = n + 1;
  let s = "";
  while (i > 0) {
    const rem = (i - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function actualFormula(r) {
  return `=SUMIFS('Daily Snapshot'!G:G,'Daily Snapshot'!B:B,B${r},'Daily Snapshot'!F:F,A${r})`;
}
function forecastFormula(r) {
  return `=SUMIFS('Forecast FY26-27'!C:C,'Forecast FY26-27'!D:D,"SUBTOTAL",'Forecast FY26-27'!B:B,A${r},'Forecast FY26-27'!A:A,B${r}&" —Total")`;
}
function varianceFormula(r) { return `=C${r}-D${r}`; }
function variancePctFormula(r) { return `=IF(D${r}=0,"",E${r}/D${r})`; }

function buildDashboardRows(months, categories) {
  const rows = [];
  let r = 2; // row 1 is the header
  months.forEach((month) => {
    categories.forEach((category) => {
      rows.push([month, category, actualFormula(r), forecastFormula(r), varianceFormula(r), variancePctFormula(r)]);
      r++;
    });
  });
  return rows;
}

module.exports = {
  DASHBOARD_HEADER, DASHBOARD_CATEGORIES, colLetter,
  actualFormula, forecastFormula, varianceFormula, variancePctFormula, buildDashboardRows,
};

const CHECKLIST_FIRST_ROW = 2;
const MONTH_ORDER_RANGE = "$Z$1:$Z$12";
const MONTHLY_GRID_HEADER_ROW = 27;
const MONTHLY_GRID_FIRST_DATA_ROW = 28;

function buildChecklistRows(categories) {
  return categories.map((c) => [true, c]);
}

function buildMonthlyHeaderRow(categories) {
  const row = ["Month"];
  categories.forEach((c) => { row.push(`${c} - Actual`); row.push(`${c} - Forecast`); });
  return row;
}

function inMonthRangeClause(monthCellRef) {
  return `MATCH(${monthCellRef},${MONTH_ORDER_RANGE},0)>=MATCH($E$1,${MONTH_ORDER_RANGE},0),` +
    `MATCH(${monthCellRef},${MONTH_ORDER_RANGE},0)<=MATCH($E$2,${MONTH_ORDER_RANGE},0)`;
}

function buildMonthlyGridRows(months, categories) {
  return months.map((month, mIdx) => {
    const sheetRow = MONTHLY_GRID_FIRST_DATA_ROW + mIdx;
    const monthCellRef = `$A${sheetRow}`;
    const row = [month];
    categories.forEach((category, cIdx) => {
      const checkboxRef = `$B$${CHECKLIST_FIRST_ROW + cIdx}`;
      const gate = `AND(${inMonthRangeClause(monthCellRef)},${checkboxRef}=TRUE)`;
      row.push(`=IF(${gate},SUMIFS(Dashboard!$C:$C,Dashboard!$A:$A,${monthCellRef},Dashboard!$B:$B,"${category}"),"")`);
      row.push(`=IF(${gate},SUMIFS(Dashboard!$D:$D,Dashboard!$A:$A,${monthCellRef},Dashboard!$B:$B,"${category}"),"")`);
    });
    return row;
  });
}

module.exports.CHECKLIST_FIRST_ROW = CHECKLIST_FIRST_ROW;
module.exports.MONTH_ORDER_RANGE = MONTH_ORDER_RANGE;
module.exports.MONTHLY_GRID_HEADER_ROW = MONTHLY_GRID_HEADER_ROW;
module.exports.MONTHLY_GRID_FIRST_DATA_ROW = MONTHLY_GRID_FIRST_DATA_ROW;
module.exports.buildChecklistRows = buildChecklistRows;
module.exports.buildMonthlyHeaderRow = buildMonthlyHeaderRow;
module.exports.buildMonthlyGridRows = buildMonthlyGridRows;
