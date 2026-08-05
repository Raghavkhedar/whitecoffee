# Leave Cancellation — Design

**Date:** 2026-08-05
**Status:** Implemented
**Branch:** `feat/leave-cancellation`
**Builds on:** `2026-07-20-partial-leave-approval-design.md`

## Problem

An approval is final. `/leaves` offers Approve and Decline only while `status === 'pending'`;
once approved there is no undo. Real cases need one — a project slips, an employee's plans
change, a leave is approved by mistake — and they arrive *after* the fact, often after the
nightly scorer has already written `PL`/`LWP` and decremented `plBalance`.

## Decisions

**Admin-only, date-level, allowed at any time including retroactively.** Confirmed with the
requester up front; all three shape the design.

### `cancelledDates` is a second overlay, never a rewrite

```
fromDate…toDate   what the employee ASKED for      — never rewritten
approvedDates[]   what the approver GRANTED        — never rewritten
cancelledDates[]  what an admin later REVOKED      — the new overlay
effective = granted − cancelled
```

Plus `cancelledBy`, `cancelComment` (mandatory), `lastCancelledAt`. The document therefore
keeps the whole history — asked for → granted → revoked — and any future audit can read the
sequence rather than a final state that has forgotten how it got there.

**`status` stays `'approved'`.** Rejected adding a `'cancelled'` status for the same reason
the last design rejected `'partially_approved'`: every `status === 'approved'` reader in three
languages would have to learn about it, and a missed one turns a granted leave day into an
Absent — a payroll bug in the dangerous direction. "Cancelled" is derived, never stored.

### ⚠️ The two empty cases are inverted, deliberately

| field | empty/absent means |
|---|---|
| `approvedDates` | the **whole** range is granted |
| `cancelledDates` | **nothing** is cancelled |

Both defaults read in the employee's favour, which is exactly what lets every legacy document
behave unchanged with no backfill. Mirroring the `approvedDates` rule onto `cancelledDates`
("empty means all cancelled") would silently unpay every leave in the database at once. This
asymmetry is asserted from both ends in all three languages.

### Reversing an already-scored day

A cancelled past day is reset to **`Absent`**. PL/LWP only ever exists on a zero-punch day (the
scorer's PL branch is reached only when both `checkIns` and `checkOuts` are empty), so with the
leave gone it is precisely the scorer's own `no leave → Absent` fallback. No new status, no new
branch. `WO` never applies — it is an unrelated, independently admin-set ops concept.

**Future dates need no attendance write at all.** No status doc exists yet, and
`leaveCoversDate` simply stops covering the day, so the nightly run scores it as the ordinary
working day it now is. There is therefore **no past-vs-future branch** in `cancelLeave` — it
attempts the read for every date and a missing doc is a no-op by construction. Past-vs-future
matters only as a UI hint.

**Gated on `markedBy === 'auto'`.** Same invariant the nightly function upholds (decision #28
in `android/CLAUDE.md`): an admin-marked day is never silently rewritten. If someone
regularized the day after the leave scored it, that later decision wins — the date is still
recorded as cancelled, but its status doc is left alone and returned in `skippedDates` so the
UI can say so instead of pretending. Rejected adding a `causedByLeaveId` provenance field: new
schema for an already-rare case, when the existing predicate says the same thing.

### ⚠️ Only a PL day refunds `plBalance`

LWP is leave taken with a **zero** balance — it never decremented anything, so refunding it
would mint leave out of nothing. `refundedDays` counts only reverts whose prior status was
exactly `'PL'`.

This is the **first and only `plBalance` increment** in the codebase outside
`accrueMonthlyLeave`'s monthly +1; every other write is a decrement. It has no automated
coverage (there is no harness for `writeBatch` against live Firestore), so it is the one thing
worth checking by hand after deploy.

**Re-cancelling is a safe no-op.** The revert writes `markedBy: 'admin'`, so the guard above
rejects a second pass and no double refund is possible. `cancelLeave` also re-derives what is
still granted from the **server** copy rather than trusting the caller's list, so a stale tab
cannot double-cancel either. `cancelledDates` is merged as a **union**, never overwritten.

### Admin-only, unlike approve/decline

`/leaves` is a grantable tab, so a non-admin manager can approve and decline. They cannot
cancel: reverting a scored day writes `attendance_status` (needs `/attendance` or
`/regularization`) and the `plBalance` refund writes the user doc (**admin-only in the rules**).
Their cancellation would be denied atomically — safe, but only after they had filled in the
form. The button is gated on `useAccess().user.role === 'admin'` instead.

### `grantedDayCount` needed more than a filter

Its contract is "return `null` → caller falls back to `totalDays`". A fully-cancelled leave
yields an empty granted list, which under a naive change reports `null` → `totalDays` — billing
the Sheets export for days nobody is taking. It now counts explicitly once any cancellation
exists, and a real `0` stays `0`. The no-cancellation path is byte-identical, so every existing
document's exported count is unmoved. Still Date-free: subtracting cancelled days from
`totalDays` needs only lexicographic compares.

## No Firestore rules changes

`leave_requests` update, `attendance_status` write, and `users` update already admit `isAdmin()`.
Verified by reading the rules and by the 79-test `firebase/rules-tests` suite passing unchanged
— that suite is the regression gate, not evidence that nothing was needed.

## The three-way mirror

| file | role |
|---|---|
| `firebase/functions/leaveCoverage.js` | authority — the nightly scorer + Sheets export read it |
| `admin/src/lib/leaveDates.ts` | portal display + the cancel picker |
| `android/.../data/model/LeaveRequest.kt` | employee's own history (read-only; the app never writes a cancellation) |

**Change all three together.** Each has its own suite; a drift between them means the app shows
an employee a leave day that payroll will score as Absent.

## Verification

| suite | result |
|---|---|
| `firebase/functions` — `node --check` + `npm test` | 235 pass (+13) |
| `firebase/rules-tests` | 79 pass, no rule changes |
| `admin` — `npx tsx src/lib/leaveDates.test.ts` | 54 pass (+22) |
| `admin` — `npm run build` | compiles, 22 static pages |
| `android` — `:app:testDebugUnitTest` | 248 pass, `LeaveCoverageTest` 23 (+9) |

Two mutation tests confirm the suites are not passing vacuously: reverting `grantedDayCount` to
the naive empty-⇒-null shortcut, and making Kotlin's `effectiveGrantedDates` skip the
subtraction. Each failed exactly the test naming that invariant, then passed again on restore.

## Out of scope

- Employee self-cancel from the Android app (read-only mirror this round, as with partial approval).
- Cancellation from the `/dashboard` leaves calendar modal — it does not surface the existing
  "Partial" badge either, so it is a separate, consistent piece of work.
- Re-granting a cancelled day. A cancellation is a revocation, not an edit; re-approval remains
  a non-flow.
- Half-day leave.
