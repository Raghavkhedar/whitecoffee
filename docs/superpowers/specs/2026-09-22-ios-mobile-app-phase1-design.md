# iOS Mobile App (React Native) — Phase 1: Office Attendance

## Context

WhiteCoffee currently ships as an Android app (`android/`) only. The author uses an iPhone
and wants a native mobile client for iOS, distributed internally (not through the App
Store) to employees. This spec covers **Phase 1** of a phased build: a new React
Native/Expo project that talks to the same Firebase backend (`white-coffee-92c27`) and
replicates the **office role's** attendance flow end to end. Later phases add Leave,
Regularization, M&T Buy, Material/Tool Transfer, Work Progress, and support for the other
roles (operations, sales, admin), following the same schema and rules documented in
`android/CLAUDE.md`.

No backend changes are required. This is purely a new client against the existing
Firestore schema, security rules, and Cloud Functions.

## Distribution

Free, internal-only distribution via **Expo Go**:
- No Apple Developer Program membership needed for this phase.
- Build with Expo's managed workflow; run via `npx expo start` and open in the free
  Expo Go app on iPhone.
- Constraint this imposes: the app must stay within Expo's managed SDK (no custom native
  modules requiring a dev client / bare workflow). Everything Phase 1 needs (GPS,
  secure storage, Firebase JS SDK) is covered by Expo's SDK.
- If a later phase needs a native module outside Expo's SDK, distribution will need to
  move to an Apple Developer Program account ($99/yr) + Firebase App Distribution or
  TestFlight — same pattern the Android app already uses for its own distribution.

## Stack

- **Expo (managed workflow) + TypeScript**
- **Firebase JS SDK (modular v9+)** — `firebase/auth` + `firebase/firestore`, pointed at
  the existing `white-coffee-92c27` project (same config values used by `admin/`).
- **React Navigation** for screen routing.
- **React Context** for session/auth state — no Redux/Zustand needed at this size.
- **expo-secure-store** for session persistence (equivalent to Android's
  `SessionManager`/SharedPreferences).
- **expo-location** for GPS capture.
- New top-level folder in the monorepo: `mobile/`, alongside `android/`, `admin/`,
  `firebase/`. Each side already builds independently (per root `CLAUDE.md`); this adds a
  fourth independent build with no shared JS build graph.

## Phase 1 scope

Build only what a signed-in **office**-role employee needs for daily attendance:

1. **Login screen** — email/password via Firebase Auth, using existing WhiteCoffee
   credentials (same Firebase project, so credentials work identically to Android).
2. **Session persistence** — signed-in user cached via `expo-secure-store` so the app
   doesn't require re-login on every launch.
3. **Home screen** — minimal shell: greeting + a single "Attendance" card. Other cards
   (M&T Buy, Material Transfer, Tool Transfer, Leave) are added in later phases.
4. **Office attendance flow** — replicates the Android 5-phase state machine
   (`android/CLAUDE.md` "Office users" section) exactly:
   - States: `NotStarted → DayStarted ↔ InOffice → DayEnded`
   - **Home In** (GPS only, no location note) — once per day, gates the day open.
   - **Office In** (GPS + required "Where are you?" free-text `locationName`) — multi-cycle.
   - **Office Out** — cycles back to `DayStarted`; multi-cycle.
   - **Home Out** (GPS, confirm dialog before writing — mirrors Android decision #35,
     since `home_out` is terminal for the day) — ends the day.
   - Home Out is hidden while `InOffice` (must office-check-out first), matching Android.
   - Writes go to `/users/{uid}/attendance/{eventId}` with the same fields as Android:
     `type` (`office_in`/`office_out`/`home_in`/`home_out`), `timestamp`, `latitude`,
     `longitude`, `locationName` (office events only), plus denormalized `userId`,
     `employeeId`, `userName`, `date` (yyyy-MM-dd). This keeps the existing
     `computeDailyAttendanceStatus` Cloud Function scoring the day identically regardless
     of which client wrote the events.

**Explicitly out of scope for Phase 1**: Leave, Regularization, M&T Buy/Transfer/Tool
Transfer, Notifications, attendance history/timeline view, any operations/sales/admin
flows. These are later phases.

## Data flow & error handling

- Firestore reads use `onSnapshot` listeners (mirrors Android's reactive `Flow` pattern)
  so the UI updates without manual refresh, and continues working from local cache when
  offline — matching the Android app's "offline is the default" principle. Writes are not
  awaited on server ack; `set()` resolves as soon as the local Firestore cache accepts it.
- GPS: `expo-location` requests foreground permission once at login, then takes a fresh
  fix on every attendance action (Home In / Office In / Office Out / Home Out), same as
  Android capturing GPS on every event.
- Button protection: disable on tap, re-enable only on error — matches Android decision #6,
  preventing duplicate punches from a slow network.
- Errors (permission denied, no GPS fix, network write failure) surface as a simple inline
  banner/toast. No elaborate error taxonomy needed at this scope.

## Verification

- Run via `npx expo start`, opened in Expo Go on the author's iPhone, logged in with a
  real `office`-role WhiteCoffee account.
- Manually walk the full state machine once (Home In → Office In → Office Out → Office In
  again → Home Out) and confirm the resulting Firestore docs under
  `/users/{uid}/attendance/` match the shape an Android-originated event would have —
  checked via the Firebase console or admin portal.
- No automated test suite for this phase; UI-driven manual verification is proportionate
  at this scope. Automated tests can be added if the app grows in later phases.

## Future phases (not designed yet)

- Phase 2: Leave (apply + history), Regularization.
- Phase 3: M&T Buy, Material Transfer, Tool Transfer.
- Phase 4: Notifications, attendance timeline, support for operations/sales/admin roles.
- If Phase 1 proves out and needs wider internal distribution beyond the author's own
  phone, revisit distribution via Apple Developer Program + Firebase App Distribution
  (matching the Android app's existing setup) or TestFlight.
