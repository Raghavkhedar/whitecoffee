# Forecast Dashboard + Charts tabs (design)

## Goal

Add two new tabs to the production Forecasting sheet
(`1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo`, referred to informally as "Forecasting Test"):

- **`Dashboard`** — a live Actual-vs-Forecast-vs-Variance table, all months at once.
- **`Charts`** — two trend-line charts (monthly Actual-vs-Forecast, daily cumulative spend), each
  with its own date-range control, plus a shared multi-category checkbox filter.

Both tabs are pure in-sheet formulas reading the existing `Daily Snapshot` and `Forecast FY26-27`
tabs — no Cloud Function change, no nightly job. See [[forecasting-daily-snapshot]] and
`docs/superpowers/specs/2026-08-01-forecast-entry-tab-design.md` for the tabs this reads from.

## Category list — use the canonical 23, not the pasted sample

The user's initial sample data included `EMP Welfare & Retention` as its own row and omitted
`Client/Vendor Ent Expense`. That doesn't match current reality: the Aug 1 2026 decision folds
Welfare permanently into `Manpower Expense` (`2026-08-01-forecast-entry-tab-design.md` lines
143-149 — "DECIDED, no change"), and `Client/Vendor Ent Expense` is one of the 23 categories now
shared verbatim between `Forecast FY26-27` and `Daily Snapshot`. The Dashboard/Charts tabs use
that canonical 23-category list, confirmed with the user, since the Actual/Forecast join depends
on identical category strings on both sides.

1. Manpower Expense · 2. Purchase Stock · 3. Electricity · 4. Asset Repair · 5. Tool Repair ·
6. Communication Expenses · 7. Material Repair · 8. Transporter Purchase · 9. Celebration ·
10. Stationery · 11. Office Cleaning · 12. Core Asset · 13. Asset Purchase · 14. Training Expense ·
15. Subscription CLOUD · 16. Subscription Job Portal · 17. Maint. of Building ·
18. Pantry/House Cleaning · 19. Tools Purchase · 20. Overhead · 21. Rental of Space ·
22. Sale & Adv Expenses · 23. Client/Vendor Ent Expense

## Tab: `Dashboard`

One long table, all months stacked (no month picker — everything visible at once):

| Month | Category | Actual (Month) | Forecast | Variance | Variance % |
|---|---|---|---|---|---|

- **Rows**: every `Month × Category` combination present so far in `Daily Snapshot` and/or
  `Forecast FY26-27`, oldest month first, 23 categories per month.
- **Actual (Month)**: `SUMIFS` over `Daily Snapshot`'s `Day Spend` column, matched on `Category` +
  `Month`. This naturally sums across all employee rows for `Manpower Expense` (sparse,
  per-employee×component rows) and across all dates for standalone categories (dense).
- **Forecast**: looked up from `Forecast FY26-27`, matching `Month` + `Type = SUBTOTAL` +
  `Category / Line Item = Category & " —Total"` — the block structure writes the subtotal row's
  label as `"{Category} —Total"` (e.g. `"Manpower Expense —Total"`, per
  `2026-08-01-forecast-entry-tab-design.md` line 64/67), not the bare category name, so the join
  must append that suffix rather than matching `Category` literally.
- **Variance** = `Actual − Forecast`.
- **Variance %** = `Variance / Forecast`, blank (not `#DIV/0!`) when Forecast is 0.
- Built with `QUERY`/`ARRAYFORMULA` so a new month appearing in `Daily Snapshot` or
  `Forecast FY26-27` extends the table automatically — no manual re-drag.

## Tab: `Charts`

### Controls (top of tab)

- **Category filter**: 23 checkboxes, one per category (`TRUE`/`FALSE` cells). Any combination
  selected drives both charts — each selected category becomes its own line.
- **Chart 1 date range**: `Start Month` / `End Month` dropdowns (own control, independent of
  Chart 2).
- **Chart 2 date range**: `Start Date` / `End Date` pickers (own control, independent of Chart 1).

Two separate range controls, not one shared range, because the two charts have different time
granularity (monthly points vs. daily points) — a shared range would either misapply a day-level
range to the monthly chart or lose precision on the daily one.

### Chart 1 — Monthly Actual vs Forecast trend

- X-axis: month, limited to the Chart 1 Start/End Month range.
- One line per selected category × {Actual, Forecast} — i.e. 2 lines per selected category.
- Source: a `QUERY`/`FILTER` helper block reading the `Dashboard` tab, filtered by the checked
  categories and the month range. The native line chart's source range is this helper block, so it
  redraws whenever the checkboxes or month pickers change.

### Chart 2 — Daily cumulative spend trend

- X-axis: day, limited to the Chart 2 Start/End Date range.
- One line per selected category, value = that category's cumulative (running total) spend for the
  day.
- Source: a second `QUERY`/`FILTER` helper block reading `Daily Snapshot`. Because `Manpower
  Expense` in `Daily Snapshot` is sparse and per-employee, this block first rolls per-day spend up
  to one value per `Category × Date` (`SUMIFS` on `Day Spend`) before taking a running sum — the
  existing per-row `Running Total` column in `Daily Snapshot` is per-employee/component and isn't
  directly usable for a category-level cumulative line.

Both charts are native Google Sheets `EmbeddedChart` line charts, not custom-drawn — standard
Sheets chart editor still works on them afterward if the user wants to tweak colors/legend
manually.

## Implementation mechanism

A one-off local Node script, `firebase/scripts/build-forecast-dashboard.js`, following the same
pattern as `firebase/scripts/set-passwords.js`:

- Auth: the existing `ATTENDANCE_SHEETS_KEY` Firebase secret (same service account
  `exportForecastSpend` already uses), pulled locally via
  `firebase functions:secrets:access ATTENDANCE_SHEETS_KEY` before running — not a new secret.
- Uses `googleapis` (`sheets.spreadsheets.batchUpdate` / `.values.update`) to create or clear the
  `Dashboard` and `Charts` tabs, write header rows, formulas, checkbox/dropdown data validation,
  and the two `EmbeddedChart` objects.
- **Idempotent, no write-guard**: unlike `Forecast FY26-27` (manager-typed, protected by a
  non-empty-range guard), `Dashboard` and `Charts` are fully generated/computed — safe to clear and
  rebuild on every run.
- Runs once, locally, against the production Forecasting sheet. Not deployed as a Cloud Function —
  nothing here needs a nightly trigger; the formulas stay live on their own once written.

## Testing

Manual verification after running the script:
- `Dashboard`: spot-check a few `Month × Category` rows against known `Daily Snapshot` sums and
  `Forecast FY26-27` subtotals (e.g. July 2026 Manpower Expense, a category with real MDD data like
  Asset Repair, and a still-empty category like Purchase Stock — see
  [[forecasting-daily-snapshot]] for which categories currently have real actuals).
- `Charts`: toggle category checkboxes and date ranges, confirm both charts redraw and lines
  match the `Dashboard` numbers for the selected categories/range.
- No automated test suite — this is a formula/chart scaffold, not application logic; the script
  itself has no unit-testable pure logic worth extracting (unlike `forecastSpend.js`).
