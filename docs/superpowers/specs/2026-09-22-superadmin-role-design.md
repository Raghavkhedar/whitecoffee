# Superadmin role — design

## Problem

Add a top privilege tier to the admin portal, above today's `admin`, that can change
any value in the database with no restrictions.

## Context: what `admin` already can't do

`admin` already has near-universal write access — every collection a human operator
plausibly needs to edit (users, compensation, attendance, leaves, OT, settlements,
holidays, config, sites, conveyance) is open to `isAdmin()` in `firestore.rules`, with
no field-level limits.

Only five walls in `firestore.rules` block even `isAdmin()` today, and none of them
exist to limit an admin's *decisions* — they exist to stop the client SDK from writing
into state that only Cloud Functions (Admin SDK, which bypasses rules entirely) are
meant to own:

| Wall | Rule | What it protects |
|---|---|---|
| `audit_log` write | `allow write: if false` | tamper-evidence — "an audit log a suspect can edit is not evidence" |
| `attendance_corrections` update/delete | `allow update, delete: if false` | immutable log of admin's own past punch-corrections |
| `wo_ledger/{date}/settlements/{autoId}` update/delete | `allow update: if false; allow delete: if false` | immutable log of past WO-debt settlements |
| `dailySpend` write | `allow write: if false` | Cloud-Function-only payroll snapshot |
| `system/**` write | `allow write: if false` | nightly-run records + the PL-accrual **idempotency marker** — a client write here could double-credit every employee a paid leave day |
| `attendance_status` on a Sunday/holiday | `!isRestDate(date)` | Protocol-1 rest-day invariant (`docs/superpowers/specs/2026-09-14-ot-redesign-design.md`) |

## Decision

**Superadmin bypasses all six walls above except `audit_log`.** `audit_log` stays
`allow write: if false` for everyone, superadmin included — every other write a
superadmin makes is still recorded there as evidence, even though nothing else in the
database can stop them from making it.

Superadmin does **not** get a new `role` enum value. It is an orthogonal boolean flag,
`superAdmin: true`, on `users/{uid}`, layered on top of an existing `role: 'admin'`
account. Reasons:

- `role` drives `roleCapabilities.ts`/`.js`/`.kt`, mirrored across admin/functions/
  Android and unit-tested on all three sides. A 5th enum value would force a change
  (or an explicit fallback decision) on all three, for a role that never needs
  attendance/OT/conveyance behavior of its own.
- `admin/src/lib/portalAccess.ts`'s `isAdminUser()` already gates on `role === 'admin'`
  — a superadmin account keeping `role: 'admin'` means portal login, sidebar, and every
  existing admin-only tab (`/dashboard`, `/users`, `/access`, `/daily-activity`,
  `/audit`) work with **zero admin-portal code changes**.
- Android never needs to know this flag exists (superadmin is portal-only — see below).

**Superadmin is portal-only.** It never appears in the Android app's role handling —
no attendance behavior of its own, no `RoleCapabilities.kt` change.

**Provisioning is console/script-only, never exposed in the portal UI.** Any existing
`admin` already has unrestricted field-level write on any `users/{uid}` doc (the
`isAdmin()` branch of the `users/{userId}` update rule has no `notSelf` guard, unlike
leaves/OT/settlements). If `superAdmin` were settable from `/users`, any admin could
one-click promote themselves. Keeping it settable only via Firebase Console or a
one-off Admin-SDK script means only whoever holds Firebase project IAM access — a
materially smaller set of people than "everyone with the app-level admin role" — can
grant it.

## Design

### 1. Data model

`users/{uid}.superAdmin?: boolean` — optional, absent/false by default. No changes to
`admin/src/types.ts`'s `User` type are required (nothing in the portal reads this
field), but it's added there anyway for documentation/type-completeness since it's a
real field on the document shape.

### 2. `firestore.rules`

One new helper function, next to `isAdmin()`:

```
function isSuperAdmin() {
  return isLoggedIn()
    && get(/databases/$(database)/documents/users/$(request.auth.uid))
         .data.get('superAdmin', false) == true;
}
```

One new catch-all match block:

```
// ── Superadmin — bypasses every wall except audit_log ────────────────
// Firestore ORs every matching rule for a given path, so this is purely additive:
// it does not touch any of the existing per-collection match blocks above, and a
// superadmin gets extra access without any of them needing to change. audit_log is
// excluded by path so `allow write: if false` there still applies to superadmin —
// every other write a superadmin makes is still recorded there as evidence.
match /{document=**} {
  allow read, write: if isSuperAdmin() && document[0] != 'audit_log';
}
```

This single block is the entire functional change. It deliberately bypasses:
`attendance_corrections` update/delete, `wo_ledger/settlements` update/delete,
`dailySpend` write, `system/**` write (including the accrual idempotency marker), and
the `isRestDate()` guard on `attendance_status` — all per the explicit decision above.

### 3. Provisioning script

A one-off script under `firebase/functions/scripts/setSuperAdmin.js`, matching the
existing convention (`migrateLegacyLeaveStatuses.js`): takes a uid or email, uses the
Admin SDK (bypasses rules), sets `superAdmin: true` on that user's doc. Confirms the
target user exists and prints their current `role`/`name` before writing, so a typo'd
uid doesn't silently create a stray field on the wrong doc. Not wired into any menu,
cron, or UI — run by hand, once, per grant.

### 4. Testing

Extend `firebase/rules-tests` (currently 110 tests, run via `npm test` in that
directory) with a new file, `superadmin.test.js`:

- A superadmin can write to each of the 5 previously-`isAdmin()`-blocked paths:
  `attendance_corrections` update/delete, `wo_ledger/{date}/settlements/{id}` update/
  delete, `dailySpend` write, `system/{doc}` write, `attendance_status` write on a
  known Sunday/holiday date.
- A superadmin **cannot** write to `audit_log` (still `if false`).
- An ordinary `admin` (no `superAdmin` flag) is still blocked from all 6 paths, exactly
  as today — regression coverage that the new catch-all doesn't leak to non-superadmin
  admins.
- A non-admin, non-superadmin user is still blocked from an arbitrary path it
  previously had no access to (e.g. another user's `compensation/current`) —
  regression coverage that the catch-all's `isSuperAdmin()` check is doing real work
  and not accidentally always-true.

Full suite (`npm test` in `firebase/rules-tests`) run before and after, per this
repo's standing rule for any `firestore.rules` change.

## Non-goals

- No admin-portal UI for granting/revoking superadmin.
- No Android changes.
- No change to `roleCapabilities.ts`/`.js`/`.kt` or the `Role` type.
- No audit_log bypass, under any circumstance.

## Risks (accepted, not mitigated further)

- A compromised superadmin session (stolen token, leaked credentials) can double-credit
  every employee a paid leave day by resetting the accrual marker, silently rewrite
  frozen settlement history, or forge `dailySpend`/`system` records — with no function
  anywhere designed to expect or reconcile such a write. `audit_log` will show that the
  write happened, but nothing stops or corrects it automatically.
- The catch-all is a single rule the whole bypass depends on; a typo in
  `document[0] != 'audit_log'` (e.g. dropping the `!`) would silently open `audit_log`
  writes to superadmin too. The `superadmin.test.js` audit_log-denial case exists
  specifically to catch this.
