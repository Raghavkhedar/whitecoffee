# WhiteCoffee — Claude Code Context File
### For use with Claude Code in Android Studio Terminal
### Last Updated: Session 8 End

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
│   │   ├── AttendanceRecord.kt          ✅ event-based + AttendanceState + AttendanceType
│   │   ├── MaterialToolRequest.kt       ✅ + RequestItem
│   │   ├── MaterialToolPurchase.kt      ✅ + PurchaseItem
│   │   ├── Transfer.kt                  ✅ + TransferItem
│   │   ├── WorkProgress.kt              ✅
│   │   └── Site.kt                      ✅
│   └── repository/
│       ├── AuthRepository.kt            ✅
│       ├── UserRepository.kt            ✅
│       ├── AttendanceRepository.kt      ✅ sub-collection: users/{uid}/attendance
│       ├── SiteRepository.kt            ✅
│       └── RequestRepository.kt         ✅ sub-collections under users/{uid}/
│
└── ui/
    ├── login/
    │   ├── LoginFragment.kt             ✅ TESTED
    │   └── LoginViewModel.kt            ✅
    ├── home/
    │   ├── HomeFragment.kt              ✅ TESTED
    │   └── HomeViewModel.kt             ✅
    ├── attendance/
    │   ├── AttendanceFragment.kt        ✅ TESTED (operations — full GPS flow)
    │   ├── AttendanceViewModel.kt       ✅
    │   ├── AttendanceTimelineAdapter.kt ✅
    │   ├── OfficeAttendanceFragment.kt  ✅ Simple check-in/out for office role
    │   └── OfficeAttendanceViewModel.kt ✅ OfficeState: NotCheckedIn/CheckedIn/DayComplete
    ├── attendance/ (continued)
    │   ├── LeaveFragment.kt             ✅ My Leaves list + FAB to apply
    │   ├── LeaveViewModel.kt            ✅
    │   ├── LeaveRequestAdapter.kt       ✅ status badge: pending/approved/rejected
    │   ├── ApplyLeaveFragment.kt        ✅ leave type + date range + reason
    │   ├── ApplyLeaveViewModel.kt       ✅ auto-calculates total days
    │   ├── LeaveApprovalsFragment.kt    ✅ office only — approve/reject with dialog
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
    │   ├── AddEditSiteFragment.kt       ✅ add/edit site + multi-select user assignment
    │   └── AddEditSiteViewModel.kt      ✅ assignUsersToSite (batch writes)
    └── requests/
        ├── PhotoPickerHelper.kt         ✅ Reusable multi-photo picker
        ├── MaterialToolRequestFragment.kt   ✅ + photo support
        ├── MaterialToolRequestViewModel.kt  ✅ + photo upload
        ├── MaterialToolBuyFragment.kt       ✅ + photo support
        ├── MaterialToolBuyViewModel.kt      ✅ + photo upload
        ├── MaterialTransferFragment.kt      ✅ + photo support
        ├── ToolTransferFragment.kt          ✅ (no photos)
        ├── TransferViewModel.kt             ✅ + photo upload for material transfer
        ├── WorkProgressFragment.kt          ✅ Step 21 DONE
        └── WorkProgressViewModel.kt         ✅ Step 21 DONE
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
```

### `/users/{userId}` — User Profile
| Field | Type | Notes |
|---|---|---|
| userId | String | Firebase Auth UID |
| employeeId | String | HR ID e.g. "EMP001" |
| userName | String | Display name |
| email | String | Lowercase |
| role | String | "operations" or "office" |
| assignedSiteIds | List\<String\> | Site IDs this user works at |
| createdAt | Timestamp | |

### `/users/{userId}/attendance/{eventId}` — Attendance Events
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized (for collectionGroup queries) |
| employeeId | String | Denormalized |
| userName | String | Denormalized |
| date | String | yyyy-MM-dd |
| type | String | home_in / home_out / site_in / site_out / market_in / market_out / **office_in / office_out** |
| timestamp | Timestamp | When event occurred |
| latitude | Double | GPS |
| longitude | Double | GPS |
| siteId | String? | site_in / site_out only |
| siteName | String? | site_in / site_out only |
| marketName | String? | market_in / market_out only |

### `/users/{userId}/material_requests/{requestId}` — M&T Requests
| Field | Type | Notes |
|---|---|---|
| id | String | DocumentId |
| userId | String | Denormalized |
| userName | String | Denormalized |
| employeeId | String | Denormalized |
| siteId | String | Which site needs items |
| siteName | String | |
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
| siteId | String | |
| siteName | String | |
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
| siteId | String | |
| siteName | String | |
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
| geofenceRadius | Int | Meters |
| assignedUserIds | List\<String\> | Users assigned here |

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
Old Firestore index `attendance: userId + date + timestamp` is no longer needed.
New index needed: `users/{uid}/attendance: date ASC + timestamp ASC` (create if queries are slow).

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

| Feature | Office | Operations |
|---|---|---|
| Attendance | Simple GPS check-in/out | Home→Site(geofence)→Market flow |
| M&T Request | ❌ Hidden | ✅ Visible |
| M&T Buy | ✅ | ✅ |
| Material Transfer | ✅ | ✅ |
| Tool Transfer | ✅ | ✅ |
| Work Progress | ❌ Hidden | ✅ Visible |
| Leave (apply + my history) | ✅ | ✅ |
| Leave Approvals | ✅ (approve/reject all staff) | ❌ Hidden |
| User Management | ❌ | ❌ | ✅ Admin only |
| Site Management | ❌ | ❌ | ✅ Admin only |

Role checked via `sessionManager.isOperations` / `sessionManager.isOffice`

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
- Site check-in validates 200m geofence
- Site picker dialog when multiple assigned sites

### Office users — simple check-in/out (OfficeAttendanceFragment + OfficeAttendanceViewModel)
Event types: `office_in`, `office_out`

State machine: `NotCheckedIn → CheckedIn → DayComplete`
- GPS captured on both events
- No geofencing, no site selection, no market
- Button listener set once in `setupActionButton()`, reads `viewModel.state.value` at tap time

### HomeFragment routing:
```kotlin
if (viewModel.isOperations) navigate(attendanceFragment)
else navigate(officeAttendanceFragment)
```

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

## TEST CREDENTIALS

| Email | Password | Role |
|---|---|---|
| test@whitecoffee.com | test1234 | operations |
| office@whitecoffee.com | test1234 | office |

### Test site (Firestore `sites/Site-001`):
- Name: Senken Gurugaon Site
- Lat: 28.4595, Lng: 77.0266
- geofenceRadius: 200

---

## BUILD STATUS

### ✅ DONE (Session 5 complete)
- Phase 1: Foundation (Hilt, Firebase, core, DI, location, session, network)
- Phase 2: Data layer (7 models, 5 repositories)
- Phase 3 ALL SCREENS COMPLETE:
  - Login ✅ tested
  - Home ✅ tested (role routing works for both roles)
  - Attendance (Operations) ✅ full GPS + geofence + timeline
  - Attendance (Office) ✅ simple check-in/out with GPS
  - M&T Request ✅ (operations only, photo upload)
  - M&T Buy ✅ (both roles, auto grand total + photos)
  - Material Transfer ✅ (both roles, photos)
  - Tool Transfer ✅ (both roles, no photos)
  - Work Progress ✅ (operations only, photos)
  - Leave (apply + my history) ✅ (both roles)
  - Leave Approvals ✅ (office + admin)
  - User Management ✅ (admin — add via secondary Firebase App, edit, password reset)
  - Site Management ✅ (admin — add/edit, multi-select user assignment, batch writes)
- 3 roles: operations / office / admin (admin includes all office capabilities via isOffice)
- Firestore schema: sub-collections under `/users/{userId}/`
- nav_graph: 15 destinations wired

### ⏳ REMAINING

**Step 23 — My Submissions screens (NEXT)**
Each form type needs a list/history screen showing the user's past submissions with status badges.
- One RecyclerView screen per type (or a tabbed screen)
- Shows: type, site, date, status badge (pending/approved/rejected), submitted time
- Tapping a row could show detail (Phase 4)
- Reuses data already returned by `getX()` methods in RequestRepository

**Admin Web Portal ✅ DONE** — `C:\Users\ragha\AndroidStudioProjects\whitecoffee-admin\`
Next.js 14 + TypeScript + Tailwind + Firebase Hosting
Pages: Dashboard, Users, Sites, Leave Requests, Attendance, Submissions
Deploy: `npm run deploy` from the admin portal directory
See: `whitecoffee-admin/DEPLOY.md` for full setup instructions

**Phase 4 — After submissions history:**
- Firestore security rules
- Manager/office approval screen (collectionGroup queries across all users)
- Background geofencing auto-checkout
- Biometric login
- Admin web portal (Next.js + Firebase)
- Google Sheets export (Cloud Functions)
- Notifications screen

---

## KEY ARCHITECTURE DECISIONS (locked — never change)

1. **Event-based attendance** — one doc per event, GPS always captured
2. **Sub-collections per user** — `/users/{uid}/{collection}/{docId}` — no userId filter needed on reads
3. **Array of maps for line items** — one read = one Sheets row
4. **SessionManager cache** — never re-query Firestore by email
5. **LocationState** (not LocationResult — name clash with GMS)
6. **Button protection** — disable on tap, re-enable only on error
7. **Email** — always `.lowercase().trim()` before any Firestore op
8. **Firestore listeners** — always removed in `onStop()`/`onDestroyView()`
9. **Transfer model shared** — Material + Tool Transfer identical structure
10. **Photo upload** — submit doc first, get docId, then upload, then update URLs
11. **Image compression** — Android Bitmap API, no extra library
12. **Admin users** — Cloud Function in Phase 4 (atomic Auth + Firestore)
13. **collectionGroup queries** — for admin/office views that need all users' data (Phase 4)

---

## HOW TO USE THIS FILE WITH CLAUDE CODE

Start your Claude Code session with:

```
Read CLAUDE.md first. Then continue building WhiteCoffee from Step 23 —
My Submissions / history screens. Each form type (M&T Request, M&T Buy,
Material Transfer, Tool Transfer, Work Progress) needs a list screen
showing the user's past submissions with status badges (pending/approved/rejected).
Follow the same MVVM pattern. Repository get() methods already exist.
IMPORTANT: Before testing Leave Approvals, create the Firestore composite index:
Collection group "leave_requests" → status ASC + submittedAt ASC.
```

---

*File: CLAUDE.md | Place in: C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2\*
