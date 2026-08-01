# Forecast Entry Tab — expanded manager input template (design)

**Date:** 2026-08-01
**Status:** design approved in conversation; open items resolved
**Related:** [[2026-07-24-forecasting-daily-snapshot-design]] (the actuals this forecast is compared against)

## Goal

Replace the bare `Forecast` tab — a 22×12 `Category | month…` grid created by
`exportForecastSpend` — with a structured entry template the operations manager fills in by hand
with what he expects to spend. He needs to forecast **per employee** on Manpower (broken into
components) and **per line item** on every other category, across **all 12 months of the fiscal
year**.

This tab is **pure input**. The function generates the empty skeleton once; every amount is typed
by the manager. He adds employees and line items himself.

## Why this shape

The existing template gives one cell per (category, month) — no room to say *which* employee or
*which* purchase makes up the number. Forecasting Manpower means reasoning about individual
salaries; forecasting Purchase Stock means listing the things you expect to buy. A single cell
can't hold that thinking, so the manager wasn't using it — **verified 2026-08-01: the live
`Forecast` tab is completely empty, every cell of all 22 rows × 12 months.**

That emptiness also makes the category rename below free: there is nothing typed, and no chart
built on the old strings, to break.

## Tab: `Forecast FY26-27`

FY-named. Each April a fresh tab appears and the prior year's typed numbers freeze as history.
The old `Forecast` tab is left in place, untouched.

### Columns

| Col | Header | Meaning |
|---|---|---|
| A | `Category / Line Item` | category name on HEADER/SUBTOTAL rows; employee name on EMP rows; blank on ITEM rows (manager types the line item) |
| B | `Month` | `"April 2026"` … repeated on every row of the block, so he can filter to one month |
| C | `Amount` | the forecast ₹. On EMP rows this is a `Row Total` formula, not an input. |
| D | `Type` | `HEADER` · `GRID_HEAD` · `EMP` · `ITEM` · `SUBTOTAL` · `TOTAL` — a machine marker for formatting and future parsing |
| E–K | `Salary` `Convy` `Incentive` `OT/WO` `PF` `ESI` `Special Allow` | Manpower component inputs; blank on non-EMP rows |
| L | `Emp ID` | employee id on EMP rows; blank elsewhere |

**`Incentive` (column G) is the renamed `Imprest`.** The rename is **display-only and scoped to
this tab** — Firestore fields (`imprest`, `imprestPercent`), the admin UI, the Android app, and
the `Daily Snapshot` actuals all keep saying "Imprest". Consequence accepted: this one component
label does not self-match between forecast and actuals the way the category names do.

### Block structure

One block per month, April 2026 → March 2027 in order:

```
Manpower Expense          April 2026            HEADER
Emp Name                  April 2026  Row Total GRID_HEAD  Salary Convy Incentive … Emp ID
Anshuman Srivastava       April 2026  =SUM(E:K) EMP                                  S381
  … 21 more employees, name-sorted …
  … 8 blank EMP rows …
Manpower Expense —Total   April 2026  =SUM(…)   SUBTOTAL
Purchase Stock            April 2026            HEADER
  … 20 blank ITEM rows …
Purchase Stock —Total     April 2026  =SUM(…)   SUBTOTAL
  … 21 more categories …
GRAND TOTAL               April 2026  =SUM(…)   TOTAL
```

Per month: 33 Manpower rows + (22 categories × 22 rows) + 1 grand total = **518 rows**.
Twelve months + a header row = **~6,217 rows**. Well within Sheets limits.

### Formulas

Written `USER_ENTERED` so they land as live formulas, with absolute row numbers computed at
generation time:

- **EMP row `Amount`** = `=SUM(E{r}:K{r})` — the 7 components across.
- **Manpower `SUBTOTAL`** = `=SUM(C{first_emp}:C{last_emp})` — over all 30 EMP rows, blanks included.
- **Category `SUBTOTAL`** = `=SUM(C{first_item}:C{last_item})` — over that category's 20 ITEM rows.
- **`GRAND TOTAL`** = `=SUM()` of the 23 subtotal cells, listed explicitly (not a range — a range
  would double-count the subtotals it spans).

