# iOS Mobile App — Phase 2a: Leave (Apply + History)

## Context

Phase 1 (office attendance) shipped and is on branch `worktree-mobile-ios-phase1` /
[PR #47](https://github.com/Raghavkhedar/whitecoffee/pull/47). This spec covers the next
increment: porting Android's **Leave** feature — applying for leave and viewing the
employee's own leave history — to the same React Native/Expo app.

Unlike Attendance (currently gated to `office`/`admin` roles only in this app), Android's
role table shows Leave (apply + my history) as available to **all four roles**
(`operations`/`office`/`sales`/`admin`). This spec follows that: Leave is visible to any
signed-in user regardless of role.

No backend changes. This is a new client reading/writing the existing
`/users/{uid}/leave_requests/{requestId}` schema exactly as documented in
`android/CLAUDE.md`, exercising the same Firestore rules the Android app already uses
(`allow create: if isOwner(userId) && status == 'pending'` — the app never writes
`approvedDates`/`cancelledDates`/`status` transitions; those are portal/admin-only).

## Android reference behavior (verified by direct investigation, not assumption)

**Apply tab** (`LeaveScreens.kt` + `ApplyLeaveViewModel.kt`):
- Fields: Applicant Name (read-only, auto-filled), Leave Start Date, Leave End Date (date
  pickers, no min/max constraint), an auto-computed "N days total" chip, Joining Date
  (date picker), Emergency Contact No. (phone keyboard, free text), Place of Visit (free
  text), Reason for Leave (multiline).
- Validation: both dates required; `toDate >= fromDate`; Joining Date, Emergency Contact,
  Place of Visit, and Reason all required non-blank. No overlap-with-existing-leave check,
  no max-duration check.
- No leave-type field (legacy, always submitted as empty string).
- On successful submit, the screen switches to the History tab and reloads.

**History tab**: lists the employee's own past leave requests, newest first
(`observeMyLeaveRequests()` ordered by `submittedAt` descending), each showing a status
badge, the date range, effective day count, and place of visit. A fully-cancelled request
renders in the same visual treatment as "rejected" despite `status: 'approved'` in the
document — this is the `effectiveGrantedDates`/`isCancelled` overlay logic
(`admin/src/lib/leaveDates.ts`, mirrored in `firebase/functions/leaveCoverage.js` and
Android's `LeaveRequest.kt`) — the mobile app's history view needs the same read-side
logic to show correct status, not just the raw `status` field.

## Data model (existing, unchanged) — `/users/{uid}/leave_requests/{requestId}`

Per `android/CLAUDE.md`'s documented schema: `id`, `userId`, `userName`, `employeeId`,
`leaveType` (legacy, empty string), `fromDate`, `toDate` (both `yyyy-MM-dd`), `totalDays`
(int), `joiningDate` (`yyyy-MM-dd`), `emergencyContact`, `placeOfVisit`, `reason`,
`status` (`pending`/`approved`/`rejected` — app only ever writes `pending`),
`approvedDates`/`cancelledDates` (portal/admin-written overlays, app never writes these),
`approvedBy`, `approverComment`, `submittedAt`, `reviewedAt`.

## Stack additions

None. Same Expo/TypeScript/Firebase JS SDK stack as Phase 1. No new npm dependencies —
date pickers use a plain text-based `yyyy-MM-dd` entry field for Phase 2a (see below),
avoiding a new native date-picker dependency for this increment.

**Date picker decision:** Android uses a native `DatePickerDialog`. Introducing a
comparable native date picker on iOS means adding `@react-native-community/datetimepicker`
(the standard Expo-compatible choice). This is a small, well-supported addition — include
it now rather than shipping a worse plain-text date entry UX, since date entry is the most
used control on this form. Validate the same rule Android does: `toDate >= fromDate`.

## File structure

- `mobile/src/leave/leaveCoverage.ts` — pure functions, ported from the read side of
  `admin/src/lib/leaveDates.ts`: `expandDateRange`, `requestedDates`, `grantedDates`,
  `cancelledDates`, `effectiveGrantedDates`, `effectiveGrantedDayCount`, `isCancelled`,
  `isPartiallyCancelled`, `isPartialApproval`, `formatDatesShort`. The write-side
  notification-message helpers (`partialApprovalMessage`, `leaveCancelledMessage`) are
  portal-only concerns and are NOT ported — the app only reads coverage, never approves
  or cancels.
- `mobile/src/leave/leaveCoverage.test.ts` — TDD unit tests for the module above, same
  rigor as `officeAttendanceState.test.ts` (Task 2 of Phase 1).
- `mobile/src/leave/leaveApi.ts` — `LeaveRequest` type (mirroring the Firestore schema
  above), `submitLeaveRequest(user, input): Promise<void>`, `subscribeMyLeaveRequests(uid,
  onChange): () => void`.
- `mobile/src/screens/LeaveScreen.tsx` — two-tab UI (Apply / History), registered as a new
  `Leave` route in `RootNavigator.tsx`.
- `mobile/src/screens/HomeScreen.tsx` — modified: add a "Leave" card, visible to any
  signed-in user (no role gate), navigating to `Leave`.

## Data flow & error handling

- `subscribeMyLeaveRequests` uses `onSnapshot` (same reactive pattern as attendance),
  ordered by `submittedAt` descending, with an `onError` callback (matching the fix
  already applied to `attendanceApi.ts` in Phase 1 — no repeating that gap here).
- `submitLeaveRequest` mints the doc reference locally (`doc(collection(...))`) and calls
  `setDoc(...).catch(...)` without awaiting the network round-trip — same offline-safe
  pattern as `recordOfficeEvent`, for the same reason (a leave submission with a weak
  signal must not hang the submit button).
- Form validation happens client-side before any Firestore call, mirroring Android's
  `ApplyLeaveViewModel.submit()` rules exactly (both dates required, `toDate >= fromDate`,
  three text fields non-blank).
- History status badges are computed from `leaveCoverage.ts`, never from the raw `status`
  field alone — a cancelled leave must visually read as cancelled/rejected, matching
  Android and the admin portal.

## Verification

- `leaveCoverage.ts` gets full unit test coverage (TDD), run via `npx jest`.
- `npx tsc --noEmit` clean project-wide.
- Manual device walkthrough (no simulator available in this environment, same constraint
  as Phase 1): submit a leave request from the app, confirm the resulting Firestore
  document under `/users/{uid}/leave_requests/` matches Android's field shape exactly, and
  confirm it appears correctly in the admin portal's `/leaves` approval queue. After an
  admin approves/partially-approves/cancels it from the portal, reload the mobile History
  tab and confirm the status badge reflects the coverage-overlay logic correctly (this is
  the one behavior that can't be verified by the app alone — it requires a round-trip
  through the admin portal).

## Out of scope for Phase 2a

- Regularization (Phase 2b, separate spec).
- Any write path for `approvedDates`/`cancelledDates`/leave approval — portal/admin-only,
  unchanged.
- Push notifications for leave status changes (Android has none either — in-app only, and
  Phase 1's notifications screen itself is deferred to a later phase).
