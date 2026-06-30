# Graph Report - WhiteCoffee01  (2026-06-30)

## Corpus Check
- 95 files · ~53,035 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1083 nodes · 1708 edges · 99 communities (74 shown, 25 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 148 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0d1bd9c9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Attendance Record & State Model|Attendance Record & State Model]]
- [[_COMMUNITY_Transfer & Work Progress Models|Transfer & Work Progress Models]]
- [[_COMMUNITY_Core UiState & Network Monitor|Core UiState & Network Monitor]]
- [[_COMMUNITY_Attendance Status & Leave Repos|Attendance Status & Leave Repos]]
- [[_COMMUNITY_Web UI Components (JSX Mockup)|Web UI Components (JSX Mockup)]]
- [[_COMMUNITY_Attendance & Home Fragments|Attendance & Home Fragments]]
- [[_COMMUNITY_Location Provider & MainActivity|Location Provider & MainActivity]]
- [[_COMMUNITY_Notifications Model & Repo|Notifications Model & Repo]]
- [[_COMMUNITY_User Model & AuthLogin|User Model & Auth/Login]]
- [[_COMMUNITY_Leave RecyclerView Adapters|Leave RecyclerView Adapters]]
- [[_COMMUNITY_Home Compose Screen|Home Compose Screen]]
- [[_COMMUNITY_M&T Purchase (Buy)|M&T Purchase (Buy)]]
- [[_COMMUNITY_M&T Request|M&T Request]]
- [[_COMMUNITY_Regularization UI (XML)|Regularization UI (XML)]]
- [[_COMMUNITY_Photo Picker & Work Progress|Photo Picker & Work Progress]]
- [[_COMMUNITY_Office Attendance|Office Attendance]]
- [[_COMMUNITY_BaseFragment & Apply Leave|BaseFragment & Apply Leave]]
- [[_COMMUNITY_Transfer Feature|Transfer Feature]]
- [[_COMMUNITY_Attendance ViewModel|Attendance ViewModel]]
- [[_COMMUNITY_Compose Design System (ThemeComponents)|Compose Design System (Theme/Components)]]
- [[_COMMUNITY_M&T Compose Screens|M&T Compose Screens]]
- [[_COMMUNITY_Leave Model & Compose Screens|Leave Model & Compose Screens]]
- [[_COMMUNITY_Photo Upload Manager|Photo Upload Manager]]
- [[_COMMUNITY_Leave Approvals|Leave Approvals]]
- [[_COMMUNITY_Site Model & Repo|Site Model & Repo]]
- [[_COMMUNITY_Design Tweaks Panel (JSX)|Design Tweaks Panel (JSX)]]
- [[_COMMUNITY_Photo Upload Worker|Photo Upload Worker]]
- [[_COMMUNITY_Firebase DI Module|Firebase DI Module]]
- [[_COMMUNITY_iOS Frame Mockup (JSX)|iOS Frame Mockup (JSX)]]
- [[_COMMUNITY_App DI Module|App DI Module]]
- [[_COMMUNITY_Transfer Compose Screen|Transfer Compose Screen]]
- [[_COMMUNITY_Work Progress Compose Screen|Work Progress Compose Screen]]
- [[_COMMUNITY_Material Symbols Icons|Material Symbols Icons]]
- [[_COMMUNITY_Application Class|Application Class]]
- [[_COMMUNITY_Design System Concepts|Design System Concepts]]
- [[_COMMUNITY_Regularization Compose Screen|Regularization Compose Screen]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Blank Screenshot Artifacts|Blank Screenshot Artifacts]]
- [[_COMMUNITY_Instrumented Test|Instrumented Test]]
- [[_COMMUNITY_Unit Test|Unit Test]]
- [[_COMMUNITY_Sheets Export Cloud Function|Sheets Export Cloud Function]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 104|Community 104]]

## God Nodes (most connected - your core abstractions)
1. `White Coffee — Developer Handbook & Handover Guide` - 33 edges
2. `MsIcon()` - 32 edges
3. `UiState` - 24 edges
4. `AttendanceRecord` - 24 edges
5. `AttendanceViewModel` - 22 edges
6. `WhiteCoffee — Claude Code Context File` - 21 edges
7. `MainViewModel` - 19 edges
8. `TransferScreen()` - 19 edges
9. `LeaveScreen()` - 18 edges
10. `OfficeAttendanceViewModel` - 18 edges

