# WhiteCoffee — Performance Improvements Log
### Audited: Session 12 | Status: Pending Implementation

---

## THE UPLOAD PROBLEM (Root Cause Analysis)

Current form submission flow (why it feels slow):

```
User taps Submit
  → Firestore write (create doc, get docId)
  → Compress photo 1  ← CPU work on wrong dispatcher
  → Upload photo 1    ← network
  → Compress photo 2
  → Upload photo 2
  → ...
  → Firestore update with photo paths   ← paths, not URLs
Total: 10–20 seconds per submission with 3+ photos
```

Target flow after fixes:

```
User picks photos → compress + upload starts silently in background
User fills form   → uploads finishing in parallel
User taps Submit  → Firestore write → wait for any remaining uploads → done
Total: 1–3 seconds
```

---

## FINDINGS — RANKED BY PRIORITY

---

### HIGH PRIORITY

#### H1 — Wrong dispatcher for image compression
- **File:** `data/PhotoUploadManager.kt:61`
- **Problem:** `withContext(Dispatchers.IO)` used for bitmap resize/compress. Bitmap operations are CPU-bound (pixel math), not disk I/O. Using IO dispatcher competes with network upload threads.
- **Fix:** Change to `withContext(Dispatchers.Default)`
- **Impact:** Faster compression, no thread contention with uploads

#### H2 — Storage path saved instead of download URL
- **File:** `data/PhotoUploadManager.kt:68–69`
- **Problem:** `putBytes().await()` is called but `.getDownloadUrl()` is never called. The function returns the raw Firebase Storage path string (e.g. `requests/uid/collection/docId/timestamp.jpg`), not a full HTTPS URL. Every future photo display requires an extra `getDownloadUrl()` network round-trip.
- **Fix:** After `putBytes().await()`, call `.getDownloadUrl().await().toString()` and return that
- **Impact:** Eliminates hidden per-display network round-trip, photos load faster everywhere

#### H3 — Photos upload AFTER form submit (no pre-upload)
- **File:** All upload ViewModels (`MaterialToolRequestViewModel.kt`, `MaterialToolBuyViewModel.kt`, `TransferViewModel.kt`, `WorkProgressViewModel.kt`)
- **Problem:** Photos are compressed and uploaded only after the user taps Submit, while the user waits. The entire upload duration is dead wait time.
- **Fix:** In `PhotoPickerHelper` callback, immediately start compressing + uploading picked photos in a background coroutine. Store a `Deferred<List<String>>` in the ViewModel. On Submit, `await()` the deferred (usually already done by then).
- **Impact:** Form submission feels nearly instant for the user

#### H4 — Compression quality too high for field use
- **File:** `data/PhotoUploadManager.kt:28–29`
- **Problem:** `MAX_DIMENSION = 1080` and `JPEG_QUALITY = 75` produces ~200KB files. Field photos are viewed on small screens, never printed.
- **Fix:** Change `MAX_DIMENSION` to `720` and `JPEG_QUALITY` to `60`
- **Impact:** ~80KB per photo instead of ~200KB — uploads ~2.5x faster on same network, zero perceptible quality loss on mobile

#### H5 — No upload progress feedback
- **File:** All upload ViewModels
- **Problem:** User sees a blank spinner for 10–20 seconds with no indication of progress. This feels broken.
- **Fix:** Emit `UiState.Loading` with a message string (e.g. `"Uploading photo 2 of 3…"`) and show it in the UI
- **Impact:** Perceived performance improvement — users tolerate waits if they see progress

#### H6 — Firestore re-fetched on every tab return
- **File:** `ui/attendance/LeaveFragment.kt` (onResume → loadLeaves())
- **Problem:** `loadLeaves()` is called in `onResume()`. Every time the user navigates away and back (e.g. switches tabs), a full Firestore read fires. On slow networks this causes visible loading flicker.
- **Fix:** Only load if `_leavesState.value` is `UiState.Empty` or `UiState.Error`. Add a manual pull-to-refresh for forced reload.
- **Impact:** Instant tab switches after first load

#### H7 — Unlimited Firestore disk cache
- **File:** `WhiteCoffeeApp.kt:21`
- **Problem:** `CACHE_SIZE_UNLIMITED` means the Firestore offline cache grows forever. Over months of use this can reach 100MB+ on device storage.
- **Fix:** `setSizeBytes(50L * 1024 * 1024)` (50MB cap)
- **Impact:** Prevents long-term storage bloat

---

### MEDIUM PRIORITY

