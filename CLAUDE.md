# WhiteCoffee — Claude Code Context File
### For use with Claude Code in Android Studio Terminal
### Last Updated: Session 22 End

---

## WHAT YOU ARE BUILDING
A **Field Operations Management Android App** called **White Coffee** for **Senken Engineering**.
- Platform: Android (Kotlin, XML Views, NOT Compose)
- Package: `com.raghav.whitecoffee`
- Project folder: `C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2`
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

## CURRENT PACKAGE STRUCTURE

```
com.raghav.whitecoffee
├── WhiteCoffeeApp.kt                    ✅ @HiltAndroidApp + Firestore offline
├── MainActivity.kt                      ✅ @AndroidEntryPoint
│
├── core/
│   ├── UiState.kt                       ✅
│   └── BaseFragment.kt                  ✅ ViewBinding lifecycle contract
│
├── di/
│   ├── FirebaseModule.kt                ✅ Auth + Firestore + Storage singletons
│   └── AppModule.kt                     ✅ FusedLocationClient
│
├── data/
│   ├── PhotoUploadManager.kt            ✅ Compress + upload to Firebase Storage
│   ├── network/NetworkMonitor.kt        ✅ Flow<Boolean>
│   ├── session/SessionManager.kt        ✅ User identity cache (eager SharedPrefs init)
│   ├── location/LocationProvider.kt     ✅ Sealed LocationState
│   ├── model/
│   │   ├── User.kt                      ✅
│   │   ├── AttendanceRecord.kt          ✅ + deriveAttendanceState() top-level function
│   │   ├── AppNotification.kt           ✅ id/title/body/type/isRead/createdAt
│   │   ├── AttendanceStatusRecord.kt    ✅ Model for attendance_status subcollection
│   │   ├── RegularizationRequest.kt     ✅ date/originalStatus/reason/status/approvedBy/approverComment
│   │   ├── MaterialToolRequest.kt       ✅ + RequestItem
│   │   ├── MaterialToolPurchase.kt      ✅ + PurchaseItem
│   │   ├── Transfer.kt                  ✅ + TransferItem
│   │   ├── WorkProgress.kt              ✅
│   │   ├── Site.kt                      ✅
│   │   └── SiteTask.kt                  ⚠️ COMMENTED OUT — daily assignment feature not in use
│   └── repository/
│       ├── AuthRepository.kt            ✅
│       ├── UserRepository.kt            ✅
│       ├── AttendanceRepository.kt      ✅ getTodayData() single query; recordEvent() returns Result<AttendanceRecord>
│       ├── NotificationRepository.kt    ✅ getNotifications/getUnreadCount/markAsRead/saveToken/saveNotification
│       ├── SiteRepository.kt            ✅ getTodayAssignedSites() COMMENTED OUT
│       ├── RequestRepository.kt         ✅ sub-collections under users/{uid}/
│       └── RegularizationRepository.kt  ✅ getMonthAttendanceStatus/getMyRequests/submitRequest
│
├── service/
│   └── FcmService.kt                    ✅ @AndroidEntryPoint; onMessageReceived saves to Firestore + shows system notif; onNewToken saves FCM token
│
└── ui/
    ├── login/
    │   ├── LoginFragment.kt             ✅ TESTED
    │   └── LoginViewModel.kt            ✅ saves FCM token after successful login
    ├── home/
    │   ├── HomeFragment.kt              ✅ bell icon + unread badge; lazy badge load
    │   └── HomeViewModel.kt             ✅ greeting val (computed once); getUnreadCount(); NotificationRepository injected
    ├── attendance/
    │   ├── AttendanceFragment.kt        ✅ lazy adapter; static DATE_FORMAT companion
    │   ├── AttendanceViewModel.kt       ✅ optimistic state update after check-in (no re-fetch)
    │   ├── AttendanceTimelineAdapter.kt ✅ includes OFFICE_IN/OFFICE_OUT labels + locationName
    │   ├── OfficeAttendanceFragment.kt  ✅ lazy adapter; static DATE_FORMAT companion
    │   └── OfficeAttendanceViewModel.kt ✅ optimistic state update; getTodayData() single query
    ├── attendance/ (continued)
    │   ├── LeaveFragment.kt             ✅ My Leaves list + FAB to apply
    │   ├── LeaveViewModel.kt            ✅
    │   ├── LeaveRequestAdapter.kt       ✅ status badge: pending/approved/rejected
    │   ├── ApplyLeaveFragment.kt        ✅ leave type + date range + reason
    │   ├── ApplyLeaveViewModel.kt       ✅ auto-calculates total days
    │   ├── LeaveApprovalsFragment.kt    ✅ admin only — approve/reject with dialog
    │   ├── LeaveApprovalsViewModel.kt   ✅ collectionGroup query across all users
    │   ├── LeaveApprovalAdapter.kt      ✅
    │   ├── RegularizationFragment.kt    ✅ month selector + inline apply dialog
    │   ├── RegularizationViewModel.kt   ✅ merged flagged days + requests
    │   └── RegularizationAdapter.kt     ✅
    │   (NOTE: there is NO ui/admin/ package in the Android app. User & Site
    │    management are handled ONLY in the Next.js admin web portal. The
    │    UserRepository.createUser/updateUserProfile/getAllUsers/sendPasswordResetEmail
    │    methods exist but are currently unused — kept for a possible future in-app
    │    admin screen.)
    ├── notifications/
    │   ├── NotificationsFragment.kt     ✅ list + "Mark all read" button
    │   ├── NotificationsViewModel.kt    ✅ optimistic mark-as-read
    │   └── NotificationAdapter.kt       ✅ unread dot + accent_light bg for unread rows
    └── requests/
        ├── PhotoPickerHelper.kt         ✅ Reusable multi-photo picker
        ├── MaterialToolRequestFragment.kt   ✅
        ├── MaterialToolRequestViewModel.kt  ✅
        ├── MaterialToolBuyFragment.kt       ✅
        ├── MaterialToolBuyViewModel.kt      ✅
        ├── MaterialTransferFragment.kt      ✅
        ├── ToolTransferFragment.kt          ✅
        ├── TransferViewModel.kt             ✅
        ├── WorkProgressFragment.kt          ✅
        └── WorkProgressViewModel.kt         ✅
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
| role | String | operations / office / admin |
| status | String | Present / HalfDay / Absent / PL / UPL |
| markedBy | String | auto (Cloud Function) / admin (manual override) / backfill |
| updatedAt | Timestamp | |

> Auto-computed nightly at 23:59 IST by `computeDailyAttendanceStatus` Cloud Function for ALL users.
> Operations: Present if home_in before 10:00 and home_out after 18:00; HalfDay otherwise.
> Office/Admin: Present if office_in before 10:00 and office_out after 18:00; HalfDay otherwise.
> No events + approved leave → PL (if plBalance > 0) or UPL. No events + no leave → Absent.

### `/users/{userId}` — User Profile
| Field | Type | Notes |
|---|---|---|
| userId | String | Firebase Auth UID |
| employeeId | String | HR ID e.g. "EMP001" |
| name | String | Display name |
| email | String | Lowercase |
| role | String | "operations", "office", or "admin" |
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

### `/users/{userId}/material_requests/{requestId}` — M&T Requests
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| siteId | String | Free-text entered by user (e.g. "Site-001") |
| siteName | String | Free-text entered by user |
| items | List\<Map\> | itemName, quantity, unit, notes |
| status | String | pending / approved / rejected |
| notes | String | Overall notes |
| photoUrls | List\<String\> | Firebase Storage URLs |
| submittedAt | Timestamp | |

### `/users/{userId}/material_purchases/{purchaseId}` — M&T Purchases
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| siteId | String | Free-text entered by user |
| siteName | String | Free-text entered by user |
| items | List\<Map\> | itemName, quantity, unit, pricePerUnit, totalPrice, notes |
| grandTotal | Double | Sum of all item totals |
| status | String | pending / approved / rejected |
| notes | String | |
| photoUrls | List\<String\> | |
| submittedAt | Timestamp | |

### `/users/{userId}/material_transfers/{transferId}` — Material Transfers
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| fromLocation | String | Site name, warehouse, etc. |
| toLocation | String | |
| transferredBy | String | Person handing over |
| receivedBy | String | Person receiving |
| items | List\<Map\> | itemName, quantity, unit, condition |
| status | String | pending / approved / rejected |
| notes | String | |
| photoUrls | List\<String\> | |
| transferDate | String | yyyy-MM-dd |
| submittedAt | Timestamp | |

### `/users/{userId}/tool_transfers/{transferId}` — Tool Transfers
Same schema as material_transfers (no photoUrls field).

### `/users/{userId}/work_progress/{progressId}` — Work Progress
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| siteId | String | Free-text entered by user |
| siteName | String | Free-text entered by user |
| date | String | yyyy-MM-dd |
| hoursWorked | Double | e.g. 7.5 |
| workDescription | String | What was accomplished |
| photoUrls | List\<String\> | |
| status | String | pending / approved / rejected |
| submittedAt | Timestamp | |

### `/sites/{siteId}` — Sites
| Field | Type | Notes |
|---|---|---|
| siteId | String | DocumentId |
| name | String | |
| latitude | Double | |
| longitude | Double | |
| geofenceRadius | Double | Meters (e.g. 200.0) — stored but NOT enforced at check-in |

### `/users/{userId}/leave_requests/{requestId}` — Leave Requests
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized — needed for collectionGroup approve/reject path |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| leaveType | String | Sick Leave / Casual Leave / Annual Leave / Unpaid Leave |
| fromDate | String | yyyy-MM-dd |
| toDate | String | yyyy-MM-dd |
| totalDays | Int | Auto-calculated inclusive days |
| reason | String | |
| status | String | pending / approved / rejected |
| approvedBy | String | Manager's name |
| approverComment | String | Rejection reason |
| submittedAt | Timestamp | |
| reviewedAt | Timestamp | |

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
| approverComment | String | Rejection reason |
| submittedAt | Timestamp | |
| reviewedAt | Timestamp | |

> **Firestore index required for Leave Approvals screen:**
> Collection group `leave_requests` → `status` ASC + `submittedAt` ASC
> Create in Firebase Console → Firestore → Indexes → Composite → Add index

### `/users/{userId}/notifications/{notifId}` — In-App Notifications
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| title | String | Notification title |
| body | String | Notification message |
| type | String | general / leave_update / work_reminder / urgent |
| isRead | Boolean | false = unread; user marks read in NotificationsFragment |
| createdAt | Timestamp | When notification was created |

### `/sent_notifications/{docId}` — Notification Send Log (admin history)
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| title | String | |
| body | String | |
| type | String | general / leave_update / work_reminder / urgent |
| recipientType | String | all / operations / office / specific |
| recipientCount | Int | Number of users notified |
| sentByName | String | Admin's display name |
| sentAt | Timestamp | |

> **Note:** This collection will also serve as the trigger for Cloud Functions FCM push in Phase 4.

### Migration note:
Old flat collections (`attendance`, `material_tool_requests`, etc.) were replaced by sub-collections.
Delete old flat collections from Firestore Console — they only contain test data.

---

## COLOR PALETTE (Professional Blue — never deviate)

```
primary_blue:     #1A5FAF  — buttons, headers
background:       #F0F4F8  — screen backgrounds
surface:          #FFFFFF  — cards
input_background: #F7FAFD  — text fields
border:           #C8D6E8  — card borders
text_primary:     #0D1B2A  — main text
text_secondary:   #6B7E94  — labels
text_hint:        #A8BBCC  — placeholders
accent_light:     #EBF2FB  — icon backgrounds
```

---

## ROLE-BASED ACCESS

| Feature | Operations | Office | Admin |
|---|---|---|---|
| Attendance | Full GPS flow (Home→Site→Market) | Multi-cycle check-in/out + location name | Same as Office |
| M&T Request | ✅ Visible | ❌ Hidden | ❌ Hidden |
| M&T Buy | ✅ | ✅ | ✅ |
| Material Transfer | ✅ | ✅ | ✅ |
| Tool Transfer | ✅ | ✅ | ✅ |
| Work Progress | ✅ Visible | ❌ Hidden | ❌ Hidden |
| Leave (apply + my history) | ✅ | ✅ | ✅ |
| Leave Approvals | ❌ Hidden | ❌ Hidden | ✅ Admin only |
| User Management | ❌ | ❌ | ✅ Web portal only (not in Android app) |
| Site Management | ❌ | ❌ | ✅ Web portal only (not in Android app) |

Role checked via `sessionManager.isOperations` / `sessionManager.isOffice` / `sessionManager.isAdmin`

**Note:** `isOffice` returns true for both office AND admin roles (admin ⊃ office capabilities).
Use `isAdmin` for Leave Approvals and admin screens — NOT `isOffice`.

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

### HomeFragment routing:
```kotlin
if (viewModel.isOperations) navigate(attendanceFragment)
else navigate(officeAttendanceFragment)
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

