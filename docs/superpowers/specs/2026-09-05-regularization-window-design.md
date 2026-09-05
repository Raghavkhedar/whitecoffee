# Regularization Past-Date Window — Design

## Problem

Today an employee can only ever request a regularization for **today's** date. The
Android Regularization screen (`RegularizationViewModel.loadToday()`) computes a single
`RegularizationDayItem` for today from live punch data and that's the only date the
"Request correction" button ever fires for. An admin wants the ability to open a window
during which employees can also regularize **past** dates (e.g. after a payroll review
turns up a batch of missed punches), then close it again so the app snaps back to
today-only.

Critically, that "today-only" rule is currently enforced **only by the Android UI** —
`firestore.rules`' `create` rule for `regularization_requests` never inspects `date` at
all. Per this repo's own security model, the rules ARE the defence (see root
`CLAUDE.md`); a UI-only restriction is not a restriction, since any signed-in employee
can already write a `regularization_requests` doc for any date directly against the API
today. This design closes that gap as part of adding the window feature, rather than
adding a second toggle on top of an unenforced rule.

## Decisions (confirmed with user)

- **Who can toggle the window**: admin only (not extended to Regularization-tab
  managers).
- **Scope**: one global on/off switch, not per-role or per-employee.
- **Past-date ceiling**: any past date is requestable while open, EXCEPT a date whose
  month is already `locked` in that employee's own `users/{uid}/settlements/{YYYY-MM}`
  doc (Settle & Lock on OT Settlements). This only constrains operations employees —
  office/admin/sales never have a `settlements` doc, so they're unrestricted by this
  clause whenever the window is open.
- **Future dates**: never allowed, window or no window. (New — closes the same
  previously-unenforced gap; there is no legitimate reason to pre-file a correction for
  a day that hasn't happened.)

## Data model

New doc: `config/regularizationWindow`

```
{
  open: boolean,
  openedBy: string | null,   // admin name, stamped like other admin actions
  openedAt: Timestamp | null,
  closedBy: string | null,
  closedAt: Timestamp | null,
}
```

Missing doc == closed (`open` defaults to `false` when absent, so a fresh/unconfigured
environment behaves exactly like today).

No changes to `RegularizationRequest` itself — `date`/`originalStatus`/`reason` already
work for any date; only the create-time gate changes.

## Firestore rules (`firebase/firestore.rules`)

### New helpers

```
// Timestamps in rules are zone-less instants; adding a Duration and then reading
// .year()/.month()/.day() reads the components as if that instant were UTC — exactly
// how the Cloud Functions fake IST by shifting +05:30 and calling getUTC*() (see
// firebase/functions/index.js). Same trick, rules-language arithmetic instead of JS.
function pad2(n) {
  return n < 10 ? '0' + string(n) : string(n);
}

function todayIST() {
  let ist = request.time + duration.value(19800, 's');
  return string(ist.year()) + '-' + pad2(ist.month()) + '-' + pad2(ist.day());
}
```

This needs to be run against the emulator during implementation to confirm the exact
method names/return types on this Firestore rules-language version, but the approach
(Timestamp + Duration arithmetic, then `.year()`/`.month()`/`.day()`, `string()` casts,
ternary padding) is a standard, documented pattern for this exact "read a different
timezone's date" problem. It gets its own dedicated rules-tests cases (below) covering
the day boundary (e.g. 18:29 UTC vs 18:31 UTC, either side of IST midnight).

```
function isRegularizationWindowOpen() {
  return get(/databases/$(database)/documents/config/regularizationWindow)
           .data.get('open', false);
}

// True only when the employee has a LOCKED settlement covering `date`'s month.
// Missing settlements doc (office/admin/sales, or a not-yet-settled ops month) => false.
function isSettledMonth(userId, date) {
  let month = date[0:7]; // "yyyy-MM-dd" -> "yyyy-MM"
  return exists(/databases/$(database)/documents/users/$(userId)/settlements/$(month))
    && get(/databases/$(database)/documents/users/$(userId)/settlements/$(month))
         .data.get('locked', false);
}
```

### Updated create rule

```
match /regularization_requests/{docId} {
  allow read:   if isLoggedIn() && (isOwner(userId) || isAdmin() || canAccessRegularization());
  allow create: if isLoggedIn() && isOwner(userId)
                && request.resource.data.status == 'pending'
                && request.resource.data.date <= todayIST()
                && (request.resource.data.date == todayIST()
                    || (isRegularizationWindowOpen()
                        && !isSettledMonth(userId, request.resource.data.date)));
  allow update: if isLoggedIn() && (isAdmin() || (canAccessRegularization() && notSelf(userId)));
  allow delete: if false;
}
```

`date <= todayIST()` relies on `"yyyy-MM-dd"` sorting lexicographically the same as
chronologically (already true everywhere else in this codebase that compares date
strings).

### New config doc rule

`config/{docId}` already exists (conveyance rates) with `write: isAdmin()`. Add a more
specific match ahead of it for the window doc, since employees need read access this
existing rule doesn't grant (Firestore unions matching `allow` statements across
blocks, so this only *widens* access for this one doc, never narrows the existing one):

