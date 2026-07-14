# Portal Access Matrix — Design

**Date:** 2026-07-14
**Branch:** `portal-access`
**Status:** Approved design, pre-implementation

## Problem

Admin-portal access is currently **preset-tag** based: a `users/{uid}.tags` array (e.g.
`attendance-manager`) maps to a fixed bundle of tabs (`TAG_TABS` in
`src/lib/portalAccess.ts`). Adding a scoped manager means editing preset code and rules.
The client wants **dynamic, per-employee, per-tab** control: a grid of employees × tabs
where an admin ticks exactly which tabs each employee may use.

## Decisions (locked)

1. **Replace tags fully.** Each user stores an explicit list of allowed tab paths
   (`tabAccess: string[]`). The preset-tag system (`TAG_TABS`/`TAG_LABELS`/`recognizedTags`)
   is deleted. The matrix is the single source of truth.
2. **Employees / user-management tab is admin-only** — never a matrix column, so no
   non-admin can open the matrix and self-promote.
3. **Dashboard is admin-only** — it aggregates across many collections; making it
   independently grantable would defeat per-tab granularity.
4. **Full per-tab Firestore rules.** Data-layer security is granular: each collection is
   unlocked only by the tab(s) that legitimately use it. Replaces the single broad
   `isAttendanceMgr()` grant.
5. **Matrix lives on a dedicated admin-only `/access` route** ("Access Control"), grouped
   under People next to Employees.
6. **Migration:** a one-off script converts existing `attendance-manager` users to explicit
   `tabAccess` lists and removes `tags`; then the clean per-tab rules deploy. No dual-field
   transitional logic.

## Grantable tabs (matrix columns)

All tabs **except** the admin-only `/dashboard`, `/users`, and `/access`:

1. `/working-hours-shortage-excess`
2. `/leaves`
3. `/regularization`
4. `/attendance`
5. `/ot-shortage`
6. `/ot-settlements`
7. `/manpower-utilisation-input`
8. `/submissions`
9. `/conveyance`
10. `/notifications`

## Section 1 — Data model & `portalAccess.ts`

- **User doc:** new field `tabAccess?: string[]` = array of tab **paths**. `tags` retired
  (used only by the migration, then removed from the type and all reads).
- **`TabDef` gains `adminOnly?: boolean`** — set on `/dashboard`, `/users`, `/access`.
  These tabs only ever show for admins and are excluded from matrix columns.
- **Grantable columns** = `TABS.filter(t => !t.adminOnly)`.
- **`allowedPaths(user)`**: admin → every tab path; non-admin → `user.tabAccess`
  intersected with the non-`adminOnly` tab paths (a stray admin-only or unknown path is
  ignored — defensive), returned in `TABS` order.
- **`hasPortalAccess(user)`**: admin, OR `allowedPaths(user)` is non-empty.
- **`canAccess` / `landingPath`**: unchanged — they already derive from `allowedPaths`.
- **Deleted:** `TAG_TABS`, `TAG_LABELS`, `ALL_TAGS`, `recognizedTags`.

## Section 2 — The matrix page (`/access`)

- New route `src/app/(admin)/access/page.tsx`, `'use client'`. Added to `TABS` with
  `adminOnly: true`, `group: 'People'`, a suitable icon.
- **Rows:** active non-admin employees (`getAllUsers()` filtered to `active !== false`
  and `role !== 'admin'`), sorted like the Employees page (office → admin → ops, then
  alphabetical — admins are omitted, so effectively office → ops). Admins are not rows;
  show a note: "Admins always have full portal access."
- **Columns:** the 10 grantable tabs (labels from `TABS`).
- **Cells:** a checkbox per employee×tab = "employee holds this tab" (`path ∈ tabAccess`).
- **Bulk controls:** per-row toggle-all (grant/revoke every tab for one employee), per-column
  toggle-all (grant/revoke one tab for every employee).
- **Sticky** header row and first (name) column; horizontal scroll for the tab columns.
- **Edit model:** edits accumulate in local React state (a working copy of each user's tab
  set). A **Save** button commits only changed users via
  `updateUserProfile(uid, { tabAccess })` — one write per changed user. Show a dirty
  indicator and an unsaved-changes guard (warn on navigate away).
- **Single-user editing** stays in the existing Employees edit modal: the current tag
  checkboxes are replaced by tab checkboxes writing the same `tabAccess` field. Matrix =
  bulk view; modal = single-user view.

