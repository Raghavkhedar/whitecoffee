# Live "OT/WO amount" column on the Employee Dashboard tab

**Date:** 2026-07-18
**Status:** Design — awaiting review
**Area:** `firebase/functions/` (Google Sheets export, `exportToSheets`)

## Problem

The Employee Dashboard tab has a `Settlement <YYYY-MM> (₹)` column. It reads each ops
employee's **locked** monthly settlement (`settlements/{YYYY-MM}.settlementCash`) and shows
₹0 until the admin runs **Settle & Lock** on the OT Settlements page. The client reads this
as "OT is missing" for most of the month, because the OT an employee has already earned and
had **authorized** is not visible until the month is formally settled.

## Goal

Show each operations employee's **authorized OT, net of shortage and WO, in rupees, live** —
recomputed on every nightly export, **without** waiting for Settle & Lock. Rename the column
to **`OT/WO amount (₹)`**.

Because the month-end settlement is computed from the *same* authorized numbers, this live
figure will **naturally equal the eventual settlement** — it is the same number, shown earlier
in the month instead of only after locking.

## What "authorized OT" means (in / out of the number)

Counted (all admin-authorized):
- **Auto-approved OT** — post-shift minutes up to the day's `declaredOtMins`.
- **Authorized rest-day OT** — Sunday/holiday work when `planned_hours.otAuthorized === true`.
- **Admin-granted OT** — `ot_approvals.approvedMins` (includes manual grants).

Netted against (automatic, always count):
- **Shortage** — late-in + early-out minutes on worked days.
- **WO debit** — −480 min per WO day (a WO with no OT nets to ₹0 — confirmed intentional).

**Excluded:**
- **Pending OT** (post-shift beyond declared, not yet approved).
- **Unauthorized rest-day work** (rest day worked without `otAuthorized`).

This is exactly the set that `computeRangeLedger` already produces on the admin side, and
exactly what `settlementCash` consumes — so the live number matches the settlement by
construction.

## The formula (unchanged from settlement)

```
netMins      = (autoOtMins + restDayOtMins + grantedOtMins) − shortageMins − woDebitMins
OT/WO amount = woDays × dayRate + (netMins ÷ 480) × dayRate      // signed, may be ±
```

`dayRate = user.salaryRate`. `woDebitMins = woDays × 480`, already inside `netMins`, so an
unworked WO nets to 0. Value is **signed**: `+` when authorized OT outweighs shortage/WO,
`−` when shortage/WO outweigh it.

Non-ledger roles (office / admin / sales — `!usesOtShortageLedger(role)`) show **0**, as today.

## Scope of "live" (honest caveat)

The whole Sheet is rebuilt once per night (`exportToSheets`, 16:30 UTC / 22:00 IST). "Live"
means **the number reflects all authorized OT / shortage / WO as of the last nightly run** — not
second-by-second. Admin approves an OT day today → it appears in the column after tonight's run.

## Architecture

### New pure, unit-tested modules (mirroring the admin TS source)

The aggregation logic already exists and is unit-tested on the admin side
(`admin/src/lib/otLedger.ts`, `admin/src/lib/otAggregate.ts`). Port it to `firebase/functions/`
as small pure modules that `index.js` calls — matching the existing pattern
(`payrollDeductions.js`, `dashboardHistory.js`, `manpowerVisits.js`):

1. **`firebase/functions/otLedger.js`** — pure per-day ledger, ported from `otLedger.ts`.
   Returns `{ autoOtMins, pendingExtraMins, restDayOtMins, shortageMins, unauthorizedRestDay }`
   plus exports `WO_DEBIT_MINS`, `DEFAULT_SHIFT_START_MIN`, `DEFAULT_SHIFT_END_MIN`,
   `netLedgerMins`. **Adds `shortageMins`**, which the current inline copy in `index.js`
   (line ~156) omits.

