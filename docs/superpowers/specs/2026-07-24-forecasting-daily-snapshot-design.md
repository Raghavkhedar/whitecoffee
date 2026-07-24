# Forecasting Sheet — Daily Spend Snapshot (design)

**Date:** 2026-07-24
**Status:** design approved verbally; pending written review
**Related:** [[2026-07-24-daily-spend-snapshot-design]] (the Firestore `dailySpend` collection this consumes)

## Goal

Feed a **Forecasting Google Sheet** with a **daily snapshot of company spend**, broken into
22 expense categories, each with a **daily figure**, a **month-to-date running total**, and an
**overall running total**, filterable by a **custom date range**. Category 1 (Manpower) additionally
breaks down **per employee**.

Data comes from **two sources**:
- **Firestore `dailySpend`** — per-employee, per-day Manpower components (already built + deployed).
- **The MDD sheet** — a transaction ledger; categories are rows filtered by a `Tags`/`tags`/`TAG`
  column value, each row carrying a Date and an Amount.

## Architecture

A new **Cloud Function** in `firebase/functions/`, mirroring the existing `exportToSheets` pattern
(service-account auth via `ATTENDANCE_SHEETS_KEY`, `googleapis`, `writeTab`/`ensureTab`). It:

1. Reads Firestore `dailySpend` (Admin SDK — native, no REST).
2. Reads the MDD sheet tabs via the Sheets API (**read-only**; never writes to MDD).
3. Buckets every spend event into one of 22 categories.
4. Writes a flat, normalized **`SpendData`** tab into the **Forecasting sheet**.
5. Writes a **`Daily Snapshot`** view tab (date-range input cells + QUERY formulas) on top of it.

**Schedule:** nightly, after `snapshotDailySpend` (which runs 22:30 IST) — e.g. **23:15 IST** — so it
reads freshly-computed Manpower figures.

### Why flat data + a formula/pivot view (not a script-rendered grid)

The script's job is **fetch + join + normalize**; the sheet's job is **presentation + filtering**.
- The **date-range filter and running totals become native sheet features** (QUERY/pivot over the
  `Date` column) — reactive, instant, no function re-run to change the dates.
- **New categories are just more rows** with a different `Category` value — the schema never changes.
- Apps Script / a rendered grid can't filter reactively; a pivot/QUERY can.

### Flat schema — `SpendData` tab

One row per spend event (zero-amount rows pruned):

| Column | Meaning |
|---|---|
| `Date` | event date (real Date value, for range filtering) |
| `Category` | one of the 22 category names |
| `Component` | sub-line (Manpower only: Salary/Imprest/PF/ESI/Conveyance/OT/Special Allowance/Welfare); blank otherwise |
| `Employee ID` | Manpower per-employee rows only; blank for standalone categories + the Welfare lump |
| `Employee Name` | as above |
| `Amount` | ₹, positive = spend |

Estimated volume: ~1,000–1,500 rows/month for 20 employees (~18k/year) — trivial for Sheets.

## Category → source mapping

**Category 1 — Manpower Expense** (per-employee, except the Welfare lump):

| Component | Source | Sign |
|---|---|---|
| Salary | Firestore `dailySpend.salary` | + |
| Imprest | Firestore `dailySpend.imprest` | + |
| PF | Firestore `dailySpend.pf` | **+ (company cost — see decision)** |
| ESI | Firestore `dailySpend.esi` | **+** |
| Conveyance | Firestore `dailySpend.conveyance` | + |
| OT amount | Firestore `dailySpend.otWo` | + |
| Special Allowance | MDD **Employee Payment** tab, `Tags = "Special Allowance"`, matched by **Employee ID** | + |
| Employee Welfare & Retention | MDD **Office Expense** tab, `Tags = "Employee Welfare & Retention"` | + (office-level **lump**, Employee ID blank) |

**PF/ESI sign decision:** on a *spend* sheet PF & ESI are money the company lays out, so they are
**positive** and **added** to the Manpower total (i.e. NOT the Firestore net-paid convention that
subtracts them). One-line flip if ever wanted the other way.

**Categories 2–22** (standalone; daily + monthly-running + overall-running; no sub-breakdown):

