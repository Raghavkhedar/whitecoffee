# Account Suspension — Design

**Date:** 2026-07-14
**Branch:** `account-management`
**Status:** Approved for planning

## Problem

Admins can already deactivate an employee (blocks Auth login, keeps all data) and
reactivate them later via the `setUserActive` Cloud Function and the Users page. But the
flow reads as a permanent "offboard" and captures nothing about *why* or *when* — so admins
perceive it as one-way and don't trust it for a temporary hold.

This work reframes the existing deactivate/reactivate mechanic as an explicit, reversible
**suspension** that records a reason, who did it and when, an optional expected return date,
and a running history — without changing the underlying `active` flag mechanic.

## Scope decisions

- **Single state.** Every inactive employee is simply **"Suspended"**. There is no separate
  "permanent offboard / left for good" state. `active: false` === suspended.
- **Reason is free text**, required on suspend.
- **Expected return date is informational only** — there is **no** auto-reactivation. The
  account stays suspended until an admin explicitly ends the suspension.
- **No company-wide suspensions report** (YAGNI). If that's ever needed, migrate history to a
  subcollection then.
- The underlying mechanic is unchanged: Auth `disabled` + doc `active` still toggle together,
  and **no employee data is ever deleted**.

## Data model

Add to the `User` type (`src/types/index.ts`) and write on the `users/{uid}` doc. Fields
below the `active` flag exist only while suspended (cleared on reactivate):

| Field | Type | Notes |
|-------|------|-------|
| `active` | `boolean?` | Unchanged. `false` = suspended. Missing = active (legacy). |
| `suspendedReason` | `string?` | Required when suspending. Cleared on reactivate. |
| `suspendedBy` | `string?` | Admin's name. **Set server-side** from `request.auth`; not client-supplied. |
| `suspendedAt` | `Timestamp?` | Server-side stamp. |
| `expectedReturn` | `string \| null` | `"YYYY-MM-DD"`, optional. Informational. |
| `suspensionHistory` | `SuspensionEvent[]?` | Appended on every suspend AND reactivate. |

```ts
interface SuspensionEvent {
  action: 'suspend' | 'reactivate';
  reason?: string;         // present on suspend
  by: string;              // admin name, server-resolved
  at: Timestamp;           // server-resolved
  expectedReturn?: string; // present on suspend when set
}
```

**On suspend:** set `active:false`, `suspendedReason`, `suspendedBy`, `suspendedAt`,
`expectedReturn`; push a `suspend` event.
**On reactivate:** set `active:true`; clear `suspendedReason`/`suspendedBy`/`suspendedAt`/
`expectedReturn`; push a `reactivate` event.

History is an array on the doc (not a subcollection): suspensions are rare per employee, the
Users page already loads the full user doc, so history costs no extra reads, no new collection,
and no new Firestore rules.

## Backend — extend `setUserActive` Cloud Function

`firebase/functions/index.js` (`exports.setUserActive`). Keep the single atomic call; it
already `assertAdmin`s and toggles Auth + doc together.

- Accept `reason` (string) and `expectedReturn` (string|null) in `request.data` alongside the
  existing `uid`, `active`.
- When `active === false`: require a non-empty `reason` (else `invalid-argument`).
- Resolve the acting admin's name: look up the caller's own `users/{request.auth.uid}` doc
  and use its `name` (fallback to the auth token email).
- Build the metadata + a `SuspensionEvent`, using `admin.firestore.FieldValue.serverTimestamp()`
  for `suspendedAt`/`at` and `FieldValue.arrayUnion(event)` for `suspensionHistory`.
- On reactivate, use `FieldValue.delete()` to clear the current-state fields.

Deploy: `firebase deploy --only functions` from repo root.

## Frontend — `src/lib/firestore.ts`

Widen the wrapper:

```ts
export async function setUserActive(
  uid: string,
  active: boolean,
  opts?: { reason?: string; expectedReturn?: string | null },
) {
  await httpsCallable(functions, 'setUserActive')({ uid, active, ...opts });
}
```

## Frontend — Users page (`src/app/(admin)/users/page.tsx`)

- **Wording:** red "Deactivate Employee" → **"Suspend Employee"**; the "Inactive" badge →
  **"Suspended"**; the "Show inactive" checkbox → **"Show suspended"**. Green button stays
  "Reactivate Employee".
- **Suspend flow:** clicking Suspend opens a small inline form (not a raw confirm): a required
  **Reason** textarea and an optional **Expected return** date input, with Confirm/Cancel.
  Confirm calls `setUserActive(uid, false, { reason, expectedReturn })`. Reactivate keeps its
  current confirm and calls `setUserActive(uid, true)`.
- **Suspended-employee detail:** in the edit modal for a suspended user, show current reason,
  `suspendedBy` + `suspendedAt`, expected return, and a **history log** (most recent first)
  listing each suspend/reactivate with reason, who, and when.
- The CSV export "Status" column keeps working; change its label text from `Inactive` →
  `Suspended`.

## Error handling

- Empty reason on suspend → the form blocks Confirm client-side; the Cloud Function also
  rejects with `invalid-argument` as a backstop.
- All the existing `setUserActive` failure handling (toast/error state around the call) is
  reused unchanged.

## Testing

- No test framework in `admin/` (per CLAUDE.md) — verify the UI manually via the running app.
- `firebase/functions` has a `node --test` suite. If the reason-required / history-append
  logic is factored into a pure helper, add a unit test there; otherwise validate the function
  with `node --check` + a manual invocation.

## Out of scope

- Auto-reactivation on `expectedReturn`.
- Notifying the employee of suspension.
- Any separate permanent-termination state.
- Cross-employee suspension reporting.