2. **`firebase/functions/otAggregate.js`** — `computeRangeLedger` + `settlementCash`, ported
   from `otAggregate.ts`. Aggregates one ops employee's month into `netMins` → rupees.

Both get `.test.js` suites (`node --test`, `npm test`) that **port the existing tsx test
cases** verbatim (e.g. `settlementCash(800, 1, -180) === 500`), so the JS port is proven
equal to the TS source.

### `index.js` changes

- **Replace** the inline `computeDayLedger` (line ~156) and the inline `DEFAULT_SHIFT_*`
  constants with `require('./otLedger')`. `otLedger.js` returns a **superset** of the current
  shape (adds `shortageMins`), so the two existing consumers (OT Exception Report, Site
  Manpower) that destructure `{ autoOtMins, pendingExtraMins, restDayOtMins, unauthorizedRestDay }`
  keep working unchanged. Net effect: **removes a duplicated, divergent copy from `index.js`**
  (directly reduces its size — a stated concern).
- **New step** (parallel to §8's `conveyanceByUserId`): build `otWoAmountByUserId` — for each
  ops employee, call `computeRangeLedger` over the current month's already-fetched
  events / planned / approvals / statuses / holidays, then `settlementCash(...)`.
- **§9 (Employee Dashboard):**
  - Header: `Settlement ${currentKey} (₹)` → `OT/WO amount (₹)`.
  - `settlement` value: read from `otWoAmountByUserId` instead of the locked-settlement map.
  - **Delete** the `settlementCashMap` block (lines ~1142–1149) that read locked settlements.
  - `settlement` still feeds `computeDeductions` → `TOTAL DUE = salaryDue + covy + imprest +
    settlement − PF − ESI`, so **TOTAL DUE also becomes live** (it now moves through the month
    with authorized OT). This is the intended consequence of "live OT amount for the employee".

### Data flow

```
attendance events ─┐
planned_hours ─────┤
ot_approvals ──────┼─► computeRangeLedger(user) ─► netMins ─► settlementCash ─► otWoAmountByUserId
attendance_status ─┤        (otAggregate.js,                                         │
holidays ──────────┘         uses otLedger.js)                                       ▼
                                                          §9 Employee Dashboard "OT/WO amount (₹)"
                                                          + TOTAL DUE
```

All five inputs are already fetched in the current export for other tabs; this step reuses
them (or issues the same month-scoped `collectionGroup('attendance')` query the OT Exception
and Manpower steps already use).

## Edge cases

- **Frozen past-month blocks** are kept verbatim (unchanged). Only the **current** month block
  is rebuilt with the live number. A settlement locked *after* month rollover does not
  retro-update a frozen block — this is the existing month-history freeze behaviour, not a
  regression, and is out of scope.
- **Negative `netMins`** (shortage-heavy month) → negative `OT/WO amount` → a negative
  `settlement` term in TOTAL DUE. Correct; the deduction base (Salary Due) is separately floored
  at 0 in `payrollDeductions.js`, unaffected.
- **Inverted/mis-entered shift window** (`end ≤ start`): `computeDayLedger` returns zeros for that
  day (existing behaviour — accrues no OT and no shortage). Documented divergence; unchanged.
- **Sales / office / admin**: `0`, as today.

## Testing / verification

- `otLedger.test.js` + `otAggregate.test.js` — ported cases, run via `npm test` (`node --test`).
- Validate changed `index.js` with `node --check` + `npm test` (eslint config is stale — do
  not lint, per repo CLAUDE.md).
- **End-to-end check:** for one ops employee in an already-settled month, confirm the live
  `otWoAmountByUserId` value equals that month's locked `settlementCash` (they must be equal by
  construction — the port is correct only if they match).

## Out of scope

- Daily per-day breakdown columns (earlier idea, dropped).
- Any change to the OT Settlements page, the settlement doc, or arrears timing.
- Retro-updating frozen past-month blocks after a late lock.
