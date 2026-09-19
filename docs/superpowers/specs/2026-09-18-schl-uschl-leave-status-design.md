# SCHL / USCHL Leave Status — Design

**Date:** 2026-09-18
**Status:** Approved, pending implementation
**Builds on:** `2026-09-12-sunday-holiday-status-design.md` (Holiday/Sunday statuses, already implemented)

## Problem

`PL` (Paid Leave) and `LWP` (Leave Without Pay) are retired as attendance statuses. Today the
nightly `computeDailyAttendanceStatus` function forks an approved-leave-and-no-punches day into
one of the two based purely on `plBalance` at that moment — same day, two different labels,
decided by an accounting detail the label then hides.

Replacing them:

- **SCHL** (Scheduled Leave) — a day inside an *approved* leave request with no check-in
  punches. Written automatically by the nightly function, exactly where PL/LWP used to be
  written. Unlike PL/LWP, the status string no longer encodes whether the day was paid.
- **USCHL** (Unscheduled Leave) — never written automatically. Only an admin can set it, via
  Regularization, for a day that was *not* pre-approved leave (e.g. retroactively excusing an
  absence). Always unpaid.
- **Holiday** — already exists (`2026-09-12-sunday-holiday-status-design.md`); this spec only
  fixes its payroll credit, which today is silently 0.

## Decisions

### SCHL pay is per-day, not per-status

A single approved leave request can straddle the `plBalance` boundary: 4 days approved, 2 days
of balance left → the first 2 days (in date order) are paid, the last 2 are not. The *status*
shown for all 4 is uniformly `SCHL` — an admin or employee looking at the calendar should not
need to know the balance arithmetic to know what day they took off. But payroll still needs to
know which SCHL days were actually paid, so a `SCHL` doc carries a new field:

```
salaryCredit?: 0 | 1   // present only on SCHL docs; 1 = drew from plBalance, 0 = balance exhausted
```

`USCHL` never carries `salaryCredit` (implicitly unpaid). `Holiday`/`Sunday`/`Present`/etc. keep
their existing fixed credit, unchanged.

`plBalance` itself and its monthly `+1` accrual (`accrueMonthlyLeave`) are **unchanged** — this
is a relabeling of PL/LWP's presentation, not a change to how much leave anyone has.

### Days NP formula

```
present + sl×0.75 + halfDay×0.5 + lnf×0.5 + Σ(salaryCredit over SCHL days) + holiday×1 − absent×2
```

USCHL contributes nothing (same treatment LWP had). Holiday now contributes `+1` (today it
contributes 0 — this is a real behavior fix, not a relabel).

### Holiday stays out of expected-hours / shortage math

Confirmed: Holiday is "a paid day off, that's all." It affects Days-NP/salary only. The Working
Hours–Shortage/Excess page's expected-hours calculation continues to exclude holidays entirely,
exactly as it excludes Sundays today — nobody accrues shortage for not working on a holiday.

### USCHL is a Regularization-only outcome

`ATTENDANCE_STATUSES` on the Regularization page becomes `['Present', 'HalfDay', 'Absent',
'USCHL', 'WO']` (PL and LWP removed). USCHL gets no `salaryCredit`, no km/conveyance credit
(already gated to Present/HalfDay outcomes only), and no `wo_ledger` effect (already gated to
the WO outcome only) — it falls through exactly like Absent does today.

### No historical migration

> **Superseded 2026-09-19:** the relabel was later approved after all; see
> `docs/superpowers/specs/2026-09-19-legacy-leave-status-migration-design.md`. The text below is the original decision, kept as a record.

Existing `attendance_status` docs already written as `PL` or `LWP` are left exactly as they are
— frozen history, same convention this codebase already uses for frozen Sheets month-blocks.
Only new writes, from deploy forward, use `SCHL`/`USCHL`. Reports spanning a month before deploy
will show `PL`/`LWP` for that month and `SCHL`/`USCHL` after — expected, not a bug.

### Sheets export: SCHL splits into two columns

The Employee Dashboard tab's `PL` / `LWP` columns are replaced with **SCHL (Paid)**, **SCHL
(Unpaid)**, **USCHL**, **Holiday** — preserving the same paid/unpaid visibility the old two
columns gave, rather than collapsing it into one ambiguous SCHL count. The **PL Balance** field
name and column label are unchanged (out of scope — flag separately if a rename is wanted; it
touches the Users page, Working Hours page, and Android besides Sheets).

## Implementation surface

