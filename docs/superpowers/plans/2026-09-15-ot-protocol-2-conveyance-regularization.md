# Implementation Plan — OT Protocol 2: regularization can correct conveyance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee claim, and an admin (or Conveyance-tab manager) adjust and approve,
a KM figure for a missed-punch day, so regularizing that day fixes conveyance the same way it
already fixes salary/OT — instead of leaving conveyance silently wrong forever.

**Architecture:** Extend the existing employee-files / admin-approves regularization flow with
one optional field (`claimedKm`) carried on the request, editable in the same approval modal
that already edits effective in/out times. On approval, if a km value is present and the
target employee's role earns conveyance, `approveRegularization`'s existing atomic batch gains
one more write: `conveyance/{userId}__{date}`, stamped `markedBy: 'admin'` so the nightly
`exportToSheets` conveyance computation — which knows nothing about `attendance_status` and
never will — skips that date instead of silently overwriting the fix the same night.

**Tech Stack:** Next.js/TypeScript admin portal, Firebase Cloud Functions (Node), Firestore
security rules, Android/Kotlin (Compose + Hilt).

**Spec:** `docs/superpowers/specs/2026-09-14-ot-redesign-design.md`, section
`## Protocol 2 — regularization can correct conveyance for a missed-punch day, not just OT/status`
(approved 2026-09-15). The spec is the authority; this plan is its argument.

## Global Constraints

- **Scope: operations and sales only**, matching `usesConveyance(role)` — never write a
  conveyance doc for office/admin, even if a km value is somehow present on their request.
- **No rules change.** `firestore.rules:677-683` already permits `isAdmin()` or a
  Conveyance-tab manager (with `notSelfDoc()`) to create/update `conveyance/{docId}`. This
  protocol is that rule's first real caller — do not touch `firestore.rules` in this plan.
- **The km field must only ever be shown/sent by an admin or a Conveyance-tab holder.** A
  Firestore batch fails atomically if any one document write in it fails its rule — a
  Regularization-only manager's whole approval (including the harmless status write) would be
  rejected if the batch ever included a conveyance write they're not allowed to make. Gate the
  UI on `isAdmin || tabAccess.includes('/conveyance')`, the same check `/conveyance` itself uses.
- **Full overwrite, not merge-in.** The written conveyance doc replaces that date's figure
  entirely, same principle as the existing OT/status override.
- **No shared build graph.** `admin/`, `firebase/functions/`, and `android/` each need their own
  edit; nothing here is auto-mirrored.
