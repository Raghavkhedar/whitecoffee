# Forecast Dashboard + Charts Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Dashboard` tab (live Actual/Forecast/Variance table, all months at once) and a `Charts`
tab (monthly Actual-vs-Forecast trend + daily cumulative spend trend, with a multi-category checkbox
filter and independent date-range pickers per chart) to the production Forecasting sheet, built as a
one-off Node script.

**Architecture:** Pure formula-string / row-building logic lives in `firebase/functions/forecastDashboard.js`
(no I/O, unit-tested with `node --test`, mirrors how `forecastSpend.js` separates logic from I/O).
`firebase/scripts/build-forecast-dashboard.js` does the Sheets API I/O only: auth, `ensureTab`, clear,
write values/formulas, write data validation, write chart requests — calling into the pure module for
every string/row it writes.

**Tech Stack:** `googleapis` Sheets v4 (already a `firebase/functions` dependency), CommonJS, `node --test`.

## Global Constraints

- **Hard prerequisite:** `docs/superpowers/plans/2026-08-01-forecast-entry-tab.md` must be executed and
  deployed FIRST. This plan reads `'Forecast FY26-27'!A:D` (Category/Line Item, Month, Amount, Type
  columns) and depends on `forecast.STANDALONE_CATEGORIES` already containing the renamed 22 values +
  `Rental of Space` (23 total with Manpower Expense) that that plan's Task 1 produces. Do not start this
  plan's Task 5 (the write script) against production until that tab exists with real SUBTOTAL rows.
- CommonJS (`require`), Node 24 runtime. No new npm dependencies (`googleapis` already present in
  `firebase/functions/package.json`).
- Validate with `node --check` + `npm test` from `firebase/functions/`. Do NOT run eslint — the config is
  stale and parse-errors on modern JS like `?.`.
- Forecasting sheet id: `1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo`.
- Category list is `["Manpower Expense", ...forecast.STANDALONE_CATEGORIES]` from
  `firebase/functions/forecastSpend.js` — never duplicate this list; always import it, so a future
  category rename can't drift between tabs.
- `Daily Snapshot` columns (existing, unchanged): `A Snapshot Date, B Category, C Employee ID,
  D Employee Name, E Component, F Month, G Day Spend, H Month Total, I Running Total`.
- `Forecast FY26-27` columns (from the entry-tab plan): `A Category / Line Item, B Month, C Amount,
  D Type, E–K component inputs, L Emp ID`. A category's month subtotal is the row where
  `D = "SUBTOTAL"` and `A = "{Category} —Total"` (em dash, exact string, per that plan's block
  structure — NOT the bare category name).
- Dashboard/Charts tabs are fully generated, no manager-typed data — safe to clear and rewrite on every
  script run (no write-guard, unlike `Forecast FY26-27`).

## File Structure

- Create `firebase/functions/forecastDashboard.js` — pure row/formula/chart-request builders.
- Create `firebase/functions/forecastDashboard.test.js` — `node --test` suite for the above.
- Create `firebase/scripts/build-forecast-dashboard.js` — one-off I/O script (auth, write, verify tabs
  exist).

---

### Task 1: Dashboard tab — row and formula builders

**Files:**
- Create: `firebase/functions/forecastDashboard.js`
- Test: `firebase/functions/forecastDashboard.test.js`

**Interfaces:**
- Produces: `DASHBOARD_HEADER` (array of 6 strings), `DASHBOARD_CATEGORIES` (array, 23 strings once the
  entry-tab plan lands), `colLetter(n)` (0-based column index → Sheets column letter, e.g. `0→"A"`,
  `25→"Z"`, `26→"AA"`), `buildDashboardRows(months, categories)` → array of `[month, category,
  actualFormula, forecastFormula, varianceFormula, variancePctFormula]` rows, one per
  `month × category` pair, in `months` outer / `categories` inner order, row numbers starting at 2
  (row 1 is the header).

- [ ] **Step 1: Write the failing tests**

