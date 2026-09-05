# Regularization Past-Date Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin open a global window during which employees can file a Regularization request for any past date (not just today), with Firestore rules — not just the app UI — actually enforcing the today-only default and the window-open exception.

**Architecture:** A new `config/regularizationWindow` doc (`{ open: boolean }`) is the single source of truth. `firestore.rules`' `create` rule for `regularization_requests` reads it directly (plus, for past dates, the requesting employee's own `settlements/{month}.locked`) so the gate holds even against direct API calls. The admin portal gets a toggle button that flips the doc. The Android app reads the same doc to decide whether to show a "pick a past date" affordance, then reuses the existing single-day request flow for whatever date comes back.

**Tech Stack:** Firestore Security Rules (rules-language), `@firebase/rules-unit-testing` + Node's built-in `node --test` (rules-tests), Next.js/TypeScript (admin), Kotlin/Jetpack Compose + Hilt + Coroutines/Flow (Android), JUnit (Android unit tests).

**Spec:** `docs/superpowers/specs/2026-09-05-regularization-window-design.md`

## Global Constraints

- Firestore rules are the actual security boundary, not the apps — every rule change in this plan must be proven by `firebase/rules-tests` (`npm test`), which must be run (and pass in full, all files in the directory) before starting and after every rules change.
- The window toggle is **global** (one doc, no per-role/per-employee scoping) and **admin-only** to write; any logged-in user may read it.
- Past-date gating additionally requires the requesting employee's own `users/{uid}/settlements/{yyyy-MM}` doc to not have `locked: true` for that date's month. Missing settlements doc (office/admin/sales, or a not-yet-settled ops month) means NOT locked.
- Future dates are never creatable, window state irrelevant. Today's date is always creatable, window state irrelevant.
- All dates are `"yyyy-MM-dd"` strings compared/derived in IST, computed in rules by shifting `request.time` (UTC) by +05:30 — the same trick `firebase/functions/index.js` already uses with `getUTC*()`, translated to rules-language `Timestamp`/`Duration` arithmetic.
- No deploy step is included in this plan. `firebase deploy --only firestore:rules` (from repo root) is a production action on the live security boundary and must be run by the user explicitly after reviewing the diff — do not run it as part of task execution.

---

### Task 1: Firestore rules — window-gated create rule

**Files:**
- Modify: `firebase/firestore.rules` (helpers block, `~line 5-31`; `config/{docId}` block, `~line 591-596`; `regularization_requests` create rule, `~line 450-460`)
- Test: `firebase/rules-tests/regularization-window.test.js` (new)

**Interfaces:**
- Produces: `config/regularizationWindow` doc shape `{ open: boolean }` — consumed by Task 2 (admin portal) and Task 3 (Android repository).
- Produces: the enforced `create` rule on `users/{userId}/regularization_requests/{docId}` — no app code depends on its internals, only on it accepting/rejecting as designed.

- [ ] **Step 1: Confirm the full existing suite passes before touching anything**

Run: `cd firebase/rules-tests && npm test`
Expected: all current tests PASS (baseline, before any change).

- [ ] **Step 2: Write the new (failing) rules-tests file**

Create `firebase/rules-tests/regularization-window.test.js`:

```js
"use strict";

/**
 * Regularization past-date window — an admin-only global toggle that lets employees file a
 * regularization for a PAST date (normally only today's date is creatable). See
 * docs/superpowers/specs/2026-09-05-regularization-window-design.md.
 *
 * Today-only enforcement was, before this change, a UI-only restriction: the create rule for
 * regularization_requests never inspected `date` at all. These tests cover the real gate.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

// IST "yyyy-MM-dd" for a JS Date, mirroring the +05:30 shift firebase/functions/index.js uses
// and the one the rule itself performs on request.time.
function istDateStr(date) {
  const ist = new Date(date.getTime() + 19800000); // +05:30 in ms
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Pure calendar-day arithmetic on a "yyyy-MM-dd" string (no further timezone shifting needed —
// istDateStr() already resolved the instant to a calendar date).
function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

const TODAY = istDateStr(new Date());
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const YESTERDAY_MONTH = YESTERDAY.slice(0, 7);

function req(userId, date) {
  return { userId, status: "pending", date, reason: "test" };
}

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:  { role: "admin", name: "Admin" },
    emp:    { role: "operations", name: "Employee" },
    other:  { role: "operations", name: "Other Employee" },
    regMgr: { role: "office", name: "Regularization Manager", tabAccess: [TABS.REGULARIZATION] },
  });
});

after(async () => { await teardown(); });

// Explicit baseline before every test — never rely on a doc being absent from a previous test.
beforeEach(async () => {
  await seedDocs(env, {
    "config/regularizationWindow": { open: false },
    [`users/emp/settlements/${YESTERDAY_MONTH}`]: { locked: false },
    [`users/other/settlements/${YESTERDAY_MONTH}`]: { locked: false },
  });
});

test("today's date is always creatable, window closed", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/regularization_requests/r1").set(req("emp", TODAY)));
});

test("a past date is denied when the window is closed", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/regularization_requests/r1").set(req("emp", YESTERDAY)));
});

test("a past date is allowed when the window is open and the month isn't settled", async () => {
  await seedDocs(env, { "config/regularizationWindow": { open: true } });
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/regularization_requests/r1").set(req("emp", YESTERDAY)));
});

test("a past date is denied when the window is open but that employee's month is locked", async () => {
  await seedDocs(env, {
    "config/regularizationWindow": { open: true },
    [`users/emp/settlements/${YESTERDAY_MONTH}`]: { locked: true },
  });
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/regularization_requests/r1").set(req("emp", YESTERDAY)));
});

test("another employee's locked month does not block a different employee", async () => {
  await seedDocs(env, {
    "config/regularizationWindow": { open: true },
    [`users/emp/settlements/${YESTERDAY_MONTH}`]: { locked: true },
  });
  const db = asUser(env, "other");
  await assertSucceeds(db.doc("users/other/regularization_requests/r1").set(req("other", YESTERDAY)));
});

test("a future date is always denied, even with the window open", async () => {
  await seedDocs(env, { "config/regularizationWindow": { open: true } });
  const db = asUser(env, "emp");
  await assertFails(db.doc("users/emp/regularization_requests/r1").set(req("emp", TOMORROW)));
});

test("any logged-in user can read the window config doc", async () => {
  await seedDocs(env, { "config/regularizationWindow": { open: true } });
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("config/regularizationWindow").get());
});

test("only admin can write the window config doc", async () => {
  await assertFails(asUser(env, "regMgr").doc("config/regularizationWindow").set({ open: true }));
  await assertFails(asUser(env, "emp").doc("config/regularizationWindow").set({ open: true }));
  await assertSucceeds(asUser(env, "admin").doc("config/regularizationWindow").set({ open: true }));
});
```

- [ ] **Step 3: Run the new file and confirm the expected tests fail**

Run: `cd firebase/rules-tests && npm test`

Expected: the suite runs every `*.test.js` file in the directory together, so watch specifically for `regularization-window.test.js`'s results. Before the rule change:
- FAIL: "a past date is denied when the window is closed" (nothing currently blocks it)
- FAIL: "a past date is denied when the window is open but that employee's month is locked" (no lock check exists)
- FAIL: "a future date is always denied, even with the window open" (no future check exists)
- FAIL: "any logged-in user can read the window config doc" (the existing `config/{docId}` rule only allows admin or a Conveyance manager to read)
- The remaining new tests already PASS today (no date/lock check exists yet, so nothing currently stops them) — that's expected, they're regression guards for after the fix, not red/green signals.
- All pre-existing test files must still be entirely green — if any of them fail, stop and investigate before proceeding.

- [ ] **Step 4: Add the IST-date and window/lock helpers to `firebase/firestore.rules`**

Insert immediately after the `userTabs()` helper (after line 31, before the `// Attendance events:` comment on line 33):

```
    // Timestamps in rules are zone-less instants. Adding a Duration then reading
    // .year()/.month()/.day() reads the components as if that instant were UTC — the same
    // trick firebase/functions/index.js uses (shift +05:30, read via getUTC*()) to fake an
    // IST calendar date off a UTC clock.
    function pad2(n) {
      return n < 10 ? '0' + string(n) : string(n);
    }

    function todayIST() {
      let ist = request.time + duration.value(19800, 's');
      return string(ist.year()) + '-' + pad2(ist.month()) + '-' + pad2(ist.day());
    }

    // config/regularizationWindow — global admin-controlled toggle (see regularization_requests
    // create rule below). Missing doc == closed, matching the pre-feature default.
    function isRegularizationWindowOpen() {
      return get(/databases/$(database)/documents/config/regularizationWindow)
               .data.get('open', false);
    }

    // True only when userId's OWN settlement for `date`'s month is locked. Office/admin/sales
    // never have a settlements doc (non-ledger roles) and so are never blocked by this.
    function isSettledMonth(userId, date) {
      let month = date[0:7];
      return exists(/databases/$(database)/documents/users/$(userId)/settlements/$(month))
        && get(/databases/$(database)/documents/users/$(userId)/settlements/$(month))
             .data.get('locked', false);
    }
```