```
match /config/regularizationWindow {
  allow read:  if isLoggedIn();
  allow write: if isLoggedIn() && isAdmin();
}
```

## Admin portal (`admin/src/`)

- `src/lib/firestore.ts`: add `getRegularizationWindow()` (one-shot `getDoc`) and
  `setRegularizationWindowOpen(open: boolean, adminName: string)` (stamped `setDoc`,
  writing `openedBy`/`openedAt` or `closedBy`/`closedAt` depending on direction).
- `src/app/(admin)/regularization/page.tsx`: an Open/Close toggle button, gated on
  `useAccess().user.role === 'admin'` (same admin-only gating precedent as Leaves'
  "Cancel leave" — a Regularization-tab manager who isn't admin never sees it). Shows
  current state; confirms before closing (closing mid-review isn't destructive to
  existing pending requests, only forward-looking, but a manager should still see the
  state change land).

## Android (`android/app/src/main/java/com/raghav/whitecoffee/`)

- `data/repository/RegularizationRepository.kt`: add
  `fun observeWindowOpen(): Flow<Boolean>` and
  `suspend fun getStatusForDate(date: String): String?` (reads
  `users/{uid}/attendance_status/{date}`, returning the status string or `null` if no
  doc — a Sunday/holiday/unscored day). The Screen renders `null` as `"Unmarked"` in
  place of `originalStatus`.
- `FirestoreRegularizationRepository`: implement both against `config/regularizationWindow`
  and the existing `attendance_status` subcollection respectively.
- `ui/attendance/RegularizationViewModel.kt`: expose `isWindowOpen: StateFlow<Boolean>`;
  add `fun loadForDate(date: String)` that fetches `getStatusForDate` + a one-shot check
  for an existing request on that date (reuse `observeRequestForDate`'s query, `.first()`
  it instead of collecting), producing a single `RegularizationDayItem` the same shape
  `loadToday()` already produces — the existing `WcDialog` reason-entry flow in
  `RegularizationFragment.kt` needs no changes, it already takes an arbitrary
  `RegularizationDayItem`.
- `ui/attendance/RegularizationScreen.kt`: when `isWindowOpen`, show a
  "Request for another date" row below the flagged-today section that opens a native
  `DatePickerDialog` capped at yesterday (`maxDate = today - 1 day`); `onDateSelected`
  calls `viewModel.loadForDate(date)` and opens the existing dialog once it resolves.
- No changes needed to `RegularizationRequest.kt` or the duplicate-prevention logic in
  `submitRequest` — both are already date-generic.

## Error handling

- Rules deny (window closed / settled month / future date) surface to the employee as
  the existing generic Firestore `PERMISSION_DENIED` → the repository's `catch` block
  already turns any exception into `Result.failure`; the ViewModel's existing
  `UiState.Error` path handles it. No new error message is strictly required, but a
  friendlier one ("Regularization for past dates is currently closed.") is worth adding
  in `FirestoreRegularizationRepository.submitRequest` by catching
  `FirebaseFirestoreException.Code.PERMISSION_DENIED` specifically — otherwise the
  employee sees a generic Firebase error string.
- If `config/regularizationWindow` fails to load (offline, first launch), treat as
  closed (`observeWindowOpen()` should default `false` on error/missing, matching the
  rules' own default) — never fail open.

## Testing

`firebase/rules-tests` (must run and pass in full, before and after — see root
`CLAUDE.md`):

- New `regularization-window.test.js`:
  - Create for today: always succeeds, window doc absent or closed.
  - Create for a past date with the window doc absent/`open:false`: fails.
  - Create for a past date with `open:true`, no settlements doc for that month: succeeds.
  - Create for a past date with `open:true`, `settlements/{month}.locked:true` for that
    employee: fails.
  - Create for a past date with `open:true` in a month that's a **different**
    employee's locked month: succeeds (the lock check is scoped to the requester, not
    global).
  - Create for a future date: fails, window state irrelevant.
  - IST day-boundary case: two `request.time` values straddling IST midnight, asserting
    `date == todayIST()` flips at the right UTC instant.
  - Non-admin (including a Regularization-tab manager) cannot write
    `config/regularizationWindow`; any logged-in user can read it.
- Full existing suite (72 tests) re-run unaffected — no existing test exercises
  `create` on `regularization_requests` today (confirmed: existing fixtures seed via
  `seedDocs`, which bypasses rules), so this is additive risk only.

Android: extend `RegularizationViewModelTest.kt` / `FakeRegularizationRepository.kt`
with the new `observeWindowOpen`/`getStatusForDate`/`loadForDate` surface. Manual pass
in the emulator/device once implemented: toggle window in the portal, verify the
Android date picker appears/disappears live.

## Out of scope

- Per-role or per-employee window scoping.
- Letting a Regularization-tab manager (non-admin) toggle the window.
- Any UI for browsing a *list* of past flagged days — the employee picks a date
  explicitly rather than being shown a pre-computed list of bad days, keeping this
  change to a single new repository read per pick rather than a range scan.
- Blocking a past date for office/admin/sales based on any "already paid" concept —
  none exists for those roles today, and inventing one is a separate decision.
