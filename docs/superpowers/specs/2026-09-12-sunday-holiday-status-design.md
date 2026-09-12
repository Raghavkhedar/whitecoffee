# Mark Sundays and Holidays as an Attendance Status — Design

## Problem

Today `computeDailyAttendanceStatus` (`firebase/functions/index.js:383-398`) skips Sundays
(`getUTCDay() === 0`) and marked holidays (`holidays/{date}` exists) with an early `return`
**before the per-user scoring loop even starts** — no `attendance_status` doc is ever written
for anyone on those days, for any role. Absence of a doc is the only signal that a day was a
rest day; there is no `HOLIDAY`/`SUNDAY` value in the status enum. Three places mirror or
depend on this:

- `admin/src/app/(admin)/attendance/page.tsx` `deriveStatus` returns `null` for Sundays/holidays
  (client-side preview before the nightly write lands).
- `admin/src/lib/firestore.ts:371` comment: "No doc = never scored (a future date, a Sunday, a
  holiday)."
- `admin/src/lib/otAggregate.ts` / `otLedger.ts` independently re-derive "is this a rest day"
  from `isSunday(date) || holidays.has(date)` (pure date math, not a Firestore read) to decide
  rest-day OT eligibility.

We want every employee's Sundays and holidays to carry a visible `Sunday`/`Holiday` status
(instead of a blank cell), with **zero payroll effect** — same as today, just visible.

## Decisions (confirmed with user)

- **Scope**: all four roles uniformly (admin, office, operations, sales) — the skip already
  happens at the function level, before any role branching, so this falls out naturally.
- **Payroll effect**: none. `Sunday`/`Holiday` are 0-weight, exactly like "no doc" is today —
  no `daily_hours` doc, no PL deduction, never counted in `daysNP`.
- **Precedence when a holiday falls on a Sunday**: `Holiday` wins (more informative — carries
  the holiday title).
- **Manual override**: if a per-user `attendance_status/{date}` doc already exists for that day
  (any `markedBy`, e.g. an admin-approved rest-day regularization or an authorized-OT Present),
  the automatic write is skipped for that user, same non-clobber rule the nightly function
  already applies to admin overrides.