- `attendanceRules.js` gains `resolveLeaveStatus(plBalance)` → `{ status: "SCHL", salaryCredit:
  plBalance > 0 ? 1 : 0 }`, unit-tested in `attendanceRules.test.js`. This follows the module's
  own established reason for existing (its own JSDoc: the scoring formula used to live inline
  in `computeDailyAttendanceStatus` with no test covering it, because the test suite graded a
  copy of the arithmetic instead of the real thing) — the PL/LWP fork has had exactly that
  problem until now, and gets the same fix.
- `payrollDeductions.js` gains `computeDaysNP({present, sl, halfDay, lnf, schlPaid, holiday,
  absent})`, unit-tested in `payrollDeductions.test.js`, implementing the formula in the
  decision above. `index.js` calls it instead of inlining the arithmetic.
- `index.js`, `computeDailyAttendanceStatus` (~L478-491): replace the `status = balance>0 ?
  "PL" : "LWP"` fork with a call to `resolveLeaveStatus(balance)`. The idempotency guard
  (`priorStatus.get(user.id) !== "PL"` → only decrement once per day even on a retry) must key
  off the *prior doc's* `salaryCredit === 1`, not its status string — `priorStatus` currently
  stores only the status string and needs to carry `salaryCredit` too.
- Employee Dashboard tab (~L922-943 MTD counters, ~L1807 Days-NP formula): counters become
  `schl` / `schlPaid` (sum of `salaryCredit`) / `uschl` / `holiday`, replacing `pl` / `lwp`;
  Days-NP now calls `computeDaysNP(...)`.
- Sheets header/columns (~L1787): `PL`/`LWP` → `SCHL (Paid)` / `SCHL (Unpaid)` / `USCHL` /
  `Holiday`.
- `roleCapabilities.js` — untouched; this change is not role-gated.

### Admin portal (`admin/`)

- `src/types/index.ts`: `AttendanceStatus['status']` drops `'PL' | 'LWP'`, gains `'SCHL' |
  'USCHL'`; add `salaryCredit?: 0 | 1`.
- `src/lib/firestore.ts`:
  - `approveRegularization` — no structural change needed (it already accepts any
    `approvedStatus` string); update the stale comment listing `Absent/LWP/WO/PL`.
  - `cancelLeave` (~L343-436): `scoredAsLeave` checks `status === 'SCHL'` (was `'PL' ||
    'LWP'`); the `plBalance` refund check becomes `data.salaryCredit === 1` (was `status ===
    'PL'`). Doc comments referencing PL/LWP updated to match.
- `src/app/(admin)/regularization/page.tsx`: `ATTENDANCE_STATUSES` list and badge colors
  updated per the decision above.
- `src/app/(admin)/attendance/page.tsx`: monthly leave-count filters (`status === 'PL' ||
  status === 'LWP'`) and the `'L = PL / LWP'` legend entry become SCHL/USCHL equivalents.
  `deriveStatus`'s comment about "PL/LWP always arrive via the stored doc" is updated to
  SCHL/USCHL (behavior already correct — this function never invents leave statuses live).
- `src/components/ui.tsx`: status-badge map — remove `PL`/`LWP` entries, add `SCHL`/`USCHL`.
- `src/app/(admin)/ot-shortage/page.tsx`: audited for any literal `'PL'`/`'LWP'` checks: none
  found beyond the shared `AttendanceStatus` type import.
- `firebase/firestore.rules`: no rule logic branches on the `PL`/`LWP` string today (only
  comments do) — comments updated, no functional rule change required.

### Android app

**No code changes.** Verified by grep: `AttendanceStatusRecord.status` is a raw passthrough
`String` (no enum, no `when` branching on it) — the app never hardcodes `PL`/`LWP`/any leave
status anywhere. The only status literals that do exist (`RegularizationViewModel`,
`HomeScreen`'s `TodayAttendanceStatus`) belong to the *live, punch-derived* preview
(Present/HalfDay/SL/LNF/Absent) — matching the admin portal's own `deriveStatus`, leave statuses
are never derived client-side, only ever read from the stored doc and displayed as-is. So
SCHL/USCHL/Holiday will simply show correctly with zero Kotlin changes.

## Rollout

- No backfill (decided above).
- Deploy order: Cloud Functions first (so new docs are written correctly), then Firestore rules
  (comment-only, low risk), then the admin portal. The nightly function is the only writer of
  `SCHL`, so there's no window where the portal expects a status the function hasn't started
  producing yet, as long as Functions deploys first. No Android deploy needed (no code change).
- Testing: `firebase/functions` `node --test` boundary suite updated for the new fork and
  Days-NP formula; `firebase/rules-tests` (110 tests) run before/after since `attendance_status`
  rule comments are touched; `admin` has no test framework (per repo convention) — verified via
  `next build` + manual walkthrough in the browser preview.
