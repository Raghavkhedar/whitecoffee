# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Static export to /out (required before deploy)
npm run deploy       # build + firebase deploy --only hosting
firebase login       # One-time auth before first deploy
firebase login --reauth  # Re-authenticate when credentials expire (run in terminal, not Claude Code)
```

No test framework is configured.

## Architecture

**Next.js 14 static export** deployed to Firebase Hosting. All pages are client-side (`'use client'`) since the app uses Firebase Auth and Firestore in the browser. The `output: 'export'` in `next.config.ts` means `next start` is unused — builds produce static HTML in `/out`.

**Data flow**: Pages → `src/lib/firestore.ts` → Firebase SDK. All Firestore operations are centralized in `firestore.ts` (40+ functions). Pages use local `useState` — no global state management (no Redux, no Context).

**Auth guard**: The `(admin)` route group layout (`src/app/(admin)/layout.tsx`) listens to `onAuthStateChanged` and redirects unauthenticated users to `/login`. It also verifies `role === 'admin'` in Firestore before allowing access.

**Routing**: File-based via Next.js App Router. The `(admin)` folder is a route group (parentheses = no URL segment), so `/dashboard`, `/users`, `/sites`, `/leaves`, `/attendance`, `/submissions` are all protected.

## Firestore Collections

- `users/` — employee profiles with `role` field (`admin`, `office`, `operations`)
- `sites/` — geofenced work locations with GPS coordinates
- `users/{uid}/leave_requests/` — subcollection per user
- `users/{uid}/attendance/` — check-in/out events per user. Ops `site_in`/`site_out` events carry a free-text `siteName` typed at check-in; the `siteId` field is filled in later by an admin from the **Site IDs** page (`updateAttendanceSiteId`).
- `users/{uid}/attendance_status/{date}` — computed daily status per user (written by `computeDailyAttendanceStatus`)
- `users/{uid}/planned_hours/{date}` — admin-set planned shift window for operations employees (`startTime`/`endTime` as `"HH:MM"`). Drives ops status; office is fixed 10–18.
- `users/{uid}/material_requests/` — M&T form submissions per user
- Top-level: `material_purchases`, `material_transfers`, `tool_transfers`, `work_progress`, `conveyance`

Required Firestore composite indexes (must be created in Firebase Console):
- `leave_requests`: `status` ASC + `submittedAt` ASC
- `attendance`: `date` ASC + `timestamp` ASC
- `material_requests`: `submittedAt` DESC
- collection-group `planned_hours`: `date` ASC (for `getPlannedHoursForMonth`)

## Attendance Status Logic

The `computeDailyAttendanceStatus` Cloud Function (runs 23:59 IST) determines daily status per employee.

**In/out events and working window differ by role:**
- **Office/admin**: in/out from `office_in` / `office_out`; fixed window 10:00 AM – 6:00 PM IST.
- **Operations**: in/out from the **first `site_in`** and **last `site_out`** of the day; window comes from the admin-set per-day planned shift (`planned_hours/{date}`). **No plan + no approved leave → day left unmarked (skipped, no status doc).** Approved leave still produces PL/UPL regardless of plan.

| Status | Condition | Salary (days) |
|--------|-----------|---------------|
| Present | Check-in by window start AND check-out after window end | 1 |
| Short Leave (SL) | Has both events, total hours worked < 6 | 0.75 |
| Half Day | Late in (after window start) AND early out (before window end) | 0.5 |
| SLNF (Log Not Found) | Missing check-in or check-out | 0.5 |
| PL (Paid Leave) | Approved leave, has PL balance | 1 |
| UPL (Unpaid Leave) | Approved leave, no balance | 0 |
| Absent | No events, no approved leave (ops: only when a plan exists) | -2 (2-day penalty) |

Statuses written by the function carry `markedBy: 'auto'`; docs with `markedBy: 'admin'` (regularization approvals) are skipped on recompute. The attendance page derives status live (client-side, mirroring this logic) until the nightly run writes it.

**Days NP formula**: `present + SL×0.75 + halfDay×0.5 + SLNF×0.5 + PL - absent×2` (UPL is unpaid → contributes 0)

**Salary**: `daysNP × salaryRate`

PL balance: +1 accrued on 1st of each month (`accrueMonthlyLeave`), -1 deducted per PL day used.

## Google Sheets Export

The `exportToSheets` Cloud Function (runs 16:30 UTC = 22:00 IST) writes all data to a Google Sheet (`SHEET_ID` in `functions/index.js`) via a service account (`ATTENDANCE_SHEETS_KEY` secret), one tab per data type.

- **Always resolve employee Name/ID from the live `users` collection**, not the value stored on each doc. Submission/attendance docs snapshot `userName`/`employeeId` at creation, so edits in the Users tab won't reflect unless looked up live. Use the `uidOf(doc)` helper + `userNameMap`/`userEmpIdMap` (keyed by uid). `uidOf` reads the doc's `userId` field, falling back to the parent path for subcollection docs.
- **Attendance tab** is a per-employee/day summary (not per-event): In Time / In Location / Site ID / Out Time / Out Location / All Activity. Office uses office in/out; operations uses first `site_in` / last `site_out`. Rows are built from the union of attendance events **and** computed status docs, so Absent / PL / UPL / SLNF days (which have no check-in events) still appear with their status. The **All Activity** column is the full chronological log of every check-in/out with the resolved Site ID in brackets.
- **Employee Dashboard tab** breaks Days NP into per-status columns (Present / SL / Half Day / SLNF / PL / UPL / Absent) before the Days NP total. Manually-entered **Imprest** is preserved across runs by locating columns by header name (not fixed index), so the layout can change without losing data.

## Styling Conventions

Global component classes are defined in `src/app/globals.css`: `.btn-primary`, `.btn-outline`, `.btn-danger`, `.btn-success`, `.card`, `.input`, `.label`, `.badge-*`. Use these instead of inline Tailwind for interactive elements.

Tailwind custom tokens (from `tailwind.config.ts`):
- `primary`: `#1A5FAF`
- `background`: `#F0F4F8`
- `border-custom`: `#C8D6E8`
- `text-primary`: `#0D1B2A`
- `text-secondary`: `#6B7E94`

## Environment

Firebase config lives in `.env.local` (not committed). Required variables: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.

Firebase project ID: `white-coffee-92c27`. Hosting URL: `https://white-coffee-92c27.web.app`.
