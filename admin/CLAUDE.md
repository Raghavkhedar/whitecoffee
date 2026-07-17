# CLAUDE.md

## Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Static export to /out (required before deploy)
npm run deploy       # build + firebase deploy --only hosting
firebase login       # One-time auth before first deploy
firebase login --reauth  # Re-authenticate when credentials expire (run in terminal, not Claude Code)
```

No test framework configured.

## Architecture

**Next.js 14 static export** → Firebase Hosting. `output: 'export'` in `next.config.ts`; `next start` unused — builds produce static HTML in `/out`. All pages are `'use client'`.

**Data flow**: Pages → `src/lib/firestore.ts` → Firebase SDK. All Firestore operations are centralized in `firestore.ts` (40+ functions). Pages use local `useState` — no global state.

**Auth guard & tab access**: `src/app/(admin)/layout.tsx` listens to `onAuthStateChanged`, redirects to `/login`, and admits a user via `hasPortalAccess` — `role === 'admin'` (superuser, all tabs) **or** a non-empty `tabAccess` array on their `users` doc (scoped access). Access is **fully granular per-tab**: `tabAccess: string[]` holds the exact tab *paths* an employee may use (e.g. `['/attendance','/ot-shortage']`) — the old preset-`tags`/`TAG_TABS` bundle system is **retired**. The layout also runs a central per-tab URL guard (`canAccess`) that redirects to the user's `landingPath` if they reach a tab they lack, so hand-typed URLs are blocked without per-page code. Access logic is pure/unit-tested in **`src/lib/portalAccess.ts`** (the single tab registry the Sidebar renders from, an `adminOnly` flag on `TabDef`, and `allowedPaths`/`canAccess`/`landingPath`); the layout provides the user via `AccessContext` (`useAccess`). **Admin-only tabs** (`adminOnly: true` → never grantable, never a matrix column): `/dashboard`, `/users`, `/access`, `/daily-activity`. The other 10 tabs are grantable. Admins assign access two ways, both writing `tabAccess`: the **admin-only `/access`** page — a bulk employees×tabs checkbox matrix — and per-tab checkboxes in the `/users` edit modal. Firestore rules enforce the same model **collection-first**: `userTabs()` reads `tabAccess`, and per-domain helpers (`canReadAttendance`, `canAccessLeaves`, `canWriteOtApprovals`, …) unlock each collection only for the tab(s) that use it; user-management writes stay admin-only (no self-promotion). **Add a grantable tab** = a `TABS` entry + map its collections to the right helper(s) in `firebase/firestore.rules` (both the per-doc `match` and the top-level `{path=**}` collection-group `match`). Rules deploy: `firebase deploy --only firestore:rules` **from the repo root** (the Firebase MCP deploy tool runs from the wrong cwd and silently deploys nothing — always verify with `firebase_get_security_rules` after).

**Routing**: `(admin)` is a route group (no URL segment) — `/dashboard`, `/access` (admin-only access matrix), `/working-hours-shortage-excess`, `/users`, `/leaves`, `/regularization`, `/attendance`, `/daily-activity` (admin-only same-day punch correction), `/ot-shortage`, `/ot-settlements`, `/manpower-utilisation-input`, `/submissions`, `/conveyance`, `/notifications` are all protected.

## Firestore Collections

- `users/` — employee profiles; `role`: `admin` | `office` | `operations` | `sales`. **`sales` is a hybrid** (office-style fixed window + ops-style hybrid check-ins and conveyance, no OT/shortage/WO/categories/manpower). Almost every role decision used to be a binary `isOps = role === 'operations' ? … : …`, which drops `sales` into the office branch silently — route role decisions through **`src/lib/roleCapabilities.ts`** (mirrored in `firebase/functions/roleCapabilities.js` + Android `RoleCapabilities.kt`; keep all three in lockstep). Design: **`docs/superpowers/specs/2026-07-16-sales-role-design.md`**
- `sites/` — geofenced locations with GPS coordinates
- `users/{uid}/leave_requests/`
- `users/{uid}/attendance/` — check-in/out events. Ops `site_in`/`site_out` carry free-text `siteName`; `siteId` is filled later by admin via **Manpower Utilisation Input** page (`updateAttendanceSiteId`). Events are otherwise immutable, except an **admin** may **delete** trailing punches for the current day via the **Daily Activity** page (same-day accidental-checkout fix — see below); every deletion is snapshotted into `attendance_corrections/`.
- `users/{uid}/attendance_corrections/{autoId}` — immutable audit log of admin same-day punch corrections (Daily Activity page). Each doc snapshots the deleted punches verbatim (`removedEvents[]`) plus `date`/`reason`/`correctedBy`/`correctedByUid`/`correctedAt`/`keptEventId`. Written by `restoreAttendanceToEvent`; admin-only create+read, never updated/deleted.
- `users/{uid}/attendance_status/{date}` — computed daily status (written by `computeDailyAttendanceStatus`). Statuses: `Present`/`HalfDay`/`SL`/`LNF`/`Absent`/`PL`/`LWP`/`WO`. **WO** (paid no-work day off for ops) is admin-set (`markedBy:'admin'`) via the Attendance page (Mark WO / clear) or as a regularization outcome; in the OT/shortage ledger it owes a standard 8h, payable by OT in the same month. Optional `inTime`/`outTime` (`"HH:MM"`) = **effective worked window** captured when an admin regularizes a day **to Present** (missed-punch fix); when present, the OT/shortage ledger uses these **instead of raw events** for that date, so a corrected Present day carries shortage/OT (set via `approveRegularization`; non-Present outcomes clear them)
- `users/{uid}/planned_hours/{date}` — admin-set shift window for ops (`startTime`/`endTime` as `"HH:MM"`); office fixed 10–18. Optional `declaredOtMins` = admin pre-declared overtime for that day (OT worked up to this is auto-approved; set inline on the Attendance page next to the shift). Optional `otAuthorized` (boolean) = Sunday/holiday OT authorization: when true, **all** worked minutes that rest day count as auto-approved OT (set via the "Authorize OT" toggle that replaces the shift inputs on Sundays/holidays). Without it, rest-day work credits 0 OT (flagged as "unauthorized" in the OT/Shortage modal)
- `users/{uid}/daily_hours/{date}` — per-day `plannedMins`/`actualMins`/`shortageMins`/`otMins` (written by `computeDailyAttendanceStatus`, fully-worked days only)
- `users/{uid}/ot_approvals/{date}` — admin OT decision: `requestedMins`/`approvedMins`/`status` (`approved`|`rejected`)/`manual`/`reason`/`approvedBy` (written by `approveOt`/`rejectOt`/`setManualOt`). `manual:true` = admin-entered OT for a day with no auto-detected surplus (e.g. missed-punch anomaly), added via the **Add manual OT** form in the OT/Shortage drill-in modal; counted as granted OT in the ledger like any approval
- `users/{uid}/settlements/{YYYY-MM}` — frozen monthly OT/shortage/WO settlement (one per ops employee): full breakdown + `netMins` + `settlementCash` + `locked`/`settledBy`. Written by admin **Settle & Lock** on the **OT Settlements** page (`settleMonth`); the Cloud Function reads the **previous month's locked** settlement and adds `settlementCash` to payroll TOTAL DUE (OT paid in arrears). `settlementCash = woDays×rate + netMins/480×rate`
- `users/{uid}/material_requests/`
- Top-level: `material_purchases`, `material_transfers`, `tool_transfers`, `work_progress`, `conveyance`
- `holidays/{date}` — company-wide holidays (`title`/`description`), marked by admin on the **Attendance** calendar. A marked day is skipped like a Sunday: no status doc, no Absent penalty, excluded from expected working days (unpaid, no payroll effect). Managed via `setHoliday`/`deleteHoliday`; read by `getHolidaysForMonth`/`getHolidaysForDateRange`.

Required composite indexes (Firebase Console):
- `leave_requests`: `status` ASC + `submittedAt` ASC
- `attendance`: `date` ASC + `timestamp` ASC
- `material_requests`: `submittedAt` DESC
- collection-group `planned_hours`: `date` ASC (for `getPlannedHoursForMonth`, `getPlannedHoursForDateRange`)
- collection-group `attendance`: `date` ASC + `timestamp` ASC (for `getAttendanceForDateRange`)

## Attendance Status Logic

> Full backend reference: **`docs/cloud-functions.md`** (all 6 functions, triggers, collections, deploy/auth notes).

`computeDailyAttendanceStatus` Cloud Function runs at 23:59 IST. **Sundays and company-wide holidays (`holidays/{date}`) are skipped entirely — no status doc written, no penalty.**

**Events and window by role** (event types + window come from `roleCapabilities`, not a hardcoded branch):
- **Office/admin**: `office_in` / `office_out`; fixed 10:00–18:00 IST
- **Operations**: first in / last out across both site and market visits (`site_in`/`market_in` and `site_out`/`market_out`); window from `planned_hours/{date}`. **No plan but they worked → scored against the default 10:00–18:00** (matching `otLedger.ts`'s `DEFAULT_SHIFT_START_MIN`/`DEFAULT_SHIFT_END_MIN`, which already scored these days that way — the function used to skip them, so the ledger and payroll disagreed). **No plan + no approved leave + no work events → day skipped (no status doc)** — an unscheduled day, deliberately not penalised as Absent. The three-way decision is the pure, unit-tested `shouldEvaluateDay` in `firebase/functions/attendanceRules.js`. Approved leave still produces PL/LWP.
- **Sales**: hybrid — first in / last out across **all** of `office_in`/`site_in`/`market_in` → `office_out`/`site_out`/`market_out`, scored against the **fixed 10:00–18:00** window (never a `planned_hours` shift, so no plan is ever needed). Same status buckets. **No** `daily_hours`/`ot_approvals` are written — sales has no OT/shortage/WO concept.

| Status | Condition | Salary (days) |
|--------|-----------|---------------|
| Present | In by window start AND out after window end | 1 |
| Short Leave (SL) | Both punches present, off-minutes (late-in + early-out) ≤ 120 | 0.75 |
| Half Day | Both punches present, off-minutes > 120 | 0.5 |
| LNF (Log Not Found) | Exactly one punch (missing check-in OR check-out); formerly SLNF | 0.5 |
| PL (Paid Leave) | Approved leave + PL balance | 1 |
| LWP (Leave Without Pay) | Approved leave, no balance | 0 |
| Absent | No events, no approved leave (ops: only when a plan exists — no plan + no events = unscheduled, skipped) | -2 |

`markedBy: 'auto'` on function-written docs; `markedBy: 'admin'` docs (regularization) are skipped on recompute. The attendance page mirrors this logic client-side until the nightly run writes it.

**Days NP**: `present + SL×0.75 + halfDay×0.5 + LNF×0.5 + PL - absent×2` (LWP = 0)

**Salary**: `daysNP × salaryRate`

PL balance: +1 on 1st of month (`accrueMonthlyLeave`), -1 per PL day used.

## Google Sheets Export

`exportToSheets` Cloud Function runs 16:30 UTC (22:00 IST) → Google Sheet (`SHEET_ID` in `functions/index.js`) via service account (`ATTENDANCE_SHEETS_KEY` secret).

- **Always resolve Name/ID from the live `users` collection** — not the snapshot values on each doc. Use `uidOf(doc)` + `userNameMap`/`userEmpIdMap` (keyed by uid). `uidOf` reads `userId` field, falling back to parent path for subcollection docs.
- **Attendance tab** is per-employee/day (not per-event): In Time / In Location / In Site ID / Out Time / Out Location / Out Site ID / All Activity / OT (mins) / Daily Status / PL Balance. Built from union of attendance events and status docs — Absent/PL/LWP/LNF days appear even without check-in events. **All Activity** = full chronological log with resolved Site ID in brackets. **OT (mins)** = per-day *credited* OT matching the Employee Dashboard, computed by a port of `otLedger.ts`'s `computeDayLedger` (declared auto-approved + authorized rest-day + admin-granted incl. manual; pending/unauthorized excluded); keep the port in sync with the TS source. **PL Balance** = each employee's current `plBalance` (repeated per row). **Blank data cells are filled with `θ`** (header row untouched; a real `0` PL balance stays `0`).
- **Employee Dashboard tab** — MTD summary, one row per employee: Date | EMP Name | EMP ID | Days Passed | Present | SL | Half Day | LNF | PL | LWP | Absent | Leaves | Days NP | Salary Rate | Salary Due MTD | Covy Due | Imprest Due | Settlement (this month) | TOTAL DUE. Includes CF BAL (carry-forward leave) and TOTAL summary rows. **Imprest** is preserved across runs by locating columns by header name (not fixed index). Conveyance is built from the `conveyance` collection (**operations + sales** — gated by `usesConveyance(role)`, so a new conveyance-earning role needs only a table row). Sales appears on this tab with salary + conveyance and a 0 settlement (it has no settlement doc). **Settlement** = the **current** month's own locked OT/shortage/WO `settlementCash` (client settles month-to-month, not in arrears; shows 0 until that month is Settled & Locked). **TOTAL DUE** = salaryDue + covy + imprest + settlement. **The tab now keeps month history**: instead of overwriting a single snapshot, each nightly run preserves every past month's block **verbatim (frozen)** and rebuilds only the **current** month's block, stacked **current-on-top** in the same tab. Blocks are delimited by a banner row `── MONTH: YYYY-MM — Month Year ──` (parsed via `/MONTH:\s*(\d{4}-\d{2})/`); each block carries its own header + CF BAL + TOTAL. A month freezes automatically once the IST calendar rolls over. Manual **Imprest** is carried into the rebuilt current block only (past blocks keep theirs). Frozen = never recomputed — a later fix to a past month does not change that month's block. Parse/freeze/merge/order logic is the pure, unit-tested `functions/dashboardHistory.js` (`npm test`); first-run migration wraps the old single-block tab into the correct month.
- **Overtime Exception Report tab** — written to its **own** spreadsheet (`SHEET_ID_OT` in `functions/index.js`), **operations only** (`usesOtShortageLedger(role)` — sales excluded), **current month, cleared & rebuilt each run**. One row per ops employee/day that is an OT "exception" (left after shift end, worked a rest day, or has an admin OT decision). Columns mirror the client's manual sheet: DATE | NAME | ESN NO | PRE-LOGIN TIME/SITE (first check-in) | POST-LOGOUT TIME/SITE (last check-out) | OVER TIME | TIME APPROVED | APPROVED/NOT APPROVED/Pending | Reasons | APPROVED/REJECTED BY | Remarks. **OVER TIME** = *raw* overtime the portal detects (mins past shift end; rest day → all worked mins); **TIME APPROVED** = the *credited* slice (declared auto-approved + authorized rest-day + admin-granted). Both are `HH:MM` (`00:30`) via `minToHHMM`; uses the same ported `computeDayLedger` + OT/decision maps as the Attendance tab. Reasons/By come from `ot_approvals` (`reason`/`approvedBy`). Not θ-filled (blanks stay blank, `NA` where the source sheet used it).
- **Site Manpower Time Utilisation tab** ("Manpower Utilisation") — written to its **own** spreadsheet (`SHEET_ID_MANPOWER` in `functions/index.js`), **operations only** (`inManpowerReports(role)` — sales does site visits for attendance + conveyance only and is excluded from labor tracking), **current month, cleared & rebuilt each run**. Reproduces the client's manual "SITE MANPOWER TIME UTILISATION REPORT" (Aug-2024 format): one row per ops `site_in`→`site_out` visit. Columns: DATE | SITE | Cust ID (admin-filled `siteId`) | Visit type (`visitType`) | TecH name | Category (as per daily schedule — user's `categories`) | work done-Category (`workDoneCategories`, `+`-joined) | work done-time | Remarks. **work done-time** = time on site ÷ 8h (`(site_out − site_in)/480`), **uncapped — may exceed 1**; blank on a missed logout (visible data gap). **Remarks** = the day's *credited* OT as `HH:MM` (declared auto-approved + authorized rest-day + admin-granted), placed on the visit with the latest departure (where the post-shift OT was earned); blank elsewhere. Market visits are excluded (they carry no visit fields). Pairing/fraction logic is the pure, unit-tested `functions/manpowerVisits.js` (`npm test`). Not θ-filled (blanks stay blank).

## Working Hours-Shortage/Excess Page

`/working-hours-shortage-excess` (`src/app/(admin)/working-hours-shortage-excess/page.tsx`) — real-time view of expected vs actual working hours across a configurable date range.

- **Filters**: date preset (Today / Last 7/15/30/90/180/365 days / custom), role, individual employee
- **Columns**: Name, Emp ID, Role, PL, WO, Working (expected), Actual, Shortage, Overtime
- **Single-day view**: also shows Check-in / Check-out times
- **Expected hours**: office/admin/sales = 8 h × working days (Mon–Sat); ops = sum of admin-set `planned_hours` windows
- **Sales**: appears here, but **Shortage/Overtime render `NA`** — its fixed window scores status only. Gated by `tracksShortage(role)` (true for office/admin/ops, false for sales); it is a **separate axis** from `usesOtShortageLedger` because office/admin show shortage while running no ledger. Sales is **excluded entirely** from OT & Shortage, OT Settlements, and Manpower Utilisation Input.
- **Actual hours**: derived from `office_in`/`office_out` (office) or `site_in`/`market_in` … `site_out`/`market_out` (ops) attendance events
- **Data**: `getAttendanceForDateRange` + `getPlannedHoursForDateRange` + `getOtApprovalsForDateRange` (all `collectionGroup`)
- Sundays excluded from working day count; sort order: office → admin → ops → sales, then alphabetical

### Shortage & Overtime (per-day, every minute counts)

Computed **per worked day** (both check-in and check-out present — absent/leave/LNF days never count). The shift window is the ops `planned_hours` window for that date; **ops days with no valid plan (or an inverted/mis-entered window like end `06:00`) fall back to the default 10:00–18:00**; office/admin is always fixed 10:00–18:00. Each shift **edge is scored independently and edges never cancel** (arriving early does not pay for leaving early). **Arriving early NEVER earns OT** — the only source of OT on a normal day is staying past shift end:
- **Shortage** = `max(0, checkIn − shiftStart)` (late-in) `+ max(0, shiftEnd − checkOut)` (early-out). Automatic, no approval. Computed live for the selected range; the nightly function writes the canonical per-day `daily_hours/{date}`. (The old lifetime `users/{uid}.shortageMins`/`approvedOtMins` counters are **retired** — no longer written or read; OT/shortage net per-month via the ledger.)
- **Overtime** = `max(0, checkOut − shiftEnd)` (late-out only; early check-in is ignored), split by the day's `declaredOtMins` (pre-declared by admin): worked OT **up to `declaredOtMins` is auto-approved** (no review); only the **surplus beyond it is pending** and needs admin action. The dashboard lists pending OT days; admin grants an adjusted amount (≤ the beyond-declared surplus) with a **mandatory reason** via `approveOt`, which writes `ot_approvals/{date}`. Admin can also **reject** a pending OT day (`rejectOt`, reason required → `ot_approvals` with `status:'rejected'`), or **manually grant OT** for a day the system can't auto-detect (`setManualOt` → `manual:true` decision; e.g. missed-punch anomalies). Declared OT is a pre-approval **ceiling, not an obligation** on the OT earned — it never changes shortage, and leaving before the declared end never creates extra shortage (shortage is measured against the plain shift). The core math is `computeDayLedger` in `src/lib/otLedger.ts` (edge-based, takes shift start/end + actual in/out as IST minutes-of-day). `savePlanned` on the Attendance page rejects `endTime ≤ startTime`.

**Rest-day OT**: ops work on a Sunday/holiday counts as **all-hours OT, but only when admin-authorized** (`planned_hours.otAuthorized`, toggled on the Attendance page); unauthorized rest-day work credits 0 and is flagged. **WO** days carry a −480 ledger debit (see collections).

**Regularized days**: approving a regularization **to Present** with effective `inTime`/`outTime` (on the `attendance_status` doc) makes that day carry shortage/OT — the ledger uses the override **instead of raw events** for the date (authoritative). Lets a missed-punch day count correctly.

**Monthly netting & payroll** (replaces the old "tracked separately, never netted"): OT (auto + rest-day + granted), shortage, and WO debits **net within a month** to `netMins`; admin **Settle & Locks** the month on the **OT Settlements** page → `settlementCash = woDays×rate + netMins/480×rate` → the Cloud Function adds the previous month's locked `settlementCash` to payroll **TOTAL DUE** (OT paid in arrears). The per-day/range math lives in **`src/lib/otLedger.ts`** + **`src/lib/otAggregate.ts`** (pure, unit-tested via `npx tsx src/lib/*.test.ts`), shared by the OT/Shortage page, Working Hours-Shortage/Excess page, and OT Settlements page. Full spec + decisions: **`docs/ot-shortage-design.md`**. Cloud Function changes need **`firebase deploy --only functions`**.

## Daily Activity Page (admin-only)

`/daily-activity` (`src/app/(admin)/daily-activity/page.tsx`) — same-day fix for an employee who checked out by mistake. The Android app derives live check-in/out state purely from the **last** punch (`deriveAttendanceState`), so "undo" = remove the erroneous **trailing** punches; ending a day from a site is two punches (`site_out` then `home_out`), so restoring "at site" removes both.

- **View**: pick a date (defaults to IST today), each employee with activity = a card with their chronological punch **timeline** + current derived state. Role + employee filters. Data via `getAttendanceForDate`.
- **Edit (today only)**: each punch shows **"Restore to here"** = keep this punch, delete everything after it. Confirm dialog previews the punches to remove + resulting state (via `deriveState`) and requires a **mandatory reason**. Past days are read-only (past-day fixes stay with Regularization).
- **Action**: `restoreAttendanceToEvent(uid, date, keepEventId, reason, adminName, adminUid)` — one atomic batch that re-reads the day's events (guards against a stale client list), hard-deletes the trailing punches, and writes a full snapshot to `attendance_corrections/`. Nothing is lost; the live timeline stays clean for the phone, nightly compute, OT ledger, and Sheets.
- **History**: each employee card shows a **Corrections** section listing every correction on the selected date (removed punches + who/why/when), fetched via `getAttendanceCorrectionsForDate` (collectionGroup scan on `attendance_corrections`, admin-only). Visible on past days too.
- **State-derivation port**: `src/lib/attendanceState.ts` (`deriveState`/`eventLabel`) is a pure port of the Kotlin `deriveAttendanceState` — **keep in sync with the Android source**. Unit-tested via `npx tsx src/lib/attendanceState.test.ts`.
- **Rules**: admin-only `delete` on `attendance` events + admin-only create/read on immutable `attendance_corrections` (`firebase/firestore.rules`). Design: **`docs/superpowers/specs/2026-07-14-daily-activity-punch-correction-design.md`**.

## Styling

Global classes in `src/app/globals.css`: `.btn-primary`, `.btn-outline`, `.btn-danger`, `.btn-success`, `.card`, `.input`, `.label`, `.badge-*`. Use these over inline Tailwind for interactive elements.

Tailwind tokens (`tailwind.config.ts`): `primary` `#1A5FAF` · `background` `#F0F4F8` · `border-custom` `#C8D6E8` · `text-primary` `#0D1B2A` · `text-secondary` `#6B7E94`

## Environment

`.env.local` (not committed): `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`

Firebase project: `white-coffee-92c27` · Hosting: `https://white-coffee-92c27.web.app`
