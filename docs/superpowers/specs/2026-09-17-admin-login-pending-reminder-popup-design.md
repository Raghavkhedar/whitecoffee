# Admin Login Pending-Reminder Popup — Design

**Date:** 2026-09-17
**Status:** Approved, not yet implemented
**Scope:** `admin/` only

## Problem

Nothing surfaces backlog counts proactively. An admin only sees how many leave requests,
regularization requests, or OT approvals are waiting if they happen to open that specific tab.
There is no single "here's what's outstanding" moment — an admin can go days without opening
`/regularization` and never know three requests have been sitting there.

## Decision: admin-only, count-gated, sound on

Confirmed with the requester:

- **Admins only** (`role === 'admin'`), not every manager with partial `tabAccess`. Simpler
  scope — no need to intersect categories against a manager's granted tabs.
- **Only pops up when the total pending count across categories is > 0.** A clear inbox produces
  no popup and no sound — silence is the "all caught up" signal, not an empty banner.
- **Stays until dismissed** (manual close, no auto-timeout) and links each category to its page.
- **A short chime plays once**, best-effort — an autoplay failure must never block or hide the
  popup itself, since the count is the useful part and the sound is decoration.

## Data — three independent counts

| Category | Source | Cost |
|---|---|---|
| Leave requests pending | `getAllLeaveRequests('pending')` (existing, `firestore.ts:269`) | One `collectionGroup` read of `leave_requests`, client-filtered — already paid by `/leaves` today. |
| Regularization requests pending | `getAllRegularizationRequests('pending')` (existing, `firestore.ts:457`) | Same shape, `regularization_requests`. |
| OT approvals pending | **new** `getPendingOtCount()`, extracted from `ot-shortage/page.tsx`'s `aggregateForEmployee` | Downloads the **entire** `attendance` collectionGroup (no server-side date filter exists for it) + `planned_hours`/`ot_approvals`/`holidays`/`attendance_status` for a fixed last-30-days range, then runs `computeDayLedger` per ops employee per day. |

All three are fetched with `Promise.all` right after the layout's `onAuthStateChanged` resolves
`role === 'admin'`. **Each fetch is independent** — if one throws, the other two still render;
a failed category is simply omitted rather than failing the whole popup or blocking login.

### Why OT is allowed to be this expensive

There is no stored "pending OT" flag anywhere and no server-side date-ranged query for
`attendance` — `getAttendanceForDateRange` already does a full unfiltered collectionGroup
download today, client-filtered by date, every time anyone opens `/ot-shortage`. This design
does not introduce that cost; it moves an *existing* cost from "on-demand when the page is
opened" to "once per admin login." A real fix (e.g. a nightly-computed `pendingOt` field) is
future work — see Out of scope.

`getPendingOtCount()` reuses the same last-30-days default the OT page itself uses, so the two
numbers agree by construction; it sums `pendingOt.length` (from `aggregateForEmployee`, already
gated on `tracksShortage(role)` — office/admin/sales are excluded) across every operations
employee in range.

## Trigger and dedupe

Lives in `admin/src/app/(admin)/layout.tsx`, which already resolves `portalUser.role` via
`onAuthStateChanged`. Once role resolves to `'admin'` for the first time in this browser tab:

1. Check `sessionStorage.getItem('adminPendingPopupShown')`. If set, skip — a page refresh or
   internal navigation must not re-pop the same reminder.
2. Otherwise, run the three fetches, and if the summed count is `> 0`, render the popup, play the
   chime, and set the `sessionStorage` flag so it does not repeat this session.
3. **Logout clears the flag.** A genuine new login in the same tab (sign out, sign back in) must
   show the reminder again — `sessionStorage` alone would otherwise suppress it, since it
   persists across a logout/login pair in the same tab.

`sessionStorage` is per-tab and cleared when the tab closes, which is the right lifetime here: a
closed-and-reopened tab is effectively a new session and should remind again; a refresh mid-work
should not.

## UI

A dismissable, non-blocking toast-style card, not a modal — it must not block the admin from
using the rest of the portal while deciding whether to act. Pinned top-right, rendered from the
layout so it floats over whichever admin page is active. One line per non-zero category:

```
3 leave requests pending      → links to /leaves
2 regularizations pending     → links to /regularization
1 OT approval pending         → links to /ot-shortage
                                                    [×]
```

Clicking a line navigates to that page (the popup does not need to close itself first — leaving
the page unmounts the layout's popup state along with it). The `[×]` dismisses without
navigating. No auto-expiry — per the earlier decision, it must stay until read.

## Sound

A short chime bundled at `admin/public/sounds/notification.mp3`, played once via
`new Audio('/sounds/notification.mp3').play()` when the popup mounts, wrapped in
`.catch(() => {})`. Browsers that block autoplay (no matter — login is itself a recent user
gesture, so most should allow it) simply get a silent popup; the sound is enhancement, never a
dependency for the reminder to be useful.

## Error handling

- Any of the three count fetches throwing is caught per-fetch; that category is omitted from the
  popup rather than surfacing an error or blocking the other two.
- If all three fail or all three are zero, nothing renders and no sound plays — same outward
  behavior as "all caught up."
- The chime failing to play never affects popup visibility.

## Testing

No backend or Firestore rules changes. `getPendingOtCount()` gets a unit test alongside the
existing `otAggregate.test.ts` pattern (`npx tsx admin/src/lib/otAggregate.test.ts`), asserting it
agrees with `/ot-shortage`'s own `pendingOt.length` on the same fixture data. Everything else is
manual verification: admin login with zero / some pending items across each category, dismiss
behavior, link navigation, no repeat-pop on refresh within a session, re-pop after logout→login,
and confirming a non-admin (office/operations/sales) role never sees it regardless of their
`tabAccess`.

## Out of scope

- Non-admin managers seeing a popup scoped to their own `tabAccess` — admin-only per the
  requester's explicit choice.
- A cheap, stored "pending OT" signal (e.g. written by the nightly Cloud Function) that would
  let this drop the expensive live attendance scan. Worth doing eventually; not blocking this
  feature, since the cost already exists on the OT page today.
- Any other pending category (material requests, conveyance, submissions) — the requester named
  leaves, regularization, and OT specifically; adding more is a follow-up, not a default.
- Per-category notification preferences (e.g. "don't remind me about OT") — one popup, no
  settings surface, for v1.