#### M1 — Attendance state refetches entire day after every event
- **File:** `ui/attendance/AttendanceViewModel.kt` (~line 272)
- **Problem:** After `recordEvent()` succeeds, `loadTodayData()` fires two Firestore queries to rebuild state. The new event was just written — we already know what it contains.
- **Fix:** Optimistically append the new `AttendanceRecord` to the local `_todayEvents` list and derive the new `AttendanceState` in-memory. Skip the Firestore re-fetch entirely.
- **Impact:** Check-in/out buttons respond in ~200ms instead of 1–2 seconds

#### M2 — Concurrency cap missing on parallel uploads
- **File:** `data/PhotoUploadManager.kt:44–47`
- **Problem:** `uris.map { async { uploadSinglePhoto(...) } }.awaitAll()` launches ALL uploads simultaneously. With 8 photos on a 4G connection, 8 concurrent upload streams compete and each gets a fraction of bandwidth — slower than 3 sequential.
- **Fix:** Add `val semaphore = Semaphore(3)` and wrap each `async` block with `semaphore.withPermit { ... }` to cap at 3 concurrent uploads
- **Impact:** Better total throughput on real mobile networks

#### M3 — TextWatcher memory leak in item rows
- **File:** `ui/requests/MaterialToolBuyFragment.kt` (~line 103–114)
- **Problem:** Every call to `addItemRow()` creates a new `TextWatcher` and adds it to the EditText. When the user removes a row, the watcher is never removed — it stays referenced in memory and may fire on subsequent input.
- **Fix:** Store each watcher reference, call `editText.removeTextChangedListener(watcher)` in the row's Remove button click listener
- **Impact:** No memory leak, no ghost text change callbacks

#### M4 — Two Firestore queries for same collection on attendance load
- **File:** `data/repository/AttendanceRepository.kt:30–46`
- **Problem:** `getTodayState()` and `getTodayEvents()` both query `/users/{uid}/attendance` with `whereEqualTo("date", today)`. They run in parallel but hit Firestore twice — double read cost.
- **Fix:** Single query that returns all today's events, then derive both the state list and the current `AttendanceState` from the result in-memory
- **Impact:** Half the Firestore read operations on every attendance screen open

#### M5 — GPS requested at 1-second interval
- **File:** `data/location/LocationProvider.kt:87`
- **Problem:** `LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)` — 1 second interval. `setMaxUpdates(1)` means only one update is needed, but the 1s interval still causes the GPS chip to power up aggressively.
- **Fix:** Change interval to `5000L` — GPS accuracy is identical for check-in purposes, battery impact reduced
- **Impact:** Faster GPS fix on some devices, less battery drain

#### M6 — Glide caches form thumbnails in memory
- **File:** `ui/requests/PhotoPickerHelper.kt:58–61`
- **Problem:** `Glide.with(fragment).load(uri).centerCrop().into(imageView)` — Glide caches these thumbnails in its memory + disk cache. These are temporary UI previews, not reusable assets.
- **Fix:** Add `.diskCacheStrategy(DiskCacheStrategy.NONE).skipMemoryCache(true)` to the Glide call
- **Impact:** Prevents temporary bitmaps accumulating in Glide's memory cache on forms with many photos

#### M7 — `notifyDataSetChanged()` instead of DiffUtil
- **File:** `ui/attendance/LeaveApprovalsFragment.kt:61`
- **Problem:** `adapter.notifyDataSetChanged()` tells RecyclerView to throw away and re-draw every visible row, even if only one item changed. DiffUtil is already wired in `LeaveApprovalAdapter`.
- **Fix:** Replace with `adapter.submitList(newList.toList())`
- **Impact:** Smooth list updates, no full-list flicker on approve/reject

---

### LOW PRIORITY (Polish)

#### L1 — `SimpleDateFormat` created every fragment open
- **File:** `ui/attendance/AttendanceFragment.kt`, `ui/attendance/OfficeAttendanceFragment.kt`
- **Problem:** `SimpleDateFormat("EEEE, d MMMM yyyy", Locale.getDefault()).format(Date())` instantiates a new formatter object on every fragment view creation. `SimpleDateFormat` is also not thread-safe.
- **Fix:** Move to `companion object` as a static val, or use `java.time.LocalDate.now().format(DateTimeFormatter.ofPattern(...))`

#### L2 — Attendance adapter re-assigned on every view creation
- **File:** `ui/attendance/AttendanceFragment.kt:76`
- **Problem:** `timelineAdapter = AttendanceTimelineAdapter()` and `binding.rvTimeline.adapter = timelineAdapter` run every `onViewCreated`. When fragment detaches and reattaches (e.g. back stack), adapter is recreated unnecessarily.
- **Fix:** Create adapter once in `onCreateView`, store as member, only reassign if null