## Section 3 — Firestore rules (per-tab, collection-first)

Because several tabs share a collection (e.g. `attendance` is used by 5 tabs), rules are
written **collection-first**: each collection asks whether the caller holds *any* tab that
unlocks it.

New helper (cached — same user doc as `userRole()`, no extra billed read):

```
function userTabs() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('tabAccess', []);
}
```

Per-collection helpers replace `isAttendanceMgr()`. Tab→collection map:

| Collection | Unlocked by tabs | Ops |
|---|---|---|
| `attendance` | `/attendance`, `/working-hours-shortage-excess`, `/ot-shortage`, `/manpower-utilisation-input`, `/regularization` | read; **update** (`siteId`/`visitType`/`workDoneCategories`) only for `/attendance` + `/manpower-utilisation-input` |
| `attendance_status` | `/attendance`, `/regularization`, `/working-hours-shortage-excess`, `/ot-shortage` | read; **write** for `/attendance` + `/regularization` |
| `planned_hours` | `/attendance`, `/working-hours-shortage-excess`, `/ot-shortage` | read; **write** for `/attendance` |
| `daily_hours` | `/ot-shortage`, `/working-hours-shortage-excess`, `/attendance` | read only (Cloud Function writes) |
| `ot_approvals` | `/attendance`, `/ot-shortage`, `/working-hours-shortage-excess`, `/ot-settlements` | read; **write** for `/attendance` + `/ot-shortage` |
| `settlements` | `/ot-settlements` | read + write |
| `holidays` | `/attendance` | read (any logged-in, unchanged); **write** for `/attendance` |
| `leave_requests` | `/leaves` | read + update |
| `regularization_requests` | `/regularization` | read + update |
| `material_requests`, `material_purchases`, `material_transfers`, `tool_transfers`, `work_progress` | `/submissions` | read + update (admin-style status); `submission_edits` read/write |
| `conveyance`, `config` | `/conveyance` | read + write (`config` read for rate lookup) |
| `sent_notifications`, `notifications` | `/notifications` | read/write send log; create user notifications |
| `sites` | read stays any-logged-in; create/update/delete stay admin-only | — |
| `users` | read = admin OR holds any grantable tab (name resolution); **create/update/delete admin-only** | — |

Rules-writing rules:
- **Every `isOwner(...)` branch is left exactly as written** — the Android employee app is
  governed by the same rules and must not change. Only the manager (`isAttendanceMgr()`)
  branches are swapped for the per-tab helpers, and new non-admin branches are added to
  collections that become grantable (conveyance, submissions family, notifications).
- Both the per-subcollection matches **and** the top-level `{path=**}` collection-group
  matches must be updated in lockstep (the portal reads cross-user via collectionGroup).
- User-management writes (`users` create/update/delete) remain **admin-only**.

## Section 4 — Migration

One-off Node script (Admin SDK, run once against `white-coffee-92c27`):
for every user whose `tags` array contains `attendance-manager`, set
`tabAccess = ['/working-hours-shortage-excess','/attendance','/ot-shortage',
'/ot-settlements','/manpower-utilisation-input']` and delete the `tags` field. Run the
migration **before** deploying the clean rules (rules do not read `tags` afterward). The
tagged-user set is tiny, so no dual-field transitional logic is needed.

## Section 5 — Testing & deploy

- **`portalAccess.test.ts`** updated for the `tabAccess` model: admin → all tabs; a granted
  subset → exactly those; empty/absent → no access, `hasPortalAccess` false; a stray
  admin-only or unknown path in `tabAccess` is ignored by `allowedPaths`.
- **Build:** `npm run build` must pass (static export).
- **Rules:** no automated harness in this repo. Validate with
  `firebase deploy --only firestore:rules` and a manual smoke test — a scoped manager can
  read a granted collection and is denied on an ungranted one; an employee's own-data app
  access is unchanged.
- **Deploy:** rules via `firebase deploy --only firestore:rules` from repo root; portal via
  its normal static-export hosting deploy.

## Out of scope

- No role changes; `role` still governs admin superuser status and Cloud Function logic.
- No change to the Android app or Cloud Functions (rules-compatible by construction).
- No field-level rule tightening beyond what already exists (e.g. submission status
  guards stay as-is).