Amount cells are left **blank, not `0`**, so an untouched row reads as "not forecast" rather than
as a genuine forecast of zero.

### Roster

The EMP rows come from Firestore `users`, name-sorted, **excluding** test accounts (`EMP001`,
`TEST001`, `TEST002`, `TEST003`) and `ADMIN-INFO`. Duplicate employee ids collapse to one row and
log a warning — a safety net, not a fix for a known case.

**`S369` and `S369A` are different employees** ("Vishnu" and "Vishnu kumar"); the actuals confirm
both ids appear independently. Both get their own row.

Plus 8 blank EMP rows so he can add people without restructuring anything.

### Write guard

`ensureTab`, then read `A1`. **If the tab has any content, log and return — write nothing.** Same
guard as the current `Forecast` tab (`index.js:512-526`). Once created, the manager owns every
cell; no nightly run can touch a number he typed.

## Category list — 23, aligned across forecast and actuals

The forecast tab and `Daily Snapshot` must use **identical category strings**, or the
forecast-vs-actual comparison the whole sheet exists for cannot be built. The manager's names win;
the actuals side is renamed to match.

1. Manpower Expense *(per-employee grid)*
2. Purchase Stock · 3. Electricity · 4. Asset Repair · 5. Tool Repair · 6. Communication Expenses ·
7. Material Repair · 8. Transporter Purchase · 9. Celebration · 10. Stationery · 11. Office Cleaning ·
12. Core Asset · 13. Asset Purchase · 14. Training Expense · 15. Subscription CLOUD ·
16. Subscription Job Portal · 17. Maint. of Building · 18. Pantry/House Cleaning · 19. Tools Purchase ·
20. Overhead · 21. Rental of Space · 22. Sale & Adv Expenses · 23. Client/Vendor Ent Expense

### Renames on the actuals side (`forecastSpend.js`)

Category **values** in `VENDOR_CATEGORIES` / `OFFICE_CATEGORIES` / `STANDALONE_CATEGORIES` change.
**MDD tag keys are NOT touched** — they must keep matching the live ledger data.

| Old | New |
|---|---|
| `Tool Purchase` | `Tools Purchase` |
| `Transporter Purchases` | `Transporter Purchase` |
| `Welfare (Celebrations)` | `Celebration` |
| `Office Cleaning Eqp. & Exp.` | `Office Cleaning` |
| `Subscription – Cloud` | `Subscription CLOUD` |
| `Subscription – Job Portal` | `Subscription Job Portal` |
| `Pantry / House Keeping` | `Pantry/House Cleaning` |
| `OH (Overhead)` | `Overhead` |
| `Sales & Adv Expenses` | `Sale & Adv Expenses` |
| `Comm Expenses` | `Communication Expenses` |

`Client/Vendor Ent Expense`, `Electricity`, `Asset Repair`, `Tool Repair`, `Material Repair`,
`Core Asset`, `Asset Purchase`, `Purchase Stock`, `Stationery`, `Training Expense`,
`Maint. of Building` are unchanged.

### Employee Welfare stays inside Manpower — DECIDED, no change

`officeResolve` (`index.js:452-454`) routes the `Employee Welfare & Retention` MDD tag into
`Manpower Expense` as a lump line. **This stays exactly as it is.** Splitting it out was
considered and rejected: it would shrink the Manpower actual and break continuity with past
figures. `EMP Welfare & Retention` therefore does **not** appear as a category on the forecast
tab. The catalog is 23, not 24.

## New source: `Rental of Space`

`Rental of Space` is a new category with no MDD tag. Its actuals come from a **third spreadsheet**,
a bank-statement ledger, read-only:

- **Sheet id:** `10-8a0KmY7BI21mG5d3LuTPXHL0L-WJ7Zkj6Dfp9kvrA`
- **Tabs read:** `Bank` and `TBPR`. A third tab exists (columns `Process … Source Tab |
  Intended Destination | Reason Flagged`) — a flagged-exceptions sheet. **Not read.**
- **Columns:** `Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. |
  Closing Balance | Payee | ID (EMP,VEN,OTH) | comments | Comments 2 | Payment Tag | Receipt Tag |
  CR triggred | bill done | INVOICE RECEIVED`

