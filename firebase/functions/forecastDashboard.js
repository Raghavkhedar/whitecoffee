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

const DAILY_GRID_HEADER_ROW = 42;
const DAILY_GRID_FIRST_DATA_ROW = 43;

// April 1 -> March 31 fiscal year containing anchorISO, inclusive, as "yyyy-mm-dd" strings.
function fiscalYearDates(anchorISO) {
  const [y, m] = String(anchorISO).split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return forecast.datesInRange(`${startYear}-04-01`, `${startYear + 1}-03-31`);
}

function buildDailyHeaderRow(categories) {
  return ["Date", ...categories.map((c) => `${c} - Cumulative`)];
}

function buildDailyGridRows(dates, categories) {
  return dates.map((date, dIdx) => {
    const sheetRow = DAILY_GRID_FIRST_DATA_ROW + dIdx;
    const dateCellRef = `$A${sheetRow}`;
    const row = [date];
    categories.forEach((category, cIdx) => {
      const checkboxRef = `$B$${CHECKLIST_FIRST_ROW + cIdx}`;
      const gate = `AND(${dateCellRef}>=$H$1,${dateCellRef}<=$H$2,${checkboxRef}=TRUE)`;
      row.push(`=IF(${gate},SUMIFS('Daily Snapshot'!$G:$G,'Daily Snapshot'!$B:$B,"${category}",'Daily Snapshot'!$A:$A,"<="&${dateCellRef}),"")`);
    });
    return row;
  });
}

module.exports.DAILY_GRID_HEADER_ROW = DAILY_GRID_HEADER_ROW;
module.exports.DAILY_GRID_FIRST_DATA_ROW = DAILY_GRID_FIRST_DATA_ROW;
module.exports.fiscalYearDates = fiscalYearDates;
module.exports.buildDailyHeaderRow = buildDailyHeaderRow;
module.exports.buildDailyGridRows = buildDailyGridRows;