- **Verification commands.**
  - admin: `cd admin && npm run build`
  - functions: `cd firebase/functions && node --check index.js && npm test`
    (eslint is stale — do NOT run lint)
  - rules: `cd firebase/rules-tests && npm test` (regression run — no rule is changing, but this
    is the dormant conveyance rule's first production caller)
  - android: `cd android && ./gradlew :app:compileDebugKotlin && ./gradlew :app:testDebugUnitTest --rerun-tasks`
- **Commit per task**, message ending with the attribution lines used elsewhere in this repo.

---

## Task 1 — Types: `claimedKm` on the request, `markedBy` on the conveyance record

**Files:**
- Modify: `admin/src/types/index.ts:160-174` (`RegularizationRequest`), `:301-313`
  (`ConveyanceRecord`)
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/data/model/RegularizationRequest.kt`

**Interfaces:**
- Produces: `RegularizationRequest.claimedKm?: number` (TS) / `claimedKm: Double? = null`
  (Kotlin) — the employee's self-reported travel distance for the day, read by Task 3's UI and
  written by Task 5's submission flow.
- Produces: `ConveyanceRecord.markedBy?: string` (TS) — read nowhere yet in this plan, but the
  field now genuinely exists on written docs so the type must describe it.

- [ ] **Step 1: admin types**

In `admin/src/types/index.ts`, add one field to `RegularizationRequest` (after `approvedStatus`):

```typescript
  approvedStatus?: string;
  claimedKm?: number; // employee-claimed travel distance for a missed-punch day (Protocol 2)
  submittedAt?: Timestamp;
```

And one field to `ConveyanceRecord` (after `conveyance`):

```typescript
  conveyance: number;
  markedBy?: string; // 'admin' when set via a regularization approval (Protocol 2) — the
                      // nightly exportToSheets computation skips a doc stamped this way
  computedAt?: Timestamp;
```

- [ ] **Step 2: Android model**

In `RegularizationRequest.kt`, add the field to the data class, `toMap()`, and
`fromDocument()`:

```kotlin
data class RegularizationRequest(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val date: String = "",
    val originalStatus: String = "",
    val reason: String = "",
    val status: String = "pending",
    val approvedBy: String = "",
    val approverComment: String = "",
    val approvedStatus: String = "",
    val claimedKm: Double? = null,
    val submittedAt: Timestamp? = null,
    val reviewedAt: Timestamp? = null
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"          to userId,
        "userName"        to userName,
        "employeeId"      to employeeId,
        "date"            to date,
        "originalStatus"  to originalStatus,
        "reason"          to reason,
        "status"          to status,
        "approvedBy"      to approvedBy,
        "approverComment" to approverComment,
        "approvedStatus"  to approvedStatus,
        "claimedKm"       to claimedKm,
        "submittedAt"     to submittedAt,
        "reviewedAt"      to reviewedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): RegularizationRequest? {
            return try {
                RegularizationRequest(
                    id              = doc.id,
                    userId          = doc.getString("userId") ?: return null,
                    userName        = doc.getString("userName") ?: "",
                    employeeId      = doc.getString("employeeId") ?: "",
                    date            = doc.getString("date") ?: "",
                    originalStatus  = doc.getString("originalStatus") ?: "",
                    reason          = doc.getString("reason") ?: "",
                    status          = doc.getString("status") ?: "pending",
                    approvedBy      = doc.getString("approvedBy") ?: "",
                    approverComment = doc.getString("approverComment") ?: "",
                    approvedStatus  = doc.getString("approvedStatus") ?: "",
                    claimedKm       = doc.getDouble("claimedKm"),
                    submittedAt     = doc.getTimestamp("submittedAt"),
                    reviewedAt      = doc.getTimestamp("reviewedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd admin && npm run build
cd ../android && ./gradlew :app:compileDebugKotlin --console=plain
```

Both must succeed with no unused-field or type errors (nothing reads `claimedKm`/`markedBy` yet,
so this step only proves the shapes compile).

```bash
git add admin/src/types/index.ts android/app/src/main/java/com/raghav/whitecoffee/data/model/RegularizationRequest.kt
git commit -m "feat(protocol-2): add claimedKm to RegularizationRequest, markedBy to ConveyanceRecord

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2 — Android: employee can claim KM when filing a request

**Files:**
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/data/repository/RegularizationRepository.kt`
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/data/repository/FirestoreRegularizationRepository.kt`
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModel.kt`
- Modify: `android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationFragment.kt`
- Modify: `android/app/src/test/java/com/raghav/whitecoffee/fake/FakeRegularizationRepository.kt`
- Modify: `android/app/src/test/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModelTest.kt`

**Interfaces:**
- Consumes: `RegularizationRequest.claimedKm` (Task 1).
- Produces: `RegularizationRepository.submitRequest(date, originalStatus, reason, claimedKm: Double? = null): Result<String>`
  and `RegularizationViewModel.submitRequest(date, originalStatus, reason, claimedKm: Double? = null)`
  — both keep their old 3-arg call sites source-compatible via the default.
- Produces: `RegularizationViewModel.canClaimConveyance: Boolean` — read by the Fragment (Task 2)
  and nothing else in this plan.

- [ ] **Step 1: repository interface**

In `RegularizationRepository.kt`, add the parameter to `submitRequest` with an update to its doc
comment:

```kotlin
    /**
     * Submits a request for [date]. Fails if the reason is blank, if a pending or already
     * approved request exists for that date (duplicate prevention lives here, not in the UI),
     * or if [date] is a Protocol 1 rest day (a Sunday, or a company holiday per [isHoliday]) —
     * rest days are immutable, so a regularization there could never be approved to anything;
     * rest-day work goes through OT approval instead (see FirestoreRegularizationRepository for
     * detail). Rest-day-ness is derived from the DATE itself, never from the stored
     * attendance_status doc — that doc is written only by the nightly 23:59 IST run, so it does
     * not exist yet for any rest day still in progress.
     *
     * [claimedKm] is an optional self-reported travel distance for the day (Protocol 2,
     * docs/superpowers/specs/2026-09-14-ot-redesign-design.md) — the admin may adjust it before
     * approving; it is meaningful only for a role that earns conveyance.
     */
    suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String,
        claimedKm: Double? = null
    ): Result<String>
```

- [ ] **Step 2: Firestore implementation**

In `FirestoreRegularizationRepository.kt`, thread the parameter through to the request:

```kotlin
    override suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String,
        claimedKm: Double?
    ): Result<String> {
```

(interface implementations do not repeat the default value — Kotlin resolves it from the
interface at the call site) and change the `RegularizationRequest(...)` construction:

```kotlin
            val request = RegularizationRequest(
                userId         = sessionManager.userId,
                userName       = sessionManager.name,
                employeeId     = sessionManager.employeeId,
                date           = date,
                originalStatus = originalStatus,
                reason         = reason,
                claimedKm      = claimedKm,
                submittedAt    = Timestamp.now()
            )
```

- [ ] **Step 3: ViewModel**

In `RegularizationViewModel.kt`, expose whether the signed-in employee's role earns conveyance,
and thread the new parameter through `submitRequest`:

```kotlin
    /** Whether this employee's role earns conveyance (Protocol 2) — gates the optional KM field
     *  on the regularize dialog. Mirrors admin's `usesConveyance` tab-access gate. */
    val canClaimConveyance: Boolean get() = RoleCapabilities.usesConveyance(role)

    fun submitRequest(date: String, originalStatus: String, reason: String, claimedKm: Double? = null) {
        viewModelScope.launch {
            _submitState.value = UiState.Loading()
            val result = repository.submitRequest(date, originalStatus, reason, claimedKm)
            if (result.isSuccess) {
                _submitState.value = UiState.Success(result.getOrThrow())
            } else {
                _submitState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed."
                )
            }
        }
    }
```

(`RoleCapabilities` is already imported in this file.)

- [ ] **Step 4: Fragment UI**

In `RegularizationFragment.kt`, add a km text field to the existing dialog, shown only when the
employee's role earns conveyance, and pass the parsed value on submit:

```kotlin
            var reason by remember { mutableStateOf("") }
            var km by remember { mutableStateOf("") }
```

```kotlin
                onRequest = { dialogItem = it; reason = ""; km = "" },
```

```kotlin
                    WcDialog(
                        title = "Regularize $displayDate",
                        subtitle = "Original status: ${item.originalStatus}",
                        confirmText = "Submit",
                        confirmEnabled = reason.isNotBlank(),
                        onConfirm = {
                            viewModel.submitRequest(
                                item.date, item.originalStatus, reason.trim(),
                                km.trim().toDoubleOrNull(),
                            )
                            dialogItem = null
                        },
                        onDismiss = { dialogItem = null },
                    ) {
                        WcField(
                            value = reason,
                            onValueChange = { reason = it },
                            placeholder = "Enter reason",
                            singleLine = false,
                            minLines = 3,
                        )
                        if (viewModel.canClaimConveyance) {
                            WcField(
                                value = km,
                                onValueChange = { km = it },
                                placeholder = "KM traveled that day (optional)",
                                singleLine = true,
                            )
                        }
                    }
```

- [ ] **Step 5: fake repository + tests**

In `FakeRegularizationRepository.kt`, add the parameter to the `submitRequest` override and
carry it onto the recorded request (the fake already exposes every successfully submitted
request via its public `submitted: MutableList<RegularizationRequest>`, which the test below
reads directly — do not add a new accessor):

```kotlin
    override suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String,
        claimedKm: Double?
    ): Result<String> {
        failWith?.let { return Result.failure(it) }
        if (reason.isBlank()) {
            return Result.failure(IllegalArgumentException("Please provide a reason."))
        }
        val existing = requests.value[date]
        if (existing != null && existing.status != "rejected") {
            return Result.failure(IllegalStateException("A request for this date already exists."))
        }
        // Mirrors production: derived from the DATE (holiday lookup + pure Sunday check,
        // holiday-first), never from statusByDate — a rest day in progress has no status doc yet.
        val restDayKind = when {
            date in holidayDates -> "Holiday"
            LocalDate.parse(date).dayOfWeek == DayOfWeek.SUNDAY -> "Sunday"
            else -> null
        }
        if (restDayKind != null) {
            return Result.failure(IllegalStateException(
                "$date is a $restDayKind — a rest day. Work done on a rest day is handled " +
                    "through OT approval, not regularization."
            ))
        }
        val id = "reg-${nextId++}"
        val request = RegularizationRequest(
            id = id,
            date = date,
            originalStatus = originalStatus,
            reason = reason,
            claimedKm = claimedKm,
            status = "pending",
        )
        requests.value = requests.value + (date to request)
        submitted += request
        return Result.success(id)
    }
```

In `RegularizationViewModelTest.kt`, the fake instance is the class field `repo: FakeRegularizationRepository`
(assigned at line 58). Add one test next to `submitRequest writes through the repository`
(around line 244):

```kotlin
    @Test
    fun `submitRequest passes claimedKm through to the repository`() = runTest(dispatcher) {
        val vm = viewModel()
        advanceUntilIdle()

        vm.submitRequest(WEEKDAY_DATE, "HalfDay", "Doctor visit", claimedKm = 12.5)
        advanceUntilIdle()

        assertEquals(12.5, repo.submitted.last().claimedKm)
    }
```

- [ ] **Step 6: Verify + commit**

```bash
cd android && ./gradlew :app:compileDebugKotlin --console=plain
./gradlew :app:testDebugUnitTest --rerun-tasks --tests "*Regularization*"
```

```bash
git add android/app/src/main/java/com/raghav/whitecoffee/data/repository/RegularizationRepository.kt android/app/src/main/java/com/raghav/whitecoffee/data/repository/FirestoreRegularizationRepository.kt android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModel.kt android/app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationFragment.kt android/app/src/test/java/com/raghav/whitecoffee/fake/FakeRegularizationRepository.kt android/app/src/test/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModelTest.kt
git commit -m "feat(protocol-2): employee can claim KM when filing a regularization request

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3 — admin: `approveRegularization` writes conveyance when a km value is given

**Files:**
- Modify: `admin/src/lib/firestore.ts:456-490` (`approveRegularization`)

**Interfaces:**
- Consumes: `getConveyanceConfig()` (`firestore.ts:1011-1018`, already exists),
  `usesConveyance(role)` (`admin/src/lib/roleCapabilities.ts`, already exists).
- Produces: `approveRegularization(userId, requestId, date, approverName, comment, approvedStatus, userName, employeeId, inTime?, outTime?, km?: number)`
  — one new optional trailing parameter, consumed by Task 4's page.

- [ ] **Step 1: import `usesConveyance`**

`firestore.ts` has no existing import from `roleCapabilities` — add a new import line after
the existing `import { PAY_FIELDS, type Pay } from './compensation';` (line 12):

```typescript
import { usesConveyance } from './roleCapabilities';
```

- [ ] **Step 2: extend `approveRegularization`**

Replace the function with:

```typescript
export async function approveRegularization(
  userId: string, requestId: string, date: string, approverName: string,
  comment: string, approvedStatus: string, userName = '', employeeId = '',
  inTime?: string, outTime?: string, km?: number,
) {
  // Re-check rather than trust the submitted form: the regularization page already excludes WO
  // from the outcome list for a rest-day request and refuses to file a request for one at all
  // (Android), but neither of those is load-bearing here — this write bypasses
  // setAttendanceStatus's assertNotRestDay (it goes straight to batch.set, per Protocol 1's
  // "no admin, manager, regularization, or backfill may write... on those dates"), so a stale
  // form, a race with a holiday just added, or a direct call must still be caught, with a clear
  // Error instead of a raw permission-denied from firestore.rules' `!isRestDate(date)`.
  const holidaysOnDate = await getHolidaysForDateRange(date, date);
  assertNotRestDay(date, new Set(holidaysOnDate.map(h => h.id)));

  const batch = writeBatch(db);
  batch.update(
    doc(db, 'users', userId, 'regularization_requests', requestId),
    stamped({ status: 'approved', approvedBy: approverName, approverComment: comment, approvedStatus, reviewedAt: Timestamp.now() })
  );
  // Set in/out only for a Present outcome with both times given; otherwise clear any stale pair
  // so a re-approval to a non-worked status doesn't leave orphan times on the doc.
  const carryHours = approvedStatus === 'Present' && !!inTime && !!outTime;
  batch.set(
    doc(db, 'users', userId, 'attendance_status', date),
    stamped({
      date, userId, userName, employeeId, status: approvedStatus, markedBy: 'admin',
      inTime: carryHours ? inTime : deleteField(),
      outTime: carryHours ? outTime : deleteField(),
      updatedAt: Timestamp.now(),
    }),
    { merge: true }
  );

  // Protocol 2 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): a claimed KM figure
  // fixes conveyance for a missed-punch day the same way inTime/outTime already fixes OT.
  // Independent of carryHours — an admin may want to correct conveyance without also touching
  // the ledger override. Scoped to usesConveyance(role): office/admin never earn conveyance,
  // so a stray km value on their request must never mint a conveyance doc for them.
  if (km !== undefined && km >= 0) {
    const userSnap = await getDoc(doc(db, 'users', userId));
    const targetRole = userSnap.exists() ? (userSnap.data().role as string) : '';
    if (usesConveyance(targetRole)) {
      const rateType = userSnap.data()?.conveyanceRateType;
      const { rate1, rate2 } = await getConveyanceConfig();
      // Mirrors firebase/functions/index.js's CONVEYANCE_RATE_FALLBACK (2.5) — the two
      // codebases have no shared build graph, so the fallback is duplicated deliberately
      // rather than left silently absent on this side.
      const ratePerKm = (rateType === 2 ? rate2 : rate1) || rate1 || 2.5;
      batch.set(
        doc(db, 'conveyance', `${userId}__${date}`),
        {
          userId, userName, employeeId, date, month: date.slice(0, 7),
          route: 'Regularized (manual entry)', totalKm: km, ratePerKm,
          conveyance: km * ratePerKm, markedBy: 'admin', computedAt: Timestamp.now(),
        },
        { merge: true },
      );
    }
  }

  await batch.commit();
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd admin && npm run build
```

There is no existing test file for `firestore.ts` (it is a Firestore-side-effecting module, not
one of the pure-logic files this repo unit-tests) — a clean build is this task's verification,
consistent with how `approveRegularization`'s existing OT-override branch is verified today.

```bash
git add admin/src/lib/firestore.ts
git commit -m "feat(protocol-2): approveRegularization writes conveyance when a km value is given

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4 — admin: Regularization page UI (KM field, gated by tab access)

**Files:**
- Modify: `admin/src/app/(admin)/regularization/page.tsx`

**Interfaces:**
- Consumes: `approveRegularization(..., km?: number)` (Task 3).
- Consumes: `useAccess().user.tabAccess` (`admin/src/components/AccessContext.tsx`, already
  exists) and `useAccess().user.role`.

- [ ] **Step 1: gate + state**

Near the existing `isAdmin` derivation (line 60), add:

```typescript
  const isAdmin = portalUser?.role === 'admin';
  // Same check /conveyance itself uses — a Regularization-only manager must never be offered
  // this field, since a Firestore batch fails atomically if it includes a write they can't
  // make (see firestore.rules:677-683 and the Protocol 2 spec's Enforcement section).
  const canClaimConveyance = isAdmin || (portalUser?.tabAccess ?? []).includes('/conveyance');
```

Add a `km` state alongside `effIn`/`effOut` (line ~71):

```typescript
  const [effIn, setEffIn]             = useState('');
  const [effOut, setEffOut]           = useState('');
  const [km, setKm]                   = useState('');
```

- [ ] **Step 2: reset on open**

In `openModal` (line 110-124), reset it alongside the other approve-modal fields, pre-filling
from the request's own claim:

```typescript
  function openModal(req: RegularizationRequest, type: 'approve' | 'reject') {
    setActionModal({ req, type });
    setActionComment('');
    setApprovedStatus('Present');
    setEffIn('');
    setEffOut('');
    setKm(req.claimedKm != null ? String(req.claimedKm) : '');
    // ...unchanged rest-day lookup below
```

- [ ] **Step 3: validate + pass through on approve**

In `handleAction` (line 126-157), add a km parse/validate alongside the existing effIn/effOut
check, and pass it to `approveRegularization`:

```typescript
  async function handleAction() {
    if (!actionModal) return;
    const { req, type } = actionModal;
    if (type === 'approve' && approvedStatus === 'Present') {
      if (!!effIn !== !!effOut) { setError('Enter both in and out times, or leave both blank.'); return; }
      if (effIn && effOut && effOut <= effIn) { setError('Out time must be after in time.'); return; }
    }
    let kmValue: number | undefined;
    if (type === 'approve' && km.trim()) {
      kmValue = parseFloat(km);
      if (isNaN(kmValue) || kmValue < 0) { setError('KM must be a non-negative number.'); return; }
    }
    setError('');
    setActioning(req.id);
    try {
      if (type === 'approve') {
        // Effective in/out only meaningful for a Present outcome (lets that day carry shortage/OT).
        const carry = approvedStatus === 'Present' && effIn && effOut;
        await approveRegularization(
          req.userId, req.id, req.date, adminName, actionComment, approvedStatus, req.userName, req.employeeId,
          carry ? effIn : undefined, carry ? effOut : undefined, kmValue,
        );
      } else {
        await rejectRegularization(req.userId, req.id, adminName, actionComment);
      }
      setActionModal(null);
      setActionComment('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${type === 'approve' ? 'Approval' : 'Rejection'} failed.`);
    }
    setActioning('');
  }
```

- [ ] **Step 4: render the field**

Add it in the modal, after the existing effIn/effOut block (after line 417), gated on
`canClaimConveyance`:

```tsx
            {actionModal.type === 'approve' && canClaimConveyance && (
              <div className="mb-4">
                <label className="label">KM traveled <span className="font-normal text-text-secondary">(optional)</span></label>
                <input
                  type="number" min="0" step="0.1"
                  className="input mt-1"
                  value={km}
                  onChange={e => setKm(e.target.value)}
                  placeholder={actionModal.req.claimedKm != null ? `Employee claimed ${actionModal.req.claimedKm} km` : 'e.g. 24.5'}
                />
                <p className="text-xs text-text-secondary mt-1.5">
                  Sets conveyance for this date directly (km × the employee&apos;s own rate). Leave blank to leave conveyance untouched.
                </p>
              </div>
            )}
```

- [ ] **Step 5: Verify + commit**

```bash
cd admin && npm run build
```

Manually sanity-check in the dev server (`npm run dev`): open a pending request as a full admin
— the KM field appears; log in as a manager holding only `/regularization` — it must not appear.

```bash
git add "admin/src/app/(admin)/regularization/page.tsx"
git commit -m "feat(protocol-2): KM field on the regularization approval modal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5 — functions: nightly conveyance loop preserves an admin-set figure

**Files:**
- Modify: `firebase/functions/index.js` (Conveyance section, lines ~1594-1619)

**Interfaces:**
- Consumes: `conveyance/{docId}.markedBy` (Task 3's write).

- [ ] **Step 1: build the skip-set before the persist loop**

Just before the existing persist block (right after `const monthStr = monthStart.slice(0, 7);`
around line 1599), add:

```js
        const monthStr = monthStart.slice(0, 7);

        // Skip any date an admin already set via regularization approval (Protocol 2) — without
        // this, the very next nightly run silently overwrites it back to the (wrong) raw-event
        // figure. Mirrors the markedBy:'admin' skip already used for attendance_status.
        const existingConvSnap = await db.collection("conveyance").where("month", "==", monthStr).get();
        const adminMarkedConv = new Set(
          existingConvSnap.docs.filter((d) => d.data().markedBy === "admin").map((d) => d.id)
        );
```

- [ ] **Step 2: skip those doc IDs in the write loop**

In the `for (const row of allRows)` loop, add the skip immediately after computing `docId`:

```js
        for (const row of allRows) {
          const [date, userName, employeeId, route, totalKmStr, conveyanceStr, , odUserId, ratePerKm] = row;
          const docId = `${odUserId}__${date}`;
          if (adminMarkedConv.has(docId)) continue;
          const docRef = db.collection("conveyance").doc(docId);
          fbBatch.set(docRef, {
            userId: odUserId, userName, employeeId, date, month: monthStr,
            route, totalKm: parseFloat(totalKmStr), ratePerKm,
            conveyance: parseFloat(conveyanceStr),
            computedAt: admin.firestore.Timestamp.now(),
          });
          opCount++;
          if (opCount >= BATCH_LIMIT) {
            await fbBatch.commit();
            fbBatch = db.batch();
            opCount = 0;
          }
        }
```

(Only the `docRef` line and the two new lines above it change; the rest of the loop body is
unchanged — do not alter the batching/commit logic below it.)

Note this only guards a date that still has *some* GPS events that month (so `grouped` — and
therefore `allRows` — contains a row for it, e.g. one missed punch among several visits). A
fully missed day (zero events at all) never appears in `allRows` in the first place, so the
admin-set doc for that date is never at risk regardless.

- [ ] **Step 3: Verify + commit**

```bash
cd firebase/functions && node --check index.js && npm test
```

`npm test` covers the pure modules (`otLedger.js`, `otAggregate.js`, etc.) via `node --test`;
this change is inline in the non-unit-tested `exportToSheets` function, consistent with the
existing `attendance_status` admin-override skip it mirrors (also untested in isolation) — the
`node --check` syntax check plus the full `npm test` regression run is this task's bar.

```bash
git add firebase/functions/index.js
git commit -m "fix(protocol-2): nightly conveyance export preserves an admin-set figure

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6 — rules-tests: lock in the batch-permission assumption

**Files:**
- Create: `firebase/rules-tests/conveyance-regularization.test.js`

**Interfaces:**
- Consumes: `helpers.js` (`TABS`, `setup`, `teardown`, `seedUsers`, `asUser`, `assertSucceeds`,
  `assertFails`), matching the pattern in `self-approval.test.js`.

No rule is changing in this plan, but Task 3-4's design depends on an assumption about the
*existing* `conveyance` rule (`firestore.rules:677-683`) that has never been exercised together
with a `regularization_requests`/`attendance_status` batch before: a Regularization-tab-only
manager's batch must still succeed when it carries no conveyance write, and must fail cleanly
(not partially apply) if it ever did carry one they're not allowed to make. This task pins that
down as a real, automated regression rather than a design-doc assertion.

- [ ] **Step 1: write the test file**

```js
"use strict";

/**
 * Protocol 2 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): a regularization
 * approval's batch can now include a conveyance write. These tests lock in the assumption the
 * design depends on — the existing conveyance rule (firestore.rules:677-683) was never
 * exercised inside a multi-collection batch before, and a Firestore batch fails ATOMICALLY if
 * any single write in it fails its rule.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const {
  TABS, setup, teardown, seedUsers, asUser, assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:   { role: "admin", name: "Admin" },
    regMgr:  { role: "office", tabAccess: [TABS.REGULARIZATION] },
    convMgr: { role: "office", tabAccess: [TABS.CONVEYANCE] },
    both:    { role: "office", tabAccess: [TABS.REGULARIZATION, TABS.CONVEYANCE] },
    emp:     { role: "operations", name: "Employee" },
  });
});

after(async () => { await teardown(); });

test("a Regularization-only manager's batch WITHOUT a conveyance write still succeeds", async () => {
  const db = asUser(env, "regMgr");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-10"), {
    date: "2026-09-10", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  await assertSucceeds(batch.commit());
});

test("a Regularization-only manager's batch WITH a conveyance write fails atomically", async () => {
  const db = asUser(env, "regMgr");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-11"), {
    date: "2026-09-11", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  batch.set(db.doc("conveyance/emp__2026-09-11"), {
    userId: "emp", date: "2026-09-11", month: "2026-09", totalKm: 10, conveyance: 25, markedBy: "admin",
  });
  await assertFails(batch.commit());

  // Confirm the status write did NOT partially apply.
  const check = await db.doc("users/emp/attendance_status/2026-09-11").get();
  assert.strictEqual(check.exists, false);
});

test("a manager holding BOTH tabs can batch both writes together", async () => {
  const db = asUser(env, "both");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-12"), {
    date: "2026-09-12", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  batch.set(db.doc("conveyance/emp__2026-09-12"), {
    userId: "emp", date: "2026-09-12", month: "2026-09", totalKm: 10, conveyance: 25, markedBy: "admin",
  });
  await assertSucceeds(batch.commit());
});

test("full admin can batch both writes with no tabAccess at all", async () => {
  const db = asUser(env, "admin");
  const batch = db.batch();
  batch.set(db.doc("users/emp/attendance_status/2026-09-13"), {
    date: "2026-09-13", userId: "emp", status: "Present", markedBy: "admin",
  }, { merge: true });
  batch.set(db.doc("conveyance/emp__2026-09-13"), {
    userId: "emp", date: "2026-09-13", month: "2026-09", totalKm: 10, conveyance: 25, markedBy: "admin",
  });
  await assertSucceeds(batch.commit());
});
```

- [ ] **Step 2: run the full suite**

```bash
cd firebase/rules-tests && npm test
```

Run the whole suite, not just the new file — per this repo's standing rule, any interaction
with `firestore.rules` gets the full regression, and this is the conveyance rule's first
production caller even though the rule text itself is unchanged.

- [ ] **Step 3: commit**

```bash
git add firebase/rules-tests/conveyance-regularization.test.js
git commit -m "test(protocol-2): lock in the regularization+conveyance batch permission assumption

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7 — Final whole-branch check

No new files. This is a checkpoint, not a code task.

- [ ] Re-run every verification command from Global Constraints in sequence:
  ```bash
  cd admin && npm run build
  cd ../firebase/functions && node --check index.js && npm test
  cd ../rules-tests && npm test
  cd ../../android && ./gradlew :app:compileDebugKotlin --console=plain && ./gradlew :app:testDebugUnitTest --rerun-tasks
  ```
- [ ] Re-read the Protocol 2 spec section top to bottom and confirm every numbered rule (1-5) has
  a corresponding task above: (1) employee claims km → Task 2; (2) admin edits it → Task 4;
  (3) conveyance set on approval → Task 3; (4) nightly loop preserves it → Task 5; (5) scope is
  operations+sales via `usesConveyance` → Task 3's guard.
  Given this is money-computing code touching payroll-adjacent figures, request the final
  whole-branch review on Opus before merging, per this repo's established protocol pattern
  (see `[[ot-redesign-protocol-by-protocol]]` — Protocol 1 used the same review tier).
