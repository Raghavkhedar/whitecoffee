# Special Allowance (SA) — monthly, per employee

**Date:** 2026-07-25
**Status:** Approved, not yet implemented

## Problem

Special Allowance reaches the Forecasting sheet by scraping rows tagged `Special Allowance`
from the MDD **Employee Payment** tab (`empPayResolve`, `firebase/functions/index.js:459`).
That tag has never appeared in the live data — every run logs
`forecast: 'Special Allowance' NOT FOUND in Employee Payment tab` — so SA is, in practice,
missing from the forecast entirely. It is also invisible to payroll: nothing in
`computeDeductions` accounts for it, so TOTAL DUE understates what the employee is paid.

SA is decided monthly by a manager, near month end. It belongs in the admin portal next to
the other pay fields, not in a Google Form ledger nobody fills.

## Decisions

| Question | Decision |
|---|---|
| Who gets SA | All four roles (`admin`/`office`/`operations`/`sales`) |
| How the monthly value is set | Entered fresh each month — no standing default |
| Where it is entered | Users page, employee modal, in the pay block |
| Where it is locked | OT Settlements, alongside the OT/WO Settle & Lock |
| Reach | Forecasting Daily Snapshot + Firestore `dailySpend` + payroll TOTAL DUE |
| Date anchor | A date the manager picks, defaulting to today |
| Proration | None — the full amount regardless of days present |
| PF/ESI/Imprest base | Unchanged (Salary Due MTD). SA is **not** in the base. |
| History migration | None needed — there is no existing SA data |

## Data model

`users/{uid}/specialAllowance/{YYYY-MM}` — one doc per employee per month, a sibling
subcollection to `settlements/{YYYY-MM}` and shaped like it.

```js
{
  month: "2026-07",        // === the document id
  amount: 12000,           // rupees, finite number
  date: "2026-07-28",      // manager-picked payment date; MUST fall inside `month`
  locked: false,
  lockedBy: null, lockedAt: null,
  lastModifiedBy, lastModifiedAt,   // stamped() — required by rules
}
```

**Why not `compensation/current`.** That document is a single standing record of rates.
SA is a different number every month, so storing it there would destroy July's figure the
moment August is typed. A month-keyed subcollection is the only shape where past months
survive. It also keeps `PAY_FIELDS` / `resolvePay` / `withPay` untouched — that module's
per-field legacy fallback is load-bearing for salary and must not be disturbed.

**Why `date` is stored, not derived.** SA is entered near month end but may record a payment
made days earlier. Deriving the date from the write timestamp would also silently move the
row every time the amount was corrected.

## Data flow

```
Users page (amount + date, per month)
        ↓
users/{uid}/specialAllowance/{YYYY-MM}
        ↓                              ↓
snapshotDailySpend (22:30 IST)    exportToSheets (Employee Dashboard)
        ↓                              ↓
dailySpend/{uid}__{date}.sa       TOTAL DUE (+ SA column)
        ↓
dailySpendToFlat → SpendData → Daily Snapshot   (exportForecastSpend, 23:15 IST)
```

Single source, one write, three surfaces. The schedule ordering already works:
`snapshotDailySpend` at 22:30 IST precedes `exportForecastSpend` at 23:15 IST, so SA entered
before 22:30 reaches the Forecasting sheet the same night.

## Components

### 1. Admin — Users page entry

`admin/src/app/(admin)/users/page.tsx`, employee modal, pay block (beside Salary Rate /
PF / ESI / Imprest):

- A **month selector** defaulting to the current month. The Users page has no month concept
  today, so the SA control carries its own.
- **Amount** (₹, number) and **Date** (date input, defaults to today, constrained to the
  selected month).
- A locked month renders read-only with `🔒 Locked — unlock on OT Settlements to revise`.
- Blank amount ≠ zero: absence of a doc means "not yet decided", and writes nothing.

New `admin/src/lib/firestore.ts` functions, mirroring the settlement helpers:
`getSpecialAllowance(uid, month)`, `setSpecialAllowance(uid, month, {amount, date})`,
`getSpecialAllowancesForMonth(month)` (collection-group + client filter, as
`getSettlementsForMonth` does — avoids a composite index).

### 2. Admin — OT Settlements lock

`admin/src/app/(admin)/ot-settlements/page.tsx` gains a second section,
**"Special Allowance — {month}"**, below the OT table:

- Lists **every active employee** (SA covers all four roles), name / employee ID / SA amount
  / date / status. The existing OT table keeps its `usesOtShortageLedger` filter — non-ops
  employees are not forced into it with five blank columns.
- A month total, and a count of employees with no SA entered (informational, **not** a
  blocker — a legitimately zero-SA month must be lockable).
- The existing **Settle & Lock** button freezes both: OT settlements for ops *and* SA for
  everyone. **Unlock to revise** releases both.

### 3. `dailySpend` — SA as a 7th component

