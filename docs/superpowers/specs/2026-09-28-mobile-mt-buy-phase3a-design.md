# iOS Mobile App — Phase 3a: M&T Buy

## Context

Phase 1 (attendance), Phase 2a (Leave), and Phase 2b (Regularization) have shipped —
Phase 1+2a merged to `main` via [PR #47](https://github.com/Raghavkhedar/whitecoffee/pull/47);
Phase 2b is complete on branch `mobile-ios-phase2b`, pending a merge/PR/keep-as-is decision.
This spec covers the next increment: porting Android's **M&T Buy** (Material & Tool
Purchase logging) feature.

This is the first of a four-part decomposition of what was originally sketched as "Phase 3"
(the remaining Android Home-screen features): M&T Request, M&T Buy, Material Transfer, Tool
Transfer, and Work Progress. Investigation found Material Transfer and Tool Transfer are one
feature with two collection targets (Android's own decision #9: "identical structure"), so
the real count is four sub-projects: **M&T Buy** (this spec), **Material+Tool Transfer**
(bundled), **M&T Request**, and **Work Progress** (blocked — Operations-only, and mobile has
not built an operations-role flow yet). M&T Buy goes first: it is the simplest of the four,
available to all four roles with no dependency on mobile's current office/admin-only role
scope, and it is where this app's **first photo-upload capability** gets built — a shared
foundation the next two specs will reuse.

## Android reference behavior (verified by direct investigation, not assumption)

**What it is**: a purchase-logging form — a user records materials/tools they actually
bought, as opposed to M&T Request (a request for someone else to buy something). Each entry
has a site, a list of purchased items (name, quantity, unit, price per unit, an
auto-computed line total, two spec fields, per-item notes), an overall notes field, and
optional photos. Business purpose: expense/purchase record-keeping for procurement
reconciliation, exported to Sheets by the admin portal (`toSheetRows()`,
`MaterialToolPurchase.kt:57-74`).

**Role gating**: all four roles (`android/CLAUDE.md`'s role table, "M&T Buy: ✅" for
Operations/Office/Sales/Admin; unconditional `add(...)` at `HomeScreen.kt:88`, comment "all
roles"). Unlike Attendance/Regularization, this feature has no dependency on which
punch-events a role produces — it is a plain form, so it can be shown to every role in the
mobile app immediately, same as Leave already is.

**No "My Submissions" view** — confirmed by the same deliberate decision that applies to
Leave... no, wait: unlike Leave (which does have a history tab), M&T Buy has **none**, per
decision #15 ("No My Submissions screens — dropped; users do not view submission history in
the app. All approvals via admin web portal only") and confirmed directly: the only read
method on the repository (`FirestoreRequestRepository.kt:107-117`,
`getMaterialToolPurchases()`) is never called anywhere in the app (dead code, confirmed by
grep). This matches Regularization's pattern, not Leave's.

**Validation** — verified against the actual code, not the aspirational prose in
`android/CLAUDE.md`'s "SITE ENTRY" section (which claims "Site Name is required" — that is
**not enforced anywhere in the code** and is a stale/aspirational doc note, the same class of
CLAUDE.md staleness already found twice in this project). The real validation
(`MaterialToolBuyViewModel.kt:50-55`):
```kotlin
fun validateItems(items: List<PurchaseItem>): String? = when {
    items.isEmpty() -> "Please add at least one item."
    items.any { it.itemName.isBlank() || it.quantity <= 0 } ->
        "Please fill in all item names and quantities."
    else -> null
}
```
That is the **entire** validation surface: at least one item; each item needs a non-blank
`itemName` and `quantity > 0`. Site name/ID, unit, price, and notes are **not validated** —
they can be submitted blank. This spec mirrors the actual app's real behavior, not the stale
doc's claim.

**Site entry**: plain free-text fields, no dropdown — confirmed in `android/CLAUDE.md`'s
"SITE ENTRY" section and in code (`MaterialToolBuyScreen.kt:53-67`, two `WcField` text
inputs bound to plain `mutableStateOf("")` strings, no Firestore query, no autocomplete). A
`/sites/{siteId}` collection exists but is explicitly **not** used as a picker source
anywhere in the app today (decision #14). This spec keeps parity: two plain text fields.

## Photo upload — the new capability this phase introduces

Phase 1/2a/2b never needed photo upload; this is genuinely new infrastructure, verified
directly against Android's implementation and Expo's current docs (not assumed):

- **Picking**: camera (one photo per capture) or gallery (multi-select). Android caps
  gallery picks at 10 with no total accumulation cap (a minor, unreplicated bug — this app
  caps the running total at **6**, a deliberate, cleaner divergence).
- **Compression**: Android downsamples to ≤720px on the longer side at JPEG quality 60
  (`PhotoUploadManager.kt:31-35`; `android/CLAUDE.md`'s "1080px/75%" claim is stale — trust
  the code). Mobile will use `expo-image-picker`'s built-in `quality` option (0–1 scale,
  ~0.6 to approximate parity) for compression; it does **not** resize dimensions the way
  Android's two-pass bitmap decode does. Adding true resize-to-720px would need
  `expo-image-manipulator`, a new dependency — deliberately **out of scope** for this first
  photo-upload phase (quality-only compression is simpler, ships faster, and can be revisited
  if resulting file sizes prove too large in practice).
- **Storage path**: `requests/{uid}/material_purchases/{docId}/{timestamp}.jpg` — verified
  against `firebase/storage.rules:22-34`, which requires: authenticated, the path's
  `{userId}` segment matches the caller's own uid (owner-only write, no admin exception),
  file `< 10 MB`, content-type matching `image/.*`. Deletes are always denied (immutable
  once uploaded).
- **Ordering — doc-first, verified as Android's own decision #10**: write the purchase
  document immediately with `photoUrls: []`, mint the doc ID *before* any upload starts (an
  upload against a document that doesn't exist yet fails permanently — `PhotoPipeline.kt`'s
  own comment on this), then upload each photo and patch `photoUrls` once done. This is
  exactly compatible with this app's existing offline-safe write pattern (mint ref, `setDoc`
  unawaited) — the photo step is simply appended after it, not a replacement for it.