| # | Category | Source tab | Tag value |
|---|---|---|---|
| 2 | Tool Purchase | Vendor Payment | `Tool` |
| 3 | Core Asset | Vendor Payment | `Core Asset` |
| 4 | Asset Purchase | Vendor Payment | `Asset` |
| 5 | Material Repair | Vendor Payment | `Material Repair` |
| 6 | Transporter Purchases | Vendor Payment | `Transporter Purchase` |
| 7 | Purchase Stock | Vendor Payment | `Stock` |
| 8 | Electricity | Office Expense | `Electricity` |
| 9 | Asset Repair | Office Expense | `Asset Repair` |
| 10 | Tool Repair | Office Expense | `Tool Repair` |
| 11 | Welfare (Celebrations) | Office Expense | `Celebration` |
| 12 | Client/Vendor Ent Expense | Office Expense | `Client/Vendor Entertainment Expenses` |
| 13 | Stationery | Office Expense | `Stationary` |
| 14 | Office Cleaning Eqp. & Exp. | Office Expense | `Office Cleaning Eqp. and Exp.` |
| 15 | Training Expense | Office Expense | `Training Exp.` |
| 16 | Subscription – Cloud | Office Expense | `Subscription - CLOUD` |
| 17 | Subscription – Job Portal | Office Expense | `Subscription - HR Related` |
| 18 | Maint. of Building | Office Expense | `Building/General Maintenance (Electrical / Plumbing / Painting / Deep Cleaning)` |
| 19 | Pantry / House Keeping | Office Expense | `Chai / Biscuit / Tissue / Disposable` |
| 20 | OH (Overhead) | Office Expense | `Mis. Overhead` |
| 21 | Sales & Adv Expenses | Office Expense | `Expense Related to Sales and Advertisement` |
| 22 | Comm Expenses | **Communication** | **(all rows, no tag filter)** — auto-detected Date + Amount cols |

## Column / tag resolution (robustness)

Exact tag strings are load-bearing. The function will:
- Locate columns **by header name** (trimmed, case-insensitive) — not fixed positions — since the MDD
  tabs are Google-Form-fed and column order can shift.
- Match tag values **trimmed + case-insensitive**.
- Read the **distinct tag values actually present** in Vendor Payment and Office Expense, and **log a
  warning for any category whose tag is not found** (typo protection — a bad tag becomes a visible
  "0 rows, tag not found" warning, never a silent drop).
- **Category 22:** auto-detect the Communication tab (name contains "communication"), its Date column
  (header matches /date/i) and Amount column (header matches /amount|amt|₹/i); log what it picked.

## Daily Snapshot table (function-computed)

A `Daily Snapshot` tab written as a **materialized table** (static values computed in the
function, not sheet formulas — cumulative running totals over a dense daily grid are painful
and slow as formulas). Columns:

`Snapshot Date | Category | Employee ID | Employee Name | Component | Month | Day Spend | Month Total | Running Total`

- **Day Spend** = that series' spend on that date. **Month Total** = month-to-date cumulative
  (resets each month). **Running Total** = all-time cumulative.
- **Standalone categories (21): dense** — one row per (date × category) for every date in the
  data span, zeros included. Employee/Component blank.
- **Manpower: expanded per (employee × component)** — Salary/Conveyance/Imprest/OT/PF/ESI/Special
  Allowance per employee, plus the office-level Employee Welfare & Retention lump (blank employee).
  **Sparse** — a row only on dates that series actually had spend.
- Sorted by date, then category order (Manpower first), then employee, then component.
- Written `USER_ENTERED` so `Snapshot Date` lands as a real date (native filtering/sorting).

The raw normalized `SpendData` tab is still written (audit/feed layer).

## Testing

- **Pure bucketing logic** (rows → categorized flat rows, tag matching, Manpower Firestore mapping,
  PF/ESI sign, Welfare lump) extracted into a pure module with a `node --test` suite (`npm test`),
  matching the repo's no-deps test boundary. No network in tests.
- **Integration** (Sheets read/write, Firestore read) verified by deploy + a manual run, reading the
  function logs for tag warnings and the Category-22 auto-detect report.

## Setup / operational requirements

- Service account `attendance-sheets-expor@white-coffee-92c27.iam.gserviceaccount.com` must have:
  **MDD → Viewer** (currently satisfied via anyone-with-link reader), **Forecasting → Editor**
  (must be an explicit share; **verify at first run** — a write 403 means re-share).
- Forecasting sheet id: `1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo`
- MDD sheet id: `1rsmpHOeOeVBG8XzIFZlnEAa2pzyxr4S0UYOYGyulFyQ`

## Open items (to confirm at/after first run)

1. Category 22 Communication tab — confirm auto-detected tab name + Date/Amount columns are right.
2. Forecasting write access — confirm the first run writes successfully (else re-share).
3. Reconcile every category's tag string against the distinct tags the first run reports.

## Security note

This exports payroll-derived per-employee spend into a Google Sheet — consistent with the 9 existing
`exportToSheets` sheets that already carry payroll data. No new exposure class. MDD is read-only.