- [ ] **Step 5: Add the window-doc rule (before the existing `config/{docId}` block)**

In `firebase/firestore.rules`, immediately before the existing:

```
    match /config/{docId} {
      allow read:  if isLoggedIn() && (isAdmin() || canAccessConveyance());
      allow write: if isLoggedIn() && isAdmin();
    }
```

insert this more specific block (Firestore rules union all matching `allow` statements for a path, so this only WIDENS read access for this one doc — every other doc under `config/` keeps the existing admin-or-Conveyance-manager read):

```
    // ── /config/regularizationWindow — admin-only past-date window toggle ─
    // Read by every logged-in user: the Android app needs this to decide whether to offer a
    // past-date picker at all. Write stays admin-only (see regularization_requests below for
    // the actual enforcement this doc gates).
    match /config/regularizationWindow {
      allow read:  if isLoggedIn();
      allow write: if isLoggedIn() && isAdmin();
    }
```

- [ ] **Step 6: Update the `regularization_requests` create rule**

Replace (around line 450-460):

```
      match /regularization_requests/{docId} {
        allow read:   if isLoggedIn() && (isOwner(userId) || isAdmin() || canAccessRegularization());
        // Must be created pending — only an admin (or Regularization manager) approval may
        // flip the linked attendance_status to Present (done via writeBatch in the portal).
        allow create: if isLoggedIn() && isOwner(userId)
                      && request.resource.data.status == 'pending';
        // notSelf: approving your own regularization flips your own day to Present.
        allow update: if isLoggedIn() && (isAdmin() || (canAccessRegularization() && notSelf(userId)));
        allow delete: if false;
      }
```

with:

```
      match /regularization_requests/{docId} {
        allow read:   if isLoggedIn() && (isOwner(userId) || isAdmin() || canAccessRegularization());
        // Must be created pending — only an admin (or Regularization manager) approval may
        // flip the linked attendance_status to Present (done via writeBatch in the portal).
        //
        // Date gating: today is always allowed. A PAST date additionally needs the admin-only
        // window (config/regularizationWindow) open AND this employee's own month not already
        // Settle & Locked. A FUTURE date is never allowed. See
        // docs/superpowers/specs/2026-09-05-regularization-window-design.md.
        allow create: if isLoggedIn() && isOwner(userId)
                      && request.resource.data.status == 'pending'
                      && request.resource.data.date <= todayIST()
                      && (request.resource.data.date == todayIST()
                          || (isRegularizationWindowOpen()
                              && !isSettledMonth(userId, request.resource.data.date)));
        // notSelf: approving your own regularization flips your own day to Present.
        allow update: if isLoggedIn() && (isAdmin() || (canAccessRegularization() && notSelf(userId)));
        allow delete: if false;
      }
```

- [ ] **Step 7: Run the full rules-tests suite and confirm everything passes**

Run: `cd firebase/rules-tests && npm test`
Expected: every test in every file PASSES, including all of `regularization-window.test.js` and all pre-existing files (baseline, hardening, self-approval, punch, compensation, dailySpend, specialAllowance, system — whatever exists in the directory).

If the `todayIST()`/`isSettledMonth()` syntax doesn't compile (rules deploy/emulator errors on `duration.value`, `.year()`/`.month()`/`.day()`, `string[0:7]` slicing, or `pad2`'s ternary), the emulator's error output names the exact line — fix the syntax and re-run. Do not weaken the logic to work around a syntax error; get the exact rules-language spelling right instead.

- [ ] **Step 8: Commit**