#### L3 — SharedPreferences lazy init may hit on main thread
- **File:** `data/session/SessionManager.kt:15–17`
- **Problem:** `private val prefs by lazy { context.getSharedPreferences(...) }` — first access is a synchronous disk read. If triggered on the main thread during startup it can cause a small jank.
- **Fix:** Change to eager `init { }` block initialization so it runs at injection time (which is off main thread via Hilt)

#### L4 — Greeting string recalculated on every Home open
- **File:** `ui/home/HomeViewModel.kt`
- **Problem:** `getGreeting()` calls `Calendar.getInstance()` on every `HomeFragment` creation.
- **Fix:** Expose as a `val greeting: String` computed once in `init { }`

#### L5 — ConstraintLayout params mutated on every view creation
- **File:** `ui/home/HomeFragment.kt` (`expandToFullWidth()`)
- **Problem:** `expandToFullWidth()` updates `ConstraintLayout.LayoutParams` in `onViewCreated`. On config change (rotation), this runs again on already-correct params.
- **Fix:** Check current `endToEnd` param value before mutating; skip if already set correctly

#### L6 — StateFlow emits without `distinctUntilChanged`
- **File:** Multiple ViewModels
- **Problem:** `MutableStateFlow` can emit the same `UiState.Loading` or `UiState.Empty` value multiple times. Collectors re-run UI logic unnecessarily.
- **Fix:** Add `.distinctUntilChanged()` when exposing public `StateFlow` from ViewModel

---

## IMPLEMENTATION ORDER

```
Week 1 — Upload Speed (H1, H2, H4 first — pure code changes, no redesign)
  ✅ H4: Change MAX_DIMENSION=720, JPEG_QUALITY=60  (2-line change, instant impact)
  ✅ H1: Fix Dispatchers.IO → Dispatchers.Default in PhotoUploadManager
  ✅ H2: Add getDownloadUrl().await() call, return full HTTPS URL
  ✅ H5: Add per-photo progress messages to UiState.Loading

Week 2 — Upload Redesign
  ✅ H3: Pre-upload photos on pick (background Deferred in ViewModel)
  ✅ M2: Add Semaphore(3) concurrency cap

Week 3 — App Snappiness
  ✅ H6: Fix onResume Firestore re-fetch in LeaveFragment
  ✅ M1: Optimistic state update in AttendanceViewModel
  ✅ M4: Merge two attendance queries into one
  ✅ M7: Fix notifyDataSetChanged → submitList

Week 4 — Cleanup
  ✅ H7: Cap Firestore cache at 50MB
  ✅ M3: Fix TextWatcher leak in item rows
  ✅ M5: GPS interval → 5000ms
  ✅ M6: Glide no-cache for thumbnails
  ✅ L1–L6: Polish items
```

---

## STATUS TRACKER

| ID | Description | Status | Session |
|----|-------------|--------|---------|
| H1 | Fix compression dispatcher | ✅ Done | 12 |
| H2 | Return download URL from upload | ✅ Done | 12 |
| H3 | Pre-upload photos on pick | ✅ Done | 12 |
| H4 | Lower quality/dimension settings | ✅ Done | 12 |
| H5 | Upload progress feedback | ✅ Done | 12 |
| H6 | Fix onResume Firestore re-fetch | ✅ Done | 12 |
| H7 | Cap Firestore cache size | ✅ Done | 12 |
| M1 | Optimistic attendance state update | ✅ Done | 13 |
| M2 | Semaphore cap on concurrent uploads | ✅ Done | 12 |
| M3 | Fix TextWatcher leak | ✅ Done | 12 |
| M4 | Merge attendance queries | ✅ Done | 13 |
| M5 | GPS interval 1s → 5s | ✅ Done | 12 |
| M6 | Glide no-cache for thumbnails | ✅ Done | 12 |
| M7 | notifyDataSetChanged → submitList | ✅ Done | 12 |
| L1 | Static SimpleDateFormat | ✅ Done | 13 |
| L2 | Adapter recreation fix | ✅ Done | 13 |
| L3 | Eager SharedPreferences init | ✅ Done | 13 |
| L4 | Greeting computed once | ✅ Done | 13 |
| L5 | ConstraintLayout params guard | ✅ Done | 13 |
| L6 | N/A — StateFlow already provides distinctUntilChanged semantics | ✅ N/A | 13 |
