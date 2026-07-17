# WhiteCoffee — Claude Code Context File
### Android side of the whitecoffee monorepo. Root context: ../CLAUDE.md
### Released: v1.8 / versionCode 8. Per-change history lives in git, not here.

---

## WHAT YOU ARE BUILDING
A **Field Operations Management Android App** called **White Coffee** for **Senken Engineering**.
- Platform: Android (Kotlin). **UI = Jetpack Compose (Session 27):** ALL 12 screens are now
  Compose with a Material 3 "teal" redesign. Each Fragment is a thin `ComposeView` host;
  ViewModels/repositories/nav-graph/Hilt/Firestore are unchanged — only the UI layer was rebuilt.
  NOT Compose Multiplatform — Android-only Jetpack Compose. Shared design system lives in
  `ui/theme/` (see DESIGN SYSTEM section). Old XML layouts + RecyclerView adapters + the
  View-based `PhotoPickerHelper` + `ApplyLeaveFragment` remain on disk but are now DEAD CODE.
- Package: `com.raghav.whitecoffee`
- Backend: Firebase Auth + Firestore + Storage (Blaze plan)

---

## PINNED TOOLCHAIN — DO NOT CHANGE ANY OF THESE

```
AGP:         8.7.3
Gradle:      8.9
Kotlin:      2.0.21   (with -Xskip-metadata-version-check flag)
KSP:         2.0.21-1.0.28
JDK:         17
Hilt:        2.52
Firebase BoM: 34.14.0
```

### Critical flags in `app/build.gradle.kts`:
```kotlin
kotlinOptions {
    jvmTarget = "17"
    freeCompilerArgs += listOf("-Xskip-metadata-version-check")
}
```

### Critical flags in `gradle.properties`:
```properties
android.useAndroidX=true
kotlin.ksp.allowAllTargetConfiguration=true
kapt.use.worker.api=false
```

---

## ARCHITECTURE — READ THIS BEFORE WRITING ANY CODE

Pattern: **MVVM + Repository + Hilt**
- Fragments = UI only, zero business logic, zero direct Firestore
- ViewModels = state via `StateFlow<UiState<T>>`
- Repositories = only layer that touches Firebase
- Hilt = constructor injection everywhere, zero manual instantiation
- ViewBinding = always cleared in `onDestroyView()` via BaseFragment
- Coroutines = `viewModelScope` for all async, `repeatOnLifecycle(STARTED)` for collection

### UiState (sealed interface — use this for EVERY screen):
```kotlin
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data object Empty : UiState<Nothing>
    data class Error(val message: String) : UiState<Nothing>
    data object Offline : UiState<Nothing>
}
```

---

## FIRESTORE SCHEMA (Sub-Collections Per User — NoSQL document database)

> Firebase Firestore is **non-relational (NoSQL)**. Collections = tables, Documents = rows. No JOINs.
> All user-owned data lives in sub-collections under `/users/{userId}/` — no userId filter needed on reads.
> For admin cross-user queries use Firestore `collectionGroup("collection_name")`.

### Collection structure:
```
/users/{userId}                              ← User profile document
/users/{userId}/attendance/{eventId}         ← Attendance events
/users/{userId}/attendance_status/{date}     ← Daily attendance status (auto-computed by Cloud Function)
/users/{userId}/material_requests/{id}       ← M&T Requests
/users/{userId}/material_purchases/{id}      ← M&T Purchases
/users/{userId}/material_transfers/{id}      ← Material Transfers
/users/{userId}/tool_transfers/{id}          ← Tool Transfers
/users/{userId}/work_progress/{id}           ← Work Progress
/users/{userId}/notifications/{id}           ← In-app notifications
/users/{userId}/leave_requests/{id}          ← Leave requests
/users/{userId}/regularization_requests/{id} ← Attendance regularization requests

/sites/{siteId}                              ← Site info (top-level, shared)
/sent_notifications/{id}                     ← Admin send log (history + Cloud Functions FCM trigger)
/daily_assignments/{date}_{userId}           ← COMMENTED OUT — not in use
```

### `/users/{userId}/attendance_status/{date}` — Daily Attendance Status
| Field | Type | Notes |
|---|---|---|
| date | String | yyyy-MM-dd (also used as document ID) |
| userId | String | Denormalized |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| role | String | operations / office / sales / admin |
| status | String | Present / SL / HalfDay / LNF / Absent / PL / LWP / WO |
| markedBy | String | auto (Cloud Function) / admin (manual override) / backfill |
| updatedAt | Timestamp | |