- **OT ledger consolidation**: explicitly **not** doing this (see "Out of scope" — this was one
  of the two motivations raised, and investigation showed it isn't a net win).
- **Backfill**: yes, a one-time script backfills past Sundays/holidays too, following the
  existing 2026-07-17 backfill precedent (temporary HTTP function, run once, removed from
  source afterward, never overwrites an existing doc).

## Data model

Extend `attendance_status.status` (currently `Present|HalfDay|SL|LNF|Absent|PL|LWP|WO`) with
two new values: `Sunday` and `Holiday`. Written with `markedBy: 'auto'`, no `inTime`/`outTime`,
no accompanying `daily_hours` doc.

```
users/{uid}/attendance_status/{date}
{
  status: 'Sunday' | 'Holiday',   // Holiday wins when both apply
  markedBy: 'auto',
  date, userId, userName, employeeId, role,   // same denormalized fields as every other status
  updatedAt: Timestamp,
}
```

No new collection, no new index — same shape and same collection as every other status value,
so every existing reader that iterates `attendance_status` docs generically (Sheets export,
Attendance tab) already renders/ignores it correctly (see below).

## Cloud Function (`firebase/functions/index.js`)

`computeDailyAttendanceStatus` already fetches each user's existing status doc for *today*
**before** the Sunday/holiday check runs (`statusChecks` populating `priorStatus`, lines
356-366) — so the new branch needs no extra reads.

Replace the two early-`return`s at lines 383-398 with:

```js
const todayDate = new Date(today + "T00:00:00Z");
const isSunday  = todayDate.getUTCDay() === 0;
const holidayDoc = await db.doc(`holidays/${today}`).get();
const dayType = holidayDoc.exists ? "Holiday" : (isSunday ? "Sunday" : null);

if (dayType) {
  const batch = db.batch();
  for (const user of allUsers) {
    if (priorStatus.has(user.id)) continue; // any existing doc (auto or admin) wins
    const ref = db.doc(`users/${user.id}/attendance_status/${today}`);
    batch.set(ref, {
      status: dayType,
      markedBy: "auto",
      date: today,
      userId: user.id,
      userName: user.name || "",
      employeeId: user.employeeId || "",
      role: user.role || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`computeDailyAttendanceStatus: marked ${dayType} for ${today} (${allUsers.length - [...priorStatus.keys()].length} users)`);
  return;
}
```

`allUsers` is already filtered to `active !== false` (offboarded users stay skipped — no
change). This runs before the per-user scoring loop, so no `daily_hours`/PL/Absent logic is
touched. `holidayDoc` is fetched unconditionally now (was previously only reached after the
Sunday check failed) — negligible cost, one extra doc read per night when it's not a holiday,
and it lets `Holiday` take precedence over `Sunday` in one pass instead of two sequential
early-returns.

## Downstream readers — audited, no code change needed

- **`exportToSheets` MTD counter** (`index.js:874-893`): `switch (d.status)` has no case for
  `Sunday`/`Holiday`, so they fall through silently — no bucket incremented, matching today's
  "day doesn't exist" behavior exactly. The `dayOfWeek === 0` guard at line 880 becomes
  redundant for *past* dates (which now have a real doc) but stays correct and is still needed
  for *today* specifically, since `exportToSheets` runs at 16:30 UTC (22:00 IST), before the
  23:59 IST `computeDailyAttendanceStatus` — today's doc (Sunday or not) never exists yet at
  export time. Left unchanged.
- **`exportToSheets` `daysPassed` working-day counter** (`index.js:792-797`): counts calendar
  days regardless of whether a status doc exists; unaffected, unchanged.
- **Attendance tab "Daily Status" column**: reads `statusMap` built from the same
  `attendance_status` collection-group query — will start showing `Sunday`/`Holiday` for any
  date that has the new doc, automatically, no code change.
- **`otLedger.ts` / `otAggregate.ts`**: **not** touched — see "Out of scope."

## Admin portal (`admin/src/`)

- `src/types/index.ts:85`: widen the `status` union to include `'Sunday' | 'Holiday'`.
- `src/app/(admin)/attendance/page.tsx` `deriveStatus`: currently returns `null` for Sundays
  (`dayOfWeek === 0`) and marked holidays. Change to return `'Sunday'`/`'Holiday'` instead —
  and note this preview is valid for **future** dates too (pure calendar/holiday-collection
  math, no punch data needed), unlike every other status this function derives. Add a badge
  style for the two new values (a neutral "off" look, distinct from work statuses, distinct
  from `WO`).
- Update the now-stale comment at `page.tsx:432` ("Holidays are skipped like Sundays — no live
  status is derived for them").
- `src/lib/firestore.ts:371`: correct the comment — a **future** Sunday/holiday still has no
  doc (the nightly job only ever writes *today*), but a **past** one now does (from the deploy
  date onward, or from the backfill's start date after that runs).

## Android

Investigated: Android has **no existing Sunday/holiday awareness anywhere** — no read of the
`holidays` collection, and `ResolveTodayStatusUseCase`'s `DayStatusPreview` enum
(`PRESENT|SHORT_LEAVE|HALF_DAY|PENDING|NOT_CHECKED_IN`) has no rest-day case. Unlike the admin
portal, there is no existing "preview" logic to extend — building a live Sunday/Holiday badge
on the home screen would be new Android work (a new holidays repository read, two new enum
cases, `HomeViewModel` wiring, UI), not a mirror of something that already exists.

**Decision: skip this for Android in this change.** Nobody checks in on a Sunday/holiday in
the normal case, so the home screen's live preview has no real day to misreport, and Android
has no historical attendance-status screen (`ui/…` — see decision #15 in `android/CLAUDE.md`,
"No My Submissions screens") where a past `Sunday`/`Holiday` value would ever need rendering
today. The one place Android reads a status *string* for an arbitrary past date is
`RegularizationRepository.getStatusForDate` (from the in-flight past-date regularization
window feature) — that already treats the field as an untyped string with a `?: "Unmarked"`
fallback, so a `Sunday`/`Holiday` value flows through it with zero code change and strictly
more accuracy than today's `"Unmarked"`.

If a future need arises to show this on the phone (e.g. once a real attendance-history screen
exists), it's a separate, self-contained addition — not blocked by anything here.

## Backfill

One-time HTTP Cloud Function (temporary — deployed, run once via an authenticated request,
then deleted from source, matching the 2026-07-17 precedent documented in `admin/CLAUDE.md`):

- Iterates every user doc (active **and** inactive — the 2026-07-17 second pass specifically
  checked inactive users too, for completeness).
- For each user, walks every date from a chosen start date (ask the user for it at
  implementation time — e.g. app launch date) through yesterday.
- For each date that is a Sunday or a `holidays/{date}` entry, writes the status doc **only if
  none exists yet** for that user+date (never overwrites an existing auto-scored day or an
  admin regularization).
- Dry-run first (count + log what *would* be written, no writes) before the real pass, same as
  the 2026-07-17 precedent.

## Testing

- `firebase/functions`: `node --check index.js` + `npm test` (existing boundary suite).
- `firebase/rules-tests` (72 tests): run before and after. Expectation is **no rule change
  needed** — `firestore.rules` does not allowlist specific `status` string values for the
  `attendance_status` write path — but this must be confirmed against the actual rules file
  during implementation, not assumed.
- `admin`: `npx tsc --noEmit` (or `npm run build`) after the type union change, to catch any
  exhaustive `switch`/`if` on `AttendanceStatus.status` the compiler flags elsewhere in the
  codebase.
- Manual: trigger `computeDailyAttendanceStatus` against the emulator for a seeded Sunday and a
  seeded holiday date; confirm status docs land for all roles, confirm an existing doc (seeded
  as `markedBy: 'admin'`) is left untouched; confirm `daily_hours` is NOT written.
- Backfill: dry-run output reviewed by the user before the real pass is triggered.

## Out of scope

- Rewiring `otLedger.ts`/`otAggregate.ts` to read the new status field instead of deriving
  rest-day-ness from date math. They're pure, already-correct, unit-tested functions called for
  date ranges that include *today* (where no status doc exists yet regardless of day type,
  since `exportToSheets` runs before the nightly status write) — coupling them to Firestore
  state that isn't always present yet is a net-new risk for no behavioral change.
- A live Sunday/Holiday badge on the Android home screen (see "Android" above) — new UI work
  with no current use, not a mirror of existing logic.
- Any change to how `daysPassed`/expected-working-days counts are computed — unaffected, they
  already independently exclude Sundays/holidays via date math, not via status docs.
- Changing the WO status or its −480 ledger debit semantics — unrelated status, untouched.
