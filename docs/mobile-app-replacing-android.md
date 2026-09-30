# Mobile app (Expo) — building it, and replacing the Android app with it

**Status:** living checklist · written 2026-09-29 against `origin/main` @ `b673db1` (PR #49)
**Scope:** everything to keep in mind while building `mobile/` (Expo / React Native) and then
retiring `android/` (Kotlin / Compose) so that ONE codebase serves iPhone *and* Android employees.

Legend: **[GAP]** = verified missing in `mobile/` today · **[DECIDE]** = a choice only you can
make · **[VERIFY]** = believed true, prove it before relying on it.

---

## 0. The one rule that sits above everything

**The backend does not know or care which client wrote a document — so every client must write
exactly what the backend expects.** `computeDailyAttendanceStatus`, `onPunchWritten`,
`autoFileUnclosedDays`, `openSessionReminder`, `dailySpend`, `exportToSheets` and the Firestore
rules all read raw documents. A field the new app forgets, a type string it spells differently,
or a punch it writes under the wrong role is **a payroll bug, not a UI bug** — it silently
changes what someone is paid, and nobody sees it until the month's settlement.

So the bar for "the new app can replace Android" is **behavioural parity on every write**, not
"the screens look the same". Read `android/CLAUDE.md` in full before each phase; it is the
de-facto spec for the Android app's behaviour, including the 35 locked decisions at the bottom.

---

## 1. Where things stand today

| Area | Android (`android/`, v1.15 / versionCode 15) | Mobile (`mobile/`) |
|---|---|---|
| Login (email **or** employee ID → `<id>@whitecoffee.internal`) | ✅ | ✅ |
| Office attendance (Home In → Office In ↔ Out → Home Out) | ✅ | ✅ |
| **Operations** attendance (Home → Site ↔ Market → Home) | ✅ | ❌ |
| **Sales** attendance (per-day chooser: Office Day / Site Visit) | ✅ | ❌ |
| Leave (apply + my history, partial approval / cancellation overlay) | ✅ | ✅ |
| Leave **Approvals** (admin only) | ✅ | ❌ |
| Regularization | ✅ | ✅ |
| M&T Buy · M&T Request · Material Transfer · Tool Transfer | ✅ | ✅ |
| **Work Progress** (operations only) | ✅ | ❌ |
| **Notifications** screen + bell badge (`users/{uid}/notifications`) | ✅ | ❌ |
| Push notifications (FCM) + `fcmToken` on user doc | ✅ | ❌ |
| "You're still checked in" ongoing reminder | ✅ | ❌ |
| Today's status preview on Home (Present / HalfDay / SL / LNF / Pending) | ✅ | ❌ |
| App version shown on Home | ✅ | ❌ |
| Single-device session (`activeSessionToken`) | ✅ | ❌ **[GAP]** |
| Suspended-account block screen | ✅ | ❌ **[GAP]** |
| Logout auto-checkout | ✅ | ❌ **[GAP]** |
| `isMockLocation` on punches | ✅ | ❌ **[GAP]** |
| `lastModifiedBy` / `lastModifiedAt` audit stamps | ✅ | ❌ **[GAP]** |
| Offline: durable disk cache, writes survive app kill | ✅ (50 MB persistent cache) | ❌ **[GAP]** see §3.1 |
| Background photo upload that survives app kill | ✅ (WorkManager) | ❌ (foreground upload only) |
| Automated tests | 224 JVM tests | 50 jest tests |

Roles supported in mobile today: **office and admin only** (`HomeScreen.tsx` hard-codes
`role === 'office' || role === 'admin'`). Operations and sales get "Attendance isn't available
for your role on this app yet." That gate is correct and must stay until §2.1 is done.

---

## 2. Feature parity — what still has to be built

### 2.1 Roles: operations and sales
- **Port the role-capabilities table as a 4th mirror** — `mobile/src/…/roleCapabilities.ts` + a
  test. Root `CLAUDE.md` says "change all three together"; that becomes **four**, and the root
  `CLAUDE.md` / `admin/CLAUDE.md` / `android/CLAUDE.md` notes must be updated to say so. Replace
  the hard-coded `role === 'office' || 'admin'` check with a capabilities lookup.
- **Never branch on `role === 'operations' ? site : office`.** That binary drops `sales` into the
  office branch — two real payroll bugs already came from exactly this (see root `CLAUDE.md`).
- **Operations flow:** event types `home_in`, `site_in`/`site_out`, `market_in`/`market_out`,
  `home_out`. Site check-in asks for **Site Name (required) + Site ID (optional)** as free text —
  no dropdown, no geofence. Fields `siteId`, `siteName`, `marketName` on the punch.
- **Sales flow:** a thin chooser that routes to the *existing* office or ops screen for the day.
  No third attendance flow.
- **State-machine guards run immediately before every write**, not just in button visibility
  (Android's `isEventAllowed` / `isOfficeEventAllowed`). `home_out` is refused while a session is
  open — an unclosed `office_in`/`site_in` leaves no closing punch and scores **LNF = half pay**.
- **Home Out confirmation dialog** for every role (decision #35) — it's terminal for the day.
  Undo windows and biometric gates were explicitly *rejected*; if the dialog is too easy to tap
  through, the agreed upgrade is slide-to-confirm.

### 2.2 Screens still missing
- **Work Progress** (operations only) — photos, site name/ID, `work_progress` sub-collection.
- **Leave Approvals** (admin only — use `isAdmin`, never "office-or-admin"). This is the one
  place Android *awaits* the write (it writes to another user's doc, the one path rules can
  refuse); keep that exception.
- **Notifications** list + unread badge (`users/{uid}/notifications`, `isRead`).
- **Today's status preview** on Home — needs a port of `firebase/functions/attendanceRules.js`
  (mirrored today by `AttendanceStatusRules.kt`). That is another lockstep mirror; add its
  tests from the JS suite. Ops preview reads `planned_hours` and falls back to 10:00–18:00;
  "not at any site yet" shows neutral **Pending**. Rest-days come from the **date + `holidays`
  collection**, never from the presence of a status doc (recurring bug — see OT memory).
- **App version** on Home (users and admins use it to confirm they updated).

### 2.3 Behaviour that isn't a screen but must be ported
- **Single-device session:** on login write a fresh `activeSessionToken` UUID to `users/{uid}`
  (fire-and-forget, *no* audit stamp — the owner-update rule is `hasOnly(['activeSessionToken',
  'fcmToken', stamp])`, any other key = PERMISSION_DENIED); listen to the user doc; sign out when
  the server token is **non-empty and different** (`isSessionSuperseded`). Empty/missing token
  must never sign anyone out.
- **Suspension block:** watch `users/{uid}.active` / `suspendedReason` / `expectedReturn`; show a
  full-screen non-dismissable block that auto-lifts on restore. Rules already enforce it
  (`isActive()`), so without the UI a suspended user just sees writes mysteriously fail.
- **Logout auto-checkout** (decision #34b): close whatever is open (site/market out or office
  out, then home out), dispatching on the *actual open state*, not the role (sales!). Failures
  swallowed — logout must always complete. Known gap inherited from Android: logout writes
  `home_out` with no confirmation — worth fixing in the new app rather than copying.
  (There's also an `onEmployeeLogout` callable in functions that no client calls — decide whether
  the new app should use it instead of client-side writes. **[DECIDE]**)
- **`isMockLocation`** on every punch. `onPunchWritten` reads it to flag spoofed GPS. iOS has no
  equivalent API (expo-location's `mocked` is Android-only) — write `false` on iOS, the real
  value on Android. Never block a punch for it (flag, don't refuse).
- **Audit stamps** — Android writes `lastModifiedBy`/`lastModifiedAt` on its writes; mobile
  doesn't. Rules say database-wide enforcement is planned "once clients stamp"
  (`docs/security-hardening-2026-07-20.md`). If that enforcement lands while mobile is
  unstamped, **every mobile write breaks at once.** Add stamps now.
- **Email / identifiers** always `.trim().toLowerCase()` before any Firestore op (decision #7).
- **Photo pipeline parity:** Android compresses to max 1080 px / JPEG 75 %, writes the doc
  first, then uploads to `requests/{uid}/{collection}/{docId}/{ts}.jpg`, then patches
  `photoUrls` (the only field the owner may update). Mobile uses `quality: 0.6` with no resize —
  add `expo-image-manipulator` resize so a 12 MP iPhone photo isn't uploaded over site 4G.

---

## 3. Platform traps (the things that bite *because* it's React Native)

### 3.1 Offline — the biggest risk **[GAP] [VERIFY]**
Android's design principle is "offline is the default": a punch at a site with no signal is
written to a **disk** cache and syncs later, even if the phone reboots.
The Firebase **JS** SDK's persistent cache is built on IndexedDB, which React Native does not
have — `mobile/src/firebase/config.ts` uses plain `getFirestore(app)`, i.e. a **memory-only**
cache. Consequences:
- A punch made offline lives only in RAM. If iOS kills the app (it will, aggressively) before
  signal returns, **the punch is gone** — no error, just a missing check-in → Absent/LNF.
- Cold start offline shows no data at all.

Fix options, in order of preference:
1. **Switch to `@react-native-firebase`** (native iOS/Android SDKs → real disk persistence,
   native FCM, `isMock` access). Requires a development build (no more Expo Go) — which you need
   anyway for push (§3.2) and distribution (§4).
2. Keep the JS SDK and build your own durable outbox (AsyncStorage/SQLite queue, replayed on
   launch). More code, more bugs, and you're re-implementing what the native SDK gives free.

**Test for it explicitly:** airplane mode → punch → force-quit app → reopen → turn signal on →
confirm the doc reaches Firestore. Android passes this; mobile must before it replaces anything.

Related server constraint: rules accept a punch only if its `timestamp` is within **−12 h / +5 min**
of server time (`timestampWithinWindow`). A punch queued offline for more than 12 hours will be
**rejected on sync**. Same for Android — but make sure the new app surfaces a failed sync
instead of swallowing it.

### 3.2 Push notifications **[GAP]**
- Expo Go **cannot receive remote push** on current SDKs — you need a dev/production build.
- iOS push needs an **Apple Developer Program** membership + an APNs key uploaded to Firebase.
- `sendPushNotification` (functions) sends via **FCM** to `users/{uid}.fcmToken`. On iOS,
  `expo-notifications`' device token is a raw **APNs** token, which FCM cannot use. Either use
  `@react-native-firebase/messaging` (gives a real FCM token on both platforms — recommended,
  zero backend change) or switch the backend to Expo's push service (backend change + a second
  token field during migration). **[DECIDE]**
- The function sends `android: { priority: "high" }` only — add an `apns` block (sound, badge)
  for iOS delivery to behave.
- **In-app copies:** Android's `FcmService.onMessageReceived` *writes* the
  `users/{uid}/notifications` row when a push arrives in the foreground. `openSessionReminder`
  deliberately relies on that and does **not** write its own row. A client that only displays
  pushes will leave those reminders out of the in-app list. Match the behaviour, or (cleaner)
  move the in-app write server-side into `sendPushNotification` before cutover. **[DECIDE]**
- Save the token on login **and** on refresh (decision #24).
- The **ongoing "still checked in" notification** can't be copied on iOS (no undismissable
  notifications). Options: rely on the 18:30 `openSessionReminder` push, schedule a local
  notification at ~18:00 when a session is open, or a Live Activity. Keep Android's version on
  Android — it has its own channel so muting admin broadcasts doesn't mute it.

### 3.3 Time and dates
- The nightly scorer and `onPunchWritten` use **IST**. `onPunchWritten` corrects a wrong `date`
  field, but the app's own UI (today's state, "is it a rest day", regularization windows) must
  compute IST dates too — don't use the device's local zone blindly (a phone set to another
  zone, or a traveller, gets the wrong "today").
- Midnight rollover while the app is backgrounded — already handled in Attendance/Regularization
  via `AppState 'active'` re-checks. Keep that pattern for every date-dependent screen.

### 3.4 GPS
- Fresh fix on **every** event; foreground permission only (`locationWhenInUse`) — never ask for
  background location, App Review will question it and you don't need it.
- Handle: permission denied, permanently denied (deep link to Settings), no fix / timeout,
  low accuracy indoors. A punch without lat/lng fails rules (`isValidPunch`), so the UI must
  explain *why* rather than spin.
- Android's `FusedLocationProvider` has a fast path using a recent accurate cached fix; mirror
  that or punches will feel slow on iOS.

### 3.5 Writes and buttons
- Fire-and-forget writes for field actions (`setDoc` with a locally minted id, not awaited) —
  already done in mobile; keep it. Awaiting the server ack hangs offline.
- Disable-on-tap, re-enable only on error (decision #6) — prevents double punches.
- Optimistic UI from the snapshot listener; never re-query after a write.

---

## 4. Distribution

### 4.1 iPhone **[DECIDE]**
Expo Go is a developer tool, not a way to ship to employees (it needs your dev server running,
and can't do push). Real options:

| Route | Cost | Limits | Updates |
|---|---|---|---|
| **TestFlight** (internal testers) | $99/yr Apple Developer | 100 internal testers who must be on your App Store Connect team; builds expire after 90 days | Easy; testers get the update in TestFlight |
| TestFlight (external) | $99/yr | 10,000 testers, but every build goes through Beta App Review | Same |
| Ad Hoc | $99/yr | Register each device UDID; 100 iPhones/yr | Re-install per build |
| Apple Business Manager "custom app" / unlisted App Store | $99/yr | Needs App Review | Normal App Store updates — the only truly hands-off option |
| Enterprise program | $299/yr | Strict eligibility, frequently refused | — |

Whatever the route: **EAS Build** (`eas build`) produces the signed binary without a Mac.
App Review will want a demo account and a privacy policy; the location-permission string in
`app.json` must explain the attendance purpose (it does).

### 4.2 Over-the-air updates (EAS Update) — handle with care
EAS Update can push JS changes without a store/TestFlight round trip — great for UI fixes, but:
- An OTA update that changes **what gets written** reaches everyone within hours. Treat any OTA
  that touches a write path, a role check or a status rule as a payroll release: tests, review,
  and the same deploy-order discipline as backend changes.
- Set `runtimeVersion` (policy `fingerprint` or `appVersion`) so a JS bundle never lands on a
  binary with the wrong native modules.
- Keep a way to roll back (`eas update:republish` / branch channels: `production`, `preview`).

### 4.3 Android — replacing the existing app in place
To have the Expo build **update over** the current Android app instead of installing beside it:
- `app.json → android.package` must be **`com.raghav.whitecoffee`** (same applicationId).
- Sign with the **same release keystore** — `android/keystore/whitecoffee-release.jks`, alias
  `whitecoffee`. It's gitignored and exists only on a dev machine: **back it up before anything
  else**, then upload it to EAS credentials (or build locally). Lose it and every employee must
  uninstall/reinstall.
- `android.versionCode` must be **> 15** (the last native release) and keep increasing.
- Ship it through the same **Firebase App Distribution** group (`employees`, 13 testers) so
  people get the familiar one-tap update.
- Add `google-services.json` (needed by `@react-native-firebase`) via `app.json` config — never
  hand-edit a generated `android/` folder (Expo CNG; see `mobile/AGENTS.md`).
- An in-place update wipes nothing on the server, but the **local session is new** — every user
  will need to log in again, and that login rotates `activeSessionToken`. Warn people.
- Permissions to carry over: fine/coarse location, notifications (Android 13+ runtime prompt),
  camera/photos. Android's battery-optimisation exemption prompt existed for WorkManager uploads —
  decide if the new upload path needs it.

### 4.4 Folder name collision
The Expo project's generated native folders are `mobile/ios` and `mobile/android` — separate from
the repo-root `android/`. Don't confuse the two in scripts, CI or `.gitignore`.

---

## 5. Keeping two clients in lockstep during the transition

For weeks (probably months) Android-native and Expo will both be writing production data.
- **Any schema or rule change** must land in: `android/`, `mobile/`, `admin/`, `firebase/`
  (functions + `firestore.rules` + `rules-tests`) in the same PR, until `android/` is retired.
- **Mirrored logic tables** (no shared build graph, each with its own tests — mobile adds a copy):
  `roleCapabilities`, `attendanceRules` (status preview), `leaveCoverage`, regularization
  status derivation. Add each mobile copy's tests from the same cases as its siblings.
- **Run `cd firebase/rules-tests && npm test` before and after any rule change** — the rules are
  the only real security boundary, whichever client is used. Add rule tests with a fixture that
  has *no other privilege* (the superadmin lesson).
- **Never loosen a rule to make the new app work.** If mobile gets PERMISSION_DENIED, the mobile
  write is wrong until proven otherwise (e.g. an extra key on an owner-update).
- **Don't let one person run both apps.** Single-device session means logging into the new app
  kicks the old one — good — but make sure the old app's logout auto-checkout doesn't then close
  the day that the new app just opened. **[VERIFY]** with a test account before telling anyone
  to switch.
- Collection-group `where()` queries need a `fieldOverride` in `firebase/firestore.indexes.json`
  or a deploy prunes the index (see memory). Mobile should query per-user sub-collections like
  Android does, so it shouldn't need new ones — check if it ever does.

---

## 6. Proving parity (what "done" means before switching anyone)

For each role (office, admin, operations, sales) with a real test account:
1. Run the full day on the new app — every event type, multi-cycle, Home Out.
2. Compare the resulting docs in `users/{uid}/attendance` **field by field** against a day
   written by the Android app (type strings, `date`, `timestamp`, lat/lng, site/market/location
   fields, `isMockLocation`, denormalised `userId`/`employeeId`/`userName`, stamps).
3. Let the nightly run, then check `attendance_status/{date}` gives the same status Android's
   day would have. Check `onPunchWritten` didn't flag anything unexpected.
4. Leave → approve in portal → check coverage display; partial approval; cancellation.
5. Regularization → approve → check status + (ops/sales) conveyance correction.
6. Each request type with photos → photos visible in the portal.
7. Offline test from §3.1, push test from §3.2, suspension toggle, second-device login kick.
8. Logout mid-day for each role → day closed correctly, no LNF.

Because you can't run the Android app yourself, verify the Android side via another tester's
device or via the Firestore documents / Cloud Function logs it produces — design checks so the
*data* proves it, not a screenshot.

---

## 7. Cutover plan (suggested order)

1. Finish parity (§2), fix the platform gaps (§3.1 offline and §3.2 push first), get to a
   dev-build + TestFlight/App Distribution pipeline (§4).
2. **Pilot:** a few iPhone users (who have no app today) + 2–3 Android volunteers on the Expo
   Android build installed over the native one. Run for at least one full payroll month and
   compare their settlements line by line.
3. **Freeze the native app:** no new features in `android/` once the pilot starts — only
   payroll-critical fixes, mirrored into `mobile/`.
4. **Roll out** the Expo Android build to the `employees` group with a versionCode above the last
   native one. Do it on a **Sunday / non-working day** so nobody is mid-day when their app changes.
5. **Rollback plan:** keep `android/` buildable. Because versionCodes only go up, rolling back
   means rebuilding the native app with a *higher* versionCode than the Expo build — write that
   down with the build command before step 4, not during an incident.
6. After one clean payroll month at 100 %: retire `android/` — archive it (tag the last commit),
   remove it from root `CLAUDE.md` / `README.md`, and collapse the "mirror in four places" rules
   back to three.
7. Update docs as you go: `mobile/AGENTS.md` (currently says "Phase 1: office-role attendance
   only"), root `CLAUDE.md`, `README.md` architecture diagram, `REQUIREMENTS.md`.

---

## 8. Open decisions **[DECIDE]**

1. `@react-native-firebase` (native SDKs) vs JS SDK + hand-built offline outbox. (Recommended:
   native — it solves offline, push tokens and mock-location in one move.)
2. iOS distribution route (TestFlight internal vs App Store custom/unlisted).
3. Push: FCM via `@react-native-firebase/messaging` vs Expo push service; and whether in-app
   notification rows move server-side.
4. iOS replacement for the ongoing "still checked in" notification.
5. Use the `onEmployeeLogout` callable for logout auto-checkout, or keep it client-side.
6. Whether logout should confirm before writing `home_out` (fixing Android's known gap).
7. OTA policy: which kinds of change may ship via EAS Update and which need a full build.
8. Dark mode — Android has the seam but no palette; decide once for the new app.

---

## Reference
- `android/CLAUDE.md` — full behaviour spec incl. 35 locked decisions (read before each phase)
- `mobile/AGENTS.md` — Expo conventions (React Navigation, `npx expo install`, CNG)
- `docs/superpowers/specs/2026-09-22-ios-mobile-app-phase1-design.md` — original mobile design
- `docs/superpowers/specs/2026-07-16-sales-role-design.md` — why sales is a hybrid
- `docs/security-hardening-2026-07-20.md` — rules audit, audit-stamp enforcement plan
- `firebase/firestore.rules` — `isValidPunch`, `timestampWithinWindow`, `isActive`, owner-update whitelists
- `firebase/functions/index.js` — `onPunchWritten`, `sendPushNotification`, `openSessionReminder`, `onEmployeeLogout`
