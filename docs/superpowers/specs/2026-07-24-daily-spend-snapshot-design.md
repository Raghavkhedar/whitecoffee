# Daily Spend Snapshot — Design

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Area:** `firebase/functions/` — new scheduled function `snapshotDailySpend` + new pure module `dailySpend.js`

## Purpose

A forecasting sheet needs a **per-employee, per-day spend snapshot**: for every employee, every
working day, the money accrued on that day broken into its six components (salary, conveyance,
PF, ESI, OT/WO, Imprest) plus a net total. Today no such thing exists — the Employee Dashboard
tab is a **monthly** MTD summary, and Firestore stores only the raw inputs (per-day attendance,
per-day conveyance, OT ledger events) plus monthly aggregates. This feature computes the daily
decomposition and persists it to a queryable Firestore collection the forecasting tool reads
directly.

The key correctness property the design leans on: **all six components decompose cleanly to a
daily value** because each is a linear function of per-day inputs —
- salary = `salaryRate × that day's attendance weight`
- conveyance = already persisted per-day (`conveyance/{uid}__{date}`)
- PF / ESI / Imprest = a flat percentage of that day's salary (no slab, no wage ceiling — see
  `payrollDeductions.js`)
- OT/WO = a per-day term of `computeRangeLedger` (the monthly net is a linear sum of per-day
  contributions, not an entangled netting)

## Snapshot semantics

**One row = that day's incremental spend** (not a running MTD photograph). Summing a month's rows
for an employee reconstructs that month's Employee Dashboard figures. `totalSpend` mirrors the
Dashboard's **TOTAL DUE** exactly:

```
totalSpend = salary + conveyance + imprest + otWo − pf − esi
```

All six components are stored individually, so a consumer may recompute any other total (e.g. a
gross company-outflow figure) without re-querying source data.

## Coverage & the freeze model

**All roles are snapshotted** (office / admin / operations / sales). Components that don't apply
to a role resolve to 0: OT/WO is 0 for non-ledger roles (`!usesOtShortageLedger`), conveyance is
0 for roles without `usesConveyance`.

**Freeze is Settle-&-Lock-driven, not calendar-driven.** A month's rows are recomputed nightly
from live Firestore until that month's ops settlement is **Settled & Locked**; then they freeze
(`frozen: true`) and are never rewritten.

- Lock state lives at `users/{uid}/settlements/{YYYY-MM}` with `locked: true`, written by
  `settleMonth` (one doc per ops employee, all locked in a single batch). A month is considered
  locked company-wide when a `collectionGroup("settlements")` query finds any doc for that month
  with `locked == true`.
- In steady state the only **unlocked** month is the current IST month, so only its rows are
  editable. If the admin is behind and a prior month is not yet settled, that month stays
  unlocked and editable too — the safety net that guarantees no data loss for late edits.
- **No data loss within the workflow:** any regularization or OT approval (even 7+ days late)
  that lands *before* the month is locked is picked up on the next nightly run. The only thing
  not absorbed is an edit to an already-locked (closed payroll) month — a deliberate correction,
  not something a snapshot should silently rewrite. This matches the monthly Employee Dashboard's
  existing frozen-block behaviour.

**Update timing is nightly-batch, not real-time.** A regularization or OT approval made today is
reflected after the next `snapshotDailySpend` run, not the instant the admin clicks. (A
trigger-based real-time variant was considered and rejected as YAGNI for a nightly forecast.)

## Data model

`dailySpend/{uid}__{YYYY-MM-DD}` — one document per employee per working day:

```
userId       string        // uid
employeeId   string        // user.employeeId
name         string        // user.name
role         string        // admin | office | operations | sales
date         string        // "YYYY-MM-DD" (IST)
month        string        // "YYYY-MM" (IST) — for range queries and freeze lookups
salary       number        // ₹ that day's salary accrual (may be negative on an Absent day)
conveyance   number        // ₹ that day's conveyance (0 if none / role without usesConveyance)
pf           number        // ₹ = pfPercent% × that day's salary
esi          number        // ₹ = esiPercent% × that day's salary
otWo         number        // ₹ that day's OT/WO ledger contribution (0 for non-ledger roles)
imprest      number        // ₹ = imprestPercent% × that day's salary × efficiency
totalSpend   number        // salary + conveyance + imprest + otWo − pf − esi
frozen       boolean       // true once the month is Settled & Locked
computedAt   Timestamp
```

