# Superadmin Portal Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/superadmin` page to the admin portal, visible and usable only by a user whose own doc has `superAdmin === true`, that can browse to and edit or delete any Firestore document except `audit_log`.

**Architecture:** A third client-side access tier (`superAdminOnly`) layered onto the existing `portalAccess.ts` two-tier model (admin / tabAccess-grantable). A pure Timestamp↔JSON marker-conversion module. Generic path-based Firestore CRUD functions added to the existing centralized `firestore.ts`. A single page that composes all three: collection picker → paginated document list → whole-document JSON editor with confirm-before-save and type-to-confirm delete.

**Tech Stack:** Next.js 14 (App Router, static export, client components), TypeScript, Firebase JS SDK v9 (modular, client-side `firebase/firestore`), no test framework — pure-logic modules get standalone `npx tsx` test files matching this repo's existing convention (see `src/lib/portalAccess.test.ts`, `src/lib/attendanceState.test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-22-superadmin-portal-editor-design.md`

## Global Constraints

- The real security boundary is `firestore.rules`' `isSuperAdmin()` (already deployed, PR #45) — nothing in this plan touches `firestore.rules`. Every UI gate added here is client-side convenience only.
- `audit_log` is never offered as a write target — excluded from the collection picker's top-level list, matching the rules' own exclusion.
- No document **creation** — browse, edit, and delete of *existing* documents only.
- No changes to any other existing page, to `Sidebar.tsx`, or to `layout.tsx` — the existing `TABS`/`allowedPaths`/`canAccess` machinery already wires a new tab through to all three with no changes needed there.
- Reuse existing CSS classes only (`.btn-primary`, `.btn-outline`, `.btn-danger`, `.btn-success`, `.card`, `.input`, `.label`) — no new global styles.
- Reuse the existing `Icon` component's `'doc'` icon — no new icon added to `Icon.tsx`.

---

### Task 1: Extend `portalAccess.ts` with a superadmin-only tab tier

**Files:**
- Modify: `admin/src/lib/portalAccess.ts`
- Modify: `admin/src/lib/portalAccess.test.ts`

