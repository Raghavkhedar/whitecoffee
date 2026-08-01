# Forecast Entry Tab — expanded manager input template (design)

**Date:** 2026-08-01
**Status:** design approved in conversation; pending written review
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
can't hold that thinking, so the manager wasn't using it.

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
  … 22 more categories …
GRAND TOTAL               April 2026  =SUM(…)   TOTAL
```

Per month: 33 Manpower rows + (23 categories × 22 rows) + 1 grand total = **540 rows**.
Twelve months + a header row = **~6,481 rows**. Well within Sheets limits.

### Formulas

Written `USER_ENTERED` so they land as live formulas, with absolute row numbers computed at
generation time:

- **EMP row `Amount`** = `=SUM(E{r}:K{r})` — the 7 components across.
- **Manpower `SUBTOTAL`** = `=SUM(C{first_emp}:C{last_emp})` — over all 30 EMP rows, blanks included.
- **Category `SUBTOTAL`** = `=SUM(C{first_item}:C{last_item})` — over that category's 20 ITEM rows.
- **`GRAND TOTAL`** = `=SUM()` of the 24 subtotal cells, listed explicitly (not a range — a range
  would double-count the subtotals it spans).

Amount cells are left **blank, not `0`**, so an untouched row reads as "not forecast" rather than
as a genuine forecast of zero.

### Roster

The 22 EMP rows come from Firestore `users`, name-sorted, **excluding**:

- test accounts: `EMP001`, `TEST001`, `TEST002`, `TEST003`
- `ADMIN-INFO`
- duplicate employee ids — `S369` currently appears twice, as both "Vishnu" and "Vishnu kumar";
  keep the first by name sort and log the collision.

Plus 8 blank EMP rows so he can add people without restructuring anything.

### Write guard

`ensureTab`, then read `A1`. **If the tab has any content, log and return — write nothing.** Same
guard as the current `Forecast` tab (`index.js:512-526`). Once created, the manager owns every
cell; no nightly run can touch a number he typed.

## Category list — 24, aligned across forecast and actuals

The forecast tab and `Daily Snapshot` must use **identical category strings**, or the
forecast-vs-actual comparison the whole sheet exists for cannot be built. The manager's names win;
the actuals side is renamed to match.

Order (as the manager listed them, with `Client/Vendor Ent Expense` appended):

1. Manpower Expense *(per-employee grid)*
2. Purchase Stock · 3. Electricity · 4. Asset Repair · 5. Tool Repair · 6. Communication Expenses ·
7. Material Repair · 8. Transporter Purchase · 9. EMP Welfare & Retention · 10. Celebration ·
11. Stationery · 12. Office Cleaning · 13. Core Asset · 14. Asset Purchase · 15. Training Expense ·
16. Subscription CLOUD · 17. Subscription Job Portal · 18. Maint. of Building ·
19. Pantry/House Cleaning · 20. Tools Purchase · 21. Overhead · 22. Rental of Space ·
23. Sale & Adv Expenses · 24. Client/Vendor Ent Expense

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

### Two structural changes

**`EMP Welfare & Retention` becomes standalone.** Today it is a special case in `officeResolve`
(`index.js:452-454`) that routes the `Employee Welfare & Retention` MDD tag into
`Manpower Expense` as a lump line with a blank employee id. It becomes an ordinary standalone
category:

- add `[normTag("Employee Welfare & Retention")]: "EMP Welfare & Retention"` to `OFFICE_CATEGORIES`
- delete the special case in `officeResolve`
- simplify `expectOffice` (`index.js:468`), which no longer needs to append the tag by hand

Effect on actuals: the amount leaves the Manpower total and becomes its own category line. Manpower
actuals drop by that amount; the company total is unchanged.

**`Rental of Space` is new.** No MDD tag maps to it yet, so its actuals stay at ₹0 until the tag is
identified (see open items). It still appears in the forecast tab, and `STANDALONE_CATEGORIES`
gains it so `Daily Snapshot` emits its dense zero rows — the line exists and reads as zero rather
than being absent.

## Implementation shape

A new pure function in `forecastSpend.js`, unit-tested with no network:

```js
buildForecastTemplate({ employees, months, categories }) -> rows
```

`employees` is `[{ id, name }]` already filtered and sorted; `months` is the output of the existing
`fiscalYearMonths()`; `categories` defaults to the new catalog. Returns the full row array
including formula strings. All row-number arithmetic lives here, where it can be asserted against.

The integration side in `index.js` step 7 shrinks to: resolve the FY tab name, `ensureTab`, check
`A1` for content, build the roster from the `users` snapshot already in scope, call
`buildForecastTemplate`, write once.

Roster filtering (test accounts, `ADMIN-INFO`, duplicate ids) goes in its own small pure helper so
the exclusion list is testable and visible rather than buried in a chain of `.filter()` calls.

## Testing

`node --test` in `firebase/functions/` (no deps, matching the repo boundary):

- **Row count and ordering** — 540 rows per month, 12 blocks, categories in catalog order, Manpower first.
- **Type markers** — every row carries exactly one valid `Type`; counts per block are 1 HEADER +
  1 GRID_HEAD + 30 EMP + 1 SUBTOTAL for Manpower, 1 HEADER + 20 ITEM + 1 SUBTOTAL for the rest.
- **Formula targets** — each SUBTOTAL's range covers exactly its own category's rows and no
  neighbour's; the GRAND TOTAL references all 24 subtotal cells and no ranges.
- **Roster filter** — test accounts and `ADMIN-INFO` are excluded; a duplicate id yields one row.
- **Blank not zero** — every input Amount cell is `""`.
- **Category alignment** — the forecast catalog equals `["Manpower Expense", ...STANDALONE_CATEGORIES]`
  as a set. This is the test that keeps forecast and actuals from silently drifting apart again.
- Existing `forecastSpend.test.js` cases updated for the renamed category values and the Welfare split.

Integration verified by a manual force-run: confirm the tab is created, formulas evaluate, and a
second run leaves it untouched.

## Open items

1. **`Rental of Space` MDD tag** — which tag value in which tab carries rent? Until answered, its
   actuals are ₹0.
2. **Existing charts** — if the manager has built anything referencing the old category strings
   (`Comm Expenses`, `OH (Overhead)`, …), those references break when `Daily Snapshot` is rewritten
   with the new names. Confirm before deploying.
3. **Manpower actuals drop** — splitting out `EMP Welfare & Retention` lowers the Manpower actual.
   Confirm the manager expects Manpower to exclude it.

## Security note

No new exposure. The tab contains no actuals — only employee names and ids, which the Forecasting
sheet already carries via `SpendData` and `Daily Snapshot`. MDD stays read-only.