**Matching rule:** a row counts as rent if **either `Payment Tag` or `Receipt Tag` contains
`"rental"`** — trimmed, case-insensitive substring, so `Rental`, `Rental of Space`, and
`Office Rental` all match. **Amount = `Withdrawal Amt.`** (gross, not netted against
`Deposit Amt.`). **Date = the `Date` column** (not `Value Dt`).

Columns are located **by header name**, like the MDD reader, since this is a bank export whose
column order can shift. If `Date`, `Withdrawal Amt.`, or both tag columns are missing, the tab
yields zero rows and logs a warning rather than throwing.

**Access:** the service account `attendance-sheets-expor@white-coffee-92c27.iam.gserviceaccount.com`
has been granted Editor on this sheet (read is all we need). **Verify at first run** — a 403 means
re-share. When read on 2026-08-01 both tabs returned headers only, so the first run may legitimately
find zero rent rows.

## Implementation shape

A new pure function in `forecastSpend.js`, unit-tested with no network:

```js
buildForecastTemplate({ employees, months, categories }) -> rows
```

`employees` is `[{ id, name }]` already filtered and sorted; `months` is the output of the existing
`fiscalYearMonths()`; `categories` defaults to the new catalog. Returns the full row array
including formula strings. All row-number arithmetic lives here, where it can be asserted against.

A second pure function handles the bank ledger, mirroring `bucketMddTab`:

```js
bucketBankRental({ values }) -> { rows, dateCol, amtCol, matched }
```

The integration side in `index.js` step 7 shrinks to: resolve the FY tab name, `ensureTab`, check
`A1` for content, build the roster from the `users` snapshot already in scope, call
`buildForecastTemplate`, write once.

Roster filtering (test accounts, `ADMIN-INFO`, duplicate ids) goes in its own small pure helper so
the exclusion list is testable and visible rather than buried in a chain of `.filter()` calls.

## Testing

`node --test` in `firebase/functions/` (no deps, matching the repo boundary):

- **Row count and ordering** — 518 rows per month, 12 blocks, categories in catalog order, Manpower first.
- **Type markers** — every row carries exactly one valid `Type`; counts per block are 1 HEADER +
  1 GRID_HEAD + 30 EMP + 1 SUBTOTAL for Manpower, 1 HEADER + 20 ITEM + 1 SUBTOTAL for the rest.
- **Formula targets** — each SUBTOTAL's range covers exactly its own category's rows and no
  neighbour's; the GRAND TOTAL references all 23 subtotal cells and no ranges.
- **Roster filter** — test accounts and `ADMIN-INFO` are excluded; a duplicate id yields one row;
  `S369` and `S369A` both survive as distinct people.
- **Blank not zero** — every input Amount cell is `""`.
- **Category alignment** — the forecast catalog equals `["Manpower Expense", ...STANDALONE_CATEGORIES]`
  as a set. This is the test that keeps forecast and actuals from silently drifting apart again.
- **Bank rental bucketing** — matches on either tag column, case-insensitive substring; ignores
  rows with no `Withdrawal Amt.`; tolerates a missing column by returning zero rows.
- Existing `forecastSpend.test.js` cases updated for the renamed category values.

Integration verified by a manual force-run: confirm the tab is created, formulas evaluate, the bank
sheet reads without a 403, and a second run leaves everything untouched.

## Out of scope — flagged for later

**Negative salaries in `dailySpend`.** The live `SpendData` tab shows repeated negative
`Salary` values (`Usha −2000`, `Anshuman Srivastava −2000`, `Bapi nuniya −1996`, `Vishnu −1992`)
and negative `OT amount` values across July 2026. On a spend sheet a negative salary is not a
meaningful figure — something upstream in the `dailySpend` snapshot is producing them. This
predates the current work and is not addressed here, but it means Manpower actuals are currently
understated and should not be trusted for forecasting until investigated.

## Security note

No new exposure from the forecast tab: it contains no actuals, only employee names and ids that
the Forecasting sheet already carries. The bank ledger is **read-only** and only `Rental of Space`
rows are extracted — no narration, payee, or balance data is copied into the Forecasting sheet.
MDD stays read-only.
