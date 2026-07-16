# App-wide Live Sync — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan
**Author:** Raghav Khedar (with Claude)

---

## Problem

The Android app reads almost all backend data with one-shot Firestore `.get()` calls,
cached in memory / `SharedPreferences`. Nothing re-fetches during a session, so a change
made in the admin portal is invisible in the app until the user leaves and re-enters a
screen — or, for identity data (role, account status), until they fully log out and back
in.

The concrete trigger: **account suspension/restore** (`setUserActive` Cloud Function sets
`active: false/true` on `users/{uid}` plus Firebase Auth `disabled`). The Android app does
not read `active` at all today, so a suspended employee keeps using the app, and a restore
is not reflected without a re-login.

**Goal:** as soon as something changes on the backend, it reflects in the app — app-wide,
including an account suspend/restore that blocks/unblocks the app instantly with no
re-login.

## Decisions locked during brainstorming

- **Scope:** everything, every screen (all reads become live), delivered as a reusable
  pattern rather than N bespoke rewrites.
- **Suspend UX:** a full-screen, non-dismissable block that **auto-lifts** the moment the
  account is restored — no re-login.
- **Role:** live role re-routing is **out of scope**. Role stays applied at next login.
- **Delivery:** Approach A (reactive repository layer), **phased** — Phase 1 account-status
  block, Phase 2 screen conversion. One spec (this doc) covers both.
- **Optimistic updates:** **replaced** by the live listener (see Phase 2).

## Approach (chosen: A — reactive repository layer)

