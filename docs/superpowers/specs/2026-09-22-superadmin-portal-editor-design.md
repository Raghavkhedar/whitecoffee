# Superadmin portal editor — design

## Problem

`users/{uid}.superAdmin` (PR #45) grants god-mode at the `firestore.rules` layer, but
nothing in the admin portal exposes it — using it today means a direct Firestore Console
edit or a one-off script. Raghav wants a page in the portal itself, visible and usable
only by a superadmin, that can browse to and edit or delete **any** document in the
database.

## Decisions (from brainstorming)

1. **Access gating**: new route `/superadmin`, rendered only when the logged-in user's
   own doc has `superAdmin === true`. Client-side only — the real boundary stays
   `firestore.rules`' `isSuperAdmin()`, unchanged by this feature.
2. **Navigation**: guided pickers — a collection dropdown (top-level collections, or
   "pick an employee, then one of their subcollections"), then a paginated, ID-filterable
   document list. Not a raw path input.
3. **Editor**: the whole document as one pretty-printed, editable JSON blob, not
   per-field typed inputs. Firestore `Timestamp` values round-trip through a
   `{"__timestamp__": "<ISO>"}` marker convention, applied recursively (works inside
   arrays/maps, not just top-level fields). `GeoPoint`/`DocumentReference` do **not**
   round-trip — accepted, because nothing in this schema uses those types (coordinates
   are plain `latitude`/`longitude` numbers throughout).
4. **Save**: shows a before/after diff for confirmation, auto-stamps
   `lastModifiedBy`/`lastModifiedAt` to the acting superadmin's uid/now before writing
   (not required by the rules for superadmin, but keeps `audit_log` entries attributable
   instead of falling back to `"unknown"`), then `setDoc`s the full document.
5. **Delete**: a per-document delete button gated behind typing the document's own ID to
   confirm — several of these collections have no delete path anywhere else in the app.
6. **`audit_log` stays fully protected**: this editor's collection picker never offers
   `audit_log` as a write target (read-only there, same as the portal's existing
   `/audit` page). Separately, and unrelated to this feature's own code: the existing
   `auditTopLevel`/`auditUserSubcollection` Cloud Function triggers fire on *any* write to
   an audited collection regardless of which client produced it, so every edit/delete
   this page makes is still captured in `audit_log` automatically.
7. **Non-goal, stated explicitly**: this is a raw data editor with no domain awareness.
   Editing `attendance_status` here does **not** trigger the OT ledger recompute,
   `plBalance` adjustments, or notifications that the Regularization flow triggers. It
   writes exactly the JSON given and nothing else.

## Design

### 1. Extending the portal's access model

`admin/src/lib/portalAccess.ts` currently has exactly two tiers: `role === 'admin'`
(all tabs) and per-tab `tabAccess` grants. `/superadmin` needs a **third** tier — visible
only when `superAdmin === true`, regardless of `tabAccess` — so it cannot simply be added
as another `adminOnly: true` entry in `TABS` (that would show it to every `role==='admin'`
user, not just a superadmin).

Changes:
- `TabDef` gets a new optional `superAdminOnly?: boolean` flag, alongside the existing
  `adminOnly?: boolean`.
- A new `TABS` entry: `{ path: '/superadmin', label: 'Superadmin', icon: 'code', group:
  'Records', superAdminOnly: true }` (icon/group placeholder — finalized in the plan).
- `AccessUser` widens from `Pick<User, 'role' | 'tabAccess'>` to
  `Pick<User, 'role' | 'tabAccess' | 'superAdmin'>`.
- A new `isSuperAdminUser(user)` predicate: `user?.superAdmin === true`.
- `allowedPaths()`: an ordinary admin gets every tab **except** `superAdminOnly` ones; a
  superadmin (who also carries `role: 'admin'` per the provisioning convention, so already
  gets every ordinary tab) additionally gets the `superAdminOnly` ones.
- `portalAccess.test.ts` gains cases for the new tier, alongside its existing assertion
  that the admin-only list can't drift from `firestore.rules`.

### 2. Collection registry (the picker's data source)

A new static list of every collection this schema has (enumerated directly from the live
`firestore.rules`, not from prose docs, to avoid drift), split into two groups:

- **Top-level**: `users`, `sites`, `holidays`, `config`, `conveyance`, `sent_notifications`,
  `submission_edits`, `dailySpend`, `system`, `audit_log` (read-only — excluded as a write
  target in the UI, matching `firestore.rules`' own exclusion).
- **Per-employee subcollections** (require picking a `users/{uid}` first): `attendance`,
  `attendance_status`, `attendance_corrections`, `compensation`, `leave_requests`,
  `regularization_requests`, `planned_hours`, `daily_hours`, `ot_approvals`, `wo_ledger`
  (+ its own nested `settlements` subcollection), `settlements`, `specialAllowance`,
  `material_requests`, `material_purchases`, `material_transfers`, `tool_transfers`,
  `work_progress`, `notifications`.

### 3. Generic Firestore operations

New functions added to `admin/src/lib/firestore.ts` (centralized, per existing
convention), operating on raw slash-separated paths rather than typed domain objects:
- `listDocuments(collectionPath, { limit, startAfterId })` — paginated list, ordered by
  document ID.
- `getDocumentRaw(docPath)` — full document data.
- `setDocumentRaw(docPath, data)` — full-document `setDoc`.
- `deleteDocumentRaw(docPath)`.

### 4. Timestamp marker conversion (the one genuinely risky piece of logic)

A new pure module, `admin/src/lib/firestoreJson.ts`:
- `docToEditableJson(data: object): string` — recursively walks the document (including
  into arrays and nested maps), replacing any Firestore `Timestamp` instance with
  `{ __timestamp__: <ISO string> }`, then `JSON.stringify`s with indentation.
- `editableJsonToDoc(json: string): object` — `JSON.parse`s, then recursively walks the
  result converting any `{ __timestamp__: <ISO string> }` shape back into a real
  `Timestamp` via `Timestamp.fromDate(new Date(iso))`. Throws a descriptive error on
  invalid JSON or a malformed `__timestamp__` value (not a silent fallback — a
  mis-parsed date written to `lastModifiedAt` or an event `timestamp` is exactly the kind
  of mistake this format exists to catch before it reaches Firestore).
- Pure, no Firebase network calls — unit-tested via `npx tsx` per this repo's convention
  (see `attendanceState.test.ts`), covering: round-trip of a document with a top-level
  Timestamp, a Timestamp nested inside an array of maps (mirrors `suspensionHistory[].at`
  shape), a document with no Timestamps at all, and malformed input (invalid JSON,
  malformed `__timestamp__` value).

### 5. The page

`admin/src/app/(admin)/superadmin/page.tsx`:
- Guarded by the layout's existing `canAccess`/`allowedPaths` mechanism (Section 1) — no
  separate inline check, matching how every other admin-only page already relies solely on
  the central layout guard.
- Collection picker (Section 2) → paginated document list (`listDocuments`) with an ID
  filter → click a document → `getDocumentRaw` + `docToEditableJson` into a `<textarea>`.
- Save: `editableJsonToDoc`, stamp `lastModifiedBy`/`lastModifiedAt`, show a before/after
  diff, confirm, `setDocumentRaw`.
- Delete: confirm dialog requiring the document ID typed exactly, then `deleteDocumentRaw`.

## Non-goals

- No per-field typed inputs — JSON editing only.
- No `GeoPoint`/`DocumentReference` round-trip support (unused in this schema; documented
  limitation, not silently broken).
- No document **creation** (only editing/deleting existing documents) — not asked for.
- No `audit_log` write access, under any circumstance.
- No change to any existing page's behavior — this is purely additive.

## Risks (accepted, not mitigated further)

- A raw JSON editor has no schema validation beyond "is it valid JSON" — a superadmin can
  write a document that violates every convention the rest of the codebase assumes (e.g. a
  `status` value no reader recognizes, a `salaryCredit` of `2`). This is the same risk
  already accepted for direct Firestore access; this feature only makes it reachable from
  inside the portal.
- Edits here bypass every domain side effect (Section 6/Non-goals above) — a superadmin
  editing `attendance_status` to `SCHL` here does not decrement `plBalance` the way an
  approved leave would, for example. The audit log will show the raw write happened, not
  that it was "wrong."