> Auto-computed nightly at 23:59 IST by `computeDailyAttendanceStatus` Cloud Function for ALL users.
> Office/Admin window is fixed 10:00–18:00; Operations use the admin-set planned shift.
> With both punches: **off-minutes** = late-in + early-out (scored against the window). `0` →
> **Present**, `≤120` → **SL**, else **HalfDay**. On-time is **inclusive** of the start —
> checking in at exactly 10:00 is on time (`inMinutes ≤ 600`), NOT late. One punch → **LNF**
> (Log Not Found, formerly SLNF). No events + approved leave → **PL** (if plBalance > 0) or
> **LWP**. No events + no leave → **Absent**.
>
> The app's live home-screen / regularization preview uses **`AttendanceStatusRules`**
> (`data/model`) — a pure, unit-tested port of this logic (minute-based, SL-aware) so what the
> employee sees matches payroll. It replaced an older hour-granular `inHour < 10` check that
> wrongly showed **Half Day** for anyone checking in during the 10:00 hour.
>
> For **operations** the preview reads that day's `planned_hours` (via
> `AttendanceRepository.getTodayPlannedWindow()`) and scores `site_in`/`market_in` →
> `site_out`/`market_out` against it — matching payroll's event source + window, NOT
> `home_in`/`home_out`. **No plan → the day is scored against the default 10:00–18:00**, not left
> unmarked: payroll's `shouldEvaluateDay` evaluates any ops day that has a plan OR approved leave
> OR actual work events, and the window falls back to 10:00–18:00 when the plan is missing. Only
> **not yet at any site** still shows the neutral **Pending** chip (no verdict yet; if they never
> turn up, the day is unscheduled and payroll skips it rather than marking Absent). The JS side is
> the shared `firebase/functions/attendanceRules.js` (`npm test` = `node --test`); it and
> `AttendanceStatusRules.kt` must stay in lockstep.

> **HalfDay vs "short leave" — there is NO short-leave concept (known gap).** HalfDay is derived
> purely from punch TIMES (late in / early out); no employee intent is attached. Leave is
> whole-day ONLY — `LeaveType` has just Sick/Casual/Annual/Unpaid and `LeaveRequest.totalDays`
> is an `Int`; there is no half-day flag, hourly leave, or "short leave" type anywhere. So an
> approved early departure is indistinguishable from slacking — both auto-mark HalfDay. The only
> recourse is **Regularization** (admin approval flips HalfDay→Present, all-or-nothing) or a
> full-day Leave. To truly support it would require a half-day flag on `LeaveRequest` (or a new
> Short-Leave type) + a new `attendance_status` value + changes to `computeDailyAttendanceStatus`
> (Cloud Function lives in the `whitecoffee-admin` repo, not here).

### `/users/{userId}` — User Profile
| Field | Type | Notes |
|---|---|---|
| userId | String | Firebase Auth UID |
| employeeId | String | HR ID e.g. "EMP001" |
| name | String | Display name |
| email | String | Lowercase |
| role | String | "operations", "office", "sales", or "admin" |
| salaryRate | Double | ₹/day — set via admin portal, used in Employee Dashboard Sheets export |
| fcmToken | String | FCM device token — saved on login + token refresh |
| createdAt | Timestamp | |

### `/daily_assignments/{date}_{userId}` — Daily Site Assignments (COMMENTED OUT)
This collection and the `getTodayAssignedSites()` function are commented out.
See `SiteRepository.kt` and `SiteTask.kt` for re-enable instructions.

### `/users/{userId}/attendance/{eventId}` — Attendance Events
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized (for collectionGroup queries) |
| employeeId | String | Denormalized |
| userName | String | Denormalized |
| date | String | yyyy-MM-dd |
| type | String | home_in / home_out / site_in / site_out / market_in / market_out / office_in / office_out |
| timestamp | Timestamp | When event occurred |
| latitude | Double | GPS |
| longitude | Double | GPS |
| siteId | String? | site_in / site_out only |
| siteName | String? | site_in / site_out only — free-text entered by user |
| marketName | String? | market_in / market_out only |
| locationName | String? | office_in / office_out only — free-text "Where are you?" |

### `/users/{userId}/leave_requests/{requestId}` — Leave Requests
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized — needed for collectionGroup approve/reject path |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| leaveType | String | Legacy — empty string for new submissions (Session 28: leave type removed from form) |
| fromDate | String | yyyy-MM-dd |
| toDate | String | yyyy-MM-dd |
| totalDays | Int | Auto-calculated inclusive days |
| joiningDate | String | yyyy-MM-dd — employee's joining date (Session 28) |
| emergencyContact | String | Phone number (Session 28) |
| placeOfVisit | String | Where employee will be during leave (Session 28) |
| reason | String | |
| status | String | pending / approved / rejected |
| approvedBy | String | Manager's name |
| approverComment | String | Rejection reason |
| submittedAt | Timestamp | |
| reviewedAt | Timestamp | |