## Surprising Connections (you probably didn't know these)
- `MaterialToolBuyScreen()` --calls--> `PurchaseItem`  [INFERRED]
  app/src/main/java/com/raghav/whitecoffee/ui/requests/MaterialToolBuyScreen.kt → app/src/main/java/com/raghav/whitecoffee/data/model/MaterialToolPurchase.kt
- `MaterialToolRequestScreen()` --calls--> `RequestItem`  [INFERRED]
  app/src/main/java/com/raghav/whitecoffee/ui/requests/MaterialToolRequestScreen.kt → app/src/main/java/com/raghav/whitecoffee/data/model/MaterialToolRequest.kt
- `TransferScreen()` --calls--> `TransferItem`  [INFERRED]
  app/src/main/java/com/raghav/whitecoffee/ui/requests/TransferScreen.kt → app/src/main/java/com/raghav/whitecoffee/data/model/Transfer.kt
- `OperationsAttendanceScreen()` --calls--> `WhiteCoffeeTheme()`  [INFERRED]
  app/src/main/java/com/raghav/whitecoffee/ui/attendance/AttendanceScreen.kt → app/src/main/java/com/raghav/whitecoffee/ui/theme/Theme.kt
- `OfficeAttendanceScreen()` --calls--> `WhiteCoffeeTheme()`  [INFERRED]
  app/src/main/java/com/raghav/whitecoffee/ui/attendance/AttendanceScreen.kt → app/src/main/java/com/raghav/whitecoffee/ui/theme/Theme.kt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **MVVM + Repository + Hilt layered stack** — developer_handbook_mvvm_repository_hilt, app_src_main_java_com_raghav_whitecoffee_core_uistate_uistate, app_src_main_java_com_raghav_whitecoffee_core_basefragment_basefragment, app_src_main_java_com_raghav_whitecoffee_data_repository_attendancerepository_attendancerepository [INFERRED 0.85]
- **Regularization end-to-end flow** — developer_handbook_regularization_workflow, app_src_main_java_com_raghav_whitecoffee_data_repository_regularizationrepository_regularizationrepository, app_src_main_java_com_raghav_whitecoffee_data_model_attendancestatusrecord_attendancestatusrecord, developer_handbook_compute_daily_attendance_status, developer_handbook_admin_web_portal [INFERRED 0.85]
- **Photo upload submission pipeline** — developer_handbook_photo_upload_system, app_src_main_java_com_raghav_whitecoffee_data_photouploadmanager_photouploadmanager, developer_handbook_mt_request_feature, app_src_main_java_com_raghav_whitecoffee_data_repository_requestrepository_requestrepository [INFERRED 0.85]

## Communities (99 total, 25 thin omitted)

### Community 0 - "Attendance Record & State Model"
Cohesion: 0.10
Nodes (37): AttendanceRecord, AttendanceState, AttendanceType, DayComplete, deriveAttendanceState(), fromDocument(), HomeCheckedIn, Any (+29 more)

### Community 1 - "Transfer & Work Progress Models"
Cohesion: 0.09
Nodes (19): Transfer, fromDocument(), DocumentSnapshot, User, AuthRepository, Boolean, Result, String (+11 more)

### Community 2 - "Core UiState & Network Monitor"
Cohesion: 0.05
Nodes (35): Empty, Error, Loading, Offline, Success, UiState, ApplyLeaveViewModel, Int (+27 more)

### Community 3 - "Attendance Status & Leave Repos"
Cohesion: 0.19
Nodes (9): fromDocument(), Any, DocumentSnapshot, Map, String, RegularizationRequest, Result, String (+1 more)

### Community 4 - "Web UI Components (JSX Mockup)"
Cohesion: 0.07
Nodes (29): Audited: Session 12 | Status: Pending Implementation, FINDINGS — RANKED BY PRIORITY, H1 — Wrong dispatcher for image compression, H2 — Storage path saved instead of download URL, H3 — Photos upload AFTER form submit (no pre-upload), H4 — Compression quality too high for field use, H5 — No upload progress feedback, H6 — Firestore re-fetched on every tab return (+21 more)

