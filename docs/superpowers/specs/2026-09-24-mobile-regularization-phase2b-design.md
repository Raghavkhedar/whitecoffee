# iOS Mobile App — Phase 2b: Regularization

## Context

Phase 1 (office attendance) and Phase 2a (Leave: Apply + History) have shipped and merged
to `main` via [PR #47](https://github.com/Raghavkhedar/whitecoffee/pull/47). This spec
covers the next increment: porting Android's **Regularization** feature — an employee's
way to dispute a day's auto-computed attendance status — to the same React Native/Expo
app, on a fresh branch off `main` (the prior PR is closed).

Regularization is meaningfully more complex than Leave: its "status" for *today* isn't a
stored field, it's derived live from the day's actual punches using the same scoring rule
the nightly Cloud Function uses. This spec narrows scope deliberately (see "Scope
decisions" below) so the port stays tractable while preserving the feature's real
complexity — the admin-controlled window flag and the live derivation — rather than
simplifying those away.

## Android reference behavior (verified by direct investigation, not assumption)

**What it is**: an employee-initiated dispute of a day's auto-computed attendance status
(e.g. a missed check-out scored as `LNF`), reviewed and decided only by an admin or a
portal manager holding the `/regularization` tab — **never approved in-app**.

**Today's live status** (`RegularizationViewModel.deriveLiveStatus`,
`android/.../RegularizationViewModel.kt:187-217`): computed from today's actual punches
using the same pure classifier the nightly Cloud Function mirrors
(`firebase/functions/attendanceRules.js`), re-subscribed across IST midnight rollover so
punches and the derived status never drift. It is explicitly a **subset** of the full
status enum — only `null` (nothing to flag), `"SL"`, or `"HalfDay"` — never `Present`,
`Absent`, or `LNF`.

**The classify rule** (`firebase/functions/attendanceRules.js:54-60`, mirrored in
`AttendanceStatusRules.kt`): late-in and early-out are graded independently, zero grace on
either side; late-in wins when both apply.
```
late = max(0, inMinutes - windowStartMin)
earlyOut = outMinutes == null ? 0 : max(0, windowEndMin - outMinutes)
if late > 0: "HalfDay"
elif earlyOut > 0: "SL"
else: "Present"
```
For office/admin the window is fixed 10:00–18:00 IST
(`OFFICE_START_MIN`/`OFFICE_END_MIN`). `inMinutes`/`outMinutes` come from the **first**
`office_in` and **last** `office_out` event of the day
(`firebase/functions/roleCapabilities.js:39-41`, confirmed the exact event types scored
for office role; `firebase/functions/nightlyScoring.js:79-120` confirmed first-in/last-out
selection). Mobile's existing `subscribeTodayOfficeEvents` already carries exactly these
event types — no new attendance data needs tracking for this phase.

**The admin-controlled window flag** — `config/regularizationWindow`
(`{ open: boolean, lastModifiedBy: string, lastModifiedAt: Timestamp }`,
`admin/src/lib/firestore.ts:1219-1221`). Any logged-in user can read it; only an admin can
write it (`firebase/firestore.rules:757-764`). It gates **only submitting for a past
date** — today is always submittable regardless of window state, and a future date is
never submittable regardless of window state
(`firebase/firestore.rules:566-591`, the `regularization_requests` create rule):
```
date == todayIST()                                            → always allowed
date < todayIST()  → allowed only if window open AND !isSettledMonth(userId, date)
date > todayIST()                                              → never allowed
```
`isSettledMonth` checks `users/{uid}/settlements/{yyyy-MM}.locked` — **office and admin
never have a `settlements` doc**, so for this phase's scope this clause never blocks
anything once the window is open.

**No history/My-Submissions view** — confirmed deliberate
(`android/CLAUDE.md`, decision #15: "No My Submissions screens… users do not view
submission history in the app"). `RegularizationScreen.kt` only ever shows *today's* one
flagged day, or the one transiently-picked past date — never a list. This is the opposite
of Leave, which does have a history tab; that asymmetry is intentional and Android-verified,
not a gap.

**Admin approval** happens only in the portal (`admin/src/app/(admin)/regularization/page.tsx`)
via an atomic batch write (`admin/src/lib/firestore.ts:459-547`) — entirely out of scope
for this mobile client.

## Scope decisions for this phase

- **Office and admin roles only.** Android exposes Regularization to all four roles, but
  today's live derivation depends on knowing a role's punch types and scoring window —
  operations/sales use `site_in`/`market_in` and a planned-shift window mobile has no UI
  for at all yet (mobile has only built office-role attendance so far). Deferred to
  whichever later phase builds out operations/sales attendance. This also means no
  `claimedKm` field (Android shows it only for conveyance-eligible roles — operations/sales)
  and no planned-shift window logic.
- **No history view.** Matches Android's own deliberate choice, not a simplification —
  this phase does not diverge from the app it's replicating.
- **Past-date regularization is in scope.** When `config/regularizationWindow.open` is
  true, the user can pick a past date (capped at yesterday) and see that date's *already
  stored* `attendance_status/{date}.status` (a plain read, not a derivation — the nightly
  job already wrote it), then submit against it with the same reason-only form as today.
  For office/admin, `isSettledMonth` never applies (see above), so no settlement-lock UI
  is needed — once the window is open, any past date is submittable, mirroring the rule.

## Data model (existing, unchanged) — `/users/{uid}/regularization_requests/{requestId}`

Per the verified schema (`RegularizationRequest.kt:7-38`, `admin/src/types/index.ts:177-192`):
`id`, `userId`, `userName`, `employeeId`, `date` (`yyyy-MM-dd`), `originalStatus`
(`HalfDay`/`SL`/`Absent`/`LNF`/`Unmarked`), `reason` (required, non-blank), `status`
(app always writes `"pending"`), `submittedAt`, plus admin-only fields the app must never
write: `approvedBy`, `approverComment`, `approvedStatus`, `reviewedAt`. `claimedKm` is
omitted entirely for this phase (operations/sales-only field, out of scope). This exactly
mirrors the `leave_requests` write discipline already established and fixed once in Phase
2a (Task 2's fix round) — the app writes `status: 'pending'` and nothing admin-controlled.

**Firestore rules** (`firebase/firestore.rules:566-591`, verified verbatim): create
requires `isOwner(userId) && isActive() && userId matches path && status == 'pending'`
plus the date-vs-window logic above. Update is admin/manager-only. Delete is always denied.

**Rules gaps the client must still enforce itself** (rules don't catch these — confirmed
by direct reading, same category as Leave's missing `totalDays` ceiling that Phase 2a's
final review caught):
- No `date` format/regex check in the rules for this collection.
- No lookback ceiling on how far into the past a date can go (unlike Leave's 366-day cap).
  This phase does not attempt to invent one Android doesn't have — matching Android's own
  behavior (no ceiling) rather than tightening policy the spec doesn't call for.
- No duplicate-pending/approved-request check in the rules — Android blocks this
  client-side by querying existing requests for that date first.
- No rest-day (Sunday/holiday) rejection in the rules for this collection — Android
  refuses client-side. Not a security hole (nothing can ever be *approved* on a rest day,
  since the linked `attendance_status` write is rules-blocked on rest dates for everyone),
  but the client must replicate the refusal for correct UX, matching Android exactly.
- No non-blank check on `reason` in the rules — Android requires it client-side.

This mobile client will replicate all four Android-only client-side guards above (they are
inexpensive reads/checks and directly prevent bad submissions the rules would otherwise
silently allow through as valid-but-useless `pending` docs).

## Stack additions

None. Same Expo/TypeScript/Firebase JS SDK stack as Phase 1/2a. The date picker
(`@react-native-community/datetimepicker`) is already a dependency from Phase 2a.

## File structure

- `mobile/src/regularization/regularizationStatus.ts` — pure functions ported from
  `firebase/functions/attendanceRules.js`: `classify(inMinutes, outMinutes, startMin,
  endMin)` (office/admin's fixed-window branch only — no `resolveOpsWindow`, out of
  scope) and `deriveTodayLiveStatus(events: OfficeAttendanceEvent[]): 'HalfDay' | 'SL' |
  null`, which finds the first `office_in`/last `office_out` from mobile's existing event
  type and calls `classify` against the fixed 10:00–18:00 window. Also `isRestDay(dateStr,
  isHoliday): boolean` (Sunday check, holiday flag passed in since this module has no
  Firestore access — mirrors `attendanceRules.js`'s own `resolveRestDayType` split).
- `mobile/src/regularization/regularizationStatus.test.ts` — TDD coverage mirroring
  `attendanceRules.js`'s own test cases: late-in wins over early-out, zero grace on both
  sides, in-progress day (checked in, no check-out yet) scores only late-in, no punches
  yet returns `null`, rest-day detection for Sunday and a holiday-flagged date.
- `mobile/src/regularization/regularizationApi.ts` — Firestore layer:
  `submitRegularizationRequest(user, input): Promise<void>` (offline-safe mint-then-write,
  writes `status: 'pending'` only, no admin fields, no `claimedKm`), `subscribeRegularizationWindow(onChange):
  () => void` (`onSnapshot` on `config/regularizationWindow` with an `onError` callback),
  `getAttendanceStatusForDate(uid, date): Promise<string | null>` (one-time read of
  `attendance_status/{date}.status`, `null` renders as "Unmarked"), `hasPendingOrApprovedRequest(uid,
  date): Promise<boolean>` (one-time query), `checkIsHoliday(date): Promise<boolean>` (one-time
  read of `holidays/{date}` existence).
- `mobile/src/screens/RegularizationScreen.tsx` — single screen (no tabs, no history):
  today's `deriveTodayLiveStatus` result rendered as a flagged-day card (only when
  non-null) with a "Request correction" button opening a reason-only modal; a
  window-gated "Request for another date" button that opens a date picker (max yesterday),
  reads that date's stored status via `getAttendanceStatusForDate`, and reuses the same
  reason-only modal. Both submit paths run the client-side guards (non-blank reason,
  duplicate check, rest-day check) before calling `submitRegularizationRequest`.
- `mobile/src/screens/HomeScreen.tsx` — modified: add a "Regularization" card, gated
  `office`/`admin` only (same gate as the existing Attendance card).
- `mobile/src/navigation/RootNavigator.tsx` — modified: add a `Regularization` route.

## Data flow & error handling

- `deriveTodayLiveStatus` runs purely off the same `subscribeTodayOfficeEvents` stream
  Attendance already subscribes to — no new subscription needed for today's status.
  `RegularizationScreen` will independently call `subscribeTodayOfficeEvents` itself
  (same pattern as `AttendanceScreen`, each screen owns its own subscription) rather than
  sharing screen state across routes.
- `subscribeRegularizationWindow`'s `onSnapshot` always has an `onError` callback,
  matching the standing project rule (already enforced in every prior Firestore-reading
  module). A read failure must not be treated as "window open" — fail closed, mirroring
  Android's own `.catch { emit(false) }` (`RegularizationViewModel.kt:80-92`) exactly.
- `submitRegularizationRequest` mints the doc ref locally and calls
  `setDoc(...).catch(...)` without awaiting the write promise — the same offline-safe
  pattern as `recordOfficeEvent`/`submitLeaveRequest`, for the same reason.
- Client-side validation order, before any Firestore write: non-blank `reason` → duplicate
  pending/approved request for that date → rest-day (Sunday/holiday) rejection. Each
  produces its own inline error message, matching the form-error pattern already
  established in `LeaveScreen.tsx`.
- The three pre-submit checks (`hasPendingOrApprovedRequest`, `checkIsHoliday`,
  plus the day-of-week calculation) are async reads that must resolve before the submit
  button's write happens — the button should show a submitting state while they run, same
  as `LeaveScreen`'s `submitting` state.

## Verification

- `regularizationStatus.ts` gets full unit test coverage (TDD), run via `npx jest`,
  mirroring `attendanceRules.test.js`'s own cases so the two stay provably in lockstep in
  spirit (not literally shared, since this is a different language/runtime, same as how
  `leaveCoverage.ts` mirrors `admin/src/lib/leaveDates.ts` without being the same file).
- `npx tsc --noEmit` clean project-wide.
- Manual device walkthrough (no simulator available, same constraint as every prior
  phase): trigger a flagged day (e.g. check in late), confirm the app shows the correct
  HalfDay/SL flag matching what the nightly job will eventually write; submit a
  correction and confirm the resulting Firestore doc matches Android's field shape
  exactly; toggle `config/regularizationWindow.open` from the admin portal and confirm the
  past-date picker appears/disappears accordingly; pick a past date and confirm its stored
  status displays correctly; confirm a duplicate-request attempt and a Sunday/holiday date
  are both refused client-side with a clear message.

## Out of scope for Phase 2b

- Operations/sales roles (deferred to whichever phase builds their attendance flows).
- `claimedKm` / conveyance (operations/sales-only, tied to the above).
- Any history/My-Submissions view (Android has none either — deliberate, not deferred).
- Admin approval UI (portal-only, unchanged, per Android's own architecture).
- A lookback ceiling on past-date regularization (Android has none; not inventing one).
- The `autoFiled` system-auto-filed request mechanism (`firebase/functions/unclosedDay.js`)
  — a read-only display concern at most, and not currently surfaced anywhere in the admin
  UI either; no action needed from the mobile client for this phase.