### ✅ DONE (Session 11 complete)
- Phase 1: Foundation (Hilt, Firebase, core, DI, location, session, network)
- Phase 2: Data layer (7 models, 5 repositories)
- Phase 3 ALL SCREENS COMPLETE:
  - Login ✅ tested
  - Home ✅ barrier grid + role visibility fixed (Leave Approvals = admin only)
  - Attendance (Operations) ✅ GPS flow + free-text site dialog (no geofence)
  - Attendance (Office) ✅ multi-cycle + "Where are you?" + timeline
  - M&T Request ✅ (operations only, free-text site, photo upload)
  - M&T Buy ✅ (both roles, free-text site, auto grand total + photos)
  - Material Transfer ✅ (both roles, photos)
  - Tool Transfer ✅ (both roles, no photos)
  - Work Progress ✅ (operations only, free-text site, photos)
  - Leave (apply + my history) ✅ (both roles)
  - Leave Approvals ✅ (admin only)
  - User Management ✅ (admin — WEB PORTAL ONLY, no Android screen)
  - Site Management ✅ (admin — WEB PORTAL ONLY, no Android screen)
- 3 roles: operations / office / admin
- SessionManager persists to SharedPreferences (survives process kill)
- nav_graph: 15 destinations wired

### ✅ Session 11 changes:
- **Daily assignment system commented out** — `SiteTask.kt` fully commented, `getTodayAssignedSites()` commented in `SiteRepository.kt`. Re-enable instructions in both files.
- **Geofencing removed** from site check-in — `confirmSiteCheckIn(siteId, siteName)` records event directly with no distance check.
- **Site dropdowns removed** — all screens now use two free-text TextInputEditText fields (Site Name + Site ID).
- **Office attendance rework** — multi-cycle check-in/out, "Where are you?" free-text, full event timeline, no DayComplete/End Day.
- **`locationName` field** added to `AttendanceRecord` + `recordEvent()` + `AttendanceTimelineAdapter`.
- **Home grid layout fixed** — three ConstraintLayout Barriers + `expandToFullWidth()` helper.
- **Leave Approvals visibility fixed** — now uses `isAdmin` (was incorrectly `isOffice`).
- **`HomeViewModel.isAdmin`** added.