### Community 5 - "Attendance & Home Fragments"
Cohesion: 0.15
Nodes (15): MarketCheckInDialog(), SiteCheckInDialog(), Bundle, LayoutInflater, View, ViewGroup, Bundle, LayoutInflater (+7 more)

### Community 6 - "Location Provider & MainActivity"
Cohesion: 0.07
Nodes (22): GpsDisabled, Boolean, StateFlow, LocationProvider, LocationState, LowAccuracy, PermissionDenied, Success (+14 more)

### Community 7 - "Notifications Model & Repo"
Cohesion: 0.12
Nodes (18): AppNotification, fromDocument(), Any, DocumentSnapshot, Map, String, Int, List (+10 more)

### Community 8 - "User Model & Auth/Login"
Cohesion: 0.13
Nodes (9): Bundle, LayoutInflater, View, ViewGroup, LoginFragment, Boolean, StateFlow, String (+1 more)

### Community 9 - "Leave RecyclerView Adapters"
Cohesion: 0.09
Nodes (21): 10. Data Consistency Checks 🟢, 1. Network / Connectivity 🔴, 2. Attendance — Double-Tap & Race Conditions 🔴, 3. GPS / Location 🔴, 4. Photo Upload 🟡, 5. Form Input — Extremes & Boundary Values 🟡, 6. Session / Auth Edge Cases 🟡, 7. Leave Management Edge Cases 🟡 (+13 more)

### Community 10 - "Home Compose Screen"
Cohesion: 0.09
Nodes (32): HomeFragment, Bundle, LayoutInflater, View, ViewGroup, ActionButton(), AttendanceStatusChip(), HomeHeader() (+24 more)

### Community 11 - "M&T Purchase (Buy)"
Cohesion: 0.25
Nodes (17): ApprovalCard(), DateBox(), FilledActionButton(), Boolean, Color, Int, List, Modifier (+9 more)

### Community 12 - "M&T Request"
Cohesion: 0.09
Nodes (21): fromDocument(), fromMap(), Any, DocumentSnapshot, List, Map, String, MaterialToolRequest (+13 more)

### Community 13 - "Regularization UI (XML)"
Cohesion: 0.05
Nodes (28): AttendanceFragment, Bundle, LayoutInflater, View, ViewGroup, LeaveApprovalsFragment, Bundle, LayoutInflater (+20 more)

### Community 14 - "Photo Picker & Work Progress"
Cohesion: 0.09
Nodes (20): fromDocument(), Any, DocumentSnapshot, Map, String, WorkProgress, Bundle, LayoutInflater (+12 more)

### Community 15 - "Office Attendance"
Cohesion: 0.19
Nodes (13): DayEnded, DayStarted, Error, InOffice, Boolean, List, Result, StateFlow (+5 more)

### Community 17 - "Transfer Feature"
Cohesion: 0.15
Nodes (16): fromDocument(), fromMap(), Any, DocumentSnapshot, List, Map, String, TransferItem (+8 more)

### Community 18 - "Attendance ViewModel"
Cohesion: 0.15
Nodes (14): ActionState, AttendanceViewModel, Error, Idle, Boolean, Double, List, Result (+6 more)

### Community 19 - "Compose Design System (Theme/Components)"
Cohesion: 0.21
Nodes (22): FlaggedDayCard(), List, String, RegularizationScreen(), WcTile, AddItemButton(), EmptyState(), FieldLabel() (+14 more)

### Community 20 - "M&T Compose Screens"
Cohesion: 0.11
Nodes (20): BuyRow, Boolean, List, String, Uri, MaterialToolBuyScreen(), ItemEditorCard(), Boolean (+12 more)

### Community 21 - "Leave Model & Compose Screens"
Cohesion: 0.09
Nodes (21): fromDocument(), fromMap(), Any, DocumentSnapshot, List, Map, String, MaterialToolPurchase (+13 more)

### Community 22 - "Photo Upload Manager"
Cohesion: 0.18
Nodes (11): Int, List, Result, String, Unit, Uri, PhotoUploadManager, Bitmap (+3 more)

### Community 23 - "Leave Approvals"
Cohesion: 0.10
Nodes (18): fromDocument(), Any, DocumentSnapshot, Map, String, LeaveRequest, LeaveType, List (+10 more)

### Community 24 - "Site Model & Repo"
Cohesion: 0.21
Nodes (9): fromDocument(), DocumentSnapshot, Site, Double, List, Result, String, Unit (+1 more)

