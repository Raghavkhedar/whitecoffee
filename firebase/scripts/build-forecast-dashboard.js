#!/usr/bin/env node
"use strict";

/**
 * One-off: (re)build the Dashboard and Charts tabs in the production Forecasting sheet.
 * Safe to re-run — both tabs are fully generated, no manager-typed data lives in them.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node build-forecast-dashboard.js
 *
 * The key must be the same service account exportForecastSpend uses (ATTENDANCE_SHEETS_KEY secret):
 *   firebase functions:secrets:access ATTENDANCE_SHEETS_KEY > /tmp/sheets-key.json
 *   GOOGLE_APPLICATION_CREDENTIALS=/tmp/sheets-key.json node build-forecast-dashboard.js
 *
 * PREREQUISITE: the 'Forecast FY26-27' tab must already exist with real SUBTOTAL rows —
 * see docs/superpowers/plans/2026-08-01-forecast-entry-tab.md. Run that first.
 */

const { google } = (() => {
  try { return require("googleapis"); }
  catch { return require(require("node:path").join(__dirname, "..", "functions", "node_modules", "googleapis")); }
})();

const forecast = require("../functions/forecastSpend");
const dash = require("../functions/forecastDashboard");

const FORECAST_SHEET_ID = "1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo";

async function ensureTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find((s) => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;
  // Default new-sheet size is 26 cols x 1000 rows — too narrow for the Charts tab's monthly
  // grid, which needs up to column AU (47 cols) for 23 categories. Size generously up front.
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: { title: tabName, gridProperties: { rowCount: 500, columnCount: 60 } },
        },
      }],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function main() {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  const todayISO = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const months = forecast.fiscalYearMonths(todayISO);
  const categories = dash.DASHBOARD_CATEGORIES;

  // ── Dashboard tab ─────────────────────────────────────────────────────
  console.log("Building Dashboard tab...");
  await ensureTab(sheets, FORECAST_SHEET_ID, "Dashboard");
  await sheets.spreadsheets.values.clear({ spreadsheetId: FORECAST_SHEET_ID, range: "Dashboard" });
  const dashboardRows = dash.buildDashboardRows(months, categories);
  await sheets.spreadsheets.values.update({
    spreadsheetId: FORECAST_SHEET_ID, range: "Dashboard!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [dash.DASHBOARD_HEADER, ...dashboardRows] },
  });
  console.log(`Dashboard: wrote ${dashboardRows.length} rows (${months.length} months x ${categories.length} categories).`);

  // ── Charts tab ────────────────────────────────────────────────────────
  console.log("Building Charts tab...");
  const chartsSheetId = await ensureTab(sheets, FORECAST_SHEET_ID, "Charts");
  await sheets.spreadsheets.values.clear({ spreadsheetId: FORECAST_SHEET_ID, range: "Charts" });

  const checklistRows = dash.buildChecklistRows(categories);
  const monthOrderCol = months.map((m) => [m]);
  const fyDates = dash.fiscalYearDates(todayISO);

  const valueUpdates = [
    { range: "Charts!A1", values: [["Include?", "Category", "", "Start Month", months[0], "", "Start Date", fyDates[0]]] },
    // Narrowed to start at D2 (not A2): columns A/B of row 2 belong to the checklist's first row
    // (CHECKLIST_FIRST_ROW = 2), written separately below. Writing blanks over A2/B2 here would
    // overlap that write in the same values.batchUpdate call, risking order-dependent clobbering.
    { range: "Charts!D2", values: [["End Month", months[months.length - 1], "", "End Date", todayISO]] },
    { range: `Charts!A${dash.CHECKLIST_FIRST_ROW}`, values: checklistRows },
    { range: "Charts!Z1", values: monthOrderCol },
    { range: `Charts!A${dash.MONTHLY_GRID_HEADER_ROW}`, values: [dash.buildMonthlyHeaderRow(categories)] },
    { range: `Charts!A${dash.MONTHLY_GRID_FIRST_DATA_ROW}`, values: dash.buildMonthlyGridRows(months, categories) },
    { range: `Charts!A${dash.DAILY_GRID_HEADER_ROW}`, values: [dash.buildDailyHeaderRow(categories)] },
    { range: `Charts!A${dash.DAILY_GRID_FIRST_DATA_ROW}`, values: dash.buildDailyGridRows(fyDates, categories) },
  ];
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: FORECAST_SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: valueUpdates.map((u) => ({ range: u.range, values: u.values })),
    },
  });

  // Delete any charts already on the Charts tab before re-adding — values.clear only clears
  // cell values, not embedded chart objects, so without this a re-run stacks duplicate charts
  // on top of the old ones at the same anchor cells.
  const chartsMeta = await sheets.spreadsheets.get({
    spreadsheetId: FORECAST_SHEET_ID,
    ranges: ["Charts"],
    fields: "sheets(properties.sheetId,charts.chartId)",
  });
  const existingChartIds = (chartsMeta.data.sheets[0]?.charts || []).map((c) => c.chartId);
  const deleteChartRequests = existingChartIds.map((chartId) => ({ deleteEmbeddedObject: { objectId: chartId } }));

  // Data validation: checkboxes for the category list, dropdowns for Start/End Month.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: FORECAST_SHEET_ID,
    requestBody: {
      requests: [
        ...deleteChartRequests,
        {
          setDataValidation: {
            range: {
              sheetId: chartsSheetId,
              startRowIndex: dash.CHECKLIST_FIRST_ROW - 1, endRowIndex: dash.CHECKLIST_FIRST_ROW - 1 + categories.length,
              startColumnIndex: 0, endColumnIndex: 1,
            },
            rule: { condition: { type: "BOOLEAN" }, strict: true },
          },
        },
        {
          setDataValidation: {
            range: { sheetId: chartsSheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 4, endColumnIndex: 5 },
            rule: {
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: `=Charts!${dash.MONTH_ORDER_RANGE}` }] },
              strict: true, showCustomUi: true,
            },
          },
        },
        {
          setDataValidation: {
            range: { sheetId: chartsSheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 8 },
            rule: { condition: { type: "DATE_IS_VALID" }, strict: true },
          },
        },
        dash.buildMonthlyChartRequest({ chartsSheetId, categoryCount: categories.length, monthCount: months.length }),
        dash.buildDailyChartRequest({ chartsSheetId, categoryCount: categories.length, dayCount: fyDates.length }),
      ],
    },
  });

  console.log("Charts: wrote checklist, month/date range controls, both helper grids, and both charts.");
  console.log("Done. Open the sheet and confirm no #REF!/#VALUE! in the Dashboard or Charts tabs.");
}

main().catch((err) => { console.error(err); process.exit(1); });