Sundays produce **no row** (not a working day — consistent with the MTD summary's Sunday skip).

## Per-day computation

A new **pure, dependency-free module** `firebase/functions/dailySpend.js` (no Firestore, no
Sheets) holds the decomposition, so it is fully unit-testable in isolation:

- `dayWeight(status)` → attendance multiplier: Present ×1, SL ×0.75, HalfDay ×0.5,
  LNF/SLNF ×0.5, PL ×1, LWP ×0, Absent ×−2 (mirrors the MTD `daysNP` weights in `index.js`).
- `dailySalary(salaryRate, status)` → `salaryRate × dayWeight(status)`.
- `dailyDeductions({ dailySalary, pfPercent, esiPercent, imprestPercent, efficiency })` →
  `{ pf, esi, imprest }`. **No per-day floor** on the deduction base — `base = dailySalary`,
  which may be negative — so the daily values sum *exactly* to the monthly
  `computeDeductions` figure. An Absent day therefore carries negative PF/ESI/Imprest
  components; that day's `totalSpend` is negative anyway (a penalty, not a payment). Rounding
  is `round2` per field, matching the rest of the payroll math (a paise-level drift between
  daily-sum and monthly-figure is accepted).
- `dailyOtWo(...)` → per-day OT/WO cash, factored out of the accrual loop in
  `computeRangeLedger`: for a given date, `(isWO ? salaryRate : 0) + ((dayAutoOt + dayRestOt +
  dayApprovedGranted − dayShortage − dayWoDebit) / 480) × salaryRate`. **A reconciliation test
  proves the sum of per-day values equals the monthly `computeRangeLedger`/`settlementCash`
  figure exactly.** Pending/unauthorized OT is excluded until an approval doc exists for the
  date (same rule as the monthly ledger), which is why a late approval must reland via nightly
  recompute.
- `dailyTotal({ salary, conveyance, imprest, otWo, pf, esi })` →
  `salary + conveyance + imprest + otWo − pf − esi` (mirrors TOTAL DUE).

## Scheduled function

New `exports.snapshotDailySpend = onSchedule(...)` in `index.js`, **separate** from
`exportToSheets`. Rationale: `exportToSheets` is a single monolithic function with no retry — a
transient error aborts the whole nightly run. Keeping the daily-spend writes in their own
Firestore-only, independently-retriable function avoids widening that blast radius. Scheduled to
run nightly **after** `computeDailyAttendanceStatus` so statuses are final.

Per-run flow:

1. Load users + pay via `db.collection("users").get()` + `collectionGroup("compensation")` and
   `withPay(...)` (same as `exportToSheets`) → `salaryRate`, `pfPercent`, `esiPercent`,
   `imprestPercent`, `role`.
2. Query `collectionGroup("settlements")` for `locked == true` → set of locked months.
3. Compute the **open window**: every month from the earliest *unlocked* month through the
   current IST month. Steady state = just the current month.
4. Load per-day sources scoped to the open window: `collectionGroup("attendance_status")`,
   `collectionGroup("attendance")`, `collectionGroup("planned_hours")`,
   `collectionGroup("ot_approvals")`, and the `conveyance` collection.
5. For each employee, for each working day in the open window, compute the six components via the
   `dailySpend.js` helpers and `set()` the `dailySpend/{uid}__{date}` doc with `frozen: false`.
   Idempotent overwrite — re-running the same night is safe.
6. Days whose month is locked are **skipped entirely** (never rewritten). When a month transitions
   to locked, its final nightly write (with `frozen` flipped to `true` on that last run) becomes
   the permanent snapshot.

IST date handling follows the repo rule: shift `+05:30` and read `getUTC*` — never bare
`new Date()` / `getDay()` for an IST date. Reuse the existing IST helpers in `index.js`.

## Firestore rules

Add a `dailySpend` collection rule to `firebase/firestore.rules`:
- **Write:** denied for all clients. The collection is authored only by the Admin SDK (which
  bypasses rules). No app writes to it.
- **Read:** granted to `admin` (and any role/tab that legitimately needs the forecast — to be
  confirmed against the `tabAccess` model during implementation; default to admin-only).

Run the rules emulator suite (`cd firebase/rules-tests && npm test`) before and after the change.

## Testing

`node --test` (no new deps) on `firebase/functions/dailySpend.test.js`:
1. `dayWeight` returns the correct multiplier for every status, including Absent → −2 and LWP → 0.
2. `dailySalary` = rate × weight, including a negative result on an Absent day.
3. `dailyDeductions` = flat % of daily salary; negative on a negative-salary day; sums across a
   month equal `computeDeductions` on the MTD salary (exact reconciliation, modulo paise rounding).
4. **`dailyOtWo` reconciliation:** given a month of events/planned/approvals/statuses, the sum of
   per-day `dailyOtWo` values equals `settlementCash(salaryRate, woDates.length, netMins)` from
   `computeRangeLedger` — the load-bearing correctness test.
5. `dailyTotal` mirrors the TOTAL DUE formula.
6. Open-window / freeze selection: a locked month is excluded; an unlocked prior month (admin
   behind) is included; the current month is always included.

Validate with `node --check firebase/functions/index.js` + `npm test` in `firebase/functions/`.
Deploy: `firebase deploy --only functions:snapshotDailySpend,firestore:rules`.

## Structure & files

- **New** `firebase/functions/dailySpend.js` — pure per-day decomposition helpers.
- **New** `firebase/functions/dailySpend.test.js` — `node --test`.
- **Modify** `firebase/functions/index.js` — add `exports.snapshotDailySpend`; factor a per-day
  OT/WO helper so both the monthly ledger and the daily module share one source of truth.
- **Modify** `firebase/functions/otAggregate.js` (or `otLedger.js`) — expose the per-day OT/WO
  contribution as a reusable pure function, keeping `computeRangeLedger` as the summing caller.
- **Modify** `firebase/firestore.rules` — `dailySpend` collection (client write denied, read
  admin-only) + rules-test coverage in `firebase/rules-tests`.

Reuses unchanged: `compensation.js` (`withPay`), `roleCapabilities.js`
(`usesOtShortageLedger` / `usesConveyance`), `payrollDeductions.js` (`computeDeductions` shape).

## Constraints / consequences

- **Frozen = never recomputed.** A regularization or OT approval on an already-locked month does
  not update that month's rows. Intended — a closed payroll period is not silently rewritten.
- **Nightly, not real-time.** Edits land in the snapshot on the next run, not on click.
- **Negative components on Absent days** are expected (the ×−2 penalty flows through salary and
  its percentage-derived deductions); the day's `totalSpend` is negative accordingly.
- **Paise-level reconciliation drift** between daily-sum and the monthly figure is accepted (each
  component is `round2`'d per day). The OT/WO reconciliation test asserts exact equality on the
  minute-based ledger; the percentage deductions may differ by rounding only.
- Cloud functions run on a UTC clock — all IST dates derived by the `+05:30` / `getUTC*` rule.
- No new dependencies.