> **Session 28 leave form:** Leave type field removed. New fields added: Joining Date, Emergency Contact, Place of Visit. Applicant Name auto-filled from `SessionManager`. `leaveType` kept in the model with empty default to avoid breaking old records.

### `/users/{userId}/regularization_requests/{requestId}` — Regularization Requests
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized — needed for collectionGroup path resolution |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| date | String | yyyy-MM-dd — the day being regularized |
| originalStatus | String | HalfDay / Absent — what the system auto-marked |
| reason | String | Employee's explanation |
| status | String | pending / approved / rejected |
| approvedBy | String | Admin's name |
| approverComment | String | Admin's reason (required for both approve AND reject — Session 28) |
| approvedStatus | String | The attendance status the admin set on approval: Present / HalfDay / Absent / PL / UPL (Session 28) |
| submittedAt | Timestamp | |
| reviewedAt | Timestamp | |

> **Session 28 regularization approval:** Admin must now supply a reason/comment for both approve and reject (previously only reject). Admin also picks the target attendance status (Present/HalfDay/Absent/PL/UPL) — was hardcoded to "Present". `approvedStatus` is written to both the `regularization_requests` doc and the `attendance_status` doc atomically via `writeBatch`.

> **Firestore index required for Leave Approvals screen:**
> Collection group `leave_requests` → `status` ASC + `submittedAt` ASC
> Create in Firebase Console → Firestore → Indexes → Composite → Add index

### Migration note:
Old flat collections (`attendance`, `material_tool_requests`, etc.) were replaced by sub-collections.
Delete old flat collections from Firestore Console — they only contain test data.

---

## COLOR PALETTE (Material 3 Teal — Session 27, never deviate)

The Compose UI uses the teal M3 palette defined in `ui/theme/Color.kt` (`WcColors`). Do NOT
add hardcoded colors — reference `WcColors` / `WcTiles`.

```
primary:        #006A71  — buttons, active states
primary_dark:   #00474C  — deep accent / grand-total bar
screen_bg:      #F4F9F9  — screen backgrounds
surface:        #FFFFFF  — cards
border:         #E2E9E9  — input/card outline
text_primary:   #101414  — main text
text_secondary: #5A6566  — labels
text_muted:     #8591A0  — placeholders / meta
accent:         #CDE7EC  — secondary button bg
header grad:    #00363B → #00585E  — dark teal hero headers
status: Present/approved #C7F0D2/#0A5132 · Pending #FCEFC7/#8A6700 · Rejected #FFDAD6/#BA1A1A
```

> NOTE: the old `res/values/colors.xml` (blue) is NOT yet reconciled and is only used by any
> leftover XML chrome — the live Compose UI is entirely teal via `WcColors`.

---

## DESIGN SYSTEM (Compose — `ui/theme/`, Session 27)