**Interfaces:**
- Consumes: `User.superAdmin?: boolean` (already on the type from PR #45).
- Produces: `TabDef.superAdminOnly?: boolean`, `isSuperAdminUser(user): boolean`, and an updated `allowedPaths()` that Task 4's page relies on being wired correctly (a superadmin must see `/superadmin` in the sidebar; an ordinary admin must not).

- [ ] **Step 1: Write the failing tests**

In `admin/src/lib/portalAccess.test.ts`, insert this new section immediately before the existing `console.log('Config integrity:');` block:

```typescript
console.log('Superadmin tier (visible ONLY with superAdmin === true, not just role==="admin"):');
const superadmin = { role: 'admin' as const, superAdmin: true };
eq('superadmin sees /superadmin', allowedPaths(superadmin).includes('/superadmin'), true);
eq('ordinary admin does NOT see /superadmin', allowedPaths(admin).includes('/superadmin'), false);
eq('superadmin can access /superadmin', canAccess(superadmin, '/superadmin'), true);
eq('ordinary admin cannot access /superadmin', canAccess(admin, '/superadmin'), false);
eq('a non-admin with a stray superAdmin flag still sees nothing extra (no tabAccess)',
  allowedPaths({ role: 'office' as const, superAdmin: true }), []);
```

And extend the existing `Config integrity` block (do not remove its current lines) by adding these two lines right after `eq('/audit is never grantable', GRANTABLE.includes('/audit'), false);`:

```typescript
eq('/superadmin is never grantable', GRANTABLE.includes('/superadmin'), false);
eq('exactly 1 superAdminOnly tab', TABS.filter(t => t.superAdminOnly).map(t => t.path), ['/superadmin']);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npx tsx src/lib/portalAccess.test.ts`
Expected: FAIL — `/superadmin` doesn't exist in `TABS` yet, so `allowedPaths(superadmin).includes('/superadmin')` is `false` (expected `true`), and the two new `Config integrity` assertions fail (`GRANTABLE.includes('/superadmin')` is trivially `false`→ that one passes; `TABS.filter(t => t.superAdminOnly)` is `[]` → fails against `['/superadmin']`). Confirm at least 3 failures are reported.

- [ ] **Step 3: Implement — add the `superAdminOnly` tier**

In `admin/src/lib/portalAccess.ts`, change:

```typescript
  adminOnly?: boolean;   // only admins ever see it; never a grantable matrix column
}
```

to:

```typescript
  adminOnly?: boolean;   // only admins ever see it; never a grantable matrix column
  // Visible ONLY to a user whose own doc has superAdmin === true — a third tier, distinct
  // from adminOnly: an ordinary admin (role==='admin', no superAdmin flag) does NOT see
  // this tab. See docs/superpowers/specs/2026-09-22-superadmin-portal-editor-design.md.
  superAdminOnly?: boolean;
}
```

Change:

```typescript
  { path: '/audit',              label: 'Audit Trail',    icon: 'search',     group: 'Records', adminOnly: true },
];
```

to:

```typescript
  { path: '/audit',              label: 'Audit Trail',    icon: 'search',     group: 'Records', adminOnly: true },
  // superAdminOnly, not adminOnly: an ordinary admin must not see this even though they
  // pass isAdminUser() — only a user with superAdmin === true on their own doc does.
  { path: '/superadmin',         label: 'Superadmin',     icon: 'doc',        group: 'Records', superAdminOnly: true },
];
```

Change:

```typescript
// Set of tab paths a non-admin can be granted (everything not adminOnly).
const GRANTABLE_PATHS = new Set(TABS.filter((t) => !t.adminOnly).map((t) => t.path));

type AccessUser = Pick<User, 'role' | 'tabAccess'>;

export function isAdminUser(user: AccessUser | null | undefined): boolean {
  return user?.role === 'admin';
}
```

to:

```typescript
// Set of tab paths a non-admin can be granted (everything not adminOnly or superAdminOnly).
const GRANTABLE_PATHS = new Set(TABS.filter((t) => !t.adminOnly && !t.superAdminOnly).map((t) => t.path));

type AccessUser = Pick<User, 'role' | 'tabAccess' | 'superAdmin'>;

export function isAdminUser(user: AccessUser | null | undefined): boolean {
  return user?.role === 'admin';
}

export function isSuperAdminUser(user: AccessUser | null | undefined): boolean {
  return user?.superAdmin === true;
}
```

Change:

```typescript
export function allowedPaths(user: AccessUser | null | undefined): string[] {
  if (isAdminUser(user)) return TABS.map((t) => t.path);
  const granted = new Set((user?.tabAccess ?? []).filter((p) => GRANTABLE_PATHS.has(p)));
  return TABS.map((t) => t.path).filter((p) => granted.has(p));
}
```

to:

```typescript
export function allowedPaths(user: AccessUser | null | undefined): string[] {
  if (isAdminUser(user)) {
    // superAdminOnly tabs are hidden from an ordinary admin — only a superadmin sees them.
    return TABS.filter((t) => !t.superAdminOnly || isSuperAdminUser(user)).map((t) => t.path);
  }
  const granted = new Set((user?.tabAccess ?? []).filter((p) => GRANTABLE_PATHS.has(p)));
  return TABS.map((t) => t.path).filter((p) => granted.has(p));
}
```

`hasPortalAccess`, `canAccess`, and `landingPath` need no changes — all three already derive from `allowedPaths()`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx tsx src/lib/portalAccess.test.ts`
Expected: PASS, `0 failed`.

- [ ] **Step 5: Type-check**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add admin/src/lib/portalAccess.ts admin/src/lib/portalAccess.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add superAdminOnly tab tier to portalAccess

A third access tier alongside admin/tabAccess: a tab marked
superAdminOnly is hidden from an ordinary admin and shown only when
the user's own doc has superAdmin === true. Sidebar/layout need no
changes — both already derive purely from allowedPaths().

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Firestore Timestamp↔JSON conversion module

**Files:**
- Create: `admin/src/lib/firestoreJson.ts`
- Create: `admin/src/lib/firestoreJson.test.ts`

**Interfaces:**
- Consumes: `Timestamp` from `firebase/firestore`.
- Produces: `docToEditableJson(data: Record<string, unknown>): string` and `editableJsonToDoc(json: string): Record<string, unknown>`, both consumed directly by Task 4's page.

- [ ] **Step 1: Write the failing test**

Create `admin/src/lib/firestoreJson.test.ts`:

```typescript
// Standalone tests for firestoreJson. Run: npx tsx src/lib/firestoreJson.test.ts
import { Timestamp } from 'firebase/firestore';
import { docToEditableJson, editableJsonToDoc } from './firestoreJson';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

function throws(name: string, fn: () => unknown) {
  try {
    fn();
    failed++; console.log(`  ✗ ${name}: expected to throw, did not`);
  } catch {
    passed++; console.log(`  ✓ ${name}`);
  }
}

console.log('No Timestamps:');
eq(
  'plain document round-trips',
  editableJsonToDoc(docToEditableJson({ a: 1, b: 'x', c: true, d: null })),
  { a: 1, b: 'x', c: true, d: null },
);

console.log('Top-level Timestamp:');
{
  const ts = Timestamp.fromDate(new Date('2026-09-07T10:00:00.000Z'));
  const json = docToEditableJson({ lastModifiedAt: ts });
  eq('shows the __timestamp__ marker', JSON.parse(json), { lastModifiedAt: { __timestamp__: '2026-09-07T10:00:00.000Z' } });
  const back = editableJsonToDoc(json) as { lastModifiedAt: Timestamp };
  eq('round-trips to an equal Timestamp', back.lastModifiedAt.isEqual(ts), true);
}

console.log('Timestamp nested inside an array of maps (suspensionHistory[].at shape):');
{
  const ts = Timestamp.fromDate(new Date('2026-07-14T09:30:00.000Z'));
  const doc = { suspensionHistory: [{ action: 'suspend', at: ts, reason: 'test' }] };
  const back = editableJsonToDoc(docToEditableJson(doc)) as {
    suspensionHistory: { action: string; at: Timestamp; reason: string }[];
  };
  eq('array survives', Array.isArray(back.suspensionHistory), true);
  eq('nested Timestamp round-trips', back.suspensionHistory[0].at.isEqual(ts), true);
  eq('sibling field round-trips', back.suspensionHistory[0].reason, 'test');
}

console.log('Malformed input:');
throws('invalid JSON throws', () => editableJsonToDoc('{not json'));
throws('a JSON array at the top level throws', () => editableJsonToDoc('[1,2,3]'));
throws('a malformed __timestamp__ value throws', () => editableJsonToDoc(JSON.stringify({ x: { __timestamp__: 'not-a-date' } })));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd admin && npx tsx src/lib/firestoreJson.test.ts`
Expected: FAIL — `Cannot find module './firestoreJson'`.

- [ ] **Step 3: Implement `admin/src/lib/firestoreJson.ts`**

```typescript
// Whole-document JSON editing for the /superadmin page (docs/superpowers/specs/
// 2026-09-22-superadmin-portal-editor-design.md). Recursively converts Firestore
// Timestamp values to/from a { __timestamp__: "<ISO>" } marker so an entire document —
// including Timestamps nested inside arrays/maps, e.g. suspensionHistory[].at — can be
// shown and edited as one plain JSON blob.
//
// Known limitation, accepted: GeoPoint and DocumentReference values do NOT round-trip
// through this format. Nothing in this schema currently uses either type (coordinates
// are plain latitude/longitude numbers throughout), so this is a documented
// simplification, not a silent gap.
import { Timestamp } from 'firebase/firestore';

const TIMESTAMP_MARKER = '__timestamp__';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toEditable(value: unknown): JsonValue {
  if (value instanceof Timestamp) {
    return { [TIMESTAMP_MARKER]: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(toEditable);
  }
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toEditable(v);
    }
    return out;
  }
  // string | number | boolean | null pass through unchanged.
  return value as JsonValue;
}

