# Sales Role — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorming complete)
**Branch:** `roles`

## Problem

WhiteCoffee has three account types today — `admin`, `office`, `operations` — set on
`users/{uid}.role` from the admin portal and read verbatim by the Android app, the
Cloud Functions, and (for `admin` only) the Firestore rules. The client needs a fourth
role, **`sales`**, for staff who split their time between the office and customer/site
visits.

`sales` is deliberately a *mix* of the existing two roles, which is exactly why it is
risky to add: nearly every role decision in the codebase is written as a **binary**
`isOps = role === "operations" ? (site behavior) : (office behavior)`. A naively added
`sales` silently lands in the `office` branch everywhere — correct for the status window,
but **wrong** for conveyance, wrong for the hybrid check-in events, and it would wrongly
pull sales into office-only surfaces. The design therefore centralizes the axes on which
sales differs instead of hand-patching every branch.

## Sales role behavior (agreed)

| Aspect | Behavior |
|---|---|
| Check-in flow | **True hybrid** — the same person may do an office day (`office_in`/`office_out`) **or** a site-visit day (`site_in`/`site_out`, free-text `siteName`), chosen per day |
| Daily status | **First check-in of ANY type, last check-out of ANY type**, scored against a **fixed 10:00–18:00 window** → `Present`/`SL`/`HalfDay`/`LNF`/`Absent`/`PL`/`LWP`. The window is used for the status bucket **only** |
| OT / shortage | **None.** Never computed, never stored (`daily_hours`, `ot_approvals`), never shown |
| WO (Week Off) | **None.** Sales has no WO concept |
| Sundays / holidays | Skipped exactly as today — a sales visit is recorded (for conveyance/history) but writes **no** `attendance_status` doc and pays nothing |
| Conveyance | **Enabled**, same as operations |
| Employee categories | **None** (categories are ops-only labor codes) |
| Manpower / labor tracking | **Excluded** — not in Manpower Utilisation Input, not in the Site Manpower report; sales `site_in`/`site_out` is attendance + conveyance only |
| Leave / PL / regularization | Normal, same as everyone. Regularizing a sales day to Present just sets the status — **no** OT/shortage side effect |
| Payroll | Existing `daysNP` / salary formula; **no** OT-settlement term |

## Approach: capability table (recommended over per-site branching)

Rather than hand-editing each `isOps` branch (Approach A, ~15 easy-to-miss sites, each
miss a silent payroll/attendance bug), introduce a small **role-capabilities** module as
the single source of truth for the axes where roles differ, then route decision points
through it. It cannot be a shared package (no shared JS build graph), so it is mirrored on
each side and unit-tested on each side.

### Capability axes

| capability | office | operations | sales |
|---|---|---|---|
| `attendanceInTypes` | `office_in` | `site_in`,`market_in` | `office_in`,`site_in`,`market_in` |
| `attendanceOutTypes` | `office_out` | `site_out`,`market_out` | `office_out`,`site_out`,`market_out` |
| `usesFixedWindow` (10–18 for status) | ✓ | ✗ (planned_hours) | ✓ |
| `usesOtShortageLedger` | ✗ | ✓ | ✗ |
| `tracksShortage` | ✓ | ✓ | ✗ |
| `usesConveyance` | ✗ | ✓ | ✓ |
| `getsCategories` | ✗ | ✓ | ✗ |
| `inManpowerReports` | ✗ | ✓ | ✗ |

`tracksShortage` was added during implementation (8th axis). It cannot be derived from the
others: office/admin show shortage on the Working Hours page but run **no** ledger, so
`usesOtShortageLedger` is false for them while shortage is still true. Sales is the only
role with a fixed window scored for **status only**. Without this axis the pages had to
infer "is sales" from `usesFixedWindow && !usesConveyance`, which silently couples shortage
to conveyance and would break for any future fixed-window role that earns conveyance.

`admin` continues to behave as office for attendance and remains the only role gated in
Firestore rules.

## Components & changes

### 1. Role-capabilities module (backbone)
- `admin/src/lib/roleCapabilities.ts` (+ `roleCapabilities.test.ts`, run via `npx tsx`)
- `firebase/functions/roleCapabilities.js` (+ `node --test` cases)
- Android: `ROLE_SALES` + `isSales` on `SessionManager`, plus a `RoleCapabilities` Kotlin
  object mirroring the same axes
- Existing `isOps ? … : …` decision points are rerouted through these predicates so
  `office`/`operations` behavior is **unchanged** and `sales` is defined by its column.

### 2. Android — hybrid check-in
- Add `ROLE_SALES = "sales"` and `isSales` to `SessionManager`
  (`data/session/SessionManager.kt`).