### ✅ Admin Web Portal DONE
`C:\Users\ragha\AndroidStudioProjects\whitecoffee-admin\`
Next.js 14 + TypeScript + Tailwind + Firebase Hosting
Pages: Dashboard, Users, Sites, Leave Requests, Attendance, Submissions, Notifications
Deploy: `npm run deploy` from the admin portal directory

### ✅ Session 12 changes — Performance improvements (all items from improvements.md done):
- **M1 — Optimistic attendance updates**: `recordEvent()` returns `Result<AttendanceRecord>` with docId. ViewModel appends record locally + re-derives state via `deriveAttendanceState()` — no Firestore re-fetch after check-in.
- **M4 — Merged dual queries**: `getTodayState()` + `getTodayEvents()` replaced by single `getTodayData(): Result<Pair<AttendanceState, List<AttendanceRecord>>>`.
- **L1 — Static DateFormat**: `SimpleDateFormat` moved to `companion object` in AttendanceFragment + OfficeAttendanceFragment.
- **L2 — Adapter `by lazy`**: `AttendanceTimelineAdapter` instantiated with `by lazy` — survives `onDestroyView` without re-creating.
- **L3 — Eager SharedPreferences init**: `SessionManager.prefs` changed from `by lazy` to eager init (avoids first-access latency).
- **L4 — `val greeting`**: `HomeViewModel.getGreeting()` replaced with `val greeting: String = run { ... }` (computed once at init).
- **L5 — `expandToFullWidth()` guard**: Early return if params already set to `PARENT_ID` to skip redundant layout passes.
- **L6 — N/A**: StateFlow already has `distinctUntilChanged` semantics; no code change needed.
- **`deriveAttendanceState()`**: Extracted as top-level function in `AttendanceRecord.kt` — shared between `AttendanceRepository` and ViewModels.

### ✅ Session 13 changes — Notifications (Phase 4 partial):
- **`AppNotification` model** — `data/model/AppNotification.kt`: id, title, body, type, isRead, createdAt.
- **`NotificationRepository`** — getNotifications, getUnreadCount, markAsRead, markAllAsRead, saveNotification, saveToken.
- **`FcmService`** — `@AndroidEntryPoint FirebaseMessagingService`: saves incoming push to Firestore + shows system notification. `onNewToken` updates `fcmToken` on user doc.
- **FCM token on login** — `LoginViewModel` calls `FirebaseMessaging.getInstance().token.await()` + `notificationRepository.saveToken()` after successful login.
- **Bell icon + badge** — `HomeFragment` header: 🔔 button + red oval badge (count of unread). Navigates to NotificationsFragment.
- **NotificationsFragment + ViewModel + NotificationAdapter** — full notifications list; "Mark all read" button visible when unread > 0; unread items highlighted in `accent_light`.
- **Firestore security rules written** — `firestore.rules` at project root. Deploy via Firebase Console → Firestore → Rules → Publish (paste content).
- **Admin portal Notifications page** — `/notifications` route: send to all/operations/office/specific user; 4 notification types; recent history table. Fixed bug: users + history loaded independently with separate try-catch so history failure never blocks Send button.
- **`/sent_notifications/` collection** — top-level Firestore collection for send history log.
- **`fcmToken` field** — saved to `/users/{uid}` document on login and on FCM token refresh.
- **nav_graph** — `notificationsFragment` destination + `action_homeFragment_to_notificationsFragment` wired.
- **`POST_NOTIFICATIONS` permission** — added to AndroidManifest.xml.

> **User actions required (not done in code):**
> ~~1. Deploy Firestore rules~~ ✅ DONE (deployed in Session 14)
> 2. Redeploy admin portal: `npm run deploy` from `whitecoffee-admin/` directory
> 3. Enable FCM: Firebase Console → Project Settings → Cloud Messaging tab

### ✅ Session 14 changes — Decimal quantities + Firestore collectionGroup rules:
- **Decimal quantity support** — `quantity` field changed from `Int` to `Double` in `RequestItem`, `PurchaseItem`, and `TransferItem` models. Users can now enter fractional amounts (e.g. `2.5 kg`).
- **`fromMap()` updated** — parses quantity as `Number→Double` in all three models (handles both `Long` and `Double` stored in Firestore).
- **`inputType="numberDecimal"`** — changed from `"number"` in `item_request_row.xml`, `item_buy_row.xml`, `item_transfer_row.xml`.
- **Fragment quantity parsing** — `toIntOrNull()` → `toDoubleOrNull()` in `MaterialToolRequestFragment`, `MaterialToolBuyFragment`, `MaterialTransferFragment`, `ToolTransferFragment`.
- **Firestore collectionGroup rules deployed** — added `{path=**}` rules for all 6 sub-collections (attendance, material_requests, material_purchases, material_transfers, tool_transfers, work_progress) so admin portal cross-user reads are not blocked by security rules.

### ✅ Session 15 changes — Google Sheets export (Cloud Functions):
- **`exportToSheets` Cloud Function** — scheduled daily (`every 24 hours`), exports all 7 collections to separate tabs in one Google Sheet.
- **Sheet ID**: `1pemb9uSbu-NenE_QSkfPx6842EG1T6Z21isGM5IXrYs`
- **Service account**: `attendance-sheets-expor@white-coffee-92c27.iam.gserviceaccount.com` — secret stored as `ATTENDANCE_SHEETS_KEY` in Firebase Secret Manager.
- **7 tabs exported**: Attendance, MT Requests, MT Purchases, Material Transfers, Tool Transfers, Work Progress, Leave Requests.
- **Write strategy**: clear + rewrite on every run — each daily export is a complete fresh snapshot (no duplicate rows).
- **Line items flattened**: requests/purchases/transfers write one row per line item for filter/pivot usability.
- **Auto-creates tabs**: `ensureTab()` creates any missing sheet tab before writing.
- **Replaced old function**: `exportAttendanceToSheets` (flat collection, attendance only) deleted; `exportToSheets` deployed in its place.
- Uses `collectionGroup()` for all 7 sub-collections — Admin SDK bypasses Firestore security rules.
- Timestamps rendered in IST (`Asia/Kolkata`).

### ✅ Session 20 changes — Employee Dashboard fix + salary rates in admin portal:
- **`computeDailyAttendanceStatus` fixed** — was only processing office/admin users, now processes ALL users. Operations users use `home_in`/`home_out` events (was `office_in`/`office_out`). Same Present/HalfDay/PL/UPL/Absent time-based logic for all roles.
- **Firestore index bug fixed** — `collectionGroup("leave_requests").where("status", "==", "approved")` required a missing collection group index. Removed `.where()` filter; status now filtered in code to avoid index requirement.
- **`salaryRate` field on user doc** — `Double`, set via admin portal Users page. Cloud Function reads `user.salaryRate` directly from Firestore instead of parsing it from the Google Sheet.
- **Admin portal Users page updated** — new "Salary Rate (₹/day)" input field in add/edit modal + "Salary Rate" column in user table. Saved to Firestore on create and update.
- **`User` type updated** — added `salaryRate?: number` to `src/types/index.ts`.
- **`backfillAttendanceStatus` HTTP function** — one-time function to generate `attendance_status` records for all users for all days in the current month. ✅ Ran + deleted from the project (no longer in source).
- **Employee Dashboard tab** — now auto-populates from `attendance_status` sub-collection data (MTD summary per user: days present, half-days, leaves, salary due, conveyance, total due).
- **Google Sheet tabs** — 9 tabs: Employee Dashboard, Conveyance, Attendance, MT Requests, MT Purchases, Material Transfers, Tool Transfers, Work Progress, Leave Requests.

### ✅ Session 21 changes — Attendance Regularization:
- **Regularization workflow** — employees see HalfDay/Absent days in the app, submit a reason, admin approves/rejects in the admin portal. Approved requests flip `attendance_status` from HalfDay/Absent → Present.
- **`AttendanceStatusRecord.kt`** — new model for reading `attendance_status` subcollection in the Android app (previously only written by Cloud Functions).
- **`RegularizationRequest.kt`** — new model: date, originalStatus, reason, status, approvedBy, approverComment.
- **`RegularizationRepository.kt`** — `getMonthAttendanceStatus()` reads HalfDay/Absent days, `getMyRequests()` reads existing requests, `submitRequest()` creates new request with duplicate prevention.
- **`RegularizationFragment.kt` + `RegularizationViewModel.kt` + `RegularizationAdapter.kt`** — single-screen approach: month selector, list of flagged days, inline dialog for reason submission.
- **Home screen card** — "Regularization" card added in Row 5 (full width, visible to all roles) with `barrier_row4` after Leave cards.
- **Admin portal `/regularization` page** — new tab: status filter buttons, month picker, table with approve/reject. Approval uses `writeBatch` to atomically update both `regularization_requests` and `attendance_status`.
- **`computeDailyAttendanceStatus` Cloud Function updated** — now skips users whose `attendance_status` has `markedBy === "admin"` (prevents overwriting approved regularizations nightly).
- **`regularizationReminder` Cloud Function** — scheduled 25th of each month at 10 AM IST, emails admin via SendGrid about pending requests + creates in-app notification.
- **Firestore rules updated** — `regularization_requests` subcollection rules (employee: read + create, admin: read + update) + collectionGroup rule for admin cross-user access.
- **nav_graph** — `regularizationFragment` destination + action from homeFragment wired.
- **SendGrid removed** — monthly reminder only creates in-app notifications (no email dependency).

> **User actions required:**
> 1. ~~Deploy Firestore rules~~ ✅ DONE (Session 22 — deployed via firebase CLI)
> 2. Deploy Cloud Functions: `firebase deploy --only functions` from `whitecoffee-admin/` directory
> 3. Redeploy admin portal: `npm run deploy` from `whitecoffee-admin/` directory

### ✅ Session 22 changes — Security hardening + Office Home In/Out:

**Security audit & Firestore/Storage rules (DEPLOYED via firebase CLI to `white-coffee-92c27`):**
- **Privilege-escalation fix #1** — `/users/{userId}` update was `isOwner || isAdmin` with NO field restriction → any user could set their own `role: "admin"` or inflate `salaryRate`. Now owner may change ONLY `['activeSessionToken', 'fcmToken']`; everything else is admin-only. Added `changedKeysWithin()` rules helper.
- **Privilege-escalation fix #2** — `material_requests/material_purchases/material_transfers/tool_transfers/work_progress` update allowed owner to flip their own `status` to "approved" (self-approval of expenses). Now owner may change ONLY `['photoUrls']`; status changes are admin-only. (`leave_requests`/`regularization_requests` were already correct.)
- **`storage.rules` CREATED** (none existed in-repo) — `requests/{userId}/**`: owner-only writes (image-only, <10 MB), owner+admin reads, default-deny elsewhere, no client deletes.
- **`firebase.json` + `.firebaserc` CREATED** in the Android repo (project `white-coffee-92c27`) so this repo can deploy its own rules: `firebase deploy --only firestore:rules,storage`. (Needs `JAVA_HOME` set, e.g. Android Studio's `jbr`.)
- **Backup hardening** — `backup_rules.xml` + `data_extraction_rules.xml` now exclude `wc_session.xml` (identity + session token) from cloud backup + device transfer.
- **R8 enabled for release** — `isMinifyEnabled = true` + `isShrinkResources = true` with keep rules in `proguard-rules.pro` for data models / Firestore / coroutines. **Must smoke-test a release build on-device before shipping.**
- **AuthRepository note** — `activeSessionToken` write is deliberately NOT awaited (offline-first; awaiting hangs offline logins). Comment added so it isn't "fixed" wrongly.
- **Doc correction** — there is NO `ui/admin/` package in the Android app. User & Site management are WEB-PORTAL ONLY. `UserRepository.createUser/updateUserProfile/getAllUsers/sendPasswordResetEmail` exist but are currently UNUSED (kept for a possible future in-app admin screen).

**Office Home In/Out feature (BUILD SUCCESSFUL — `:app:compileDebugKotlin`):**
- Office attendance reworked from `NotCheckedIn ↔ CheckedIn` to a 5-phase Home→Office→Home day (see ATTENDANCE LOGIC section). New `home_in`/`home_out` events for office users: ONCE per day, GPS-only, data-only (no conveyance/attendance_status impact).
- `OfficeAttendanceViewModel.kt` — new `OfficeState` (NotStarted/DayStarted/InOffice/DayEnded/Error), `homeIn()`/`homeOut()`, `deriveOfficeState()` gate logic.
- `OfficeAttendanceFragment.kt` — per-phase button dispatch + state rendering.
- `fragment_office_attendance.xml` — added outlined `btn_home_out` (End Day).
- NOT done (optional follow-up): Home screen "today status" card still derives office status from last event only — shows "Not checked in" after home_in/home_out. Cosmetic.

### ⏳ REMAINING (Phase 4)
- **Cloud Functions — FCM push** — send push to backgrounded devices (trigger: new doc in `/sent_notifications/`); deferred
- **Background geofencing auto-checkout** (commented out by design — not in use)
- Notifications screen ✅ DONE (in-app only; push to background requires Cloud Functions)
- Google Sheets export ✅ DONE

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
26. **`attendance_status` for all roles** — `computeDailyAttendanceStatus` runs nightly at 23:59 IST for ALL users. Operations use `home_in`/`home_out`, office/admin use `office_in`/`office_out`. Same time thresholds: in before 10:00 + out after 18:00 = Present, otherwise HalfDay.
27. **Regularization = employee-initiated, admin-approved** — employee submits reason per flagged day, admin approves/rejects in admin portal only (no Android admin screen). Approval atomically updates both `regularization_requests` and `attendance_status` via `writeBatch`.
28. **Admin overrides protected** — `computeDailyAttendanceStatus` skips any user whose `attendance_status` doc has `markedBy === "admin"`. This prevents nightly auto-compute from overwriting approved regularizations.
29. **Duplicate prevention** — `RegularizationRepository.submitRequest()` checks for existing pending/approved request for the same date before creating a new one.
30. **Monthly in-app reminder** — `regularizationReminder` Cloud Function runs on the 25th, creates in-app notification for all admin users about pending regularization requests. No email dependency (SendGrid removed).
31. **Firestore rules = field-level least privilege (Session 22)** — owner-update rules NEVER use a bare `isOwner` allow. Owner may only patch a whitelisted set of fields (`changedKeysWithin([...])`): user doc → `activeSessionToken`/`fcmToken`; request/purchase/transfer/work_progress docs → `photoUrls`. Status/role/salary changes are admin-only. Never widen these without a matching app write.
32. **No in-app admin user/site screens** — User & Site management are WEB-PORTAL ONLY. There is no `ui/admin/` package. `UserRepository` admin methods exist but are unused.
33. **Office home events are data-only** — `home_in`/`home_out` for office users are recorded purely for record-keeping. Conveyance is operations-only; `computeDailyAttendanceStatus` for office keys on office_in/out. Never wire office home events into pay/status logic.

---

## HOW TO USE THIS FILE WITH CLAUDE CODE

Start your Claude Code session with:

```
Read CLAUDE.md first. Session 22 done: Security hardening + Office Home In/Out.
Key state:
- Phase 3 complete: all screens done (Login, Home, Attendance x2, M&T Request/Buy, Transfers x2, Work Progress, Leave x3, Regularization). User/Site mgmt = WEB PORTAL ONLY (no ui/admin in app).
- Session 22 security: Firestore + Storage rules deployed (field-level least privilege — owner can't self-promote to admin or self-approve requests). storage.rules + firebase.json + .firebaserc created in repo. R8 enabled for release (needs on-device smoke test). Backup excludes wc_session.
- Session 22 feature: office attendance now Home→Office→Home (5 phases). home_in/home_out for office = once/day, GPS-only, DATA ONLY (no conveyance/attendance_status impact).
- Session 21: Attendance Regularization — flagged days → reason → admin approves in portal → flips attendance_status to Present.
- Google Sheet: 9 tabs. Conveyance = ops-only, road-distance via Maps Distance Matrix × per-employee ₹/km rate.
- Daily assignment system COMMENTED OUT. No geofencing. Site entry = two free-text fields.
Phase 4 remaining: Cloud Functions FCM push to backgrounded devices.
```

---

*File: CLAUDE.md | Place in: C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2\*