```bash
git add firebase/firestore.rules firebase/rules-tests/regularization-window.test.js
git commit -m "$(cat <<'EOF'
feat(rules): gate regularization_requests create on an admin-controlled past-date window

Today-only was previously enforced only by the Android UI; the create rule never checked
`date` at all, so any signed-in employee could already file a regularization for any date
directly against the API. This adds a real gate: today is always allowed, a past date needs
config/regularizationWindow.open plus an unlocked settlement month for that employee, and a
future date is never allowed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EtywRKhvM9G4MLBXX7627X
EOF
)"
```

---

### Task 2: Admin portal — window toggle

**Files:**
- Modify: `admin/src/lib/firestore.ts` (near the "Conveyance Config" section, `~line 929-942`)
- Modify: `admin/src/app/(admin)/regularization/page.tsx`

**Interfaces:**
- Consumes: `config/regularizationWindow` doc shape from Task 1 (`{ open: boolean }`).
- Produces: `getRegularizationWindow(): Promise<{ open: boolean }>` and `setRegularizationWindowOpen(open: boolean): Promise<void>` in `admin/src/lib/firestore.ts` — used only by this task's page component, no other consumer.

- [ ] **Step 1: Add the read/write functions to `admin/src/lib/firestore.ts`**

Add directly after `setConveyanceConfig` (after line 942):

```ts
// ── Regularization Window ────────────────────────────────────────────────
// Global admin-only toggle: while open, employees may file a regularization for a past
// date (normally only today is allowed) — see firebase/firestore.rules, which is what
// actually enforces this, not this function.

export async function getRegularizationWindow(): Promise<{ open: boolean }> {
  const snap = await getDoc(doc(db, 'config', 'regularizationWindow'));
  return { open: snap.exists() ? snap.data().open === true : false };
}

export async function setRegularizationWindowOpen(open: boolean): Promise<void> {
  await setDoc(doc(db, 'config', 'regularizationWindow'), stamped({ open }));
}
```

- [ ] **Step 2: Type-check by building**

Run: `cd admin && npm run build`
Expected: build succeeds (this also type-checks the whole app — a typo in the new functions surfaces here).

- [ ] **Step 3: Add the toggle UI to the Regularization page**

In `admin/src/app/(admin)/regularization/page.tsx`:

Add to the imports:

```tsx
import { useAccess } from '@/components/AccessContext';
import { getAllRegularizationRequests, approveRegularization, rejectRegularization, getRegularizationWindow, setRegularizationWindowOpen } from '@/lib/firestore';
```

(this replaces the existing narrower `firestore` import line that only pulls in `getAllRegularizationRequests, approveRegularization, rejectRegularization`).

Add state, near the other `useState` declarations:

```tsx
  const { user: portalUser } = useAccess();
  const isAdmin = portalUser?.role === 'admin';
  const [windowOpen, setWindowOpen]     = useState(false);
  const [togglingWindow, setToggling]   = useState(false);
```

Add a loader effect, alongside the existing `adminName` effect:

```tsx
  useEffect(() => {
    getRegularizationWindow().then(w => setWindowOpen(w.open)).catch(() => setWindowOpen(false));
  }, []);
```

Add the handler function, near `handleAction`:

```tsx
  async function handleToggleWindow() {
    const next = !windowOpen;
    if (!next && !window.confirm(
      'Close the regularization window? Employees will only be able to request today\'s date again.'
    )) return;
    setToggling(true);
    try {
      await setRegularizationWindowOpen(next);
      setWindowOpen(next);
    } catch {
      setError('Failed to update the regularization window.');
    }
    setToggling(false);
  }
```

Add the button itself, admin-only, right above the "Month selector" block:

```tsx
      {isAdmin && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-text-secondary">
            Past-date window: <span className={windowOpen ? 'text-green-600 font-semibold' : 'text-text-secondary font-semibold'}>
              {windowOpen ? 'Open' : 'Closed'}
            </span>
          </span>
          <button
            onClick={handleToggleWindow}
            disabled={togglingWindow}
            className={windowOpen ? 'btn-danger text-sm py-1.5 px-3' : 'btn-success text-sm py-1.5 px-3'}
          >
            {windowOpen ? 'Close Window' : 'Open Window'}
          </button>
        </div>
      )}
```

- [ ] **Step 4: Build again to confirm it compiles**