```js
// firebase/functions/forecastDashboard.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: FAIL — `Cannot find module './forecastDashboard'`.

- [ ] **Step 3: Implement**

```js
// firebase/functions/forecastDashboard.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastDashboard.js firebase/functions/forecastDashboard.test.js
git commit -m "feat(forecast): Dashboard tab row/formula builders"
```

---

### Task 2: Charts tab — category checklist + monthly Actual-vs-Forecast grid builders

**Files:**
- Modify: `firebase/functions/forecastDashboard.js`
- Test: `firebase/functions/forecastDashboard.test.js`

**Layout this task locks in** (documented here because later tasks and the write script depend on the
exact addresses):
- `Charts` tab row 1: `A1="Include?"`, `B1="Category"`, `D1="Start Month"`, `E1=<dropdown>`,
  `G1="Start Date"`, `H1=<date>`.
- Row 2: `D2="End Month"`, `E2=<dropdown>`, `G2="End Date"`, `H2=<date>`.
- Rows 2–24: category checklist, one row per `DASHBOARD_CATEGORIES[i]` at row `2 + i` — `A` checkbox
  (default `TRUE`), `B` category name.
- `Z1:Z12`: the 12 fiscal-year month labels, literal values, in order — the lookup range `E1`/`E2`
  validate against and the monthly grid range-checks against.
- Monthly grid header row 27: `A27="Month"`, then for each category `i` (0-based): column `1+2*i`
  (0-based, i.e. `B,D,F,...`) = `"{category} - Actual"`, column `2+2*i` (`C,E,G,...`) =
  `"{category} - Forecast"`.
- Monthly grid data rows 28–39 (12 fiscal months, one per row, in `Z1:Z12` order).

**Interfaces:**
- Consumes: `DASHBOARD_CATEGORIES`, `colLetter` from Task 1.
- Produces: `CHECKLIST_FIRST_ROW = 2`, `buildChecklistRows(categories)` → array of `[true, category]`,
  `MONTH_ORDER_RANGE = "$Z$1:$Z$12"`, `MONTHLY_GRID_HEADER_ROW = 27`, `MONTHLY_GRID_FIRST_DATA_ROW = 28`,
  `buildMonthlyHeaderRow(categories)` → `["Month", "{cat0} - Actual", "{cat0} - Forecast", ...]`,
  `buildMonthlyGridRows(months, categories)` → array of rows, `row[0]` = month string, `row[1..]` =
  formula strings alternating Actual/Forecast per category.

- [ ] **Step 1: Write the failing tests**

```js
// append to firebase/functions/forecastDashboard.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Implement**

```js
// append to firebase/functions/forecastDashboard.js

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: PASS, all 8 tests so far.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastDashboard.js firebase/functions/forecastDashboard.test.js
git commit -m "feat(forecast): Charts tab checklist + monthly grid builders"
```

---

### Task 3: Charts tab — daily cumulative grid builder

**Files:**
- Modify: `firebase/functions/forecastDashboard.js`
- Test: `firebase/functions/forecastDashboard.test.js`

**Layout locked in by this task:**
- Daily grid header row 42: `A42="Date"`, then one column per category (0-based index `i`, column
  `1+i`, i.e. `B,C,D,...`) = `"{category} - Cumulative"`.
- Daily grid data rows 43 onward, one row per calendar day of the fiscal year (365 or 366 rows,
  literal ISO dates in column A, `USER_ENTERED` so Sheets parses them as real dates).