`firebase/functions/dailySpend.js`:
- `dailyTotal` gains `+ sa`.
- `dailyDeductions` is **unchanged** — SA is not in the PF/ESI/Imprest base.

`firebase/functions/index.js`, `snapshotDailySpend`:
- Read the `specialAllowance` collection group (fetch + client filter, matching how
  `lockedSet` is built from `settlements`), keyed `uid → {date, amount}` per month.
- Each SA `date` joins that employee's `candidateDates` union — the same mechanism that
  already admits rest-day-OT and conveyance-only Sundays. Without this, an SA dated on a
  Sunday or a no-status day would be dropped.
- `sa` is written onto that one date's doc; every other day is `sa: 0`.
- If an SA doc's month is locked (never recomputed) and no `dailySpend` row carries it, log
  a warning naming the employee and month. The UI prevents this, but the log is the
  backstop.

`firebase/functions/forecastSpend.js`:
- `MANPOWER_COMPONENTS` gains `["sa", "Special Allowance"]` as the 7th entry.
- No other change. `dailySpendToFlat` already skips zero components, so SA appears as
  exactly one row per employee per month, and `buildDailySnapshot`'s Manpower series are
  already sparse (`if (day === 0) return;`) — the single dated row is the default
  behaviour, not a special case.

### 4. Payroll — TOTAL DUE

`firebase/functions/payrollDeductions.js`:

```
TOTAL DUE = salaryDue + covy + imprest + settlement + sa − PF − ESI
```

`computeDeductions` gains an `sa` parameter (missing → 0, via the existing `toNum`).
The deduction base stays `Math.max(0, salaryDue)` — SA does not enter it.

`firebase/functions/index.js`, Employee Dashboard tab: a new **SA** column beside
Settlement, sourced from the month's `specialAllowance` doc. Read live for the current
month — matching how `settlement` already behaves since the live OT/WO column shipped
(2026-07-18) — and frozen once the month locks, via the existing month-block freezing in
`dashboardHistory.js`.

### 5. Forecast export — deletion only

`exportForecastSpend` (`firebase/functions/index.js`): remove `empPayTab`, `empPayResolve`,
the Employee Payment read, its `bucketMddTab` call, its missing-tag warning, and its
`empPay tags seen` diagnostic (lines ~434, 459, 466, 473, 479). Nothing is lost — the tag
has never matched a live row. The MDD sheet stays read-only and otherwise untouched.

### 6. Security rules

`firebase/firestore.rules` — **both doors**, per the monorepo warning that a `{path=**}`
collection-group rule silently reopens what a per-doc rule closes:

```
// per-doc, inside match /users/{userId}
match /specialAllowance/{month} {
  allow read:  if isLoggedIn() && (isOwner(userId) || isAdmin() || canAccessSettlements());
  // notSelf: SA lands straight in TOTAL DUE — same self-deal risk as settlementCash.
  allow write: if isLoggedIn() && (isAdmin() || (canAccessSettlements() && notSelf(userId)));
}

// collection-group, READ-ONLY — a collectionGroup match cannot bind {userId}, so it
// cannot enforce notSelf. Writes must go through the per-doc path.
match /{path=**}/specialAllowance/{month} {
  allow read: if isLoggedIn() && (isAdmin() || canAccessSettlements());
}
```

Scoped identically to `settlements`, which SA mirrors in both risk and access pattern.

The `date`-inside-`month` constraint is enforced in the UI only, not in rules. Only admins
and settlement managers can write SA at all, and a mis-dated SA misplaces one row in a
report rather than granting anyone access — not worth the rules complexity. `snapshotDailySpend`
ignores an SA whose `date` falls outside the window months regardless.

## Testing

| Suite | Coverage added |
|---|---|
| `firebase/rules-tests` (`npm test`) | SA read/write per role; non-admin denied; **self-write denied** (notSelf); collection-group write denied; owner can read own |
| `firebase/functions/dailySpend.test.js` | `dailyTotal` includes `sa`; `dailyDeductions` base excludes it |
| `firebase/functions/forecastSpend.test.js` | `dailySpendToFlat` emits the SA component; zero SA emits no row; Daily Snapshot carries one sparse SA row on its date |
| `firebase/functions/payrollDeductions.test.js` | `sa` in TOTAL DUE; missing `sa` → 0; SA absent from the PF/ESI base |

Run `cd firebase/rules-tests && npm test` **before and after** the rules change — it has
already caught a real regression.

## Not doing

- **No proration by attendance.** A full month's SA regardless of days present.
- **No standing SA default.** Entered fresh monthly; no carry-forward from last month.
- **No backfill or dual-source reader.** There is no historical SA to preserve.
- **No `roleCapabilities` axis.** SA is universal across all four roles, so it needs no
  per-role capability flag.
- **No Android surface.** SA is admin-entered and reaches the employee through payroll
  exports, exactly as pay already does.
