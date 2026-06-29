# White Coffee — Developer Handbook & Handover Guide
### Senken Engineering — Field Operations Management App
### Last Updated: June 2026

---

> ⚠️ **PARTIALLY SUPERSEDED — UI layer is out of date.** This handbook describes the
> original **XML Views** UI with the "DM Sans / Space Grotesk" + `colors.xml` design system.
> As of **Session 27** the entire UI was rebuilt in **Jetpack Compose** with a Material 3
> **teal** design system (Manrope font, Material Symbols, `ui/theme/`). All 12 screens are now
> thin `ComposeView` hosts. **`CLAUDE.md` is the authoritative source for the current UI,
> design system, and screen list.** The architecture/data/Firestore sections below are still
> accurate (ViewModels, repositories, Hilt, nav-graph, and Firestore were not changed); only
> the View/XML/design-system chapters (e.g. §23) are stale.

---

## Table of Contents

1. [What Is This App?](#1-what-is-this-app)
2. [Tech Stack & Prerequisites](#2-tech-stack--prerequisites)
3. [Project Setup (First Time)](#3-project-setup-first-time)
4. [Architecture Overview](#4-architecture-overview)
5. [Folder Structure — Full File Map](#5-folder-structure--full-file-map)
6. [Core Framework — The Patterns Everything Uses](#6-core-framework--the-patterns-everything-uses)
7. [Dependency Injection (Hilt)](#7-dependency-injection-hilt)
8. [Data Layer — Models](#8-data-layer--models)
9. [Data Layer — Repositories](#9-data-layer--repositories)
10. [Data Layer — Services & Helpers](#10-data-layer--services--helpers)
11. [UI Layer — Every Screen Explained](#11-ui-layer--every-screen-explained)
12. [Navigation Graph](#12-navigation-graph)
13. [Firebase Backend — Firestore Schema](#13-firebase-backend--firestore-schema)
14. [Firebase Security Rules](#14-firebase-security-rules)
15. [Role-Based Access Control](#15-role-based-access-control)
16. [Attendance Logic — The Core Business Rule](#16-attendance-logic--the-core-business-rule)
17. [Photo Upload System](#17-photo-upload-system)
18. [Push Notifications (FCM)](#18-push-notifications-fcm)
19. [Session Management & Single-Device Enforcement](#19-session-management--single-device-enforcement)
20. [Cloud Functions (Server Side)](#20-cloud-functions-server-side)
21. [Admin Web Portal](#21-admin-web-portal)
22. [Google Sheets Export](#22-google-sheets-export)
23. [Design System — Colors, Fonts, Themes](#23-design-system--colors-fonts-themes)
24. [How To: Common Changes](#24-how-to-common-changes)
25. [Build & Release](#25-build--release)
26. [Test Credentials](#26-test-credentials)
27. [Things That Are Intentionally Disabled](#27-things-that-are-intentionally-disabled)
28. [Toolchain Lock — DO NOT CHANGE](#28-toolchain-lock--do-not-change)
29. [Troubleshooting](#29-troubleshooting)

---

## 1. What Is This App?

White Coffee is a **field operations management Android app** for Senken Engineering. It tracks:

- **Attendance** — GPS-verified check-in/out for field workers and office staff
- **Material & Tool Requests** — employees request items needed at job sites
- **Material & Tool Purchases** — employees log purchases with receipts (photos)
- **Material & Tool Transfers** — track movement of items between locations
- **Work Progress** — daily work logs with photos
- **Leave Management** — apply for leave, admin approves/rejects
- **Attendance Regularization** — employees explain late arrivals, admin corrects records
- **Notifications** — in-app alerts from admin

There are **three user roles**:
- **Operations** — field workers who visit sites, markets, and work from home
- **Office** — staff who work from an office location
- **Admin** — office role + can approve leaves, manage users (via web portal)

The app is paired with:
- A **Next.js admin web portal** for user management, site management, and approvals
- **Cloud Functions** for nightly attendance computation and Google Sheets export
- **Firebase** as the entire backend (Auth + Firestore + Storage + FCM)

---

## 2. Tech Stack & Prerequisites

### Android App
| Component | Version | Notes |
|-----------|---------|-------|
| Language | Kotlin 2.0.21 | XML Views, NOT Jetpack Compose |
| Android Gradle Plugin | 8.7.3 | |
| Gradle | 8.9 | |
| Min SDK | 26 (Android 8.0) | |
| Target SDK | 35 | |
| Compile SDK | 35 | |
| JDK | 17 | |
| KSP | 2.0.21-1.0.28 | Annotation processing (not KAPT) |
| Hilt | 2.52 | Dependency injection |
| Firebase BoM | 34.14.0 | Auth, Firestore, Storage, FCM, Analytics |
| ViewBinding | Enabled | No DataBinding |
| Navigation | Jetpack Navigation Component | Single-activity, multi-fragment |
| Coroutines | Kotlin Coroutines | All async is coroutine-based |

### Firebase Project
- Project ID: `white-coffee-92c27`
- Auth: Email/password sign-in
- Firestore: Sub-collections per user
- Storage: Photo uploads
- FCM: Push notifications (partial — Cloud Function push to background not yet implemented)

### Required Tools
- Android Studio (latest stable)
- JDK 17
- Firebase CLI (for deploying rules): `npm install -g firebase-tools`
- A physical Android device or emulator with Google Play Services (for GPS)

---

## 3. Project Setup (First Time)

1. **Clone the repository**
2. **Open in Android Studio** — File → Open → select the project root
3. **Let Gradle sync** — it will download all dependencies automatically
4. **Firebase config** — the `google-services.json` file should already be at `app/google-services.json`. If missing, download from Firebase Console → Project Settings → Android app → `google-services.json`
5. **Build** — Build → Make Project (or `Ctrl+F9`)
6. **Run** — Select a device/emulator and hit Run (or `Shift+F10`)

### If the build fails:
- Ensure JDK 17 is set: File → Settings → Build → Gradle → Gradle JDK → 17
- Ensure `local.properties` has the correct `sdk.dir` path
- Run `File → Invalidate Caches / Restart` if Hilt or KSP annotations aren't resolving

---

## 4. Architecture Overview

The app follows **MVVM + Repository + Hilt**:

```
┌─────────────────────────────────────────────────────┐
│                    FRAGMENTS (UI)                    │
│  Observe StateFlow, render views, handle user input  │
│  Zero business logic, zero direct Firebase calls     │
└────────────────────────┬────────────────────────────┘
                         │ observes
┌────────────────────────▼────────────────────────────┐
│                   VIEWMODELS                         │
│  Expose StateFlow<UiState<T>>, call repositories     │
│  Business logic + validation lives here              │
│  Coroutines via viewModelScope                       │
└────────────────────────┬────────────────────────────┘
                         │ calls
┌────────────────────────▼────────────────────────────┐
│                  REPOSITORIES                        │
│  ONLY layer that touches Firebase (Firestore/Auth)   │
│  Returns Result<T> for all operations                │
│  Injected via Hilt constructor injection             │
└────────────────────────┬────────────────────────────┘
                         │ reads/writes
┌────────────────────────▼────────────────────────────┐
│              FIREBASE (Remote Backend)               │
│  Firestore (database), Auth (login), Storage (files) │
└─────────────────────────────────────────────────────┘
```

**Golden rules:**
- Fragments never touch Firebase directly
- ViewModels never import `com.google.firebase.*`
- Repositories never update UI
- All injection is constructor-based via Hilt (`@Inject constructor(...)`)
- Every screen state is a `StateFlow<UiState<T>>`

---

## 5. Folder Structure — Full File Map

```
app/src/main/java/com/raghav/whitecoffee/
│
├── WhiteCoffeeApp.kt               — @HiltAndroidApp, Firestore offline config
├── MainActivity.kt                  — @AndroidEntryPoint, single activity host
├── MainViewModel.kt                 — Session invalidation monitor, auto-checkout on logout
│
├── core/
│   ├── UiState.kt                   — Sealed interface: Loading/Success/Empty/Error/Offline
│   └── BaseFragment.kt              — ViewBinding lifecycle (inflate + clear in onDestroyView)
│
├── di/
│   ├── FirebaseModule.kt            — Provides FirebaseAuth, Firestore, Storage singletons
│   └── AppModule.kt                 — Provides FusedLocationClient, WorkManager
│
├── data/
│   ├── PhotoUploadManager.kt        — Compress + upload photos to Firebase Storage
│   │
│   ├── network/
│   │   └── NetworkMonitor.kt        — Flow<Boolean> for connectivity changes
│   │
│   ├── session/
│   │   └── SessionManager.kt        — SharedPreferences cache: userId, role, name, token
│   │
│   ├── location/
│   │   └── LocationProvider.kt      — GPS wrapper with sealed LocationState result
│   │
│   ├── worker/
│   │   └── PhotoUploadWorker.kt     — WorkManager job for background photo upload retry
│   │
│   ├── model/                       — Data classes for every Firestore document type
│   │   ├── User.kt                  — User profile
│   │   ├── AttendanceRecord.kt      — Check-in/out event + deriveAttendanceState()
│   │   ├── AttendanceStatusRecord.kt— Daily computed status (Present/HalfDay/Absent)
│   │   ├── LeaveRequest.kt          — Leave application
│   │   ├── RegularizationRequest.kt — Attendance correction request
│   │   ├── MaterialToolRequest.kt   — M&T request + RequestItem
│   │   ├── MaterialToolPurchase.kt  — M&T purchase + PurchaseItem
│   │   ├── Transfer.kt              — Material/Tool transfer + TransferItem
│   │   ├── WorkProgress.kt          — Daily work log
│   │   ├── AppNotification.kt       — In-app notification
│   │   ├── Site.kt                  — Job site (admin-managed)
│   │   └── SiteTask.kt             — COMMENTED OUT (daily assignments disabled)
│   │
│   └── repository/                  — Firebase data access layer
│       ├── AuthRepository.kt        — Login, logout, session token
│       ├── UserRepository.kt        — User CRUD (admin functions, mostly unused in app)
│       ├── AttendanceRepository.kt  — Check-in/out events + state derivation
│       ├── RequestRepository.kt     — M&T requests, purchases, transfers, work progress
│       ├── LeaveRepository.kt       — Leave requests + admin approve/reject
│       ├── NotificationRepository.kt— Notifications + FCM token
│       ├── RegularizationRepository.kt — Attendance status + regularization requests
│       └── SiteRepository.kt        — Site CRUD (used by web portal only)
│
├── service/
│   └── FcmService.kt               — Firebase Cloud Messaging handler
│
└── ui/
    ├── login/
    │   ├── LoginFragment.kt         — Email/password form
    │   └── LoginViewModel.kt        — Auth + FCM token save
    │
    ├── home/
    │   ├── HomeFragment.kt          — Dashboard with cards, bell icon, role visibility
    │   └── HomeViewModel.kt         — Today's status, greeting, unread count
    │
    ├── attendance/
    │   ├── AttendanceFragment.kt         — Operations: Home/Site/Market check-in/out
    │   ├── AttendanceViewModel.kt        — State machine for operations attendance
    │   ├── OfficeAttendanceFragment.kt   — Office: Home→Office→Home day flow
    │   ├── OfficeAttendanceViewModel.kt  — 5-phase state machine for office attendance
    │   ├── AttendanceTimelineAdapter.kt  — RecyclerView adapter for event timeline
    │   ├── LeaveFragment.kt              — My leave requests list
    │   ├── LeaveViewModel.kt             — Loads leave history
    │   ├── LeaveRequestAdapter.kt        — Leave list item with status badge
    │   ├── ApplyLeaveFragment.kt         — Leave application form
    │   ├── ApplyLeaveViewModel.kt        — Validation + submission
    │   ├── LeaveApprovalsFragment.kt     — Admin: approve/reject leaves
    │   ├── LeaveApprovalsViewModel.kt    — Cross-user pending query
    │   ├── LeaveApprovalAdapter.kt       — Approval list item with action buttons
    │   ├── RegularizationFragment.kt     — Monthly flagged days + reason submission
    │   ├── RegularizationViewModel.kt    — Month navigation + request management
    │   └── RegularizationAdapter.kt      — Flagged day list item
    │
    ├── notifications/
    │   ├── NotificationsFragment.kt      — Notification list + mark all read
    │   ├── NotificationsViewModel.kt     — Load + mark read
    │   └── NotificationAdapter.kt        — Notification list item with unread dot
    │
    └── requests/
        ├── PhotoPickerHelper.kt              — Reusable multi-photo picker + thumbnails
        ├── MaterialToolRequestFragment.kt    — M&T request form
        ├── MaterialToolRequestViewModel.kt   — Request submission with photos
        ├── MaterialToolBuyFragment.kt        — M&T purchase form (with price fields)
        ├── MaterialToolBuyViewModel.kt       — Purchase submission with photos
        ├── MaterialTransferFragment.kt       — Material transfer form
        ├── ToolTransferFragment.kt           — Tool transfer form
        ├── TransferViewModel.kt              — Shared VM for both transfer types
        ├── WorkProgressFragment.kt           — Work progress form
        └── WorkProgressViewModel.kt          — Work progress submission with photos
```

### Resource Files

```
app/src/main/res/
├── layout/
│   ├── activity_main.xml                  — NavHostFragment container
│   ├── fragment_login.xml                 — Login screen
│   ├── fragment_home.xml                  — Dashboard grid
│   ├── fragment_attendance.xml            — Operations attendance
│   ├── fragment_office_attendance.xml     — Office attendance
│   ├── fragment_leave.xml                 — Leave list
│   ├── fragment_apply_leave.xml           — Leave form
│   ├── fragment_leave_approvals.xml       — Admin approvals
│   ├── fragment_regularization.xml        — Regularization
│   ├── fragment_material_tool_request.xml — M&T request form
│   ├── fragment_material_tool_buy.xml     — M&T purchase form
│   ├── fragment_material_transfer.xml     — Material transfer form
│   ├── fragment_tool_transfer.xml         — Tool transfer form
│   ├── fragment_work_progress.xml         — Work progress form
│   ├── fragment_notifications.xml         — Notifications list
│   ├── item_attendance_event.xml          — Timeline row
│   ├── item_leave_request.xml             — Leave list row
│   ├── item_leave_approval.xml            — Approval row with buttons
│   ├── item_notification.xml              — Notification row
│   ├── item_request_row.xml               — Dynamic item row (requests)
│   ├── item_buy_row.xml                   — Dynamic item row (purchases)
│   ├── item_transfer_row.xml              — Dynamic item row (transfers)
│   ├── item_regularization_day.xml        — Flagged day row
│   ├── item_photo_thumbnail.xml           — Photo thumbnail with remove
│   ├── view_gps_banner.xml                — GPS disabled warning
│   └── view_offline_banner.xml            — Network offline warning
│
├── navigation/
│   └── nav_graph.xml                      — All fragment destinations + actions
│
├── values/
│   ├── colors.xml                         — Full color palette
│   ├── strings.xml                        — App name
│   └── themes.xml                         — Material theme + all component styles
│
├── drawable/                              — 35+ XML drawables (badges, backgrounds, icons)
├── font/                                  — DM Sans + Space Grotesk (4 font files + 2 XML families)
├── mipmap-*/                              — App icons (all densities)
└── xml/
    ├── backup_rules.xml                   — Excludes session from cloud backup
    └── data_extraction_rules.xml          — Excludes session from device transfer
```

### Root-Level Files

```
WhiteCoffee01/
├── CLAUDE.md                  — Claude Code context file (what you're reading now exists separately)
├── DEVELOPER_HANDBOOK.md      — THIS FILE
├── firestore.rules            — Firestore security rules (deploy with firebase CLI)
├── storage.rules              — Cloud Storage security rules
├── firebase.json              — Firebase deploy config
├── .firebaserc                — Firebase project binding (white-coffee-92c27)
├── build.gradle.kts           — Project-level build (plugin versions)
├── app/build.gradle.kts       — App-level build (dependencies, SDK versions)
├── settings.gradle.kts        — Module declarations
├── gradle.properties          — Gradle flags
└── app/proguard-rules.pro     — R8 keep rules for release builds
```

---

## 6. Core Framework — The Patterns Everything Uses

### UiState (the universal screen state wrapper)

**File:** `core/UiState.kt`

Every screen in the app wraps its data in this sealed interface:

```kotlin
sealed interface UiState<out T> {
    data class Loading(val message: String = "") : UiState<Nothing>
    data class Success<T>(val data: T) : UiState<T>
    data object Empty : UiState<Nothing>
    data class Error(val message: String) : UiState<Nothing>
    data object Offline : UiState<Nothing>
}
```

**How it's used:**
- ViewModel exposes: `val state: StateFlow<UiState<SomeData>>`
- Fragment observes with `repeatOnLifecycle(STARTED)` and `when(state)` to show the right UI

**Why it matters:**
- Every possible screen state is explicitly handled
- You can't accidentally show a loading spinner forever or forget error handling
- The `Loading` variant optionally carries a progress message (used during photo uploads)

### BaseFragment (ViewBinding lifecycle)

**File:** `core/BaseFragment.kt`

Every fragment extends `BaseFragment<SomeBinding>` which handles:
- Creating the binding in `onCreateView`
- Clearing the binding in `onDestroyView` (prevents memory leaks)
- Subclasses just implement `inflateBinding()` to specify their layout

```kotlin
class MyFragment : BaseFragment<FragmentMyBinding>() {
    override fun inflateBinding(inflater: LayoutInflater, container: ViewGroup?) =
        FragmentMyBinding.inflate(inflater, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        // Use binding.someView safely here
    }
}
```

### StateFlow Collection Pattern

Every fragment collects ViewModel state the same way:

```kotlin
viewLifecycleOwner.lifecycleScope.launch {
    viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
        viewModel.state.collect { state ->
            when (state) {
                is UiState.Loading -> showLoading()
                is UiState.Success -> showData(state.data)
                is UiState.Empty -> showEmpty()
                is UiState.Error -> showError(state.message)
                is UiState.Offline -> showOffline()
            }
        }
    }
}
```

---

## 7. Dependency Injection (Hilt)

Hilt manages all object creation. You never write `SomeClass()` manually.

### Setup chain:
1. `WhiteCoffeeApp.kt` — annotated `@HiltAndroidApp` (Hilt entry point)
2. `MainActivity.kt` — annotated `@AndroidEntryPoint`
3. Every Fragment — annotated `@AndroidEntryPoint`
4. Every ViewModel — annotated `@HiltViewModel` with `@Inject constructor`
5. Every Repository — annotated with `@Inject constructor`
6. `FcmService.kt` — annotated `@AndroidEntryPoint` (required for services)

### Module: FirebaseModule (`di/FirebaseModule.kt`)

Provides singletons:
- `FirebaseAuth` — `FirebaseAuth.getInstance()`
- `FirebaseFirestore` — `Firebase.firestore`
- `FirebaseStorage` — `Firebase.storage`

### Module: AppModule (`di/AppModule.kt`)

Provides singletons:
- `FusedLocationProviderClient` — Google Play Services location
- `WorkManager` — Background job scheduler

### How to add a new dependency:

1. If it's a Firebase service or Android system service, add a `@Provides` function in the appropriate module
2. If it's your own class, just add `@Inject constructor(...)` — Hilt figures out the rest
3. If it's a singleton, add `@Singleton` annotation

---

## 8. Data Layer — Models

All models are in `data/model/`. Each model represents a Firestore document.

### Key pattern: Every model has a `fromDocument()` function

```kotlin
companion object {
    fun fromDocument(doc: DocumentSnapshot): MyModel? {
        // Parse Firestore fields with safe fallbacks
        // Returns null if required fields are missing
    }
}
```

### AttendanceRecord (`data/model/AttendanceRecord.kt`)

The most important model. Represents a single check-in or check-out event.

**Fields:** id, userId, employeeId, userName, date, type, timestamp, latitude, longitude, siteId, siteName, marketName, locationName

**Event types (constants in companion object):**
- `HOME_IN`, `HOME_OUT` — leaving/returning home
- `SITE_IN`, `SITE_OUT` — arriving/leaving a job site
- `MARKET_IN`, `MARKET_OUT` — visiting a market
- `OFFICE_IN`, `OFFICE_OUT` — office check-in/out

**Critical function — `deriveAttendanceState(events: List<AttendanceRecord>)`:**

This top-level function lives in `AttendanceRecord.kt` and determines what the user is currently doing based on their event sequence. It returns a sealed interface:
- `AttendanceState.NoRecord` — no events today
- `AttendanceState.HomeCheckedIn` — home_in recorded, nothing else
- `AttendanceState.SiteCheckedIn(siteId, siteName)` — at a job site
- `AttendanceState.MarketCheckedIn(marketName)` — at a market
- `AttendanceState.DayComplete` — home_out recorded

This function is shared between `AttendanceRepository` (initial load) and `AttendanceViewModel` (optimistic updates). **Never duplicate this logic.**

### User (`data/model/User.kt`)

Fields: id, name, email (always lowercase+trimmed), role, employeeId, createdAt

### LeaveRequest (`data/model/LeaveRequest.kt`)

Fields: id, userId, userName, employeeId, leaveType, fromDate, toDate, totalDays, reason, status, approvedBy, approverComment, submittedAt, reviewedAt

Leave types: Sick Leave, Casual Leave, Annual Leave, Unpaid Leave (defined as `LeaveType` companion constants)

### Transfer (`data/model/Transfer.kt`)

Shared model for both material transfers and tool transfers (identical schema).

Fields: id, userId, userName, employeeId, fromLocation, toLocation, transferredBy, receivedBy, items (List<TransferItem>), notes, photoUrls, transferDate, submittedAt

### MaterialToolRequest / MaterialToolPurchase

Similar structure: site info + list of items + photos + status + timestamps.
Purchase adds `pricePerUnit`, `totalPrice`, and `grandTotal` fields.

### RegularizationRequest

Fields: id, userId, userName, employeeId, date, originalStatus, reason, status, approvedBy, approverComment, submittedAt, reviewedAt

### AppNotification

Fields: id, title, body, type, isRead, createdAt

---

## 9. Data Layer — Repositories

Every repository is `@Singleton` with `@Inject constructor`. They return `Result<T>` for all operations.

### AuthRepository (`data/repository/AuthRepository.kt`)

**What it does:** Handles login/logout and session management.

**Key methods:**
| Method | Returns | What it does |
|--------|---------|--------------|
| `login(email, password)` | `Result<User>` | Firebase Auth sign-in → fetch user doc → generate session token → cache in SessionManager |
| `logout()` | `Unit` | Clear SessionManager + Firebase sign out |
| `isLoggedIn()` | `Boolean` | Check Firebase Auth + try restore from SharedPreferences cache |

**Important detail:** The session token write to Firestore is NOT awaited. This is intentional — awaiting would cause login to hang when offline. Firestore's local cache handles the write and syncs when online.

### AttendanceRepository (`data/repository/AttendanceRepository.kt`)

**What it does:** Records check-in/out events, queries today's events.

**Key methods:**
| Method | Returns | What it does |
|--------|---------|--------------|
| `getTodayData()` | `Result<Pair<AttendanceState, List<AttendanceRecord>>>` | Single query: gets all today's events + derives current state |
| `recordEvent(type, lat, lng, ...)` | `Result<AttendanceRecord>` | Write event to Firestore, returns the record immediately (non-blocking) |

**Important detail:** `recordEvent()` uses `document.set()` without `.await()`. The document ID is generated locally by Firestore, so it's available immediately. The write syncs to the server in the background. This is what makes check-in feel instant even on slow connections.

### RequestRepository (`data/repository/RequestRepository.kt`)

**What it does:** Manages all submission types (requests, purchases, transfers, work progress).

**Key methods:**
| Method | Returns | What it does |
|--------|---------|--------------|
| `newDocId(collection)` | `String` | Pre-generate a Firestore doc ID (no network call) for photo upload path |
| `submitMaterialToolRequest(request, docId?, photoUrls?)` | `Result<String>` | Submit M&T request |
| `submitMaterialToolPurchase(purchase, docId?, photoUrls?)` | `Result<String>` | Submit M&T purchase |
| `submitMaterialTransfer(transfer, docId?, photoUrls?)` | `Result<String>` | Submit material transfer |
| `submitToolTransfer(transfer, docId?, photoUrls?)` | `Result<String>` | Submit tool transfer |
| `submitWorkProgress(progress, docId?, photoUrls?)` | `Result<String>` | Submit work progress |

### LeaveRepository (`data/repository/LeaveRepository.kt`)

**Key methods:**
| Method | Returns | What it does |
|--------|---------|--------------|
| `submitLeaveRequest(request)` | `Result<String>` | Create leave request |
| `getMyLeaveRequests()` | `Result<List<LeaveRequest>>` | User's own leave history |
| `getPendingLeaveRequests()` | `Result<List<LeaveRequest>>` | Admin: all pending leaves (collectionGroup query) |
| `approveLeave(userId, requestId, approverName)` | `Result<Unit>` | Admin: approve |
| `rejectLeave(userId, requestId, approverName, comment)` | `Result<Unit>` | Admin: reject with reason |

**Important:** `getPendingLeaveRequests()` uses a Firestore **collectionGroup** query to read `leave_requests` across ALL users. This requires a composite index in Firebase Console.

### NotificationRepository (`data/repository/NotificationRepository.kt`)

**Key methods:**
| Method | Returns | What it does |
|--------|---------|--------------|
| `getNotifications()` | `Result<List<AppNotification>>` | Last 50 notifications, newest first |
| `getUnreadCount()` | `Result<Int>` | Count of unread (server-side count query) |
| `markAsRead(id)` | `Result<Unit>` | Mark single notification read |
| `markAllAsRead()` | `Result<Unit>` | Batch mark all read |
| `saveToken(token)` | `Result<Unit>` | Save FCM token to user doc |

### RegularizationRepository (`data/repository/RegularizationRepository.kt`)

**Key methods:**
| Method | Returns | What it does |
|--------|---------|--------------|
| `getMonthAttendanceStatus(yearMonth)` | `Result<List<AttendanceStatusRecord>>` | HalfDay/Absent days for a month |
| `getMyRequests(yearMonth)` | `Result<List<RegularizationRequest>>` | User's regularization requests for month |
| `submitRequest(date, originalStatus, reason)` | `Result<String>` | Submit with duplicate prevention |

---

## 10. Data Layer — Services & Helpers

### SessionManager (`data/session/SessionManager.kt`)

**Purpose:** In-memory cache of the logged-in user's identity, persisted to SharedPreferences.

**Key properties:**
- `userId`, `name`, `email`, `role`, `employeeId`, `sessionToken`
- `isOperations` — true if role == "operations"
- `isOffice` — true if role == "office" OR role == "admin" (admin inherits office capabilities)
- `isAdmin` — true if role == "admin" only

**Important:** `isOffice` returns true for admin users too! Always use `isAdmin` when you need admin-only checks (like Leave Approvals).

**Key methods:**
- `saveSession(user, token)` — Cache all fields to memory + SharedPreferences
- `clearSession()` — Wipe memory + SharedPreferences + Firebase sign out
- `tryRestoreFromCache()` — On app restart, restore from SharedPreferences if Firebase Auth still has a user

### NetworkMonitor (`data/network/NetworkMonitor.kt`)

**Purpose:** Reactive connectivity status.

Exposes `isOnline: Flow<Boolean>` that emits when network state changes. Used by:
- ViewModels: to decide whether to show offline state
- Fragments: to show/hide the offline banner

### LocationProvider (`data/location/LocationProvider.kt`)

**Purpose:** GPS location acquisition with error handling.

Returns a sealed `LocationState`:
- `Success(latitude, longitude)` — GPS fix obtained
- `GpsDisabled` — device GPS is off
- `PermissionDenied` — app doesn't have location permission
- `LowAccuracy` — GPS fix was >50m accuracy (unreliable)
- `Timeout` — no GPS fix within 10 seconds

**How it works:**
1. Check location permission → `PermissionDenied`
2. Check GPS enabled → `GpsDisabled`
3. Request location with 10-second timeout
4. Validate accuracy ≤ 50m → `LowAccuracy`
5. Return `Success(lat, lng)`

### PhotoUploadManager (`data/PhotoUploadManager.kt`)

**Purpose:** Compress images and upload to Firebase Storage.

**Compression pipeline:**
1. Decode image bounds only (no memory allocation for full bitmap)
2. Calculate sample size to fit within 720px max dimension
3. Decode downsampled bitmap
4. Compress to JPEG at 60% quality (~80KB output)

**Upload:**
- Path: `requests/{userId}/{collectionName}/{docId}/{timestamp}.jpg`
- Parallel uploads with 3-concurrent semaphore
- Progress callback: `onProgress(current, total)`
- Supports caching to disk for WorkManager retry

### PhotoUploadWorker (`data/worker/PhotoUploadWorker.kt`)

**Purpose:** WorkManager job that retries failed photo uploads in the background.

Used when the user submits a form but photo upload fails (e.g., poor network). The form submission succeeds (Firestore doc created), and photos are retried later.

---

## 11. UI Layer — Every Screen Explained

### Login Screen

**Files:** `ui/login/LoginFragment.kt` + `LoginViewModel.kt`
**Layout:** `fragment_login.xml`

**What it does:**
1. If already logged in (Firebase Auth has user + SessionManager has cache), skip to Home
2. User enters email + password
3. Button disables on tap (double-tap prevention)
4. On success: saves FCM token, navigates to Home
5. On error: shows error message, re-enables button

**What changes what:**
- Email validation → `LoginViewModel.login()` checks blank/length
- Firebase Auth → `AuthRepository.login()` handles sign-in + user doc fetch
- FCM token → `LoginViewModel.saveFcmToken()` runs silently after login
- Session cache → `AuthRepository` calls `SessionManager.saveSession()`

---

### Home Screen (Dashboard)

**Files:** `ui/home/HomeFragment.kt` + `HomeViewModel.kt`
**Layout:** `fragment_home.xml`

**What it does:**
- Shows greeting ("Good morning, Raghav")
- Shows today's date in a card
- Shows today's attendance status (Not checked in / Checked in at Site XYZ / Day complete)
- Shows a grid of feature cards (role-dependent visibility)
- Bell icon with unread notification count badge
- Logout button
- Offline banner when no internet
- Battery optimization prompt (one-time)

**Card visibility by role:**

| Card | Operations | Office | Admin |
|------|-----------|--------|-------|
| Attendance | Yes | Yes (routes to Office variant) | Yes (Office variant) |
| M&T Request | Yes | No | No |
| M&T Buy | Yes | Yes | Yes |
| Material Transfer | Yes | Yes | Yes |
| Tool Transfer | Yes | Yes | Yes |
| Work Progress | Yes | No | No |
| Leave | Yes | Yes | Yes |
| Leave Approvals | No | No | Yes |
| Regularization | Yes | Yes | Yes |

**Attendance card routing:**
- Operations users → `AttendanceFragment`
- Office/Admin users → `OfficeAttendanceFragment`

**What changes what:**
- `HomeViewModel.greeting` — computed once from current hour
- `HomeViewModel.loadTodayAttendance()` — fetches today's events from `AttendanceRepository`
- `HomeViewModel.getUnreadCount()` — queries `NotificationRepository`
- Card visibility — `HomeFragment.setupRoleVisibility()` reads `SessionManager` role flags
- Today status card — `HomeFragment.observeTodayStatus()` renders `TodayAttendanceStatus` sealed class
- The grid uses `ConstraintLayout` with `Barrier` views so that when a card is `GONE`, the remaining cards still align properly. `expandToFullWidth()` makes a lone card span full width.

---

### Operations Attendance Screen

**Files:** `ui/attendance/AttendanceFragment.kt` + `AttendanceViewModel.kt`
**Layout:** `fragment_attendance.xml`

**What it does:** Multi-location check-in/out for field workers.

**State machine:**
```
NoRecord (no events today)
  └→ HOME_IN → HomeCheckedIn
                  ├→ SITE_IN → SiteCheckedIn
                  │              ├→ MARKET_IN → MarketCheckedIn (auto SITE_OUT first)
                  │              └→ SITE_OUT → HomeCheckedIn
                  ├→ MARKET_IN → MarketCheckedIn
                  │              └→ MARKET_OUT → HomeCheckedIn
                  └→ HOME_OUT → DayComplete
```

**Buttons shown per state:**
- NoRecord → "Home Check In"
- HomeCheckedIn → "Site Check In", "Market Check In", "Home Check Out"
- SiteCheckedIn → "Site Check Out", "Market Check In"
- MarketCheckedIn → "Market Check Out"
- DayComplete → no buttons

**Site check-in flow:**
1. User taps "Site Check In"
2. ViewModel gets GPS location
3. If GPS OK → shows dialog for Site Name + Site ID (free text, no dropdown)
4. User fills in and taps OK → `confirmSiteCheckIn(siteId, siteName)`
5. Event recorded optimistically (appended to local list, state re-derived)

**Market from site flow:**
1. User is at a site, taps "Market Check In"
2. ViewModel gets GPS, then prompts for market name
3. Two events recorded: SITE_OUT first, then MARKET_IN
4. If MARKET_IN fails, SITE_OUT is NOT rolled back (documented limitation)

**What changes what:**
- Each button → calls a ViewModel method (e.g., `homeCheckIn()`, `initiateSiteCheckIn()`)
- ViewModel → calls `LocationProvider.getCurrentLocation()` for GPS
- ViewModel → calls `AttendanceRepository.recordEvent()` to write to Firestore
- After recording → ViewModel appends event to local list and calls `deriveAttendanceState()` to update UI without re-fetching from Firestore (optimistic update)

---

### Office Attendance Screen

**Files:** `ui/attendance/OfficeAttendanceFragment.kt` + `OfficeAttendanceViewModel.kt`
**Layout:** `fragment_office_attendance.xml`

**What it does:** Simplified Home→Office→Home day flow for office/admin users.

**5-phase state machine:**
```
NotStarted (no home_in)
  └→ HOME_IN → DayStarted
                  ├→ OFFICE_IN → InOffice (with locationName)
                  │               └→ OFFICE_OUT → DayStarted (multi-cycle)
                  └→ HOME_OUT → DayEnded
```

**Rules:**
- Home In/Out: **once per day**, GPS only, no location name prompt
- Office In/Out: **multi-cycle** (can check in/out of office multiple times)
- Office check-in requires a "Where are you?" text field (locationName)
- Cannot end day (Home Out) while checked into office — must Office Check Out first
- Home events are **data only** — they do NOT affect attendance status or conveyance calculations

**What changes what:**
- `homeIn()` / `homeOut()` → GPS-only events via `recordSimpleEvent()`
- `checkIn(locationName)` → OFFICE_IN event with locationName field
- `checkOut(locationName)` → OFFICE_OUT event, reuses the same locationName
- `deriveOfficeState()` scans events: last HOME_OUT? → DayEnded. Last HOME_IN? → DayStarted. Last OFFICE_IN vs OFFICE_OUT? → InOffice or DayStarted.

---

### Leave Screen (My Leaves)

**Files:** `ui/attendance/LeaveFragment.kt` + `LeaveViewModel.kt`
**Layout:** `fragment_leave.xml`

**What it does:** Shows the user's leave request history with status badges (pending/approved/rejected). FAB button to apply for new leave.

---

### Apply Leave Screen

**Files:** `ui/attendance/ApplyLeaveFragment.kt` + `ApplyLeaveViewModel.kt`
**Layout:** `fragment_apply_leave.xml`

**What it does:**
- Leave type dropdown (Sick/Casual/Annual/Unpaid)
- From date + To date pickers
- Auto-calculates total days (inclusive)
- Reason text area
- Submit → creates leave request with status "pending"

---

### Leave Approvals Screen (Admin Only)

**Files:** `ui/attendance/LeaveApprovalsFragment.kt` + `LeaveApprovalsViewModel.kt`
**Layout:** `fragment_leave_approvals.xml`

**What it does:** Admin sees all pending leave requests across all users. Can approve or reject (with optional reason).

**How it queries across users:** Uses Firestore `collectionGroup("leave_requests")` which reads the `leave_requests` sub-collection from ALL users simultaneously. This requires a Firestore composite index.

---

### Regularization Screen

**Files:** `ui/attendance/RegularizationFragment.kt` + `RegularizationViewModel.kt`
**Layout:** `fragment_regularization.xml`

**What it does:**
- Month navigation (prev/next arrows)
- Shows days flagged as HalfDay or Absent by the nightly Cloud Function
- User can tap "Apply" on a flagged day → enters reason in dialog
- Creates a regularization request (admin approves in web portal)
- If approved, the `attendance_status` doc is updated to "Present"

**What changes what:**
- `RegularizationRepository.getMonthAttendanceStatus(yearMonth)` → reads `attendance_status` sub-collection for HalfDay/Absent
- `RegularizationRepository.getMyRequests(yearMonth)` → reads existing requests
- ViewModel merges both lists into `RegularizationDayItem` objects
- Submit → `RegularizationRepository.submitRequest()` with duplicate prevention

---

### M&T Request Screen

**Files:** `ui/requests/MaterialToolRequestFragment.kt` + `MaterialToolRequestViewModel.kt`
**Layout:** `fragment_material_tool_request.xml`

**What it does:**
- Site Name + Site ID (free text fields)
- Dynamic item rows: tap "Add Item" to add more rows (Item Name, Quantity, Unit, Notes)
- Photo picker (up to 10 photos)
- Notes text area
- Submit validates all fields → uploads photos → creates Firestore doc

**Photo upload flow:**
1. User selects photos → `PhotoPickerHelper` shows thumbnails
2. Photos cached locally immediately
3. If online, parallel upload starts in background
4. On submit: await pending upload (or start new one), get URLs
5. Create Firestore doc with `photoUrls` list

---

### M&T Buy Screen

**Files:** `ui/requests/MaterialToolBuyFragment.kt` + `MaterialToolBuyViewModel.kt`
**Layout:** `fragment_material_tool_buy.xml`

Same as M&T Request but adds: price per unit, total price per item, grand total (auto-calculated).

---

### Material Transfer / Tool Transfer Screens

**Files:** `ui/requests/MaterialTransferFragment.kt` + `ToolTransferFragment.kt` + `TransferViewModel.kt`
**Layouts:** `fragment_material_transfer.xml` + `fragment_tool_transfer.xml`

Both use the same `TransferViewModel`. Fields: from location, to location, transferred by, received by, items list, notes, photos.

Material Transfer includes photos; Tool Transfer does not.

---

### Work Progress Screen

**Files:** `ui/requests/WorkProgressFragment.kt` + `WorkProgressViewModel.kt`
**Layout:** `fragment_work_progress.xml`

Fields: Site Name, Site ID, Date, Hours Worked (decimal), Work Description, Photos.

---

### Notifications Screen

**Files:** `ui/notifications/NotificationsFragment.kt` + `NotificationsViewModel.kt`
**Layout:** `fragment_notifications.xml`

Shows last 50 notifications. Unread items highlighted with accent_light background + dot. "Mark All Read" button. Tap a notification to mark it read.

---

## 12. Navigation Graph

**File:** `res/navigation/nav_graph.xml`

Start destination: `loginFragment`

```
loginFragment ──→ homeFragment (clears back stack)

homeFragment ──→ attendanceFragment
             ──→ officeAttendanceFragment
             ──→ materialToolRequestFragment
             ──→ materialToolBuyFragment
             ──→ materialTransferFragment
             ──→ toolTransferFragment
             ──→ workProgressFragment
             ──→ leaveFragment
             ──→ leaveApprovalsFragment
             ──→ notificationsFragment
             ──→ regularizationFragment
             ──→ loginFragment (logout, clears back stack)

leaveFragment ──→ applyLeaveFragment
```

All other screens are leaf screens (back button returns to Home).

### How to add a new screen:

1. Create `FragmentXyz.kt` extending `BaseFragment<FragmentXyzBinding>`
2. Create `XyzViewModel.kt` with `@HiltViewModel`
3. Create `fragment_xyz.xml` layout
4. Add a `<fragment>` entry in `nav_graph.xml`
5. Add an `<action>` from `homeFragment` to the new fragment
6. Add a card in `fragment_home.xml` + click handler in `HomeFragment.kt`

---

## 13. Firebase Backend — Firestore Schema

Firestore is a NoSQL document database. Think of it as: **Collections = tables, Documents = rows, Fields = columns**. But there are no JOINs — all related data must be stored together or queried separately.

### Data Organization

All user-owned data lives in **sub-collections** under each user's document:

```
/users/{userId}                              ← User profile
    /attendance/{eventId}                    ← Check-in/out events
    /attendance_status/{date}               ← Daily status (computed by Cloud Function)
    /leave_requests/{requestId}              ← Leave applications
    /regularization_requests/{requestId}     ← Attendance corrections
    /material_requests/{requestId}           ← M&T requests
    /material_purchases/{purchaseId}         ← M&T purchases
    /material_transfers/{transferId}         ← Material transfers
    /tool_transfers/{transferId}             ← Tool transfers
    /work_progress/{progressId}              ← Work logs
    /notifications/{notifId}                 ← In-app notifications

/sites/{siteId}                              ← Site info (admin-managed, top-level)
/sent_notifications/{docId}                  ← Admin notification send log
```

**Why sub-collections?** When a user reads their own data, they automatically get ONLY their data — no filter needed. For admin cross-user queries, Firestore's `collectionGroup()` reads the same-named sub-collection across all users.

### Key Document Schemas

#### User Profile (`/users/{userId}`)
| Field | Type | Description |
|-------|------|-------------|
| userId | String | Firebase Auth UID |
| employeeId | String | HR ID (e.g., "EMP001") |
| name | String | Display name |
| email | String | Always lowercase |
| role | String | "operations", "office", or "admin" |
| salaryRate | Double | ₹/day (set via admin portal) |
| fcmToken | String | Push notification device token |
| activeSessionToken | String | For single-device enforcement |
| createdAt | Timestamp | Account creation date |

#### Attendance Event (`/users/{userId}/attendance/{eventId}`)
| Field | Type | Description |
|-------|------|-------------|
| id | String | Document ID |
| userId, employeeId, userName | String | Denormalized for cross-user queries |
| date | String | "yyyy-MM-dd" |
| type | String | home_in/home_out/site_in/site_out/market_in/market_out/office_in/office_out |
| timestamp | Timestamp | When event occurred |
| latitude, longitude | Double | GPS coordinates |
| siteId, siteName | String? | For site events only |
| marketName | String? | For market events only |
| locationName | String? | For office events (free-text "Where are you?") |

#### Daily Attendance Status (`/users/{userId}/attendance_status/{date}`)
| Field | Type | Description |
|-------|------|-------------|
| date | String | "yyyy-MM-dd" (also document ID) |
| status | String | Present/HalfDay/Absent/PL/UPL |
| markedBy | String | "auto" (Cloud Function) / "admin" (regularization) / "backfill" |
| userId, userName, employeeId, role | String | Denormalized |

This collection is **auto-computed nightly** by the `computeDailyAttendanceStatus` Cloud Function. The Regularization workflow can change it to "admin" markedBy when an admin approves a correction.

---

## 14. Firebase Security Rules

**Files:** `firestore.rules` + `storage.rules`

### Firestore Rules — Key Principles

1. **Owner can read their own sub-collections** — any logged-in user reads their own data
2. **Owner can CREATE new documents** — but with restrictions on what fields are set
3. **Owner CANNOT change status fields** — status (pending/approved/rejected) can only be changed by admin. This prevents employees from self-approving requests.
4. **Owner can only UPDATE specific fields** — e.g., on their user doc, they can only update `activeSessionToken` and `fcmToken`. They CANNOT change their `role` or `salaryRate`.
5. **Admin can read and write everything** — checked via `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'`

### Storage Rules

- Path: `requests/{userId}/{collectionName}/{docId}/{filename}`
- Owner writes to their own path only
- Files must be images (`image/*`), max 10MB
- Owner + admin can read
- **No deletes** — uploaded evidence is immutable

### Deploying Rules

From the project root (where `firebase.json` lives):

```bash
firebase deploy --only firestore:rules,storage
```

You'll need to be logged in: `firebase login`

---

## 15. Role-Based Access Control

Three roles: `operations`, `office`, `admin`

### Role hierarchy

```
admin ⊃ office ⊃ (base features)
```

- `SessionManager.isOperations` → true only for "operations"
- `SessionManager.isOffice` → true for "office" AND "admin"
- `SessionManager.isAdmin` → true only for "admin"

### Common mistake to avoid

**Never use `isOffice` for admin-only features!** Since `isOffice` is true for admins too, using it for admin-only checks (like Leave Approvals) would incorrectly show the feature to regular office users.

```kotlin
// WRONG — shows Leave Approvals to office users too
if (sessionManager.isOffice) showLeaveApprovals()

// CORRECT — admin only
if (sessionManager.isAdmin) showLeaveApprovals()
```

---

## 16. Attendance Logic — The Core Business Rule

This is the most complex part of the app. There are two completely different attendance flows.

### Operations Flow (`AttendanceFragment` + `AttendanceViewModel`)

For field workers. Every action = one Firestore document with GPS coordinates.

**State machine:**
```
NoRecord → [Home Check In]
  → HomeCheckedIn → [Site Check In] / [Market Check In] / [Home Check Out]
    → SiteCheckedIn → [Site Check Out] / [Market Check In (auto site-out first)]
    → MarketCheckedIn → [Market Check Out]
  → DayComplete (after Home Check Out)
```

**Key behaviors:**
- GPS is captured on EVERY event
- Site check-in prompts for free-text Site Name + Site ID (no geofencing)
- Going to Market from Site auto-records a SITE_OUT first
- Events are optimistically appended — no Firestore re-fetch after recording

### Office Flow (`OfficeAttendanceFragment` + `OfficeAttendanceViewModel`)

For office staff (office + admin roles).

**State machine (5 phases):**
```
NotStarted → [Home In (GPS only)]
  → DayStarted → [Office Check In (+ "Where are you?")] / [Home Out]
    → InOffice → [Office Check Out]
      → DayStarted (can cycle back in)
  → DayEnded (after Home Out)
```

**Key behaviors:**
- Home In / Home Out: once per day, GPS only, NO location name
- Office In / Out: multi-cycle with "Where are you?" free text
- Cannot end day while checked into office — must check out first
- Home events are DATA ONLY — they don't affect the nightly attendance status computation

### Nightly Computation (Cloud Function)

The `computeDailyAttendanceStatus` Cloud Function runs at 23:59 IST and creates/updates `attendance_status` documents for every user:

- **Operations:** home_in before 10:00 AND home_out after 18:00 → Present. Otherwise → HalfDay.
- **Office/Admin:** office_in before 10:00 AND office_out after 18:00 → Present. Otherwise → HalfDay.
- **No events + approved leave → PL** (if PL balance > 0) or **UPL**
- **No events + no leave → Absent**
- **Skips docs with `markedBy: "admin"`** — so admin-approved regularizations aren't overwritten

---

## 17. Photo Upload System

Used by: M&T Request, M&T Buy, Material Transfer, Work Progress

### Flow

```
User selects photos
    ↓
PhotoPickerHelper shows thumbnails in UI
    ↓
PhotoUploadManager.cachePhotos() writes JPEG to internal storage
    ↓
If online: PhotoUploadManager.uploadPhotos() starts parallel upload (3 concurrent)
    ↓
User taps Submit
    ↓
ViewModel awaits pending upload / starts new upload
    ↓
Gets list of Firebase Storage URLs
    ↓
Creates Firestore doc with photoUrls field
    ↓
If upload failed: PhotoUploadWorker (WorkManager) retries in background
```

### Storage path format

```
requests/{userId}/{collectionName}/{docId}/{timestamp}.jpg
```

Where collectionName matches the Firestore sub-collection: `material_requests`, `material_purchases`, `material_transfers`, `tool_transfers`, `work_progress`

### How to add photos to a new screen

1. Add `PhotoPickerHelper` in your fragment:
```kotlin
private lateinit var photoPicker: PhotoPickerHelper

override fun onViewCreated(...) {
    photoPicker = PhotoPickerHelper(this, binding.photoContainer, binding.photoScroll) {
        viewModel.onPhotosChanged(it) // Pass URIs to ViewModel
    }
    binding.btnAddPhoto.setOnClickListener { photoPicker.launch() }
}
```

2. In your ViewModel, use `PhotoUploadManager`:
```kotlin
fun onPhotosChanged(uris: List<Uri>) {
    photoUploadManager.cachePhotos(context, uris, collectionName, docId)
    if (isOnline) photoUploadManager.uploadPhotos(...)
}
```

---

## 18. Push Notifications (FCM)

**File:** `service/FcmService.kt`

### Current state:
- **In-app notifications work fully** — admin sends from web portal → Firestore doc created → app reads and displays
- **Push to foregrounded app works** — `FcmService.onMessageReceived()` fires, saves to Firestore, shows system notification
- **Push to backgrounded app NOT implemented** — requires a Cloud Function that triggers on `/sent_notifications/` writes and calls FCM HTTP v1 API

### FCM token lifecycle:
1. On login → `LoginViewModel` gets token from `FirebaseMessaging` and saves to user doc
2. On token refresh → `FcmService.onNewToken()` saves new token to user doc
3. Token stored at: `/users/{userId}/fcmToken`

### How notifications flow:
```
Admin Portal → creates doc in /sent_notifications/ + writes to each user's /notifications/
    ↓
FcmService.onMessageReceived() (if app is foregrounded)
    ↓
Saves AppNotification to /users/{uid}/notifications/
    ↓
Shows system notification (NotificationManager)
```

---

## 19. Session Management & Single-Device Enforcement

### How single-device sessions work:

1. User logs in → `AuthRepository` generates a random UUID as `sessionToken`
2. Token saved to `SessionManager` (memory + SharedPreferences) AND to Firestore `/users/{uid}/activeSessionToken`
3. `MainViewModel.startMonitorIfLoggedIn()` sets up a Firestore snapshot listener on the user doc
4. If `activeSessionToken` in Firestore changes (another device logged in) → `MainViewModel` emits `sessionInvalidated`
5. `MainActivity` receives the event → navigates to login, shows "Session expired" toast

### Auto-checkout on logout:

When a user logs out (or gets session-invalidated), `MainViewModel.logoutWithAutoCheckout()`:
- **Operations role:** Records HOME_OUT (and SITE_OUT/MARKET_OUT if checked in) with current GPS
- **Office/Admin role:** Records OFFICE_OUT and HOME_OUT based on today's event history
- This ensures attendance records are properly closed even if the user forgets to check out

---

## 20. Cloud Functions (Server Side)

Cloud Functions are deployed from the admin web portal project directory. They run on Google's servers.

### `computeDailyAttendanceStatus`
- **Schedule:** Daily at 23:59 IST
- **What it does:** For every user, reads today's attendance events and creates/updates an `attendance_status` document
- **Output:** status = Present / HalfDay / Absent / PL / UPL
- **Respects admin overrides:** Skips docs where `markedBy === "admin"`

### `exportToSheets`
- **Schedule:** Daily
- **What it does:** Exports all 7 data collections + Employee Dashboard + Conveyance to a Google Sheet
- **Sheet ID:** `1pemb9uSbu-NenE_QSkfPx6842EG1T6Z21isGM5IXrYs`
- **Strategy:** Clear + full rewrite on every run (no duplicates)

### `regularizationReminder`
- **Schedule:** 25th of each month at 10 AM IST
- **What it does:** Creates in-app notifications for all admin users about pending regularization requests

### Deploying Cloud Functions:

```bash
cd path/to/whitecoffee-admin/
firebase deploy --only functions
```

---

## 21. Admin Web Portal

**Separate project:** `whitecoffee-admin/` (Next.js 14 + TypeScript + Tailwind)

**NOT in this Android repo.** It has its own deployment.

### Pages:
- **Dashboard** — overview stats
- **Users** — create, edit, delete users, set salary rates
- **Sites** — manage job sites
- **Leave Requests** — approve/reject leaves (also available in Android app for admin)
- **Attendance** — view all attendance records
- **Submissions** — view all M&T requests, purchases, transfers, work progress
- **Notifications** — send push notifications to users
- **Regularization** — approve/reject regularization requests

### Deploying:

```bash
cd path/to/whitecoffee-admin/
npm run deploy
```

---

## 22. Google Sheets Export

The `exportToSheets` Cloud Function writes to a Google Sheet daily.

### 9 Tabs:
1. **Employee Dashboard** — MTD per-user summary (days present, half-days, leaves, salary)
2. **Conveyance** — operations-only, road distances via Google Maps Distance Matrix API
3. **Attendance** — all check-in/out events
4. **MT Requests** — one row per line item
5. **MT Purchases** — one row per line item
6. **Material Transfers** — one row per line item
7. **Tool Transfers** — one row per line item
8. **Work Progress** — daily work logs
9. **Leave Requests** — all leave applications

### Service Account:
`attendance-sheets-expor@white-coffee-92c27.iam.gserviceaccount.com`
Key stored as `ATTENDANCE_SHEETS_KEY` in Firebase Secret Manager.

---

## 23. Design System — Colors, Fonts, Themes

### Color Palette (`res/values/colors.xml`)

**Primary brand colors:**
| Name | Hex | Usage |
|------|-----|-------|
| primary_blue | #3B82F6 | Buttons, active states, links |
| midnight | #05091A | Status bar, dark backgrounds |
| deep | #0D1836 | Headers |
| navy | #1A2F72 | Secondary headers |

**Neutral colors:**
| Name | Hex | Usage |
|------|-----|-------|
| surface | #FFFFFF | Card backgrounds |
| background | #F0F4F8 | Screen backgrounds |
| card_border | #E2E8F0 | Card borders |
| text_primary | #0D1B2A | Main text |
| text_secondary | #6B7E94 | Labels, hints |
| hint | #A8BBCC | Placeholder text |

**Status colors:**
| Name | Hex | Usage |
|------|-----|-------|
| status_pending | #D97706 | Pending badges |
| status_approved | #059669 | Approved badges |
| status_rejected | #E11D48 | Rejected badges |

**Module gradient pairs (used on Home screen cards):**
Each card has a unique gradient background — e.g., Attendance is blue (#1E3A8A → #3B82F6), M&T Request is orange (#9A3412 → #F97316).

### Fonts (`res/font/`)

| Font | Usage |
|------|-------|
| Space Grotesk Bold/Semibold | Headings, screen titles |
| DM Sans Regular/Medium | Body text, form labels |

### Theme (`res/values/themes.xml`)

Base theme: `Theme.MaterialComponents.Light.NoActionBar`

Custom component styles prefixed `WC.`:
- `WC.Button.Primary` — blue rounded button
- `WC.Button.Outlined` — stroke-only button
- `WC.Button.Danger` — red stroke button
- `WC.CardView` — 20dp radius card with border
- `WC.TextInputLayout` — outlined text field with 12dp radius
- `WC.Text.ScreenTitle` — 20sp bold white heading
- `WC.Text.Body` — 14sp body text
- `WC.ExtendedFab` — floating action button

---

## 24. How To: Common Changes

### Add a new screen

1. Create layout XML: `res/layout/fragment_xyz.xml`
2. Create Fragment: `ui/xyz/XyzFragment.kt` extending `BaseFragment<FragmentXyzBinding>`
3. Create ViewModel: `ui/xyz/XyzViewModel.kt` with `@HiltViewModel` + `@Inject constructor`
4. Add to nav_graph.xml: `<fragment>` entry + `<action>` from homeFragment
5. Add card to Home: entry in `fragment_home.xml` + click listener in `HomeFragment.kt`
6. Handle role visibility if needed in `HomeFragment.setupRoleVisibility()`

### Add a new Firestore field to an existing model

1. Add the field to the data class in `data/model/`
2. Update the `fromDocument()` / `fromMap()` function to parse it
3. Update the `toMap()` function to include it
4. If displayed in UI, update the relevant Fragment layout + binding code
5. Update Firestore security rules if needed (especially for field-level owner restrictions)

### Add a new submission type (like M&T Request)

1. Create model in `data/model/` with `fromDocument()` + `toMap()`
2. Add sub-collection methods in `RequestRepository` (submit + get)
3. Create Fragment + ViewModel + layout
4. If photos needed: integrate `PhotoPickerHelper` + `PhotoUploadManager`
5. Add card on Home screen with role visibility
6. Update Firestore rules for the new sub-collection
7. Update the Google Sheets Cloud Function to export the new collection

### Change the attendance state machine

The state machine lives in **two places** (both in `AttendanceRecord.kt`):
- `deriveAttendanceState()` — operations state derivation
- `deriveOfficeState()` — in `OfficeAttendanceViewModel.kt`

If you add a new event type:
1. Add constant in `AttendanceRecord.companion` (e.g., `const val WAREHOUSE_IN = "warehouse_in"`)
2. Update `deriveAttendanceState()` to handle the new type
3. Update `AttendanceFragment` to show appropriate buttons for the new state
4. Update `AttendanceTimelineAdapter` to display the new event type with an icon/label
5. Update `HomeViewModel.loadTodayAttendance()` for today's status display
6. Update the nightly `computeDailyAttendanceStatus` Cloud Function
7. Update Firestore security rules if field restrictions change

### Change which roles see which features

In `HomeFragment.setupRoleVisibility()`:
```kotlin
// Example: make Work Progress visible to office users too
binding.cardWorkProgress.isVisible = viewModel.isOperations || viewModel.isOffice
```

### Deploy Firestore/Storage rules after editing

```bash
cd C:\Users\crispyfries\StudioProjects\WhiteCoffee01
firebase deploy --only firestore:rules,storage
```

---

## 25. Build & Release

### Debug build
```bash
./gradlew assembleDebug
```
APK at: `app/build/outputs/apk/debug/app-debug.apk`

### Release build
```bash
./gradlew assembleRelease
```

**R8 is enabled for release** (`isMinifyEnabled = true`, `isShrinkResources = true`). ProGuard rules in `app/proguard-rules.pro` keep:
- All data models (`com.raghav.whitecoffee.data.model.**`)
- Firebase Firestore annotations
- Kotlin coroutines internals

**ALWAYS smoke-test a release build on a real device before distributing.** R8 can strip classes that look unused but are needed by reflection (Firestore uses reflection to deserialize documents).

### Signing

You'll need a keystore for release builds. Configure in `app/build.gradle.kts` under `signingConfigs`.

---

## 26. Test Credentials

| Email | Password | Role |
|-------|----------|------|
| test@whitecoffee.com | test1234 | operations |
| office@whitecoffee.com | test1234 | office |

These accounts exist in Firebase Auth + Firestore for the `white-coffee-92c27` project.

---

## 27. Things That Are Intentionally Disabled

### Daily Site Assignments
- `SiteTask.kt` — model file is fully commented out
- `SiteRepository.getTodayAssignedSites()` — commented out
- Collection: `/daily_assignments/{date}_{userId}` — exists but unused
- **Re-enable:** uncomment both files, add UI to show assigned sites

### Geofencing at Check-In
- `geofenceRadius` field exists on `/sites/{siteId}` documents
- NOT enforced anywhere in the app
- Site check-in uses free-text entry, no proximity check

### Background Push Notifications
- `FcmService` handles foreground pushes
- Background push (app killed/minimized) requires a Cloud Function
- The Cloud Function would trigger on `/sent_notifications/` writes and call FCM HTTP v1 API
- **Marked as Phase 4 remaining**

### My Submissions Screens
- Dropped from scope — users don't view their own submission history in the app
- All submission review happens in the admin web portal

---

## 28. Toolchain Lock — DO NOT CHANGE

These versions are pinned. Changing any of them will likely break the build:

```
AGP:         8.7.3
Gradle:      8.9
Kotlin:      2.0.21
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

If you must upgrade, test EVERYTHING before committing. Hilt + KSP version mismatches are the most common source of build failures.

---

## 29. Troubleshooting

### Build fails with Hilt/KSP errors
- Ensure KSP version matches Kotlin version exactly: Kotlin 2.0.21 → KSP 2.0.21-1.0.28
- File → Invalidate Caches / Restart
- Delete `.gradle/` and `build/` directories, then re-sync

### "Cannot resolve symbol" on Firebase classes
- Check that `google-services.json` exists at `app/google-services.json`
- Check that the Google Services plugin is applied in `app/build.gradle.kts`

### GPS not working on emulator
- Use a physical device — emulators have unreliable GPS
- Or set a mock location in the emulator's extended controls

### Firestore permission denied errors
- Check that the user's role in Firestore matches what the security rules expect
- Run `firebase deploy --only firestore:rules` to ensure rules are current
- Check the Firebase Console → Firestore → Rules tab for the deployed version

### Login hangs or times out
- Check internet connection
- Check Firebase Auth status in Firebase Console
- The session token write is intentionally non-blocking — if login hangs, it's the Auth call itself

### Photos not uploading
- Check Firebase Storage rules are deployed
- Check that the Storage bucket exists in Firebase Console
- Check device storage permissions
- Look for `PhotoUploadWorker` in Android Studio's WorkManager inspector

### CollectionGroup query returns empty
- Ensure the Firestore composite index exists
- Firebase Console → Firestore → Indexes → check for the required index
- Required index: `leave_requests` collection group on `status ASC, submittedAt ASC`

### App shows "Session expired" toast unexpectedly
- Another device logged in with the same account
- This is the single-device enforcement working correctly
- Only one device can be logged in per account at a time

### Release build crashes but debug works
- R8 stripped a class needed by Firestore reflection
- Check `proguard-rules.pro` for missing keep rules
- Add `-keep class com.raghav.whitecoffee.data.model.YourNewModel { *; }` for new models

---

*This document was generated from the WhiteCoffee01 codebase at commit 3fa88be. Keep it updated when you make significant architectural changes.*