### Community 25 - "Design Tweaks Panel (JSX)"
Cohesion: 0.13
Nodes (14): 12. Navigation Graph, 15. Role-Based Access Control, 1. What Is This App?, 26. Test Credentials, 3. Project Setup (First Time), 4. Architecture Overview, Common mistake to avoid, How to add a new screen: (+6 more)

### Community 26 - "Photo Upload Worker"
Cohesion: 0.22
Nodes (7): buildRequest(), List, Result, String, PhotoUploadWorker, CoroutineWorker, OneTimeWorkRequest

### Community 27 - "Firebase DI Module"
Cohesion: 0.25
Nodes (4): FirebaseModule, FirebaseAuth, FirebaseFirestore, FirebaseStorage

### Community 28 - "iOS Frame Mockup (JSX)"
Cohesion: 0.11
Nodes (18): ARCHITECTURE — READ THIS BEFORE WRITING ANY CODE, Collection names used in photo upload calls (must match Firestore sub-collection names):, COLOR PALETTE (Material 3 Teal — Session 27, never deviate), CURRENT PACKAGE STRUCTURE, DESIGN SYSTEM (Compose — `ui/theme/`, Session 27), For use with Claude Code in Android Studio Terminal, graphify, HOME SCREEN GRID — CONSTRAINTLAYOUT BARRIERS (+10 more)

### Community 29 - "App DI Module"
Cohesion: 0.33
Nodes (4): AppModule, Context, FusedLocationProviderClient, WorkManager

### Community 30 - "Transfer Compose Screen"
Cohesion: 0.12
Nodes (17): ✅ Admin Web Portal DONE, BUILD STATUS, ✅ DONE (Session 11 complete), ⏳ REMAINING (Phase 4), ✅ Session 11 changes:, ✅ Session 12 changes — Performance improvements (all items from improvements.md done):, ✅ Session 13 changes — Notifications (Phase 4 partial):, ✅ Session 14 changes — Decimal quantities + Firestore collectionGroup rules: (+9 more)

### Community 31 - "Work Progress Compose Screen"
Cohesion: 0.17
Nodes (7): Boolean, String, SessionManager, FcmService, String, FirebaseMessagingService, RemoteMessage

### Community 32 - "Material Symbols Icons"
Cohesion: 0.40
Nodes (5): One-time setup (already done in code), One-time setup (manual — do in console / CLI), Release signing (dedicated keystore), RELEASE SIGNING & DISTRIBUTION (Firebase App Distribution — Session 30), Ship an update (every release)

### Community 33 - "Application Class"
Cohesion: 0.33
Nodes (4): WhiteCoffeeApp, Application, Configuration, HiltWorkerFactory

### Community 34 - "Design System Concepts"
Cohesion: 0.50
Nodes (4): Claude Design Handoff Bundle, Midnight Indigo XML Redesign, White Coffee Print HTML Prototype, White Coffee HTML Design Prototype

### Community 35 - "Regularization Compose Screen"
Cohesion: 0.12
Nodes (17): Collection structure:, `/daily_assignments/{date}_{userId}` — Daily Site Assignments (COMMENTED OUT), FIRESTORE SCHEMA (Sub-Collections Per User — NoSQL document database), Migration note:, `/sent_notifications/{docId}` — Notification Send Log (admin history), `/sites/{siteId}` — Sites, `/users/{userId}/attendance/{eventId}` — Attendance Events, `/users/{userId}/attendance_status/{date}` — Daily Attendance Status (+9 more)

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (6): BaseFragment, Bundle, LayoutInflater, View, ViewGroup, VB

### Community 37 - "Blank Screenshot Artifacts"
Cohesion: 0.67
Nodes (4): Empty Dark Screen Canvas (no rendered content), White Coffee Current Screenshot (blank), Device Status Bar (9:41, signal, wifi, battery), White Coffee Material 3 Teal Design Language