- New sales attendance screen offering **both** an office check-in
  (`office_in`/`office_out`) and a site visit (`site_in`/`site_out` with `siteName`),
  chosen per day — reusing the existing office and site view models rather than a rewrite.
- Enable the **conveyance** feature for sales (currently ops-gated).
- Keep `AttendanceStatusRules.kt` in sync with the backend status logic (sales =
  fixed-window bucket over all event types).

### 3. Backend / Cloud Functions (`firebase/functions/index.js` + `backfill-attendance-tz.js`)
- **Status computation**: for sales, `checkIns` = first event whose type is in
  `attendanceInTypes(sales)`, `checkOuts` = last event whose type is in
  `attendanceOutTypes(sales)`, scored against the **fixed 10–18** window → the existing
  office-style buckets. **No** `daily_hours`, **no** `ot_approvals`, **no** ledger writes.
- **Sundays/holidays**: unchanged skip behavior — no status doc, no pay for a sales visit.
- **No WO** handling for sales.
- **Conveyance**: include sales alongside operations in the payroll `covy` computation
  (currently `user.role === "operations"`, ~`index.js:1146`) via `usesConveyance(role)`.
- **Sheets export**: sales appears on the Attendance and Employee Dashboard tabs with
  salary + conveyance; **excluded** from the Overtime Exception and Site Manpower reports
  (`inManpowerReports(role)` / `usesOtShortageLedger(role)` false); no settlement value.
- `daysNP` / salary use the existing formula with no OT-settlement term for sales.

### 4. Admin portal
- `users/page.tsx`: add `'sales'` to `ROLES`; **no** categories UI when
  `!getsCategories(role)`; give `RoleBadge` a sales color/label.
- **Sales visible on**: Attendance, Daily Activity, Conveyance, Leaves, Regularization,
  Users, Employee Dashboard, **Working Hours-Shortage/Excess** (Shortage/Overtime columns
  render **blank/NA** for sales via `usesOtShortageLedger(role)`).
- **Sales excluded from**: OT & Shortage, OT Settlements, Manpower Utilisation Input,
  Site Manpower report.
- Attendance page: for sales, hide the shift/`planned_hours`/declared-OT/Authorize-OT/WO
  controls (fixed window, no ledger).

### 5. Firestore rules (`firebase/firestore.rules`)
- Sales is a normal employee governed by `tabAccess`, like office/ops; **only `admin`
  stays role-gated**. **Verified during implementation: NO rules change is needed.**
  `attendance` create is `isLoggedIn() && isOwner(userId)` with no role check, so a sales
  user may write `office_in` *and* `site_in`; the `conveyance` collection is written by the
  Cloud Function via the Admin SDK (which bypasses rules) and read via `canAccessConveyance()`
  (tab-based, not role-based); `role` appears only inside `isAdmin()`. Nothing assumes a
  binary office/ops split. Rules were **not** modified, so no rules deploy is required.

### 6. Testing
- Capability tables unit-tested on all three sides.
- Backend `node --test` boundary suite extended with sales cases: hybrid events →
  fixed-window bucket; Sunday visit → no status doc; conveyance included in payroll; no
  ledger docs written; excluded from manpower/OT reports.
- Admin: `roleCapabilities.test.ts` + page-filter checks via `npx tsx`.

## Non-goals / YAGNI
- No WO, OT, or shortage machinery for sales.
- No wholesale refactor of the office/ops role checks — only the cross-cutting axes are
  centralized; unrelated `role` checks are left as-is.
- No sales-specific manpower/labor reporting.

## Open items to verify during implementation
- ~~Exact current file/page names~~ — resolved against the live code.
- ~~Whether any Firestore conveyance/attendance rule needs an explicit sales allowance~~ —
  resolved: none does (see §5).

### 7. Notifications (added during implementation)
- **Sales is its own recipient group** — `all` / `operations` / `office` / **`sales`** /
  `specific`. `office` still means `role in ['office','admin']`; sales is **never** folded
  into it despite sharing the fixed window. Both halves are required or the feature
  half-works: the portal (`notifications/page.tsx` + `SentNotification['recipientType']`)
  resolves the in-app recipients, and `sendPushNotification` in `functions/index.js` runs
  the matching `where("role","==","sales")` query for the FCM push.

## Known gaps (deliberately not addressed)
- **Android**: sales sees the same home cards as office (M&T Request / Work Progress
  hidden); a site-visit day still requires a Home In punch first, matching ops. No Android
  unit tests were added for `RoleCapabilities` (the app has no test suite for this layer).
- **Sales `siteId` is always blank** in the Sheets Attendance tab: `siteId` is filled by an
  admin on Manpower Utilisation Input, from which sales is excluded by design. The
  free-text `siteName` still shows in the Location column. Correct per "sales site visits
  are attendance + conveyance only".
