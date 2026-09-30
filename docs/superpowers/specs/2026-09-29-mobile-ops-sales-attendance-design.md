# iOS Mobile App — Phase 4a: Operations & Sales Attendance

## Context

Phases 1–3a (office attendance, Leave, Regularization, M&T Buy) shipped via
[PR #47](https://github.com/Raghavkhedar/whitecoffee/pull/47) and
[PR #48](https://github.com/Raghavkhedar/whitecoffee/pull/48). M&T Request and
Material/Tool Transfer followed in the same PR #48. All of it is office/admin-role
attendance plus role-agnostic submission forms. Operations and sales roles are today
completely locked out of Attendance on mobile — `HomeScreen`'s `canUseOfficeAttendance`
gate admits only `office`/`admin`, and there is no other attendance screen. This spec
covers porting Android's operations attendance flow and sales's office/site chooser,
closing that gap.

## Android reference behavior (verified by direct investigation, not assumption)

Read directly from `android/app/src/main/java/com/raghav/whitecoffee/data/model/AttendanceRecord.kt`
and `android/CLAUDE.md`'s "ATTENDANCE LOGIC" section — not inferred from `roleCapabilities`.

**Operations — event-based, GPS on every event, no site picker.** Event types:
`home_in`, `home_out`, `site_in`, `site_out`, `market_in`, `market_out`. State machine
(`AttendanceState` sealed interface + `deriveAttendanceState`/`isEventAllowed`):

```
NoRecord --home_in--> HomeCheckedIn
HomeCheckedIn --site_in--> SiteCheckedIn
HomeCheckedIn --market_in--> MarketCheckedIn
HomeCheckedIn --home_out--> DayComplete          (terminal — confirm dialog, like office's Home Out)
SiteCheckedIn --site_out--> HomeCheckedIn        (cycles — repeatable multi-visit day)
SiteCheckedIn --market_in--> MarketCheckedIn     (allowed directly — no site_out button shown;
                                                   Android's isEventAllowed permits market_in from
                                                   BOTH HomeCheckedIn and SiteCheckedIn)
MarketCheckedIn --market_out--> HomeCheckedIn    (cycles)
```

`home_out` is terminal exactly like office's: checked across the *whole* event list (not
just the last event), same reasoning as mobile's existing `deriveOfficeState` guard against
a stray post-checkout event reopening a closed day.

**Site check-in dialog**: two free-text fields — **Site Name** (required) and **Site ID**
(optional, e.g. "Site-001"). **No dropdown** — `android/CLAUDE.md`'s "SITE ENTRY" section is
explicit: `/sites/` is not used as a picker source anywhere in the app, deliberately (decision
#14, "Daily site assignments COMMENTED OUT... Site entry is manual free-text in all screens").
**Market check-in dialog**: one free-text field, Market Name. No geofencing anywhere
(decision #18) — GPS is captured and stored, never validated against a site's coordinates.

**Exact Firestore fields** (`AttendanceRecord.kt` + `android/CLAUDE.md`'s schema table,
cross-checked against each other, identical): `userId`, `employeeId`, `userName`, `date`
(`yyyy-MM-dd`), `type`, `timestamp`, `latitude`, `longitude`, plus event-specific: `siteId`
+ `siteName` (site events only), `marketName` (market events only). `isMockLocation` also
exists on the Android model but mobile's existing `recordOfficeEvent` never writes it for
any event type today — this phase does not introduce it either, for consistency with the
app's own established (if incomplete) pattern.

**Firestore rules**: already admit every one of these punch types —
`firebase/firestore.rules`'s `validPunchType` allows `'office_in', 'office_out', 'site_in',
'site_out', 'market_in', 'market_out', 'home_in', 'home_out'` today (verified — this list
predates this phase and was never office-only). **No rules changes needed.**

**Sales — a once-per-day chooser, not a third state machine.** `SalesAttendanceScreen`
shows two cards: "Office Day" (routes into the *existing, unmodified* office flow) or "Site
Visit" (routes into the *same* operations flow described above — sales gets the full
site+market cycle, not a restricted subset). The choice is per-day and **must be derived
from live attendance state on screen entry, not just remembered client-side**: if the
employee already has an open office or field session today (e.g. app was killed and
reopened), the chooser must skip straight to whichever flow is open — `android/CLAUDE.md`
decision #34's `dayClosePath`/`willLogoutCloseDay` reasoning exists specifically because
sales's open day cannot be inferred from role alone, only from live events. Sending a
site-checked-in sales user down the wrong path is the exact "site_in left unclosed → nightly
scores LNF → half pay" bug that motivated the whole `RoleCapabilities` refactor.

## Scope decisions for this phase

- **Operations and sales attendance only.** Regularization, conveyance, categories
  (`getsCategories`), manpower reports (`inManpowerReports`), and the OT/shortage ledger are
  explicitly **not** built — confirmed by direct source investigation (a prior research pass
  this session grepped the entire Android app for "conveyance": zero UI/ViewModel/repository
  hits) that these are 100% server-computed or admin-portal-only with **no employee-facing UI
  on Android at all**. There is nothing to port for them. `visitType`/`workDoneCategories`
  are admin-only fields patched later from the Manpower Utilisation Input portal page — the
  employee's own `AttendanceRecord` model doesn't even declare them.
- **Regularization stays office/admin-only, deferred.** Its live-status derivation
  (`regularizationStatus.ts`) is hardcoded to office's fixed-window office_in/out scoring.
  Extending it needs its own design: what "missed punch" correction means for a multi-visit
  site day, and porting `AttendanceStatusRules`' ops branch (site/market events vs. the
  admin-set `planned_hours` window, falling back to 10:00–18:00 when no plan exists) is a
  materially different problem from a fixed-window classifier. Flagged as a follow-up phase,
  not solved inline here — matching how Phase 2b itself deferred this exact gap.
- **No site picker.** Matches Android's own deliberate choice (decision #14), not a
  simplification this app is inventing — free-text Site Name + optional Site ID, same as
  every other screen in this app that captures a site (M&T Request/Buy already do this).
- **Home's role label mapping already covers operations/sales** — `ROLE_LABELS` in
  `HomeScreen.tsx` (added during the UI polish pass) already has both entries; no change
  needed there.
- **M&T Request's Android-side ops+office-only gate is not being added.** Mobile currently
  shows M&T Buy/Request/Transfer cards unconditionally to every logged-in role (a prior
  phase's deliberate simplification, not an oversight). Not revisiting that in this phase —
  out of scope, unrelated to attendance.

## File structure

- `mobile/src/attendance/opsAttendanceState.ts` — pure state-machine module, ported from
  `AttendanceRecord.kt`'s `deriveAttendanceState`/`isEventAllowed`:
  ```ts
  export type OpsEventType = 'home_in' | 'home_out' | 'site_in' | 'site_out' | 'market_in' | 'market_out';
  export interface OpsAttendanceEvent { type: OpsEventType; timestamp: number }
  export type OpsState = 'NoRecord' | 'HomeCheckedIn' | 'SiteCheckedIn' | 'MarketCheckedIn' | 'DayComplete';
  export function deriveOpsState(events: OpsAttendanceEvent[]): OpsState
  export function isOpsEventAllowed(state: OpsState, event: OpsEventType): boolean
  ```
  `home_out` terminal-across-whole-list guard mirrors `deriveOfficeState`'s existing pattern
  exactly. `isOpsEventAllowed('market_in', ...)` returns true for both `HomeCheckedIn` and
  `SiteCheckedIn`, per Android's verified `isEventAllowed`.
- `mobile/src/attendance/opsAttendanceState.test.ts` — TDD coverage: every legal transition
  in the table above, every illegal one (e.g. `site_out` from `MarketCheckedIn`), the
  terminal-`home_out`-checked-across-whole-list case, and `market_in` allowed from both
  `HomeCheckedIn` and `SiteCheckedIn`.
- `mobile/src/attendance/attendanceApi.ts` — extended, not replaced: add
  `recordOpsEvent(user, input: { type: OpsEventType; latitude; longitude; siteId?; siteName?;
  marketName? })` alongside the existing `recordOfficeEvent`, and
  `subscribeTodayOpsEvents(uid, onChange)` alongside `subscribeTodayOfficeEvents` (same
  `where('date','==',todayDateString())` + `orderBy('timestamp','asc')` query shape, reusing
  the existing `todayDateString()` export). Kept in the same file rather than a new module —
  it's the same collection (`users/{uid}/attendance`) and the same offline-safe
  `setDoc(...).catch(...)` write pattern, just a different event-type union and optional
  fields; splitting it into a separate API file would duplicate the query/write plumbing for
  no benefit.
- `mobile/src/screens/OperationsAttendanceScreen.tsx` — new screen, structurally mirroring
  `AttendanceScreen.tsx` (same day-rollover guard via `AppState` + `subscribedDate`, same
  write-time-stale-date backstop, same button-disable-while-submitting, same
  `AnimatedModalCard` pattern): buttons driven by `deriveOpsState`, a Site Name + Site ID
  modal for `site_in`, a Market Name modal for `market_in`, a Home Out confirm modal (same
  copy/pattern as office's). Shows the day's punch types so far isn't required by Android and
  isn't added here (Android has no in-screen history view either — decision #15, "No My
  Submissions screens").
- `mobile/src/screens/SalesAttendanceScreen.tsx` — new screen: on mount, subscribes to
  today's events via **both** `subscribeTodayOfficeEvents` and `subscribeTodayOpsEvents`
  simultaneously (a sales user's open session could be either), and once both have loaded:
  if an office session is open (`deriveOfficeState` ∉ `{NotStarted, DayEnded}`) or an ops
  session is open (`deriveOpsState` ∉ `{NoRecord, DayComplete}`), navigate straight into that
  flow (`replace`, not `navigate`, so the chooser isn't left on the back stack); otherwise
  render the two-card chooser ("Office Day" → `OfficeAttendance` route, "Site Visit" →
  `OperationsAttendance` route — reusing the exact same two screens/routes, not duplicating
  them).
- `mobile/src/navigation/RootNavigator.tsx` — add `OperationsAttendance` and
  `SalesAttendance` route entries.
- `mobile/src/screens/HomeScreen.tsx` — the Attendance card's `onPress` becomes role-routed
  instead of hardcoded to `'Attendance'`:
  ```ts
  const attendanceRoute =
    user?.role === 'operations' ? 'OperationsAttendance' :
    user?.role === 'sales'      ? 'SalesAttendance' :
    'Attendance'; // office/admin, existing behavior unchanged
  ```
  The card itself becomes visible for `office`/`admin`/`operations`/`sales` (i.e. every role
  except an unrecognized one) rather than gated to `canUseOfficeAttendance` alone — but the
  **Regularization** card keeps its existing `canUseOfficeAttendance`-only gate unchanged,
  per the scope decision above.

## Data flow & error handling

Identical patterns to the existing office screen, reused rather than reinvented:
- GPS via the existing `requestLocationPermission`/`getCurrentCoordinates` (`useLocation.ts`)
  — no change needed, already role-agnostic.
- Offline-safe writes: `setDoc(...).catch(...)`, not awaited, same as every existing
  attendance/submission write in this app.
- Day-rollover double guard (the `AppState` listener + write-time `todayDateString()` recheck
  in `AttendanceScreen.tsx`) is replicated verbatim in `OperationsAttendanceScreen` — this is
  the exact bug class (`S338` in `firebase/functions/punchSequence.js`) the existing office
  screen's comments document; there's no reason the ops screen would be immune to it.
- `SalesAttendanceScreen`'s dual-subscription-then-route logic needs both subscriptions to
  report their first snapshot before deciding (avoid a flash of the chooser before a real
  open session is detected) — mirrors the existing `eventsLoaded` gate pattern already used
  to disable buttons before the first snapshot arrives.

## Verification

- `opsAttendanceState.ts` gets full unit test coverage (TDD), run via `npx jest`, mirroring
  `officeAttendanceState.test.ts`'s structure.
- `npx tsc --noEmit` clean project-wide.
- Manual device walkthrough (no simulator available, same constraint as every prior phase):
  test-credential ops account (`test@whitecoffee.com` / `test1234`, per `android/CLAUDE.md`)
  — walk Home In → Site In (name+ID) → Site Out → Market In (name) → Market Out → Site In
  again → Home Out, confirming the resulting Firestore docs under `/users/{uid}/attendance/`
  match Android's field shape exactly (checked via Firebase console or admin portal). Confirm
  `market_in` is reachable directly from a `SiteCheckedIn` state. For sales, confirm the
  chooser appears on a fresh day, confirm picking "Site Visit" then killing/reopening the app
  mid-session re-enters the site flow directly (not the chooser), and confirm the same for
  "Office Day".

## Out of scope for Phase 4a

- Regularization for operations/sales (deferred — see "Scope decisions" above).
- Conveyance, categories, manpower reports, OT/shortage ledger — zero employee-facing UI on
  Android; nothing to build.
- A site picker/dropdown — Android deliberately has none.
- Geofencing — Android deliberately has none.
- Admin role: already fully covered today (`canUseOfficeAttendance` already includes
  `admin`), untouched by this phase.