Run: `cd admin && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual check in the dev server**

Run: `cd admin && npm run dev`, sign in as an admin user, open `/regularization`. Confirm:
- The "Past-date window: Closed" indicator and "Open Window" button are visible.
- Clicking it flips to "Open" without a confirm prompt; clicking "Close Window" prompts to confirm first.
- Signing in as a non-admin Regularization-tab manager: the toggle is not rendered at all.

Stop the dev server when done (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
git add admin/src/lib/firestore.ts "admin/src/app/(admin)/regularization/page.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): add admin-only regularization past-date window toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EtywRKhvM9G4MLBXX7627X
EOF
)"
```

---

### Task 3: Android — repository layer (window read + historical status lookup)

**Files:**
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/data/repository/RegularizationRepository.kt`
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/data/repository/FirestoreRegularizationRepository.kt`
- Modify: `android/app/src/test/java/com/raghav/whitecoffee/fake/FakeRegularizationRepository.kt`

**Interfaces:**
- Consumes: `config/regularizationWindow` doc (`{ open: boolean }`) and `users/{uid}/attendance_status/{date}` doc (`{ status: string, ... }`) — both already readable under existing rules for the signed-in owner (Task 1 added the config doc's broad read; `attendance_status` already allows `isOwner(userId)` read).
- Produces on `RegularizationRepository`: `fun observeWindowOpen(): Flow<Boolean>` and `suspend fun getStatusForDate(date: String): String?` — consumed by Task 4 (`RegularizationViewModel`).
- Produces on `FakeRegularizationRepository`: `fun setWindowOpen(open: Boolean)`, `fun setStatusForDate(date: String, status: String?)`, `var failStatusLookup: Exception?` — test-only seams consumed by Task 4's tests.

- [ ] **Step 1: Add the two methods to the `RegularizationRepository` interface**

In `RegularizationRepository.kt`, add inside the interface, after `observeRequestForDate`:

```kotlin
    /** Live read of the admin-controlled past-date window (`config/regularizationWindow`). */
    fun observeWindowOpen(): Flow<Boolean>

    /**
     * The stored daily status for [date] (`users/{uid}/attendance_status/{date}.status`), or
     * null if no such doc exists yet (a Sunday/holiday/unscored day, or a date before the app's
     * status backfill).
     */
    suspend fun getStatusForDate(date: String): String?
```

- [ ] **Step 2: Implement both in `FirestoreRegularizationRepository`**

In `FirestoreRegularizationRepository.kt`, add after the `regCol` property declaration:

```kotlin
    private val statusCol get() = userDoc.collection("attendance_status")
```

Add the two overrides after `observeRequestForDate`:

```kotlin
    override fun observeWindowOpen(): Flow<Boolean> =
        firestore.collection("config").document("regularizationWindow")
            .snapshotsAsFlow()
            .map { it.getBoolean("open") ?: false }

    override suspend fun getStatusForDate(date: String): String? =
        statusCol.document(date).get().await().getString("status")
```

- [ ] **Step 3: Compile**

Run: `cd android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL. (This will currently fail until `FakeRegularizationRepository` also implements the new interface members — do this step and the next together, then compile once.)

- [ ] **Step 4: Extend `FakeRegularizationRepository` with the same surface**

This file has, in order: the constructor + `requests`/`failWith`/`submitted`/`nextId` fields
+ `setRequestForDate`, then `override fun observeRequestForDate`, then
`override suspend fun submitRequest`. Only the first part is touched — do not restate or
otherwise modify `observeRequestForDate` or `submitRequest`; leave both exactly as they are.

Replace exactly this block — everything from `class FakeRegularizationRepository(` up to but
NOT including the `override fun observeRequestForDate` line:

```kotlin
class FakeRegularizationRepository(
    initialRequests: Map<String, RegularizationRequest> = emptyMap()
) : RegularizationRepository {

    private val requests = MutableStateFlow(initialRequests)

    /** When set, every call fails with this error instead of running the normal logic. */
    var failWith: Exception? = null

    /** Every request the subject successfully submitted, in order. */
    val submitted = mutableListOf<RegularizationRequest>()

    private var nextId = 1

    /** Seeds (or clears, with null) the request on file for [date]. */
    fun setRequestForDate(date: String, request: RegularizationRequest?) {
        requests.value = if (request == null) requests.value - date else requests.value + (date to request)
    }
```

with:

```kotlin
class FakeRegularizationRepository(
    initialRequests: Map<String, RegularizationRequest> = emptyMap(),
    windowOpen: Boolean = false,
) : RegularizationRepository {

    private val requests = MutableStateFlow(initialRequests)
    private val windowOpenFlow = MutableStateFlow(windowOpen)
    private val statusByDate = mutableMapOf<String, String>()

    /** When set, every call fails with this error instead of running the normal logic. */
    var failWith: Exception? = null

    /** When set, [getStatusForDate] throws this instead of returning normally. */
    var failStatusLookup: Exception? = null

    /** Every request the subject successfully submitted, in order. */
    val submitted = mutableListOf<RegularizationRequest>()

    private var nextId = 1

    /** Seeds (or clears, with null) the request on file for [date]. */
    fun setRequestForDate(date: String, request: RegularizationRequest?) {
        requests.value = if (request == null) requests.value - date else requests.value + (date to request)
    }

    /** Flips the fake window state; [observeWindowOpen] reflects it immediately. */
    fun setWindowOpen(open: Boolean) { windowOpenFlow.value = open }

    /** Seeds (or clears, with null) the historical status [getStatusForDate] returns for [date]. */
    fun setStatusForDate(date: String, status: String?) {
        if (status == null) statusByDate.remove(date) else statusByDate[date] = status
    }
```

This leaves `override fun observeRequestForDate` immediately following, unmodified. Then
insert the two new overrides right after `observeRequestForDate`'s closing line, before the
`override suspend fun submitRequest` line:

```kotlin
    override fun observeWindowOpen(): Flow<Boolean> = windowOpenFlow

    override suspend fun getStatusForDate(date: String): String? {
        failStatusLookup?.let { throw it }
        return statusByDate[date]
    }
```

`submitRequest` itself is not touched at all.

- [ ] **Step 5: Compile**

Run: `cd android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Run the existing Android unit tests to confirm nothing broke**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.raghav.whitecoffee.ui.attendance.RegularizationViewModelTest"`
Expected: all existing tests still PASS (the new constructor params have defaults, so every existing `FakeRegularizationRepository()` call site is unaffected).

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/raghav/whitecoffee/data/repository/RegularizationRepository.kt \
        android/app/src/main/java/com/raghav/whitecoffee/data/repository/FirestoreRegularizationRepository.kt \
        android/app/src/test/java/com/raghav/whitecoffee/fake/FakeRegularizationRepository.kt
git commit -m "$(cat <<'EOF'
feat(android): add window-open and historical-status reads to RegularizationRepository

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EtywRKhvM9G4MLBXX7627X
EOF
)"
```

---

### Task 4: Android — ViewModel support for picking a past date

**Files:**
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModel.kt`
- Test: `android/app/src/test/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModelTest.kt`

**Interfaces:**
- Consumes: `RegularizationRepository.observeWindowOpen()`, `RegularizationRepository.getStatusForDate(date)`, `RegularizationRepository.observeRequestForDate(date)` (existing) from Task 3.
- Produces: `val isWindowOpen: StateFlow<Boolean>`, `val pickedDateState: StateFlow<UiState<RegularizationDayItem>>`, `fun loadForDate(date: String)`, `fun resetPickedDateState()` — consumed by Task 5 (`RegularizationFragment`/`RegularizationScreen`).

- [ ] **Step 1: Write the failing tests**

Add to `RegularizationViewModelTest.kt`, in a new section after "submit":

```kotlin
    // ── past-date window ─────────────────────────────────────────────────

    @Test
    fun `isWindowOpen mirrors the repository`() = runTest(dispatcher) {
        repo = FakeRegularizationRepository(windowOpen = true)
        val vm = subject()
        advanceUntilIdle()

        assertTrue(vm.isWindowOpen.value)
    }

    @Test
    fun `loadForDate reports Unmarked when there is no stored status`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.loadForDate("2026-07-01")
        advanceUntilIdle()

        val state = vm.pickedDateState.value
        assertTrue(state is UiState.Success)
        val item = (state as UiState.Success).data
        assertEquals("2026-07-01", item.date)
        assertEquals("Unmarked", item.originalStatus)
        assertEquals(null, item.request)
    }

    @Test
    fun `loadForDate surfaces the stored status and any existing request`() = runTest(dispatcher) {
        repo.setStatusForDate("2026-07-01", "Absent")
        val existing = RegularizationRequest(
            id = "r1", date = "2026-07-01", originalStatus = "Absent", reason = "Sick", status = "pending"
        )
        repo.setRequestForDate("2026-07-01", existing)
        val vm = subject()
        advanceUntilIdle()

        vm.loadForDate("2026-07-01")
        advanceUntilIdle()

        val item = (vm.pickedDateState.value as UiState.Success).data
        assertEquals("Absent", item.originalStatus)
        assertEquals(existing, item.request)
    }

    @Test
    fun `loadForDate surfaces an error when the lookup fails`() = runTest(dispatcher) {
        repo.failStatusLookup = IllegalStateException("offline")
        val vm = subject()
        advanceUntilIdle()

        vm.loadForDate("2026-07-01")
        advanceUntilIdle()

        assertTrue(vm.pickedDateState.value is UiState.Error)
    }

    @Test
    fun `resetPickedDateState clears a previous result`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.loadForDate("2026-07-01")
        advanceUntilIdle()
        assertTrue(vm.pickedDateState.value is UiState.Success)

        vm.resetPickedDateState()

        assertTrue(vm.pickedDateState.value is UiState.Empty)
    }
```

- [ ] **Step 2: Run the tests and confirm they fail to compile / fail**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.raghav.whitecoffee.ui.attendance.RegularizationViewModelTest"`
Expected: compile failure — `isWindowOpen`, `pickedDateState`, `loadForDate`, `resetPickedDateState` don't exist yet on `RegularizationViewModel`, and `FakeRegularizationRepository(windowOpen = true)` needs the constructor param added in Task 3 Step 4 (already done).

- [ ] **Step 3: Add the new state and functions to `RegularizationViewModel`**

Add after the `submitState` declaration:

```kotlin
    val isWindowOpen: StateFlow<Boolean> = repository.observeWindowOpen()
        .catch { emit(false) } // never fail open — a load error must not unlock past dates
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    private val _pickedDateState = MutableStateFlow<UiState<RegularizationDayItem>>(UiState.Empty)
    val pickedDateState: StateFlow<UiState<RegularizationDayItem>> = _pickedDateState.asStateFlow()
```

Add after `submitRequest`:

```kotlin
    /** Loads the flaggable item for an arbitrary past [date] picked by the user, for the same
     * request dialog `loadToday()`'s items already use. */
    fun loadForDate(date: String) {
        viewModelScope.launch {
            _pickedDateState.value = UiState.Loading()
            try {
                val status = repository.getStatusForDate(date) ?: "Unmarked"
                val existing = repository.observeRequestForDate(date).first()
                _pickedDateState.value = UiState.Success(
                    RegularizationDayItem(
                        date = date,
                        dayOfWeek = getDayOfWeek(date),
                        originalStatus = status,
                        request = existing
                    )
                )
            } catch (e: Exception) {
                _pickedDateState.value = UiState.Error("Couldn't load that date.")
            }
        }
    }

    fun resetPickedDateState() {
        _pickedDateState.value = UiState.Empty
    }
```

Add `kotlinx.coroutines.flow.first` to the imports (`import kotlinx.coroutines.flow.first`).

- [ ] **Step 4: Run the tests again and confirm they pass**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.raghav.whitecoffee.ui.attendance.RegularizationViewModelTest"`
Expected: all tests in the file PASS, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModel.kt \
        android/app/src/test/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModelTest.kt
git commit -m "$(cat <<'EOF'
feat(android): add loadForDate/isWindowOpen to RegularizationViewModel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EtywRKhvM9G4MLBXX7627X
EOF
)"
```

---

### Task 5: Android — date-picker UI

**Files:**
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationScreen.kt`
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationFragment.kt`

**Interfaces:**
- Consumes: `RegularizationViewModel.isWindowOpen`, `.pickedDateState`, `.loadForDate(date)`, `.resetPickedDateState()` from Task 4.
- Produces: nothing further consumed elsewhere — this is the leaf UI.

This task has no automated test (no Compose UI tests exist anywhere in this codebase today — verification is a compile + manual pass, matching the existing pattern for every other screen in this module).

- [ ] **Step 1: Add the "Request for another date" affordance to `RegularizationScreen`**

Add `isWindowOpen: Boolean` and `onPickPastDate: () -> Unit` parameters to `RegularizationScreen`'s signature:

```kotlin
@Composable
fun RegularizationScreen(
    state: UiState<List<RegularizationDayItem>>,
    todayLabel: String,
    isOnline: Boolean,
    isWindowOpen: Boolean,
    onBack: () -> Unit,
    onRequest: (RegularizationDayItem) -> Unit,
    onRetry: () -> Unit,
    onPickPastDate: () -> Unit,
) = WhiteCoffeeTheme {
```

Add, right after the closing `}` of the `when (state) { ... }` block and before the closing of its enclosing `Column`:

```kotlin
            if (isWindowOpen) {
                Spacer(Modifier.height(20.dp))
                WcPrimaryButton(
                    text = "Request for another date",
                    icon = Ms.event_available,
                    onClick = onPickPastDate,
                )
            }
```

- [ ] **Step 2: Wire it up in `RegularizationFragment`**

No new imports are needed — the picker function below uses fully-qualified `java.util.Calendar`/`android.app.DatePickerDialog`, matching `LeaveFragment.showDatePicker`'s style, and everything else (`Toast`, `LaunchedEffect`, `UiState`) is already imported in this file.

Inside `setContent { ... }`, alongside the other `collectAsStateWithLifecycle()` calls:

```kotlin
            val isWindowOpen by viewModel.isWindowOpen.collectAsStateWithLifecycle()
            val pickedDate by viewModel.pickedDateState.collectAsStateWithLifecycle()
```

Add a `LaunchedEffect` alongside the existing `submit` one:

```kotlin
            LaunchedEffect(pickedDate) {
                when (val p = pickedDate) {
                    is UiState.Success -> {
                        dialogItem = p.data
                        reason = ""
                        viewModel.resetPickedDateState()
                    }
                    is UiState.Error -> {
                        Toast.makeText(requireContext(), p.message, Toast.LENGTH_LONG).show()
                        viewModel.resetPickedDateState()
                    }
                    else -> {}
                }
            }
```

Pass the two new params to `RegularizationScreen`:

```kotlin
            RegularizationScreen(
                state = state,
                todayLabel = todayLabel,
                isOnline = isOnline,
                isWindowOpen = isWindowOpen,
                onBack = { findNavController().navigateUp() },
                onRequest = { dialogItem = it; reason = "" },
                onRetry = { viewModel.loadToday() },
                onPickPastDate = { showPastDatePicker { date -> viewModel.loadForDate(date) } },
            )
```

Add the picker function, alongside the fragment's `companion object` (mirroring `LeaveFragment.showDatePicker`, capped so today/future can't be picked — today is already covered by the main flow, and a future date is always rejected by the rules regardless):

```kotlin
    private fun showPastDatePicker(onDate: (String) -> Unit) {
        val cal = java.util.Calendar.getInstance()
        val dialog = android.app.DatePickerDialog(
            requireContext(),
            { _, year, month, day -> onDate(String.format("%04d-%02d-%02d", year, month + 1, day)) },
            cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH),
        )
        cal.add(java.util.Calendar.DAY_OF_MONTH, -1)
        dialog.datePicker.maxDate = cal.timeInMillis
        dialog.show()
    }
```

- [ ] **Step 3: Compile**

Run: `cd android && ./gradlew :app:compileDebugKotlin`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Manual verification on a device/emulator**

With the admin toggle from Task 2 available:
1. Leave the window closed. Open the Regularization screen — confirm no "Request for another date" button appears, only today's card behaves as before.
2. Open the window from the admin portal. Reopen (or leave open, since the app observes it live via `snapshotsAsFlow`) the Regularization screen — confirm the button now appears.
3. Tap it, pick a date more than a day in the past that has a known bad status (e.g. a day you know is `Absent` in Firestore) — confirm the dialog opens pre-filled with that status, submit a reason, confirm the request is created (check `users/{uid}/regularization_requests` in the Firebase console).
4. Pick a date within a settlement-locked month for an operations employee (if one exists in test data) — confirm submission fails with a visible error (the generic Firebase permission-denied message is acceptable here; the friendlier message mentioned in the spec's Error Handling section is optional and out of scope for this plan).
5. Close the window from the admin portal — confirm the button disappears from the Android screen without needing to restart the app.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationScreen.kt \
        android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationFragment.kt
git commit -m "$(cat <<'EOF'
feat(android): add past-date picker to the Regularization screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EtywRKhvM9G4MLBXX7627X
EOF
)"
```
