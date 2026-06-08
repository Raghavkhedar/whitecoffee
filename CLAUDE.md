# WhiteCoffee — Claude Code Context File
### For use with Claude Code in Android Studio Terminal
### Last Updated: Session 13 End

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
│       └── RequestRepository.kt         ✅ sub-collections under users/{uid}/
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
    │   └── LeaveApprovalAdapter.kt      ✅
    ├── admin/
    │   ├── AdminUserListFragment.kt     ✅
    │   ├── AdminUserListViewModel.kt    ✅
    │   ├── AdminUserAdapter.kt          ✅
    │   ├── AddEditUserFragment.kt       ✅
    │   ├── AddEditUserViewModel.kt      ✅
    │   ├── AdminSiteListFragment.kt     ✅
    │   ├── AdminSiteListViewModel.kt    ✅
    │   ├── AdminSiteAdapter.kt          ✅
    │   ├── AddEditSiteFragment.kt       ✅
    │   └── AddEditSiteViewModel.kt      ✅
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
/users/{userId}/material_requests/{id}       ← M&T Requests
/users/{userId}/material_purchases/{id}      ← M&T Purchases
/users/{userId}/material_transfers/{id}      ← Material Transfers
/users/{userId}/tool_transfers/{id}          ← Tool Transfers
/users/{userId}/work_progress/{id}           ← Work Progress
/users/{userId}/notifications/{id}           ← In-app notifications

/sites/{siteId}                              ← Site info (top-level, shared)
/sent_notifications/{id}                     ← Admin send log (history + future Cloud Functions trigger)
/daily_assignments/{date}_{userId}           ← COMMENTED OUT — not in use
```

### `/users/{userId}` — User Profile
| Field | Type | Notes |
|---|---|---|
| userId | String | Firebase Auth UID |
| employeeId | String | HR ID e.g. "EMP001" |
| name | String | Display name |
| email | String | Lowercase |
| role | String | "operations", "office", or "admin" |
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
| User Management | ❌ | ❌ | ✅ |
| Site Management | ❌ | ❌ | ✅ |

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

### Office users — multi-cycle (OfficeAttendanceFragment + OfficeAttendanceViewModel)
Event types: `office_in`, `office_out`

State machine: `NotCheckedIn ↔ CheckedIn` (repeatable — no DayComplete, no End Day button)
- GPS captured on both events
- "Where are you?" free-text field — user enters location name (stored as `locationName` in Firestore)
- Multiple check-in/out cycles per day supported (sales team use case)
- Full event timeline shown below the action button
- State derived from the last event only: last `office_in` → CheckedIn; otherwise NotCheckedIn

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

The `/sites/{siteId}` Firestore collection still exists for admin site management (AddEditSiteFragment).
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
  - User Management ✅ (admin)
  - Site Management ✅ (admin)
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
> 1. Deploy Firestore rules: Firebase Console → Firestore → Rules → paste `firestore.rules` content → Publish
> 2. Redeploy admin portal: `npm run deploy` from `whitecoffee-admin/` directory
> 3. Enable FCM: Firebase Console → Project Settings → Cloud Messaging tab

### ⏳ REMAINING (Phase 4)
- **Cloud Functions** — FCM push to backgrounded devices (trigger: new doc in `/sent_notifications/`); Google Sheets export
- **Background geofencing auto-checkout** (commented out by design — not in use)
- Notifications screen ✅ DONE (in-app only; push to background requires Cloud Functions)

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
17. **Office attendance multi-cycle** — state derived from last event only. `DayComplete` state does not exist for office users. No End Day button.
18. **No geofencing at check-in** — geofenceRadius field exists in `/sites/` documents but is not enforced anywhere in the app currently.
19. **Optimistic attendance updates** — after `recordEvent()` returns `Result<AttendanceRecord>` (with docId), ViewModel appends the record locally and calls `deriveAttendanceState()` in-memory. No Firestore re-fetch. Reduces post-check-in latency from ~1-2s to ~200ms.
20. **`deriveAttendanceState()` top-level function** — lives in `AttendanceRecord.kt` (model package). Shared by `AttendanceRepository` (for initial load) and ViewModels (for optimistic updates). Never duplicate this logic.
21. **Notifications in Firestore sub-collection** — `/users/{uid}/notifications/` stores in-app notifications. FcmService writes here on push receive. Admin portal writes here via `writeBatch` when sending. Bell badge count = `getUnreadCount()` (whereEqualTo isRead false).
22. **`FcmService` is `@AndroidEntryPoint`** — required for Hilt injection into a `FirebaseMessagingService`. Uses its own `CoroutineScope(SupervisorJob() + Dispatchers.IO)` — not ViewModelScope or lifecycleScope.
23. **Push to background = Cloud Functions** — `FcmService.onMessageReceived` only fires when app is foregrounded. Sending push to backgrounded devices requires a Cloud Function that reads `/sent_notifications/` docs and calls FCM HTTP v1 API. Deferred to Phase 4.
24. **FCM token saved two ways** — proactively on login via `FirebaseMessaging.getInstance().token.await()`, and automatically on refresh via `FcmService.onNewToken()`. Both call `notificationRepository.saveToken()`.

---

## HOW TO USE THIS FILE WITH CLAUDE CODE

Start your Claude Code session with:

```
Read CLAUDE.md first. Session 13 done: all Phase 3 screens + performance improvements + notifications.
Key state:
- Phase 3 complete: all screens done (Login, Home, Attendance x2, M&T Request/Buy, Transfers x2, Work Progress, Leave x3, User/Site Mgmt).
- Session 12: attendance optimistic updates, merged queries, SharedPreferences eager init, static DateFormat, adapter by-lazy.
- Session 13: in-app notifications (NotificationsFragment, NotificationRepository, FcmService, FCM token on login, bell badge in Home header), admin portal Notifications page, Firestore security rules written (firestore.rules at project root — deploy manually).
- Daily assignment system COMMENTED OUT (SiteTask.kt + SiteRepository.getTodayAssignedSites).
- No geofencing. Site entry = two free-text fields everywhere.
- Office attendance: multi-cycle, state from last event, no DayComplete.
Phase 4 remaining: Cloud Functions for FCM push to background + Google Sheets export.
User must deploy Firestore rules + redeploy admin portal before notifications work end-to-end.
```

---

*File: CLAUDE.md | Place in: C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2\*