- **Retry mechanism — deliberately simpler than Android's.** Android uses WorkManager
  (persistent background retry surviving app kills, exponential backoff, 3 attempts). Expo
  has no direct equivalent, and building one (e.g. `expo-task-manager`-backed) is
  disproportionate for a first phase. This app uploads inline right after the doc write
  resolves; on failure, an inline "Retry upload" button stays visible on the just-submitted
  record for as long as the user remains on the screen. **Accepted limitation**: since there
  is no history/My-Submissions view (matching Android) and no persistent queue (a deliberate
  simplification), a photo upload that's still failing when the user navigates away is lost
  for good — the purchase record itself is never lost (it was already written), only its
  photos. This is a real, documented tradeoff, not a silent gap.
- **Firestore rules for the photo patch**: `firebase/firestore.rules:381-392`, the
  `material_purchases` update rule's owner branch —
  `isOwner(userId) && changedKeysWithin(withStamp(['photoUrls'])) && stampIsTruthful()`.
  Verified precisely: `withStamp` only *allows* `lastModifiedBy`/`lastModifiedAt` alongside
  `photoUrls`, it does not *require* them, and `stampIsTruthful()` only constrains
  `lastModifiedBy` if it's actually touched. A patch that touches **only** `photoUrls`
  satisfies this rule with no audit-stamp fields needed — matching this app's existing
  convention of not porting Android's audit-stamp mechanism (Leave and Regularization's
  mobile writes don't include it either).
- **Expo Go compatibility — confirmed, not assumed**: `expo-image-picker`'s SDK 57 docs
  page states "Included in Expo Go" — no custom dev build needed for development/testing.
  Firebase Storage via the already-installed `firebase` JS SDK (not `@react-native-firebase`)
  is Expo's own documented recommended path for Expo Go projects, needing no additional
  native module. Both halves of this feature are fully testable in the same Expo Go setup
  already used for every prior phase.

## Data model (existing, unchanged) — `/users/{uid}/material_purchases/{purchaseId}`

Verified against `MaterialToolPurchase.kt`/`PurchaseItem.kt`:

**Purchase document**: `id`, `userId`, `userName`, `employeeId`, `siteId`, `siteName`,
`items: PurchaseItem[]`, `grandTotal` (number, sum of each item's `totalPrice`), `notes`,
`photoUrls: string[]` (empty on create, patched after upload), `submittedAt`.

**Each item**: `itemName`, `quantity` (number), `unit`, `pricePerUnit` (number), `totalPrice`
(number, = `quantity × pricePerUnit`, computed client-side same as Android's
`items.sumOf { totalPrice }` for the grand total), `spec1`, `spec2`, `notes`.

**Firestore rules** (`firebase/firestore.rules:381-392`, verified verbatim): create requires
`isLoggedIn() && isOwner(userId) && isActive() && createdUnreviewed()` — the last of which
(`createdUnreviewed()`, rules line ~293-296) means the create payload must omit `status`
entirely, or assert exactly `'pending'`; this app's `MaterialToolPurchase` model has no
`status` field at all, so omitting it (as the schema above already does) satisfies this
automatically. No `hasOnly` restriction on create — extra fields are tolerated. Owner
`update` is restricted to `photoUrls` only (see photo section above). Admin/a Submissions-tab
manager can update anything else (portal-only, unchanged). Delete is always denied.

## Stack additions

One new dependency: `expo-image-picker` (Expo Go compatible per the confirmation above,
install via `npx expo install expo-image-picker`). No Firebase Storage-specific package
needed — `getStorage`/`ref`/`uploadBytes`/`getDownloadURL` come from the already-installed
`firebase` JS SDK's `firebase/storage` entry point.

## File structure

- `mobile/src/photos/photoUpload.ts` — shared, reusable module (first of its kind in this
  app; the next two Phase-3 specs will reuse it): `pickPhotos(existingCount: number):
  Promise<string[]>` (offers camera-or-gallery choice via a simple prompt, respects the
  6-total cap by limiting how many more can be picked, returns local URIs), `uploadPhoto(uri:
  string, storagePath: string): Promise<string>` (uploads via Firebase Storage, returns the
  download URL).
- `mobile/src/materialBuy/materialBuyApi.ts` — `PurchaseItem` type, `SubmitPurchaseInput`
  type (`{ siteId: string; siteName: string; items: PurchaseItem[]; notes: string }`),
  `submitMaterialPurchase(user, input): string` (mints the doc ref locally — a pure,
  synchronous operation, so the `docId` is available immediately with no waiting — then
  calls `setDoc(docRef, ...).catch(...)` unawaited, same offline-safe pattern as every prior
  phase, and returns the `docId` synchronously so the caller can build the photo storage
  path right away), `updatePurchasePhotoUrls(uid: string, docId: string, urls: string[]):
  Promise<void>` (a plain `updateDoc` touching only `photoUrls`).
- `mobile/src/screens/MaterialBuyScreen.tsx` — the form: site name/ID text fields, a dynamic
  item list (add/remove rows: name, quantity, unit, price per unit, computed line total,
  spec1/spec2, per-item notes), an overall notes field, a photo picker (thumbnail strip +
  add button, capped at 6, with per-upload retry on failure), and submit. Resets to a blank
  form after a successful submit (no tabs to switch to, unlike Leave).
- `mobile/src/screens/HomeScreen.tsx` — modified: add an "M&T Buy" card, visible to any
  signed-in user (no role gate — matches Leave's precedent, not Attendance/Regularization's).

## Data flow & error handling

- Validation before any write mirrors Android exactly: at least one item; every item needs a
  non-blank name and a quantity greater than zero. Nothing else is required.
- Submit: mint the doc ref locally, `setDoc(...).catch(...)` unawaited with `photoUrls: []`
  — same offline-safe pattern as every prior phase's writes.
- If photos were picked, upload each (sequentially, to keep the retry UI simple — one
  in-flight upload at a time rather than parallel) to
  `requests/{uid}/material_purchases/{docId}/{timestamp}.jpg`, then call
  `updatePurchasePhotoUrls` with all resulting URLs once every upload succeeds.
- A failed upload leaves an inline "Retry upload" affordance on the just-submitted record's
  confirmation state; tapping it retries only the photos that didn't finish. Leaving the
  screen (via the reset-for-next-entry action, or navigating back) abandons any still-pending
  upload — the accepted tradeoff documented above.
- No history view — matches Android; a successful submit shows a brief confirmation and
  resets the form for the next entry.

## Verification

- No pure-logic module this phase (unlike Leave/Regularization's coverage/status-derivation
  modules) — grand-total computation is a one-line `reduce`, not complex enough to warrant
  its own test file, consistent with how simple a straightforward form-plus-list this is.
- `npx tsc --noEmit` clean project-wide.
- Manual device walkthrough (no simulator available, same constraint as every prior phase):
  submit a purchase with multiple items and confirm the grand total computes correctly;
  submit with photos and confirm they appear in Firebase Storage at the expected path and
  `photoUrls` gets patched onto the Firestore doc; confirm a purchase with zero items is
  blocked with the validation message; confirm the admin portal's Sheets export still reads
  a mobile-submitted purchase correctly (field-shape parity check, same kind of check done
  for every prior phase).

## Out of scope for Phase 3a

- M&T Request, Material/Tool Transfer, Work Progress — separate specs (Work Progress
  additionally blocked on operations-role support).
- A true persistent background upload-retry queue (Android's WorkManager equivalent) —
  accepted as a documented limitation, not deferred-but-planned.
- Photo resizing/dimension downsampling (`expo-image-manipulator`) — quality-only
  compression for this first phase.
- Any admin/portal-side changes — read/export behavior is unchanged and already correct for
  whatever shape this app writes, verified against the existing schema.
- A `/sites/{siteId}`-backed autocomplete for site entry — Android has none; not adding one
  here would exceed parity, though it's a plausible future improvement if ever requested.
