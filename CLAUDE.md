# WhiteCoffee — Claude Code Context File
### For use with Claude Code in Android Studio Terminal
### Last Updated: Session 3 End

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
│       ├── AttendanceRepository.kt      ✅
│       ├── SiteRepository.kt            ✅
│       └── RequestRepository.kt         ✅ + updatePhotoUrls()
│
└── ui/
    ├── login/
    │   ├── LoginFragment.kt             ✅ TESTED
    │   └── LoginViewModel.kt            ✅
    ├── home/
    │   ├── HomeFragment.kt              ✅ TESTED
    │   └── HomeViewModel.kt             ✅
    ├── attendance/
    │   ├── AttendanceFragment.kt        ✅ TESTED
    │   ├── AttendanceViewModel.kt       ✅
    │   └── AttendanceTimelineAdapter.kt ✅
    └── requests/
        ├── PhotoPickerHelper.kt         ✅ Reusable multi-photo picker
        ├── MaterialToolRequestFragment.kt   ✅ + photo support
        ├── MaterialToolRequestViewModel.kt  ✅ + photo upload
        ├── MaterialToolBuyFragment.kt       ✅ + photo support
        ├── MaterialToolBuyViewModel.kt      ✅ + photo upload
        ├── MaterialTransferFragment.kt      ✅ + photo support
        ├── ToolTransferFragment.kt          ✅ (no photos)
        ├── TransferViewModel.kt             ✅ + photo upload for material transfer
        ├── WorkProgressFragment.kt          ← NEXT TO BUILD (Step 21)
        └── WorkProgressViewModel.kt         ← NEXT TO BUILD (Step 21)
```

---

## FIRESTORE COLLECTIONS (6 separate — no shared collection)

| Screen | Collection |
|---|---|
| Attendance | `attendance` |
| M&T Request | `material_tool_requests` |
| M&T Buy | `material_tool_purchases` |
| Material Transfer | `material_transfers` |
| Tool Transfer | `tool_transfers` |
| Work Progress | `work_progress` |

### Firestore indexes created:
- `attendance`: userId ASC + date ASC + timestamp ASC ✅

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

Role checked via `sessionManager.isOperations` / `sessionManager.isOffice`

---

## ATTENDANCE LOGIC (Operations users — event-based)

Every check-in/out = one Firestore doc with GPS coordinates.

### Event types:
- `home_in` → start of day
- `home_out` → end of day  
- `site_in` → arrived at site (validated inside 200m geofence)
- `site_out` → left site
- `market_in` → arrived at market (manual name entry)
- `market_out` → left market

### State machine:
```
NoRecord → HomeCheckedIn → SiteCheckedIn ←→ MarketCheckedIn
                        → MarketCheckedIn
                        → DayComplete (home_out)
```

### Rules:
- GPS captured on EVERY event
- Only ONE location at a time (site OR market)
- Can go Market → come back → check in at site again
- Site check-in = button-triggered geofence validation (Phase 1)
- Site picker dialog when multiple assigned sites

---

## PHOTO UPLOAD SYSTEM

- Firebase Storage (Blaze plan) ✅ enabled
- Compression: max 1080px + JPEG 75% = ~150-250KB per photo
- Storage path: `requests/{userId}/{collection}/{docId}/{timestamp}.jpg`
- `PhotoUploadManager` handles compress + upload
- `PhotoPickerHelper` handles UI picker + thumbnails
- Applies to: M&T Request, M&T Buy, Material Transfer
- `photoUrls: List<String>` field in all relevant Firestore models
- Upload flow: submit doc first → get docId → upload photos → update doc with URLs

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

### ✅ DONE
- Phase 1: Foundation (Hilt, Firebase, core, DI, location, session, network)
- Phase 2: Data layer (7 models, 5 repositories)
- Phase 3 partial:
  - Login ✅ tested
  - Home ✅ tested (role visibility works)
  - Attendance ✅ tested (full GPS flow + timeline)
  - M&T Request ✅ (with photo upload)
  - M&T Buy ✅ (with auto grand total + photo upload)
  - Material Transfer ✅ (with photo upload)
  - Tool Transfer ✅ (no photos)

### ⏳ REMAINING

**Step 21 — Work Progress screen (NEXT)**
Files to create:
- `res/layout/fragment_work_progress.xml`
- `ui/requests/WorkProgressViewModel.kt`
- `ui/requests/WorkProgressFragment.kt`

Fields: siteId, siteName, date, hoursWorked (Double), workDescription, photoUrls, status

**Phase 4 — After all screens done:**
- Firestore security rules
- Background geofencing auto-checkout
- Biometric login
- Admin web portal (Next.js + Firebase)
- Google Sheets export (Cloud Functions)
- Notifications screen

---

## KEY ARCHITECTURE DECISIONS (locked — never change)

1. **Event-based attendance** — one doc per event, GPS always captured
2. **6 separate Firestore collections** — one per feature tab
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

---

## HOW TO USE THIS FILE WITH CLAUDE CODE

Start your Claude Code session with:

```
Read CLAUDE.md first. Then continue building WhiteCoffee from Step 21 — 
Work Progress screen. Create fragment_work_progress.xml, 
WorkProgressViewModel.kt and WorkProgressFragment.kt following 
the exact same MVVM pattern as the other request screens.
The Work Progress screen captures: site selection (from assigned sites),
date (auto-filled today), hours worked, work description, and photos.
```

---

*File: CLAUDE.md | Place in: C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2\*