### Community 46 - "Community 46"
Cohesion: 0.22
Nodes (9): LoginScreen(), LoginScreenPreview(), WcPrimaryButton(), Color, Modifier, String, Ms, MsIcon() (+1 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (14): Admin, Admin Web Portal, Architecture, Attendance, Features, Leave Management, Material & Tool Management, Notifications (+6 more)

### Community 48 - "Community 48"
Cohesion: 0.13
Nodes (14): ~~1-3. SendGrid~~ — REMOVED (not needed, admin checks portal directly), 4. Deploy Firestore security rules, 5. Deploy Cloud Functions, 6. Deploy Admin Portal, 7. Test the feature, Admin Portal (modified files):, Admin Portal (new files):, Android App (modified files): (+6 more)

### Community 49 - "Community 49"
Cohesion: 0.14
Nodes (14): 11. UI Layer — Every Screen Explained, Apply Leave Screen, Home Screen (Dashboard), Leave Approvals Screen (Admin Only), Leave Screen (My Leaves), Login Screen, M&T Buy Screen, M&T Request Screen (+6 more)

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (6): Boolean, List, String, Uri, TransferScreen(), XferRow

### Community 51 - "Community 51"
Cohesion: 0.38
Nodes (6): Boolean, List, String, Uri, StepButton(), WorkProgressScreen()

### Community 52 - "Community 52"
Cohesion: 0.20
Nodes (10): 29. Troubleshooting, App shows "Session expired" toast unexpectedly, Build fails with Hilt/KSP errors, "Cannot resolve symbol" on Firebase classes, CollectionGroup query returns empty, Firestore permission denied errors, GPS not working on emulator, Login hangs or times out (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.22
Nodes (9): 8. Data Layer — Models, AppNotification, AttendanceRecord (`data/model/AttendanceRecord.kt`), Key pattern: Every model has a `fromDocument()` function, LeaveRequest (`data/model/LeaveRequest.kt`), MaterialToolRequest / MaterialToolPurchase, RegularizationRequest, Transfer (`data/model/Transfer.kt`) (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (7): 24. How To: Common Changes, Add a new Firestore field to an existing model, Add a new screen, Add a new submission type (like M&T Request), Change the attendance state machine, Change which roles see which features, Deploy Firestore/Storage rules after editing

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (7): 9. Data Layer — Repositories, AttendanceRepository (`data/repository/AttendanceRepository.kt`), AuthRepository (`data/repository/AuthRepository.kt`), LeaveRepository (`data/repository/LeaveRepository.kt`), NotificationRepository (`data/repository/NotificationRepository.kt`), RegularizationRepository (`data/repository/RegularizationRepository.kt`), RequestRepository (`data/repository/RequestRepository.kt`)

### Community 56 - "Community 56"
Cohesion: 0.33
Nodes (6): 10. Data Layer — Services & Helpers, LocationProvider (`data/location/LocationProvider.kt`), NetworkMonitor (`data/network/NetworkMonitor.kt`), PhotoUploadManager (`data/PhotoUploadManager.kt`), PhotoUploadWorker (`data/worker/PhotoUploadWorker.kt`), SessionManager (`data/session/SessionManager.kt`)

### Community 57 - "Community 57"
Cohesion: 0.33
Nodes (6): 13. Firebase Backend — Firestore Schema, Attendance Event (`/users/{userId}/attendance/{eventId}`), Daily Attendance Status (`/users/{userId}/attendance_status/{date}`), Data Organization, Key Document Schemas, User Profile (`/users/{userId}`)

### Community 58 - "Community 58"
Cohesion: 0.50
Nodes (3): Boolean, NetworkMonitor, Flow

### Community 59 - "Community 59"
Cohesion: 0.40
Nodes (5): 20. Cloud Functions (Server Side), `computeDailyAttendanceStatus`, Deploying Cloud Functions:, `exportToSheets`, `regularizationReminder`

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (5): 27. Things That Are Intentionally Disabled, Background Push Notifications, Daily Site Assignments, Geofencing at Check-In, My Submissions Screens

### Community 61 - "Community 61"
Cohesion: 0.40
Nodes (5): 7. Dependency Injection (Hilt), How to add a new dependency:, Module: AppModule (`di/AppModule.kt`), Module: FirebaseModule (`di/FirebaseModule.kt`), Setup chain:

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (3): AttendanceStatusRecord, fromDocument(), DocumentSnapshot

### Community 63 - "Community 63"
Cohesion: 0.50
Nodes (4): ATTENDANCE LOGIC, HomeFragment routing:, Office users — Home→Office→Home sequential day (OfficeAttendanceFragment + OfficeAttendanceViewModel), Operations users — event-based (AttendanceFragment + AttendanceViewModel)

### Community 64 - "Community 64"
Cohesion: 0.50
Nodes (4): 14. Firebase Security Rules, Deploying Rules, Firestore Rules — Key Principles, Storage Rules

### Community 65 - "Community 65"
Cohesion: 0.50
Nodes (4): 16. Attendance Logic — The Core Business Rule, Nightly Computation (Cloud Function), Office Flow (`OfficeAttendanceFragment` + `OfficeAttendanceViewModel`), Operations Flow (`AttendanceFragment` + `AttendanceViewModel`)

### Community 66 - "Community 66"
Cohesion: 0.50
Nodes (4): 17. Photo Upload System, Flow, How to add photos to a new screen, Storage path format

### Community 67 - "Community 67"
Cohesion: 0.50
Nodes (4): 18. Push Notifications (FCM), Current state:, FCM token lifecycle:, How notifications flow:

### Community 68 - "Community 68"
Cohesion: 0.50
Nodes (4): 23. Design System — Colors, Fonts, Themes, Color Palette (`res/values/colors.xml`), Fonts (`res/font/`), Theme (`res/values/themes.xml`)

### Community 69 - "Community 69"
Cohesion: 0.50
Nodes (4): 25. Build & Release, Debug build, Release build, Signing

### Community 70 - "Community 70"
Cohesion: 0.50
Nodes (4): 2. Tech Stack & Prerequisites, Android App, Firebase Project, Required Tools

### Community 71 - "Community 71"
Cohesion: 0.50
Nodes (4): 6. Core Framework — The Patterns Everything Uses, BaseFragment (ViewBinding lifecycle), StateFlow Collection Pattern, UiState (the universal screen state wrapper)

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (3): Critical flags in `app/build.gradle.kts`:, Critical flags in `gradle.properties`:, PINNED TOOLCHAIN — DO NOT CHANGE ANY OF THESE

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (3): 19. Session Management & Single-Device Enforcement, Auto-checkout on logout:, How single-device sessions work:

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (3): 22. Google Sheets Export, 9 Tabs:, Service Account:

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (3): 28. Toolchain Lock — DO NOT CHANGE, Critical flags in `app/build.gradle.kts`:, Critical flags in `gradle.properties`:

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (3): 21. Admin Web Portal, Deploying:, Pages:

### Community 104 - "Community 104"
Cohesion: 0.67
Nodes (3): 5. Folder Structure — Full File Map, Resource Files, Root-Level Files

## Ambiguous Edges - Review These
- `Empty Dark Screen Canvas (no rendered content)` → `White Coffee Material 3 Teal Design Language`  [AMBIGUOUS]
  .design_import/whitecoffe/project/screenshots/current.png · relation: conceptually_related_to

## Knowledge Gaps
- **255 isolated node(s):** `AttendanceType`, `LeaveType`, `WcColors`, `WcTiles`, `Ms` (+250 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty Dark Screen Canvas (no rendered content)` and `White Coffee Material 3 Teal Design Language`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `UiState` connect `Core UiState & Network Monitor` to `Attendance Record & State Model`, `Notifications Model & Repo`, `User Model & Auth/Login`, `M&T Purchase (Buy)`, `M&T Request`, `Community 46`, `Photo Picker & Work Progress`, `Transfer Feature`, `Attendance ViewModel`, `Compose Design System (Theme/Components)`, `Leave Model & Compose Screens`, `Leave Approvals`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `LeaveRequest` connect `Leave Approvals` to `Core UiState & Network Monitor`, `M&T Purchase (Buy)`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `WhiteCoffeeTheme()` connect `Attendance & Home Fragments` to `Attendance Record & State Model`, `Notifications Model & Repo`, `Home Compose Screen`, `M&T Purchase (Buy)`, `Community 46`, `Community 50`, `Compose Design System (Theme/Components)`, `M&T Compose Screens`, `Community 51`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `MsIcon()` (e.g. with `AttendanceScaffold()` and `CardActionButton()`) actually correct?**
  _`MsIcon()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AttendanceType`, `LeaveType`, `WcColors` to the rest of the system?**
  _259 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Attendance Record & State Model` be split into smaller, more focused modules?**
  _Cohesion score 0.10253699788583509 - nodes in this community are weakly interconnected._