export function docToEditableJson(data: Record<string, unknown>): string {
  return JSON.stringify(toEditable(data), null, 2);
}

function isTimestampMarker(value: unknown): value is { [TIMESTAMP_MARKER]: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 1 &&
    typeof (value as Record<string, unknown>)[TIMESTAMP_MARKER] === 'string'
  );
}

function fromEditable(value: JsonValue): unknown {
  if (isTimestampMarker(value)) {
    const iso = (value as unknown as Record<string, string>)[TIMESTAMP_MARKER];
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid __timestamp__ value: ${JSON.stringify(iso)}`);
    }
    return Timestamp.fromDate(date);
  }
  if (Array.isArray(value)) {
    return value.map(fromEditable);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = fromEditable(v as JsonValue);
    }
    return out;
  }
  return value;
}

export function editableJsonToDoc(json: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Document must be a JSON object, not an array or a primitive.');
  }
  return fromEditable(parsed as JsonValue) as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx tsx src/lib/firestoreJson.test.ts`
Expected: PASS, `0 failed`.

- [ ] **Step 5: Type-check**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add admin/src/lib/firestoreJson.ts admin/src/lib/firestoreJson.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add firestoreJson Timestamp<->JSON conversion

Pure module letting a whole Firestore document (including Timestamps
nested inside arrays/maps) be shown and edited as one JSON blob for
the /superadmin editor. GeoPoint/DocumentReference intentionally don't
round-trip — unused anywhere in this schema.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Generic Firestore CRUD + collection registry

**Files:**
- Modify: `admin/src/lib/firestore.ts`
- Create: `admin/src/lib/superadminCollections.ts`

**Interfaces:**
- Consumes: `db` (already exported from `admin/src/lib/firebase.ts`, already imported at the top of `firestore.ts`).
- Produces: `listDocumentsPage(collectionPath, pageSize, after): Promise<DocListPage>`, `getDocumentRaw(docPath): Promise<Record<string, unknown> | null>`, `setDocumentRaw(docPath, data): Promise<void>`, `deleteDocumentRaw(docPath): Promise<void>`, and the `TOP_LEVEL_COLLECTIONS`/`USER_SUBCOLLECTIONS` registries — all consumed directly by Task 4's page.

This task has no automated test: it's thin wiring over the Firebase client SDK with no pure logic to isolate, and this admin portal has no live-Firestore test harness (its only tests are the standalone pure-logic ones already used in Tasks 1–2). Verification here is `npx tsc --noEmit` plus manual review of the diff against the spec.

- [ ] **Step 1: Add imports needed for pagination**

In `admin/src/lib/firestore.ts`, change the top-of-file import:

```typescript
import {
  collection, collectionGroup, doc, getDocs, getDoc,
  setDoc, updateDoc, deleteDoc, deleteField, writeBatch, increment, runTransaction,
  Timestamp, where, query, orderBy, limit,
} from 'firebase/firestore';
```

to:

```typescript
import {
  collection, collectionGroup, doc, getDocs, getDoc,
  setDoc, updateDoc, deleteDoc, deleteField, writeBatch, increment, runTransaction,
  Timestamp, where, query, orderBy, limit, documentId, startAfter,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
```

- [ ] **Step 2: Append the generic operations**

At the end of `admin/src/lib/firestore.ts` (after the existing `getAuditLog` function, currently the last thing in the file), append:

```typescript
// ── Superadmin generic document access ────────────────────────────────────
// Raw, path-based Firestore operations for the /superadmin editor (see
// docs/superpowers/specs/2026-09-22-superadmin-portal-editor-design.md). Unlike every
// other function in this file, these operate on an arbitrary slash-separated path rather
// than a typed domain object — firestore.rules' isSuperAdmin() catch-all is what actually
// authorizes the caller; nothing here narrows what can be read or written, EXCEPT that
// the /superadmin page itself never offers audit_log as a write target (see
// superadminCollections.ts) — these functions would not stop a caller who tried anyway;
// firestore.rules is what actually denies that write.

export interface DocListPage {
  docs: { id: string; data: Record<string, unknown> }[];
  cursor: QueryDocumentSnapshot<DocumentData> | null; // pass as `after` for the next page; null = no more pages
}

/** One page of document IDs (and their data) in `collectionPath`, ordered by document ID. */
export async function listDocumentsPage(
  collectionPath: string,
  pageSize: number,
  after: QueryDocumentSnapshot<DocumentData> | null,
): Promise<DocListPage> {
  const base = collection(db, collectionPath);
  const q = after
    ? query(base, orderBy(documentId()), startAfter(after), limit(pageSize))
    : query(base, orderBy(documentId()), limit(pageSize));
  const snap = await getDocs(q);
  return {
    docs: snap.docs.map((d) => ({ id: d.id, data: d.data() })),
    cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
  };
}

/** A single document's raw data, or null if it doesn't exist. */
export async function getDocumentRaw(docPath: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, docPath));
  return snap.exists() ? snap.data() : null;
}

/** Full-document overwrite (not merge) — the editor always writes the complete JSON it shows. */
export async function setDocumentRaw(docPath: string, data: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db, docPath), data);
}

export async function deleteDocumentRaw(docPath: string): Promise<void> {
  await deleteDoc(doc(db, docPath));
}
```

- [ ] **Step 3: Create the collection registry**

Create `admin/src/lib/superadminCollections.ts`:

```typescript
// Static registry of every collection this app's firestore.rules recognize, for the
// /superadmin editor's collection picker (docs/superpowers/specs/
// 2026-09-22-superadmin-portal-editor-design.md). Enumerated directly from
// firebase/firestore.rules, not from prose docs — keep in sync if the schema changes.
//
// audit_log is intentionally EXCLUDED from TOP_LEVEL_COLLECTIONS: firestore.rules blocks
// writes to it even for a superadmin, and it already has its own dedicated /audit page.

export interface TopLevelCollection {
  path: string;
  label: string;
}

export const TOP_LEVEL_COLLECTIONS: TopLevelCollection[] = [
  { path: 'users', label: 'Users' },
  { path: 'sites', label: 'Sites' },
  { path: 'holidays', label: 'Holidays' },
  { path: 'config', label: 'Config' },
  { path: 'conveyance', label: 'Conveyance' },
  { path: 'sent_notifications', label: 'Sent Notifications' },
  { path: 'submission_edits', label: 'Submission Edits' },
  { path: 'dailySpend', label: 'Daily Spend' },
  { path: 'system', label: 'System' },
];

export interface UserSubcollection {
  name: string;
  label: string;
}

// Every subcollection nested under users/{uid} that firestore.rules defines. Selecting
// one of these requires an employee to be chosen first — the page builds the full path
// as `users/${uid}/${name}`. wo_ledger additionally has its own nested settlements
// subcollection (users/{uid}/wo_ledger/{date}/settlements) — reached from an open
// wo_ledger document via the page's generic "browse a subcollection of this document"
// control, not listed separately here.
export const USER_SUBCOLLECTIONS: UserSubcollection[] = [
  { name: 'attendance', label: 'Attendance' },
  { name: 'attendance_status', label: 'Attendance Status' },
  { name: 'attendance_corrections', label: 'Attendance Corrections' },
  { name: 'compensation', label: 'Compensation' },
  { name: 'leave_requests', label: 'Leave Requests' },
  { name: 'regularization_requests', label: 'Regularization Requests' },
  { name: 'planned_hours', label: 'Planned Hours' },
  { name: 'daily_hours', label: 'Daily Hours' },
  { name: 'ot_approvals', label: 'OT Approvals' },
  { name: 'wo_ledger', label: 'WO Ledger' },
  { name: 'settlements', label: 'Settlements' },
  { name: 'specialAllowance', label: 'Special Allowance' },
  { name: 'material_requests', label: 'Material Requests' },
  { name: 'material_purchases', label: 'Material Purchases' },
  { name: 'material_transfers', label: 'Material Transfers' },
  { name: 'tool_transfers', label: 'Tool Transfers' },
  { name: 'work_progress', label: 'Work Progress' },
  { name: 'notifications', label: 'Notifications' },
];
```

- [ ] **Step 4: Type-check**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/firestore.ts admin/src/lib/superadminCollections.ts
git commit -m "$(cat <<'EOF'
feat(admin): add generic Firestore CRUD + collection registry

listDocumentsPage/getDocumentRaw/setDocumentRaw/deleteDocumentRaw
operate on raw paths rather than typed domain objects, for the
/superadmin editor. firestore.rules' isSuperAdmin() is what actually
authorizes these calls, not anything in this file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The `/superadmin` page

**Files:**
- Create: `admin/src/app/(admin)/superadmin/page.tsx`

**Interfaces:**
- Consumes: `listDocumentsPage`, `getDocumentRaw`, `setDocumentRaw`, `deleteDocumentRaw`, `stamped`, `getAllUsers` (from `@/lib/firestore`); `docToEditableJson`, `editableJsonToDoc` (from `@/lib/firestoreJson`); `TOP_LEVEL_COLLECTIONS`, `USER_SUBCOLLECTIONS` (from `@/lib/superadminCollections`); `User` (from `@/types`).
- Produces: nothing consumed elsewhere — this is the leaf page. Reached automatically via the `(admin)` layout's existing routing once `allowedPaths()` (Task 1) includes `/superadmin` for the signed-in user.

- [ ] **Step 1: Create the page**

Create `admin/src/app/(admin)/superadmin/page.tsx`:

```typescript
'use client';
/**
 * Superadmin editor — browse and edit/delete any Firestore document directly.
 *
 * Gated entirely by the layout's canAccess/allowedPaths (superAdminOnly tab, see
 * src/lib/portalAccess.ts) — firestore.rules' isSuperAdmin() catch-all is the real
 * boundary. This page has NO domain awareness: editing a document here does not trigger
 * the side effects (OT ledger recompute, plBalance adjustments, notifications, ...) that
 * the app's normal flows would. See docs/superpowers/specs/
 * 2026-09-22-superadmin-portal-editor-design.md.
 */
import { useCallback, useEffect, useState } from 'react';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import {
  listDocumentsPage, getDocumentRaw, setDocumentRaw, deleteDocumentRaw,
  getAllUsers, stamped, type DocListPage,
} from '@/lib/firestore';
import { docToEditableJson, editableJsonToDoc } from '@/lib/firestoreJson';
import { TOP_LEVEL_COLLECTIONS, USER_SUBCOLLECTIONS } from '@/lib/superadminCollections';
import type { User } from '@/types';

const PAGE_SIZE = 25;

type Source = 'top-level' | 'user-sub';

export default function SuperadminPage() {
  const [source, setSource] = useState<Source>('top-level');
  const [topLevel, setTopLevel] = useState(TOP_LEVEL_COLLECTIONS[0].path);
  const [users, setUsers] = useState<User[]>([]);
  const [employeeUid, setEmployeeUid] = useState('');
  const [subcollection, setSubcollection] = useState(USER_SUBCOLLECTIONS[0].name);
  const [collectionPath, setCollectionPath] = useState<string | null>(null);

  const [page, setPage] = useState<DocListPage | null>(null);
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [idFilter, setIdFilter] = useState('');

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [docError, setDocError] = useState('');
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [subPathInput, setSubPathInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { getAllUsers(true).then(setUsers).catch(() => {}); }, []);

  const loadPage = useCallback(async (path: string, after: QueryDocumentSnapshot<DocumentData> | null) => {
    setListLoading(true); setListError('');
    try {
      const result = await listDocumentsPage(path, PAGE_SIZE, after);
      setPage(result);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      setPage(null);
    }
    setListLoading(false);
  }, []);

  const openCollection = useCallback((path: string) => {
    setCollectionPath(path);
    setCursorStack([null]);
    setOpenPath(null);
    setIdFilter('');
    loadPage(path, null);
  }, [loadPage]);

  const goNext = () => {
    if (!collectionPath || !page?.cursor) return;
    const next = [...cursorStack, page.cursor];
    setCursorStack(next);
    loadPage(collectionPath, page.cursor);
  };

  const goPrev = () => {
    if (!collectionPath || cursorStack.length <= 1) return;
    const next = cursorStack.slice(0, -1);
    setCursorStack(next);
    loadPage(collectionPath, next[next.length - 1]);
  };

  const openDoc = useCallback(async (id: string) => {
    if (!collectionPath) return;
    const path = `${collectionPath}/${id}`;
    setDocError(''); setConfirmingSave(false); setDeleteConfirmText(''); setSubPathInput('');
    try {
      const data = await getDocumentRaw(path);
      if (!data) { setDocError(`No document at ${path}.`); return; }
      setOpenPath(path);
      setOriginal(data);
      setJsonText(docToEditableJson(data));
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
  }, [collectionPath]);

  const openById = () => { if (idFilter.trim()) openDoc(idFilter.trim()); };

  const closeDoc = () => {
    setOpenPath(null); setOriginal(null); setJsonText(''); setDocError('');
    setConfirmingSave(false); setDeleteConfirmText(''); setSubPathInput('');
  };

  const requestSave = () => {
    setDocError('');
    try {
      editableJsonToDoc(jsonText); // validate before showing the confirm step
      setConfirmingSave(true);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmSave = async () => {
    if (!openPath) return;
    setSaving(true); setDocError('');
    try {
      const parsed = editableJsonToDoc(jsonText);
      await setDocumentRaw(openPath, stamped(parsed));
      const fresh = await getDocumentRaw(openPath);
      setOriginal(fresh);
      setJsonText(docToEditableJson(fresh ?? {}));
      setConfirmingSave(false);
      if (collectionPath) loadPage(collectionPath, cursorStack[cursorStack.length - 1]);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const idOf = (path: string) => path.split('/').pop() ?? path;

  const confirmDelete = async () => {
    if (!openPath || deleteConfirmText !== idOf(openPath)) return;
    setSaving(true); setDocError('');
    try {
      await deleteDocumentRaw(openPath);
      closeDoc();
      if (collectionPath) loadPage(collectionPath, cursorStack[cursorStack.length - 1]);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const openSubcollection = () => {
    if (!openPath || !subPathInput.trim()) return;
    openCollection(`${openPath}/${subPathInput.trim()}`);
  };

  return (
    <div className="max-w-[1200px]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Superadmin — Document Editor</h1>
        <p className="text-sm text-[#8A817A] mt-1">
          Raw read/write on any collection except audit_log. No domain logic runs on save —
          this edits exactly what you type.
        </p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-[5px] bg-[#F1EEEA] rounded-[11px] p-1 w-fit">
            {(['top-level', 'user-sub'] as Source[]).map((s) => (
              <button key={s} onClick={() => setSource(s)}
                className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors ${source === s ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(26,22,19,0.06)]' : 'text-[#8A817A] hover:text-text-primary'}`}>
                {s === 'top-level' ? 'Top-level collection' : 'Employee subcollection'}
              </button>
            ))}
          </div>

          {source === 'top-level' ? (
            <div>
              <label className="label">Collection</label>
              <select className="input !w-auto min-w-[220px]" value={topLevel} onChange={(e) => setTopLevel(e.target.value)}>
                {TOP_LEVEL_COLLECTIONS.map((c) => <option key={c.path} value={c.path}>{c.label}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="label">Employee</label>
                <select className="input !w-auto min-w-[220px]" value={employeeUid} onChange={(e) => setEmployeeUid(e.target.value)}>
                  <option value="">Select an employee…</option>
                  {users.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
                    .map((u) => <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Subcollection</label>
                <select className="input !w-auto min-w-[200px]" value={subcollection} onChange={(e) => setSubcollection(e.target.value)}>
                  {USER_SUBCOLLECTIONS.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </div>
            </>
          )}

          <button
            className="btn-primary"
            disabled={source === 'user-sub' && !employeeUid}
            onClick={() => openCollection(source === 'top-level' ? topLevel : `users/${employeeUid}/${subcollection}`)}
          >
            Browse
          </button>
        </div>
      </div>

      {collectionPath && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-sm text-[#6B625A]">{collectionPath}</div>
            <div className="flex items-center gap-2">
              <input
                className="input !w-auto !py-2 text-sm"
                placeholder="Open by exact document ID…"
                value={idFilter}
                onChange={(e) => setIdFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') openById(); }}
              />
              <button className="btn-outline" onClick={openById} disabled={!idFilter.trim()}>Open</button>
            </div>
          </div>

          {listLoading ? (
            <div className="text-center text-[13px] text-[#9A938C] py-8">Loading…</div>
          ) : listError ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{listError}</div>
          ) : !page || page.docs.length === 0 ? (
            <div className="text-center text-[13px] text-[#9A938C] py-8">No documents.</div>
          ) : (
            <>
              <ul className="divide-y divide-[#EFEBE6]">
                {page.docs.map((d) => (
                  <li key={d.id}>
                    <button className="w-full text-left py-2 font-mono text-sm hover:text-primary" onClick={() => openDoc(d.id)}>
                      {d.id}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 mt-3">
                <button className="btn-outline" onClick={goPrev} disabled={cursorStack.length <= 1}>Prev</button>
                <button className="btn-outline" onClick={goNext} disabled={!page.cursor || page.docs.length < PAGE_SIZE}>Next</button>
              </div>
            </>
          )}
        </div>
      )}

      {openPath && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-sm text-[#6B625A]">{openPath}</div>
            <button className="btn-outline" onClick={closeDoc}>Close</button>
          </div>

          {docError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{docError}</div>}

          <textarea
            className="input font-mono text-xs !h-[420px] resize-y"
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setConfirmingSave(false); }}
            spellCheck={false}
          />

          {!confirmingSave ? (
            <div className="flex items-center gap-2 mt-3">
              <button className="btn-primary" onClick={requestSave}>Save…</button>
            </div>
          ) : (
            <div className="mt-3 p-3 bg-[#FDF3E3] border border-[#F0E0C6] rounded-lg">
              <div className="text-sm font-medium mb-2">Confirm write to {openPath}</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="label">Before</div>
                  <pre className="text-xs bg-white border border-border rounded-lg p-2 max-h-[240px] overflow-auto">{JSON.stringify(original, null, 2)}</pre>
                </div>
                <div>
                  <div className="label">After</div>
                  <pre className="text-xs bg-white border border-border rounded-lg p-2 max-h-[240px] overflow-auto">{jsonText}</pre>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-success" onClick={confirmSave} disabled={saving}>{saving ? 'Writing…' : 'Confirm write'}</button>
                <button className="btn-outline" onClick={() => setConfirmingSave(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-[#EFEBE6]">
            <div className="label">Danger zone</div>
            <div className="flex items-center gap-2 mb-3">
              <input
                className="input !w-auto !py-2 text-sm"
                placeholder={`Type "${idOf(openPath)}" to confirm delete`}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
              <button
                className="btn-danger"
                disabled={deleteConfirmText !== idOf(openPath) || saving}
                onClick={confirmDelete}
              >
                Delete document
              </button>
            </div>

            <div className="label">Browse a subcollection of this document</div>
            <div className="flex items-center gap-2">
              <input
                className="input !w-auto !py-2 text-sm"
                placeholder="e.g. settlements"
                value={subPathInput}
                onChange={(e) => setSubPathInput(e.target.value)}
              />
              <button className="btn-outline" onClick={openSubcollection} disabled={!subPathInput.trim()}>Browse</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Re-run every pure-logic test suite in the project (regression check)**

Run: `cd admin && npx tsx src/lib/portalAccess.test.ts && npx tsx src/lib/firestoreJson.test.ts`
Expected: both PASS, `0 failed`.

- [ ] **Step 4: Manual QA checklist (record results, don't skip)**

This page cannot be exercised by an automated test (no test harness talks to live Firestore in this portal). Before considering this task done, log into the portal as the superadmin account (Sanjay K) and confirm by hand:
1. `/superadmin` appears in the sidebar for Sanjay K, and does **not** appear for an ordinary admin account.
2. Browsing a top-level collection (e.g. `holidays`) lists documents; Next/Prev paginate correctly.
3. Browsing an employee's `attendance_status` subcollection and opening the 2026-09-07 doc (or any known date) shows its JSON, including any `Timestamp` fields as `{"__timestamp__": ...}`.
4. Editing a non-critical field, saving, shows the before/after diff, and the write succeeds (verify in Firebase Console or by re-opening the doc).
5. Typing the wrong text in the delete-confirm box leaves the Delete button disabled; typing the exact document ID enables it.
6. `audit_log` is not present in the top-level collection dropdown.
7. Signed in as an ordinary (non-superadmin) `admin`, navigating directly to `/superadmin` by URL redirects away (via the layout's `canAccess` guard).

- [ ] **Step 5: Commit**

```bash
git add "admin/src/app/(admin)/superadmin/page.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): add /superadmin document editor page

Guided collection/document pickers, whole-document JSON editing via
firestoreJson, confirm-before-save with a before/after diff, and
delete gated behind typing the document's own ID. Visible only when
allowedPaths() grants /superadmin (superAdmin === true).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## After all tasks

```bash
cd admin && npx tsc --noEmit && npx tsx src/lib/portalAccess.test.ts && npx tsx src/lib/firestoreJson.test.ts
```

Deploying this (there's nothing to deploy beyond the normal `admin/` hosting build — `npm run build && firebase deploy --only hosting`, or `npm run deploy`) is a separate, explicit action for you to trigger once you've completed the manual QA checklist in Task 4.
