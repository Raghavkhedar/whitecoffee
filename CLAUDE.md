# WhiteCoffee — Claude Code Context File
### For use with Claude Code in Android Studio Terminal
### Last Updated: Session 11 End

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
│   ├── session/SessionManager.kt        ✅ User identity cache
│   ├── location/LocationProvider.kt     ✅ Sealed LocationState
│   ├── model/
│   │   ├── User.kt                      ✅
│   │   ├── AttendanceRecord.kt          ✅ event-based + AttendanceState + AttendanceType + locationName field
│   │   ├── MaterialToolRequest.kt       ✅ + RequestItem
│   │   ├── MaterialToolPurchase.kt      ✅ + PurchaseItem
│   │   ├── Transfer.kt                  ✅ + TransferItem
│   │   ├── WorkProgress.kt              ✅
│   │   ├── Site.kt                      ✅
│   │   └── SiteTask.kt                  ⚠️ COMMENTED OUT — daily assignment feature not in use
│   └── repository/
│       ├── AuthRepository.kt            ✅
│       ├── UserRepository.kt            ✅
│       ├── AttendanceRepository.kt      ✅ recordEvent() accepts locationName param
│       ├── SiteRepository.kt            ✅ getTodayAssignedSites() COMMENTED OUT
│       └── RequestRepository.kt         ✅ sub-collections under users/{uid}/
│
└── ui/
    ├── login/
    │   ├── LoginFragment.kt             ✅ TESTED
    │   └── LoginViewModel.kt            ✅
    ├── home/
    │   ├── HomeFragment.kt              ✅ Role visibility + ConstraintLayout barriers
    │   └── HomeViewModel.kt             ✅ isOperations, isOffice, isAdmin
    ├── attendance/
    │   ├── AttendanceFragment.kt        ✅ GPS flow; site check-in = free-text dialog (no geofence)
    │   ├── AttendanceViewModel.kt       ✅ SiteInputRequired action state; no SiteRepository
    │   ├── AttendanceTimelineAdapter.kt ✅ includes OFFICE_IN/OFFICE_OUT labels + locationName
    │   ├── OfficeAttendanceFragment.kt  ✅ Multi-cycle check-in/out + "Where are you?" + timeline
    │   └── OfficeAttendanceViewModel.kt ✅ NotCheckedIn/CheckedIn; DayComplete REMOVED
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
    │   ├── AdminUserListFragment.kt     ✅ list all users, tap to edit
    │   ├── AdminUserListViewModel.kt    ✅
    │   ├── AdminUserAdapter.kt          ✅ role badge coloured purple/blue/green
    │   ├── AddEditUserFragment.kt       ✅ add (secondary Firebase Auth) / edit user
    │   ├── AddEditUserViewModel.kt      ✅ createUser via secondary app, updateProfile, resetPassword
    │   ├── AdminSiteListFragment.kt     ✅ list all sites, tap to edit
    │   ├── AdminSiteListViewModel.kt    ✅
    │   ├── AdminSiteAdapter.kt          ✅
    │   ├── AddEditSiteFragment.kt       ✅ add/edit site name/lat/lng/geofenceRadius
    │   └── AddEditSiteViewModel.kt      ✅
    └── requests/
        ├── PhotoPickerHelper.kt         ✅ Reusable multi-photo picker
        ├── MaterialToolRequestFragment.kt   ✅ free-text site name + ID fields
        ├── MaterialToolRequestViewModel.kt  ✅ submitRequest(siteId, siteName, ...)
        ├── MaterialToolBuyFragment.kt       ✅ free-text site name + ID fields
        ├── MaterialToolBuyViewModel.kt      ✅ submitPurchase(siteId, siteName, ...)
        ├── MaterialTransferFragment.kt      ✅ + photo support
        ├── ToolTransferFragment.kt          ✅ (no photos)
        ├── TransferViewModel.kt             ✅ + photo upload for material transfer
        ├── WorkProgressFragment.kt          ✅ free-text site name + ID fields
        └── WorkProgressViewModel.kt         ✅ submitProgress(siteId, siteName, ...)
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

/sites/{siteId}                              ← Site info (top-level, shared)
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
Pages: Dashboard, Users, Sites, Leave Requests, Attendance, Submissions
Deploy: `npm run deploy` from the admin portal directory

### ⏳ REMAINING (Phase 4)
- Firestore security rules
- Background geofencing auto-checkout
- Google Sheets export (Cloud Functions)
- Notifications screen

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

---

## HOW TO USE THIS FILE WITH CLAUDE CODE

Start your Claude Code session with:

```
Read CLAUDE.md first. All Phase 3 screens are complete (Session 11 done).
Key changes from Session 11:
- Daily assignment system (SiteTask + getTodayAssignedSites) is COMMENTED OUT in SiteRepository.kt and SiteTask.kt.
- Site entry is now two free-text fields on all screens (no dropdowns, no geofencing).
- Office attendance: multi-cycle check-in/out with "Where are you?" text field + full event timeline.
- Home grid uses ConstraintLayout Barriers (barrier_row1/2/3). Leave Approvals is admin-only.
Phase 4: Firestore security rules, background geofencing, Cloud Functions, notifications.
Firestore index: collection group "leave_requests" → status ASC + submittedAt ASC.
```

---

*File: CLAUDE.md | Place in: C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2\*
