# Daily Activity — Admin Same-Day Punch Correction

**Date:** 2026-07-14
**Status:** Approved design → implementation
**Scope:** Admin portal (`admin/`) + Firestore rules (`firebase/`)

## Problem

When an ops/office employee accidentally checks out — "Check out from Site" and/or
"Check out for the day" — the Android app moves them to a terminal state and there is
no way to resume. The app derives check-in/out state purely from the ordered list of
that day's `attendance` events (`deriveAttendanceState`): the **last** event decides
the state. Ending a day from a site produces two deliberate punches:

```
site_in → [Check out from Site] → site_out → [Check out for the day] → home_out → DAY COMPLETE
```

Because state = last event, restoring "where they were" means removing the erroneous
**trailing** punches. Removing only `home_out` lands them at "At Home"; removing
`home_out` + `site_out` lands them back "At Site" — checked in and able to work.

## Goal

An **admin-only** "Daily Activity" tab that shows every employee's chronological punch
timeline for a chosen date, and — **for today only** — lets an admin rewind an
employee's timeline to a chosen punch, hard-deleting the trailing punches while
preserving a full audit record.

## Non-goals

- **Past-day correction** — stays with the existing Regularization flow
  (`inTime`/`outTime` overrides). Past days are view-only here.
- **Un-remove / redo** — one-directional. The audit log preserves removed data for a
  manual fix if ever needed.
- **Push to the phone** — the employee refreshes/reopens the attendance screen to see
  the reverted state (`getTodayData` re-reads events). No push in MVP.

## Design

### 1. Tab & access (`src/lib/portalAccess.ts`)

Add an **admin-only** tab (like `/dashboard`, `/users`, `/access`):

```ts
{ path: '/daily-activity', label: 'Daily Activity', icon: 'calendar', group: 'Time & Sites', adminOnly: true },
```

`adminOnly: true` ⇒ never granted to non-admins, never a matrix column. The Sidebar
renders it automatically; the layout's `canAccess` guard blocks hand-typed URLs for
non-admins. No `portalAccess.test.ts` logic changes (adminOnly is already covered).

### 2. Route & view (`src/app/(admin)/daily-activity/page.tsx`)

- `'use client'`, protected by the `(admin)` layout.
- **Date picker**, defaults to **today** (IST). Data: `getAttendanceForDate(date)`,
  grouped by `userId`.
- Each employee = a card: name / emp id / role, then their punches in chronological
  order (type label, `HH:MM`, site/market name or location). Role filter + employee
  search, matching sibling pages. Sort office → admin → ops, then alphabetical.
- **Edit gating:** the "Restore to here" control renders only when the selected date
  equals the **current IST day**. On past days the timeline is read-only.

### 3. Rewind interaction (restore-to-a-point)

- Each punch on today's timeline shows **"Restore to here"** = "make this the new last
  event; remove everything after it." The selected event is always kept, so at least
  one event remains.
- Confirm step shows: the exact punches to be removed, the resulting derived state
  (e.g. "→ At Site: Acme"), and a **mandatory reason** textarea. Empty reason → button
  disabled (mirrors OT approval UX).

### 4. Removal + audit (`src/lib/firestore.ts`)

New `restoreAttendanceToEvent(uid, date, keepEventId, reason, adminName, adminUid)`,
run as **one atomic `writeBatch`**:

1. Read today's events for `uid` (already in memory from the page; re-read defensively
   inside the call to avoid a stale set), ordered by timestamp.
2. Identify events strictly **after** `keepEventId`. If none, no-op.
3. Snapshot each removed event's full payload (`type`, `timestamp`, `latitude`,
   `longitude`, `siteId`, `siteName`, `marketName`, `id`).
4. `batch.delete(doc(db,'users',uid,'attendance',eventId))` for each.
5. `batch.set` one record to **`users/{uid}/attendance_corrections/{autoId}`**:
   `{ date, removedEvents: [...snapshots], reason, correctedBy: adminName,
   correctedByUid: adminUid, correctedAt: serverTimestamp(), keptEventId }`.
6. `batch.commit()`.

The live `attendance` timeline stays clean and truthful for the phone, the nightly
`computeDailyAttendanceStatus`, the OT ledger, and the Sheets exports — none of which
need a "voided" filter. Nothing is lost: removed punches live verbatim in the log.

**Types (`src/types/index.ts`):** add `AttendanceCorrection` (`id`, `date`,
`removedEvents: AttendanceRecord[]`, `reason`, `correctedBy`, `correctedByUid`,
`correctedAt?`, `keptEventId`).

### 5. Firestore rules (`firebase/firestore.rules`)

- `/users/{userId}/attendance/{docId}`: change `allow delete: if false;` →
  `allow delete: if isLoggedIn() && isAdmin();`. Deletes hit the per-doc path, so no
  collection-group change is needed for delete. Update stays field-restricted; create
  stays owner-only.
- New `match /users/{userId}/attendance_corrections/{docId}`:
  `allow read, create: if isLoggedIn() && isAdmin();` (immutable log — no update/delete).
- Deploy **from repo root**: `firebase deploy --only firestore:rules`, then verify with
  `firebase_get_security_rules`. (Not run by the agent without explicit go-ahead.)

## Testing / verification

- `npm run build` (static export) must pass.
- Manual: on today, a two-punch logout (`site_out` + `home_out`) → "Restore to here" on
  the `site_in` removes both and shows "→ At Site"; the correction log records both
  removed events + reason; the phone shows the employee checked in again after refresh.
- Past day: timeline visible, no "Restore to here" control.
- Rules: non-admin cannot delete an attendance event or read/write corrections.

## Data-loss / safety notes

Removed punches carry **real** timestamp + GPS (they were genuine taps, not fabricated).
Hard-delete is safe **only because** step-3 snapshots the full payload into the audit
log first — that record is what prevents an admin from silently erasing a real punch.