Single source of truth for the Material 3 UI. Build every new screen from these.
- `Color.kt` — `WcColors` (palette) + `WcTile`/`WcTiles` (per-module icon-tile bg/fg).
- `Type.kt` — `Manrope` FontFamily (`res/font/manrope_400..800.ttf`) + `MaterialSymbols` font + `WcTypography`.
- `MsIcons.kt` — `object Ms` (icon name → PUA codepoint string) + `MsIcon(Ms.x, sizeSp, tint)`.
  Icons come from a **subset** font `res/font/material_symbols.ttf` (~10.6 KB, 49 glyphs).
  To add an icon, re-subset the full Material Symbols Rounded font by Unicode codepoints
  (fonttools: `varLib.instancer` to pin wght=400/FILL=0, then `subset --unicodes=...`) and add a
  `const val` to `Ms`. (`location_on`'s glyph is named `place`, codepoint `e0c8`.)
- `Theme.kt` — `WhiteCoffeeTheme {}` (call at top of each `*Screen`).
- `Components.kt` — `WcTopBar`, `WcPrimaryButton`, `WcField`, `ReadOnlyFieldBox`, `WcCard`,
  `IconTile`, `StatusBadge`, `AddItemButton`, `RemovableItemRow`, `EmptyState`, `InfoBanner`,
  `SectionLabel`/`FieldLabel`.

**Screen host pattern:** Fragment extends plain `Fragment` (not BaseFragment); `onCreateView`
returns a `ComposeView` (DisposeOnViewTreeLifecycleDestroyed) that collects ViewModel flows via
`collectAsStateWithLifecycle` and renders a stateless `*Screen` composable. Android dialogs
(DatePicker, site/market/reject/regularize-reason AlertDialogs) stay in the Fragment, triggered
via callbacks. Photos: `rememberLauncherForActivityResult(PickMultipleVisualMedia)` + Glide
thumbnails in an `AndroidView`.

> Build note (verified Session 30): the bundled Android Studio JBR is broken (`...\jbr\bin`
> missing `lib\jvm.cfg`). Command-line Gradle needs TWO standalone JDKs installed:
>  - **JDK 21** — the *Gradle daemon* JVM. The repo pins it via `gradle/gradle-daemon-jvm.properties`
>    (`toolchainVersion=21`). Without it the daemon won't start ("Cannot find a Java installation ...
>    matching ... Java 21").
>  - **JDK 17** — the app's bytecode target (`jvmTarget = "17"`); kotlinc/javac on the 21 daemon
>    emit 17 bytecode, so 17 isn't strictly required to build but matches the pinned target.
>  Both installed via winget (Eclipse Temurin):
>    `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot` and `...\jdk-17.0.19.10-hotspot`.
>  CLI build (PowerShell): set `JAVA_HOME` to the **21** JDK and run gradlew — do NOT pass
>  `-Dorg.gradle.java.home=<path>` on the command line (PowerShell splits the spaced path and breaks it):
> ```powershell
> $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
> .\gradlew.bat :app:assembleDebug --console=plain
> ```

> **Linux build (this machine — Arch, verified Session 31):** the Windows/JBR notes above do NOT
> apply here. JDK 21 is on PATH (`/usr/bin/java`, `java-21-openjdk`) and the Gradle daemon is
> already pinned to 21 via `gradle/gradle-daemon-jvm.properties`, so **no `JAVA_HOME` juggling is
> needed** — do not set it. Android SDK lives at `~/Android/Sdk` (`local.properties → sdk.dir`).
> Run gradlew from the **`android/` directory** (that's where `gradlew` + `settings.gradle.kts`
> live and where Gradle's `rootProject` resolves — NOT the monorepo root):
> ```bash
> ./gradlew :app:compileDebugKotlin --console=plain   # fast type-check
> ./gradlew :app:assembleDebug --console=plain          # full debug APK
> ```

---

## RELEASE SIGNING & DISTRIBUTION (Firebase App Distribution — Session 30)

Distribution is via **Firebase App Distribution** (not Play Store). Testers get an email +
"App Tester" app notification on every new build; one tap to update. Free, uses the existing
`white-coffee-92c27` Firebase project.

### Release signing (dedicated keystore)
- Keystore: `android/keystore/whitecoffee-release.jks`, alias `whitecoffee` (created Session 30).
- Credentials: `android/keystore.properties` — NOTE the paths are relative to Gradle's
  `rootProject`, which is the **`android/` dir**, not the monorepo root (`build.gradle.kts` does
  `rootProject.file("keystore.properties")` + `rootProject.file(storeFile)`). **Both files are
  gitignored** (`*.jks`, `*.keystore`, `keystore.properties`) — they are NOT in version control,
  so they exist ONLY on a dev machine; verify with `keytool -list -keystore <jks>` before a release.
- ⚠️ **BACK UP BOTH FILES** (password manager / secure storage). If lost, you can never ship an
  update that installs over the existing app — users would have to uninstall + reinstall.
- `app/build.gradle.kts` loads `keystore.properties` and applies a `release` signingConfig. If the
  file is absent (fresh clone) release builds stay unsigned rather than failing configuration.

### One-time setup (already done in code)
- Plugin `com.google.firebase.appdistribution` 5.3.0 in version catalog + root + app build files.
- `firebaseAppDistribution { artifactType="APK"; groups="employees"; releaseNotes=... }` in the
  release buildType. App ID resolved from `google-services.json` (`1:905719927616:android:...`).

### One-time setup (manual — do in console / CLI)
1. `firebase login` (Firebase CLI 15.x already installed — the Gradle plugin uses its credentials).
2. Firebase Console → App Distribution → Testers & Groups → create a group with alias **`employees`**
   and add tester emails. (Group alias must match `groups="employees"` in build.gradle.kts.)

### Ship an update (every release)
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
.\gradlew.bat assembleRelease appDistributionUploadRelease "-PreleaseNotes=What changed this build"
```
Bump `versionCode` (and `versionName`) in `app/build.gradle.kts` before each release so testers
see it as a new version. Signed release APK output: `app/build/outputs/apk/release/app-release.apk`.

> Truly silent/automatic updates would require the Play Store internal track or an MDM; App
> Distribution updates are one-tap (Android blocks silent sideload updates).

---

## ROLE-BASED ACCESS

| Feature | Operations | Office | Sales | Admin |
|---|---|---|---|---|
| Attendance | Full GPS flow (Home→Site→Market) | Multi-cycle check-in/out + location name | **Chooser**: Office Day *or* Site Visit, per day (routes to the two screens below — no duplicate flow) | Same as Office |
| M&T Request | ✅ Visible | ✅ Visible | ❌ Hidden | ❌ Hidden |
| M&T Buy | ✅ | ✅ | ✅ | ✅ |
| Material Transfer | ✅ | ✅ | ✅ | ✅ |
| Tool Transfer | ✅ | ✅ | ✅ | ✅ |
| Work Progress | ✅ Visible | ❌ Hidden | ❌ Hidden | ❌ Hidden |
| Leave (apply + my history) | ✅ | ✅ | ✅ | ✅ |
| Leave Approvals | ❌ Hidden | ❌ Hidden | ❌ Hidden | ✅ Admin only |
| User Management | ❌ | ❌ | ❌ | ✅ Web portal only (not in Android app) |
| Site Management | ❌ | ❌ | ❌ | ✅ Web portal only (not in Android app) |

Role checked via `sessionManager.isOperations` / `sessionManager.isOffice` / `sessionManager.isSales` / `sessionManager.isAdmin`

**Note:** `isOffice` returns true for both office AND admin roles (admin ⊃ office capabilities).
Use `isAdmin` for Leave Approvals and admin screens — NOT `isOffice`. **`isOffice` is FALSE for
sales** — sales is its own role, never folded into office.

**⚠️ Do NOT branch on `isOperations` for behavior that differs per role** — that binary drops
`sales` into the office branch silently. Sales is a deliberate *mix* (office-style fixed window,
ops-style hybrid check-ins + conveyance), so it rides neither branch. Use
**`RoleCapabilities`** (`data/model/RoleCapabilities.kt`) — `attendanceInTypes` /
`attendanceOutTypes` / `usesFixedWindow` / `usesOtShortageLedger` / `tracksShortage` /
`usesConveyance` / `getsCategories` / `inManpowerReports`. The table is **mirrored** in
`admin/src/lib/roleCapabilities.ts` and `firebase/functions/roleCapabilities.js` — change all
three together. Two real bugs came from this exact binary: a sales site day was unregularizable,
and logout auto-checkout left a `site_in` unclosed (scored LNF = half pay). Design:
`docs/superpowers/specs/2026-07-16-sales-role-design.md`

---

## ATTENDANCE LOGIC

### Operations users — event-based (AttendanceFragment + AttendanceViewModel)
Every check-in/out = one Firestore doc with GPS coordinates.

Event types: `home_in`, `home_out`, `site_in`, `site_out`, `market_in`, `market_out`

State machine:
```
NoRecord → HomeCheckedIn → SiteCheckedIn ←→ MarketCheckedIn
                        → MarketCheckedIn
                        → DayComplete (home_out)
```
- GPS captured on EVERY event
- Site check-in: shows dialog with two free-text fields (Site Name + Site ID) — **NO geofencing**
- No site picker dropdown — user manually enters site name and ID

### Office users — Home→Office→Home sequential day (OfficeAttendanceFragment + OfficeAttendanceViewModel)
Event types: `office_in`, `office_out`, `home_in`, `home_out` (Session 22)

State machine (5 phases): `NotStarted → DayStarted ↔ InOffice → DayEnded`
- **NotStarted** (no home_in) → button: `🏠 Start Day — Home In` (GPS only, no location note)
- **DayStarted** (home_in done, not in office) → two buttons: `🏢 Office Check In` (+ "Where are you?") AND `🏠 End Day — Home Out`
- **InOffice** (last office event = office_in) → button: `🏢 Office Check Out` (cycles back to DayStarted — multi-cycle office)
- **DayEnded** (home_out done) → no buttons, "Day complete"
- **Home In / Home Out**: ONCE per day, GPS + timestamp ONLY. Recorded for data only —
  do NOT feed conveyance (ops-only) or attendance_status (office uses office_in/out thresholds).
- Home Out is hidden mid-office-session (must office-check-out before ending the day).
- Office check-in/out: still multi-cycle with "Where are you?" free-text `locationName`.
- `deriveOfficeState()` uses home_in/home_out as once-per-day gates; office_in/out cycle between them.
- Full event timeline shown below the buttons (AttendanceTimelineAdapter already labels home events).

### Sales users — hybrid day (SalesAttendanceFragment)
Sales split their time between the office and customer/site visits, choosing **per day**. The
attendance card routes to a **chooser** (`ui/attendance/SalesAttendanceFragment` + `…Screen`) —
a thin stateless picker with two options that navigate to the **existing, unchanged** screens:
- **Office Day** → `officeAttendanceFragment` (`office_in`/`office_out`, Home→Office→Home)
- **Site Visit** → `attendanceFragment` (`site_in`/`site_out`, Home→Site→Home)

No duplicate attendance flow exists. Status is scored on the **fixed 10:00–18:00** window over
the first check-in / last check-out of **any** type (`HomeViewModel.deriveSalesDailyStatus`).
Sales has **no OT/shortage/WO/categories** and is excluded from manpower reports, but **does**
earn conveyance.

### HomeFragment routing:
```kotlin
when {
    viewModel.isSales      -> navigate(salesAttendanceFragment)   // chooser: office day or site visit
    viewModel.isOperations -> navigate(attendanceFragment)
    else                   -> navigate(officeAttendanceFragment)
}
```

---

## SITE ENTRY (ALL SCREENS)

Site dropdowns have been removed. Users manually enter:
- **Site Name** — e.g. "Senken Gurugaon Site"
- **Site ID** — e.g. "Site-001"

Both fields are plain `TextInputEditText` widgets. Site Name is required; Site ID is optional.
Applies to: M&T Request, M&T Buy, Work Progress, AttendanceFragment site check-in dialog.

The `/sites/{siteId}` Firestore collection still exists for admin site management (web portal only).
It is NOT used as a dropdown source anywhere in the app currently.

---

## PHOTO UPLOAD SYSTEM

- Firebase Storage (Blaze plan) ✅ enabled
- Compression: max 1080px + JPEG 75% = ~150-250KB per photo
- Storage path: `requests/{userId}/{collectionName}/{docId}/{timestamp}.jpg`
- `PhotoUploadManager` handles compress + upload
- `PhotoPickerHelper` handles UI picker + thumbnails
- Applies to: M&T Request, M&T Buy, Material Transfer, Work Progress
- `photoUrls: List<String>` field in all relevant Firestore models
- Upload flow: submit doc first → get docId → upload photos → update doc with URLs

### Collection names used in photo upload calls (must match Firestore sub-collection names):
- M&T Request → `"material_requests"`
- M&T Purchase → `"material_purchases"`
- Material Transfer → `"material_transfers"`
- Tool Transfer → `"tool_transfers"`
- Work Progress → `"work_progress"`

---

## HOME SCREEN GRID — CONSTRAINTLAYOUT BARRIERS

The 2-column card grid uses three `Barrier` views to prevent layout breaks when GONE cards collapse:

- `barrier_row1` — bottom of `card_attendance` + `card_mt_request`
- `barrier_row2` — bottom of `card_mt_buy` + `card_material_transfer`
- `barrier_row3` — bottom of `card_tool_transfer` + `card_work_progress`

Row 4 (`card_leave`, `card_leave_approvals`) anchors to `barrier_row3`.

When a GONE card collapses to 0dp height, the barrier automatically tracks the surviving card.
`HomeFragment.expandToFullWidth()` programmatically spans a lone card to full width when its
partner is GONE (updates `ConstraintLayout.LayoutParams` to `endToEnd=PARENT_ID`).

---

## TEST CREDENTIALS

| Email | Password | Role |
|---|---|---|
| test@whitecoffee.com | test1234 | operations |
| office@whitecoffee.com | test1234 | office |

---

## BUILD STATUS

### ⏳ REMAINING (Phase 4)
- **Cloud Functions — FCM push** — send push to backgrounded devices (trigger: new doc in `/sent_notifications/`); deferred
- **Background geofencing auto-checkout** (commented out by design — not in use)
- Notifications screen ✅ DONE (in-app only; push to background requires Cloud Functions)
- Google Sheets export ✅ DONE

### 🧹 TECH-DEBT BACKLOG (graph audit — deferred, need a working Gradle build to verify)
- **#4 Duplicated submit/reset boilerplate** — the 6 request/leave ViewModels (`MaterialToolRequest`, `MaterialToolBuy`, `Transfer`, `WorkProgress`, `ApplyLeave`, `Regularization`) repeat near-identical `submit()` / `resetSubmitState()` + `UiState` plumbing. Candidate for a shared base `SubmitViewModel<T>`.
- **#5 No test coverage** — only the default `ExampleUnitTest` / `ExampleInstrumentedTest` stubs exist. Repos + `deriveAttendanceState()` / `deriveOfficeState()` are untested.
- **#6 `UiState.Offline` couples UI-state to connectivity** — `NetworkMonitor` leaks into the `UiState` contract that all 18 ViewModels depend on. Low severity; revisit if `UiState` is reused outside this app.

---

## KEY ARCHITECTURE DECISIONS (locked — never change)

1. **Event-based attendance** — one doc per event, GPS always captured
2. **Sub-collections per user** — `/users/{uid}/{collection}/{docId}` — no userId filter needed on reads
3. **Array of maps for line items** — one read = one Sheets row
4. **SessionManager cache** — persists to SharedPreferences; never re-query Firestore by email
5. **LocationState** (not LocationResult — name clash with GMS)
6. **Button protection** — disable on tap, re-enable only on error
7. **Email** — always `.lowercase().trim()` before any Firestore op
8. **Firestore listeners** — always removed in `onStop()`/`onDestroyView()`
9. **Transfer model shared** — Material + Tool Transfer identical structure
10. **Photo upload** — submit doc first, get docId, then upload, then update URLs
11. **Image compression** — Android Bitmap API, no extra library
12. **Admin users** — secondary Firebase App instance (admin stays logged in during user creation)
13. **collectionGroup queries** — for admin/office views that need all users' data
14. **Daily site assignments COMMENTED OUT** — `SiteRepository.getTodayAssignedSites()` and `SiteTask` class are commented. Site entry is manual free-text in all screens. Re-enable via comments in `SiteRepository.kt` and `SiteTask.kt`.
15. **No My Submissions screens** — dropped; users do not view submission history in the app. All approvals via admin web portal only.
16. **Leave Approvals = admin only** — `isOffice` is true for both office and admin; always use `isAdmin` for the Leave Approvals card/screen check.
17. **Office attendance = Home→Office→Home (Session 22)** — 5-phase day: NotStarted → DayStarted ↔ InOffice → DayEnded. Home In/Out are once-per-day GPS-only gates recorded for DATA ONLY (no conveyance/attendance_status impact). Office in/out still multi-cycle between the home gates. `deriveOfficeState()` keys on home_in/home_out as gates. (Replaces the old `NotCheckedIn ↔ CheckedIn` last-event-only model.)
18. **No geofencing at check-in** — geofenceRadius field exists in `/sites/` documents but is not enforced anywhere in the app currently.
19. **Optimistic attendance updates** — after `recordEvent()` returns `Result<AttendanceRecord>` (with docId), ViewModel appends the record locally and calls `deriveAttendanceState()` in-memory. No Firestore re-fetch. Reduces post-check-in latency from ~1-2s to ~200ms.
20. **`deriveAttendanceState()` top-level function** — lives in `AttendanceRecord.kt` (model package). Shared by `AttendanceRepository` (for initial load) and ViewModels (for optimistic updates). Never duplicate this logic.
21. **Notifications in Firestore sub-collection** — `/users/{uid}/notifications/` stores in-app notifications. FcmService writes here on push receive. Admin portal writes here via `writeBatch` when sending. Bell badge count = `getUnreadCount()` (whereEqualTo isRead false).
22. **`FcmService` is `@AndroidEntryPoint`** — required for Hilt injection into a `FirebaseMessagingService`. Uses its own `CoroutineScope(SupervisorJob() + Dispatchers.IO)` — not ViewModelScope or lifecycleScope.
23. **Push to background = Cloud Functions** — `FcmService.onMessageReceived` only fires when app is foregrounded. Sending push to backgrounded devices requires a Cloud Function that reads `/sent_notifications/` docs and calls FCM HTTP v1 API. Deferred to Phase 4.
24. **FCM token saved two ways** — proactively on login via `FirebaseMessaging.getInstance().token.await()`, and automatically on refresh via `FcmService.onNewToken()`. Both call `notificationRepository.saveToken()`.
25. **Salary rate in Firestore** — `salaryRate` (₹/day) stored on `/users/{uid}` doc, set via admin portal. Cloud Function `exportToSheets` reads it from the user doc directly (not from the Google Sheet). Imprest is still manually entered in the sheet and preserved across exports.
26. **`attendance_status` for all roles** — `computeDailyAttendanceStatus` runs nightly at 23:59 IST for ALL users. Office/admin are scored on `office_in`/`office_out` vs a fixed 10:00–18:00 window; operations on the first `site_in`/`market_in` → last `site_out`/`market_out` vs the day's admin-set `planned_hours`, **falling back to the default 10:00–18:00 when no plan exists** (an ops day with no plan, no leave AND no work events is *unscheduled* and skipped — never Absent; the decision is the tested `shouldEvaluateDay`); **sales** on the first check-in / last check-out across **all** of office+site+market vs the **fixed** 10:00–18:00 window (never needs a plan). Status = off-minutes (late-in + early-out): `0` Present, `≤120` SL, else HalfDay; a single punch → LNF. `home_in`/`home_out` are commute markers only and are never scored. The rule lives in `firebase/functions/attendanceRules.js` (shared, `npm test`) and is mirrored by `AttendanceStatusRules.kt` for the app preview — **change both together**. The **event types + window per role** come from `RoleCapabilities` / `roleCapabilities.js` — never re-derive them from an `isOperations` binary.
27. **Regularization = employee-initiated, admin-approved** — employee submits reason per flagged day, admin approves/rejects in admin portal only (no Android admin screen). Approval atomically updates both `regularization_requests` and `attendance_status` via `writeBatch`.
28. **Admin overrides protected** — `computeDailyAttendanceStatus` skips any user whose `attendance_status` doc has `markedBy === "admin"`. This prevents nightly auto-compute from overwriting approved regularizations.
29. **Duplicate prevention** — `RegularizationRepository.submitRequest()` checks for existing pending/approved request for the same date before creating a new one.
30. **Monthly in-app reminder** — `regularizationReminder` Cloud Function runs on the 25th, creates in-app notification for all admin users about pending regularization requests. No email dependency (SendGrid removed).
31. **Firestore rules = field-level least privilege (Session 22)** — owner-update rules NEVER use a bare `isOwner` allow. Owner may only patch a whitelisted set of fields (`changedKeysWithin([...])`): user doc → `activeSessionToken`/`fcmToken`; request/purchase/transfer/work_progress docs → `photoUrls`. Status/role/salary changes are admin-only. Never widen these without a matching app write.
32. **No in-app admin user/site screens** — User & Site management are WEB-PORTAL ONLY. There is no `ui/admin/` package. `UserRepository` admin methods exist but are unused.
33. **Office home events are data-only** — `home_in`/`home_out` for office users are recorded purely for record-keeping. Conveyance is **operations + sales** (`usesConveyance`), never office/admin; `computeDailyAttendanceStatus` for office keys on office_in/out. Never wire office home events into pay/status logic.
34. **`MainViewModel` (app root) owns session + logout** — `@HiltViewModel` scoped to `MainActivity`. Two responsibilities:
    (a) **Single-device session enforcement** — `startMonitor()` attaches a Firestore snapshot listener on `users/{uid}.activeSessionToken`; if the server token diverges from the cached `SessionManager.sessionToken` (account logged in elsewhere) it emits `sessionInvalidated`. Started via `startMonitorIfLoggedIn()` / `onLoginSuccess()`, torn down in `logout()` + `onCleared()`.
    (b) **Logout auto-checkout** — `logoutWithAutoCheckout()` records closing attendance events before signing out: operations → `SITE_OUT`/`MARKET_OUT` then `HOME_OUT` based on current `AttendanceState`; office → `OFFICE_OUT` (if still in office) then `HOME_OUT`. **Sales dispatches on the actual `AttendanceState`, NOT the role** — site/market checked-in takes the operations path, anything else the office path. This is load-bearing: sales is hybrid, so the open day cannot be inferred from the role, and sending a site-checked-in sales user down the office path leaves the `site_in` unclosed → the nightly compute scores the day **LNF = half pay**. Guarded by `_logoutInProgress`; auto-checkout failures are swallowed so logout always completes (offline-safe by design — do not "fix" the empty catch without preserving guaranteed logout).
35. **Home check-out confirms before it writes (v1.7)** — `home_out` is the one attendance action gated by a dialog (`HomeOutConfirmDialog` in `ui/attendance/AttendanceScreen.kt`, hosted by `AttendanceFragment` + `OfficeAttendanceFragment`; sales inherits it via the chooser). Rationale: `home_out` is **terminal** — `deriveAttendanceState` returns `DayComplete` for good and `isEventAllowed` then blocks `HOME_IN` (needs `NoRecord`) and `SITE_IN` (needs `HomeCheckedIn`), so a stray tap cost the employee the rest of their day, and `home_in` → mis-tap left the day closed with **zero scored punches** (ops day unmarked/Absent). **A self-serve undo window and a biometric gate were both proposed and explicitly rejected** — if the dialog proves too easy to tap through, upgrade it to slide-to-confirm rather than adding undo or a fingerprint dependency. ⚠️ Known gap: `MainViewModel.logoutWithAutoCheckout()` still writes `HOME_OUT` with **no** prompt, so an accidental logout ends the day silently — same consequence, different door.

---

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