- Cumulative = running total from the start of the fiscal year through that date (same semantics as
  `Daily Snapshot`'s own `Running Total` column), gated by the Chart 2 date-range pickers (`H1`/`H2`
  from Task 2's layout) and the shared category checklist — NOT reset at the picked Start Date; the
  date range only crops which portion of the curve is visible, consistent with how `Running Total`
  already behaves in `Daily Snapshot`.

**Interfaces:**
- Consumes: `colLetter` (Task 1), `CHECKLIST_FIRST_ROW` (Task 2).
- Produces: `DAILY_GRID_HEADER_ROW = 42`, `DAILY_GRID_FIRST_DATA_ROW = 43`,
  `fiscalYearDates(anchorISO)` → array of `"yyyy-mm-dd"` strings for the fiscal year containing
  `anchorISO` (April 1 → March 31), `buildDailyHeaderRow(categories)`, `buildDailyGridRows(dates,
  categories)`.

- [ ] **Step 1: Write the failing tests**

```js
// append to firebase/functions/forecastDashboard.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: FAIL — new exports don't exist yet.

- [ ] **Step 3: Implement**

```js
// append to firebase/functions/forecastDashboard.js

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: PASS, all 12 tests so far.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastDashboard.js firebase/functions/forecastDashboard.test.js
git commit -m "feat(forecast): Charts tab daily cumulative grid builder"
```

---

### Task 4: Native chart request builders

**Files:**
- Modify: `firebase/functions/forecastDashboard.js`
- Test: `firebase/functions/forecastDashboard.test.js`

**Interfaces:**
- Consumes: `MONTHLY_GRID_HEADER_ROW`, `MONTHLY_GRID_FIRST_DATA_ROW`, `DAILY_GRID_HEADER_ROW`,
  `DAILY_GRID_FIRST_DATA_ROW` (Tasks 2–3), category count.
- Produces: `buildMonthlyChartRequest({ chartsSheetId, categoryCount, monthCount })` → a single Sheets
  API `Request` object (`{ addChart: { chart: {...} } }`) for a `LINE` `basicChart` whose domain is the
  monthly grid's `Month` column and whose series are every Actual/Forecast column.
  `buildDailyChartRequest({ chartsSheetId, categoryCount, dayCount })` → same shape for the daily grid.

- [ ] **Step 1: Write the failing tests**

```js
// append to firebase/functions/forecastDashboard.test.js
const { buildMonthlyChartRequest, buildDailyChartRequest } = require("./forecastDashboard");

test("buildMonthlyChartRequest: LINE chart, domain = Month column, one series per Actual/Forecast column", () => {
  const req = buildMonthlyChartRequest({ chartsSheetId: 123, categoryCount: 2, monthCount: 12 });
  const chart = req.addChart.chart.spec.basicChart;
  assert.equal(chart.chartType, "LINE");
  assert.equal(chart.domains[0].domain.sourceRange.sources[0].sheetId, 123);
  assert.equal(chart.domains[0].domain.sourceRange.sources[0].startColumnIndex, 0); // column A
  // GridRange row/column indexes are 0-based: sheet row 27 (MONTHLY_GRID_HEADER_ROW, 1-based) = 26.
  assert.equal(chart.domains[0].domain.sourceRange.sources[0].startRowIndex, 26);
  assert.equal(chart.domains[0].domain.sourceRange.sources[0].endRowIndex, 26 + 12); // header + 12 months
  assert.equal(chart.series.length, 4); // 2 categories x (Actual, Forecast)
  assert.equal(chart.series[0].series.sourceRange.sources[0].startColumnIndex, 1); // column B
});

test("buildDailyChartRequest: LINE chart, domain = Date column, one series per category", () => {
  const req = buildDailyChartRequest({ chartsSheetId: 123, categoryCount: 3, dayCount: 365 });
  const chart = req.addChart.chart.spec.basicChart;
  assert.equal(chart.chartType, "LINE");
  // GridRange row/column indexes are 0-based: sheet row 42 (DAILY_GRID_HEADER_ROW, 1-based) = 41.
  assert.equal(chart.domains[0].domain.sourceRange.sources[0].startRowIndex, 41);
  assert.equal(chart.domains[0].domain.sourceRange.sources[0].endRowIndex, 41 + 365);
  assert.equal(chart.series.length, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: FAIL — `buildMonthlyChartRequest`/`buildDailyChartRequest` are not exported yet. Sheets
`GridRange` row/column indexes are 0-based, so 1-based `MONTHLY_GRID_HEADER_ROW = 27` becomes
`startRowIndex: 26`, and `DAILY_GRID_HEADER_ROW = 42` becomes `startRowIndex: 41` — the implementation
in Step 3 computes these with `MONTHLY_GRID_HEADER_ROW - 1` / `DAILY_GRID_HEADER_ROW - 1`.

- [ ] **Step 3: Implement**

```js
// append to firebase/functions/forecastDashboard.js

function buildMonthlyChartRequest({ chartsSheetId, categoryCount, monthCount }) {
  const headerRow0 = MONTHLY_GRID_HEADER_ROW - 1;       // 0-based
  const firstDataRow0 = MONTHLY_GRID_FIRST_DATA_ROW - 1; // 0-based
  const lastDataRowExcl0 = firstDataRow0 + monthCount;
  const seriesCount = categoryCount * 2;
  const series = [];
  for (let i = 0; i < seriesCount; i++) {
    const col = 1 + i; // column B onward
    series.push({
      series: {
        sourceRange: {
          sources: [{
            sheetId: chartsSheetId,
            startRowIndex: headerRow0, endRowIndex: lastDataRowExcl0,
            startColumnIndex: col, endColumnIndex: col + 1,
          }],
        },
      },
      targetAxis: "LEFT_AXIS",
    });
  }
  return {
    addChart: {
      chart: {
        spec: {
          title: "Monthly Actual vs Forecast",
          basicChart: {
            chartType: "LINE",
            legendPosition: "BOTTOM_LEGEND",
            headerCount: 1,
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId: chartsSheetId,
                    startRowIndex: headerRow0, endRowIndex: lastDataRowExcl0,
                    startColumnIndex: 0, endColumnIndex: 1,
                  }],
                },
              },
            }],
            series,
          },
        },
        position: { overlayPosition: { anchorCell: { sheetId: chartsSheetId, rowIndex: 4, columnIndex: 9 } } },
      },
    },
  };
}

function buildDailyChartRequest({ chartsSheetId, categoryCount, dayCount }) {
  const headerRow0 = DAILY_GRID_HEADER_ROW - 1;
  const firstDataRow0 = DAILY_GRID_FIRST_DATA_ROW - 1;
  const lastDataRowExcl0 = firstDataRow0 + dayCount;
  const series = [];
  for (let i = 0; i < categoryCount; i++) {
    const col = 1 + i;
    series.push({
      series: {
        sourceRange: {
          sources: [{
            sheetId: chartsSheetId,
            startRowIndex: headerRow0, endRowIndex: lastDataRowExcl0,
            startColumnIndex: col, endColumnIndex: col + 1,
          }],
        },
      },
      targetAxis: "LEFT_AXIS",
    });
  }
  return {
    addChart: {
      chart: {
        spec: {
          title: "Daily Cumulative Spend",
          basicChart: {
            chartType: "LINE",
            legendPosition: "BOTTOM_LEGEND",
            headerCount: 1,
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId: chartsSheetId,
                    startRowIndex: headerRow0, endRowIndex: lastDataRowExcl0,
                    startColumnIndex: 0, endColumnIndex: 1,
                  }],
                },
              },
            }],
            series,
          },
        },
        position: { overlayPosition: { anchorCell: { sheetId: chartsSheetId, rowIndex: 19, columnIndex: 9 } } },
      },
    },
  };
}

module.exports.buildMonthlyChartRequest = buildMonthlyChartRequest;
module.exports.buildDailyChartRequest = buildDailyChartRequest;
```

Fix the two test assertions flagged in Step 2 to `startRowIndex: 26` (monthly) — derive and fill in the
daily chart's equivalent the same way — before running.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && node --test forecastDashboard.test.js`
Expected: PASS, all 14 tests.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastDashboard.js firebase/functions/forecastDashboard.test.js
git commit -m "feat(forecast): native chart request builders for Charts tab"
```

---

### Task 5: One-off write script

**Files:**
- Create: `firebase/scripts/build-forecast-dashboard.js`

**Interfaces:**
- Consumes every export from `firebase/functions/forecastDashboard.js` (Tasks 1–4) and
  `forecast.fiscalYearMonths` from `firebase/functions/forecastSpend.js`.
- Produces: nothing importable — this is the executable entry point.

- [ ] **Step 1: Write the script**

```js
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
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function main() {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  const todayISO = new Date().toISOString().slice(0, 10);
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
    { range: "Charts!A2", values: [["", "", "", "End Month", months[months.length - 1], "", "End Date", todayISO]] },
    { range: `Charts!A${dash.CHECKLIST_FIRST_ROW}`, values: checklistRows },
    { range: "Charts!Z1", values: monthOrderCol },
    { range: `Charts!A${dash.MONTHLY_GRID_HEADER_ROW}`, values: [dash.buildMonthlyHeaderRow(categories)] },
    { range: `Charts!A${dash.MONTHLY_GRID_FIRST_DATA_ROW}`, values: dash.buildMonthlyGridRows(months, categories) },
    { range: `Charts!A${dash.DAILY_GRID_HEADER_ROW}`, values: [dash.buildDailyHeaderRow(categories)] },
    { range: `Charts!A${dash.DAILY_GRID_FIRST_DATA_ROW}`, values: dash.buildDailyGridRows(fyDates, categories) },
  ];
  for (const u of valueUpdates) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: FORECAST_SHEET_ID, range: u.range,
      valueInputOption: "USER_ENTERED", requestBody: { values: u.values },
    });
  }

  // Data validation: checkboxes for the category list, dropdowns for Start/End Month.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: FORECAST_SHEET_ID,
    requestBody: {
      requests: [
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
              condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "=Charts!$Z$1:$Z$12" }] },
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check firebase/scripts/build-forecast-dashboard.js`
Expected: no output (valid syntax).

- [ ] **Step 3: Commit**

```bash
git add firebase/scripts/build-forecast-dashboard.js
git commit -m "feat(forecast): one-off script to build Dashboard + Charts tabs"
```

---

### Task 6: Run against production and verify

**Prerequisite:** `docs/superpowers/plans/2026-08-01-forecast-entry-tab.md` has been executed, deployed,
and force-run at least once, so `'Forecast FY26-27'` has real SUBTOTAL rows.

- [ ] **Step 1: Pull the service-account key locally**

Run: `firebase functions:secrets:access ATTENDANCE_SHEETS_KEY > /tmp/sheets-key.json` (requires a real
terminal login, not `!` — see [[release-rollout-gotchas]]).

- [ ] **Step 2: Run the script**

Run: `cd firebase/scripts && GOOGLE_APPLICATION_CREDENTIALS=/tmp/sheets-key.json node build-forecast-dashboard.js`
Expected: log lines ending "Done." with no thrown error.

- [ ] **Step 3: Manually verify in the browser**

Open `https://docs.google.com/spreadsheets/d/1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo`:
- `Dashboard` tab: 12 × 23 = 276 data rows, no `#REF!`/`#VALUE!`/`#N/A`. Spot-check one month/category
  combo you know the actuals for (see [[forecasting-daily-snapshot]] for which categories currently
  have real MDD data vs. still-empty ones) against `Daily Snapshot`.
- `Charts` tab: 23 checkboxes all checked by default, Start/End Month dropdowns populated, Start/End
  Date cells populated, both charts render with visible lines. Uncheck one category, confirm its lines
  disappear from both charts. Narrow the month/date range, confirm both charts crop accordingly.
- If any helper cell shows an error, the fix belongs in `forecastDashboard.js` (regenerate via the
  script), never hand-edited into the sheet — a re-run would silently overwrite a hand fix.

- [ ] **Step 4: Delete the local key**

Run: `rm /tmp/sheets-key.json` — don't leave a live service-account key on disk.

- [ ] **Step 5: Update memory**

Note in the `forecasting-daily-snapshot` memory (or a fresh linked memory) that `Dashboard`/`Charts`
tabs are live, built via `firebase/scripts/build-forecast-dashboard.js`, re-run any time the category
list or fiscal year changes.
