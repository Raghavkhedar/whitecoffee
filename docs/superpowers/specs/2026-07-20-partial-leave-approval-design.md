# Partial Leave Approval — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation
**Branch:** `feat/partial-leave-approval`

## Problem

A leave request today is approved all-or-nothing. `approveLeave()` flips
`status: 'approved'`, and the nightly scorer treats **every** date from `fromDate` to
`toDate` as leave (`firebase/functions/index.js:232`). An approver who wants to grant
three of five requested days has no way to say so — they must approve all five or
decline the whole request.

The approver needs to pick which dates are granted.

## Decisions

1. **Ungranted dates are normal working days.** They are not leave in any form. If the
   employee does not punch in, the nightly scorer marks the day `Absent` through the
   existing path — no new status, no override of a real punch-in. "I gave you Mon–Wed
   off; I expect you at work Thu–Fri."
2. **Arbitrary subsets, not range trimming.** Any combination of the requested dates can
   be granted. This subsumes the contiguous-trim case.
3. **Admin portal builds the picker; Android is read-only this round.**
4. **The employee is told explicitly**, in-app and by push, which dates were granted and
   which days they are expected at work.

## Data model

Add one field to the leave request document:

```
approvedDates: string[]   // sorted "yyyy-MM-dd", e.g. ["2026-07-21","2026-07-22","2026-07-24"]
```

`fromDate`, `toDate` and `totalDays` are **not** modified — they remain the record of what
the employee requested. "Partial" is derived, never stored:

```
isPartial = status === 'approved' && approvedDates is non-empty
            && approvedDates.length < (days spanned by fromDate…toDate)
```

### The compatibility rule

> **On an approved leave, a missing or empty `approvedDates` means the entire
> `fromDate…toDate` range is granted.**

Every leave already in Firestore lacks this field, so all of them keep their current
meaning. There is no backfill and no migration. Any writer that does not know about
partial approval (notably the Android approve action) writes no `approvedDates` and
therefore correctly grants the full range.

### Rejected alternatives

- **A `'partially_approved'` status value.** `status` is a three-language enum read by the
  portal filter tabs, the Android approvals and employee lists, the Sheets export, and
  every `status === 'approved'` predicate. A reader missed during the change silently
  stops counting the leave *at all* — the leave day becomes `Absent`, a payroll bug in
  the dangerous direction. The label is computable; the risk is not worth it.
- **Rewriting `fromDate`/`toDate` to the granted span.** Cannot express a non-contiguous
  grant, and destroys the record of what was originally requested.

## Backend (`firebase/functions/`)

A single pure helper, unit-tested, replaces the date predicate that is currently
hardcoded in three places:

```js
// leaveCoverage.js
function leaveCoversDate(leave, date) // date: "yyyy-MM-dd"
```

Returns true when the leave is approved **and** covers `date`: within `fromDate…toDate`
and, when `approvedDates` is present and non-empty, a member of it.

Call sites to convert:

| Site | Current | Change |
|---|---|---|
| `index.js:232` | nightly scorer's `leavesToday` predicate | use helper — an ungranted date falls through to the existing `Absent` / working-day path |
| `backfill-attendance-tz.js:148` | same predicate, duplicated | use helper, so the two cannot drift |
| `index.js:972` | Sheets export row | `totalDays` column becomes days **granted**; new column lists the granted dates |

**PL balance needs no change.** It is deducted per-day as each day is scored
(`index.js:334`), so granting 3 of 5 days deducts 3.

## Admin portal (`admin/src/`)

### Approve modal

Approve opens a modal shaped like the existing Decline modal in
`admin/src/app/(admin)/leaves/page.tsx`:

```
Approve Leave — Ramesh Kumar
Requested: 2026-07-21 → 2026-07-25 (5 days)

  ☑ Tue 21 Jul      ☑ Wed 22 Jul
  ☐ Thu 23 Jul      ☑ Fri 24 Jul
  ☐ Sat 25 Jul

  [All]  [None]                    Granting 3 of 5 days

Comment (optional) ______________________

           [Cancel]        [Approve 3 days]
```

- One checkbox per requested date, **all ticked by default** — approving everything stays
  two clicks, as it is today.
- Sundays and holidays in the range are shown but flagged; they are never leave days (the
  scorer returns before reaching them).
- Zero dates ticked disables the button. That is a decline, not an approval.

### Writer

`approveLeave()` (`admin/src/lib/firestore.ts:178`) gains an `approvedDates: string[]`
parameter and writes the field alongside `status`, `approvedBy`, `reviewedAt`.

### List display

A **Partial** badge plus the granted dates on partially-approved rows, so the record reads
correctly after the fact.

## Employee notification

On partial approval only — a full approval keeps today's behaviour — the portal calls the
existing `sendNotification` helper (`admin/src/lib/firestore.ts:332`), which writes to
`users/{uid}/notifications/` and `sent_notifications/`, where the existing trigger
(`index.js:1264`) delivers the push.

> **Leave partially approved** — 3 of your 5 requested days were approved: 21, 22, 24 Jul.
> You are expected at work on 23, 25 Jul.

Naming the **expected** days explicitly is the point of the message — that is the sentence
that prevents an unexpected absence.

## Android (read-only this round)

- `LeaveRequest.kt`: add `approvedDates: List<String> = emptyList()` to the data class,
  `toMap()`, and `fromDocument()`.
- Employee leave list: show "Partially Approved" and the granted dates.
- Approvals screen: same, for already-actioned requests.
- **No Compose date picker.** Android approve stays all-or-nothing and writes no
  `approvedDates`, which under the compatibility rule grants the full range.

## Testing

`node --test` in `firebase/functions/` for `leaveCoversDate`:

| Case | Expect |
|---|---|
| approved, no `approvedDates` (legacy), date in range | covered |
| approved, `approvedDates: []`, date in range | covered |
| approved, date in `approvedDates` | covered |
| approved, date in range but **not** in `approvedDates` | not covered |
| date outside `fromDate…toDate` | not covered |
| granted date outside the requested range | not covered — range still bounds it |
| status `pending` / `rejected` | not covered |

Portal-side: a test for the granted-day count derivation and the partial/full split.

## Out of scope

- Compose date picker on Android.
- Editing the granted dates after an approval — re-approval is not a flow today and this
  design does not add one.
- Half-day leave.