Rejected alternatives:
- **B — per-screen bespoke `addSnapshotListener`:** copy-pasted listener boilerplate +
  teardown in every ViewModel, listener-leak risk, inconsistent behavior. (This is the
  duplication tech-debt #4 already warns about.)
- **C — FCM push-triggered refetch:** needs a Cloud Function per change type, not truly
  instant, no offline support, and can't reliably drive the account block.

### Key insight

Fragments already observe ViewModel `StateFlow`s reactively via
`collectAsStateWithLifecycle`. The only non-live link in the whole app is
**repository → ViewModel** (the one-shot `.get()`). Convert that single link to a `Flow`
and everything downstream becomes live for free. This is what makes "everything" tractable.

---

## Section 1 — The core primitive

New file `data/firestore/FirestoreFlow.kt`:

```kotlin
fun Query.snapshotsAsFlow(): Flow<QuerySnapshot>
fun DocumentReference.snapshotsAsFlow(): Flow<DocumentSnapshot>
```

Each wraps `addSnapshotListener` in `callbackFlow { … awaitClose { registration.remove() } }`,
forwards snapshots, and closes the flow on listener error. This is the **only** place
`addSnapshotListener` is written for data reads — everything composes on top.

**Listener lifecycle / cost control:** ViewModels collect with
`stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)`. A screen's
listener attaches when the screen is observed and detaches ~5 s after it stops. Only
**visible** screens hold listeners, bounding battery and Firestore read cost even at
app-wide scope. There are no always-on background listeners (the one exception is the
single shared user-doc listener in `MainViewModel`, which already exists).

---

## Section 2 — Phase 1: Account-status live block

**Data model** (`User`): add `active: Boolean = true`, plus display fields
`suspendedReason: String = ""`, `suspendedBy: String = ""`, `expectedReturn: String = ""`.
Parsed defensively in `fromDocument` — a missing `active` field is treated as active, so
existing user docs don't break.

**Listener:** extend the existing `MainViewModel.startMonitor()` user-doc snapshot listener
(it already parses that snapshot for `activeSessionToken`) to also read `active` + the
suspension fields and publish:

```kotlin
sealed interface AccountStatus {
    data object Active : AccountStatus
    data class Suspended(val reason: String, val expectedReturn: String) : AccountStatus
}
val accountStatus: StateFlow<AccountStatus>
```

**UI:** an overlay `ComposeView` layered above `nav_host_fragment` in `activity_main.xml`,
collected in `MainActivity`.
- `Suspended` → full-screen non-dismissable block (teal design system): reason,
  expected-return if present, and a "Contact your administrator" line.
- `Active` → overlay absent.

Because the block is an overlay (not navigation), a restore simply removes it and the user
is exactly where they were — **auto-lift, no re-login**.

**Cold-start:** on launch a suspended user restores from cache as locally "active"; the
listener's first snapshot corrects this within a moment and the block appears. If the first
snapshot already has `active == false`, block immediately.

**Interplay with Auth `disabled`:** suspension also sets Firebase Auth `disabled: true`,
but that alone can't reliably eject an offline-first session (token refresh is lazy) —
which is exactly why the Firestore-field listener is the real mechanism. Restore flips
`active: true` (listener lifts the block) and re-enables Auth (future token refreshes
succeed). The client does not depend on the Auth flag.

---

## Section 3 — Phase 2: Reactive repositories + optimistic reconciliation

Repositories gain `observeX(): Flow<…>` methods built on the primitive; ViewModels swap
their one-shot `loadX()` for collecting the flow into their existing `StateFlow`s. **No
Fragment/Compose changes** — they already observe the ViewModel StateFlows.

**Optimistic updates → replaced by the live listener.** Firestore fires snapshot listeners
from the local cache immediately on a local write, including offline (with
`hasPendingWrites = true`) — so the listener gives the same instant feedback the optimistic
code was written for, from a single source of truth.

- **Both recent attendance fixes survive:** `deriveAttendanceState` (home-out sticky) and
  `isEventAllowed` (write-time guard) are pure functions over the events list regardless of
  its source; the guard reads state that is now listener-fed. The existing
  `AttendanceRecordTest` continues to pin this behavior and is re-run after the swap.
- **Removes fragile code:** the revert-on-failure branch in `confirmMarketCheckIn` only ever
  reverted in-memory optimistic state, never the committed `site_out` doc. With the listener
  showing truth, that branch is deleted.

---

## Section 4 — Surfaces this lights up ("what other places")

Best value first:

1. **Leave request status** — My Leaves flips pending → approved/rejected live.
2. **Regularization outcome** — approved status + admin comment appear live.
3. **Notifications** — bell badge + list update live.
4. **Attendance timeline** — reflects auto-checkout / multi-device writes live.
5. **Home "today status" chip** — updates when a regularization elsewhere changes
   `attendance_status`.
6. **Leave Approvals (admin)** — new requests stream in without re-entering the screen.
7. **Salary rate / plBalance / employeeId** — folded into the same user-doc listener
   (cheap), keeping previews fresh.

**Out of scope:** live role re-routing (role applied at next login); M&T
request/purchase/transfer approval views (per KEY DECISION #15 there are no in-app
submission-history screens to make live).

---

## Section 5 — Error handling, testing, cost

- **Errors:** a listener error closes its flow; the ViewModel maps to the existing
  `UiState.Error`. Offline shows cached data plus the existing offline banner (unchanged).
- **Testing:**
  - `.asFlow()` primitive — unit-tested with a fake `Query`/`DocumentReference`: emits on
    snapshot, removes the registration on cancellation.
  - Account-status mapping (`snapshot → AccountStatus`) — its own unit tests.
  - Attendance pure-function tests (`deriveAttendanceState`, `isEventAllowed`) — kept and
    re-run after the optimistic-update swap.
- **Cost:** `WhileSubscribed(5000)` + one shared user-doc listener. No always-on background
  listeners. Conscious read-cost trade-off for instant sync, documented here.

---

## Phasing / rollout

- **Phase 1 — account-status live block:** primitive (`FirestoreFlow.kt`), `User` model
  fields, `MainViewModel` listener extension + `AccountStatus`, `MainActivity` overlay,
  cold-start gate, tests. Ships independently and delivers the driving requirement.
- **Phase 2 — reactive repositories:** convert screens one at a time using the primitive —
  attendance (with optimistic-update removal), leave, regularization, notifications, home
  today-status, leave approvals. Each screen is an isolated change with its ViewModel test
  kept green.

## Non-goals

- Live role re-routing.
- Push/FCM-based change delivery.
- In-app submission-history screens.
- Any change to the admin portal or Cloud Functions (this is Android-only; `active` and all
  fields are already written by the existing `setUserActive`).
