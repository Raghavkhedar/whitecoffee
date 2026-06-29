# Graph Report - .  (2026-06-29)

## Corpus Check
- 121 files · ~69,610 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 960 nodes · 1737 edges · 46 communities (43 shown, 3 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 161 edges (avg confidence: 0.8)
- Token cost: 168,049 input · 4,000 output

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
- [[_COMMUNITY_Photo Upload Worker|Photo Upload Worker]]
- [[_COMMUNITY_Firebase DI Module|Firebase DI Module]]
- [[_COMMUNITY_App DI Module|App DI Module]]
- [[_COMMUNITY_Transfer Compose Screen|Transfer Compose Screen]]
- [[_COMMUNITY_Work Progress Compose Screen|Work Progress Compose Screen]]
- [[_COMMUNITY_Material Symbols Icons|Material Symbols Icons]]
- [[_COMMUNITY_Application Class|Application Class]]
- [[_COMMUNITY_Design System Concepts|Design System Concepts]]
- [[_COMMUNITY_Regularization Compose Screen|Regularization Compose Screen]]
- [[_COMMUNITY_Shared Map Serialization|Shared Map Serialization]]
- [[_COMMUNITY_Blank Screenshot Artifacts|Blank Screenshot Artifacts]]
- [[_COMMUNITY_Instrumented Test|Instrumented Test]]
- [[_COMMUNITY_Unit Test|Unit Test]]
- [[_COMMUNITY_Sheets Export Cloud Function|Sheets Export Cloud Function]]

## God Nodes (most connected - your core abstractions)
1. `AttendanceRecord` - 32 edges
2. `MsIcon()` - 32 edges
3. `UiState` - 26 edges
4. `LeaveRequest` - 26 edges
5. `AttendanceViewModel` - 22 edges
6. `sg()` - 21 edges
7. `dm()` - 20 edges
8. `TransferViewModel` - 20 edges
9. `MainViewModel` - 19 edges
10. `OfficeAttendanceViewModel` - 18 edges

## Surprising Connections (you probably didn't know these)
- `UiState` --implements--> `MVVM + Repository + Hilt Architecture`  [EXTRACTED]
  app/src/main/java/com/raghav/whitecoffee/core/UiState.kt → DEVELOPER_HANDBOOK.md
- `LocationProvider` --references--> `Operations Attendance State Machine`  [INFERRED]
  app/src/main/java/com/raghav/whitecoffee/data/location/LocationProvider.kt → DEVELOPER_HANDBOOK.md
- `RequestRepository` --implements--> `M&T Request / Buy / Transfer / Work Progress`  [EXTRACTED]
  app/src/main/java/com/raghav/whitecoffee/data/repository/RequestRepository.kt → DEVELOPER_HANDBOOK.md
- `BaseFragment` --implements--> `MVVM + Repository + Hilt Architecture`  [EXTRACTED]
  app/src/main/java/com/raghav/whitecoffee/core/BaseFragment.kt → DEVELOPER_HANDBOOK.md
- `Performance Improvements Log (Session 12 audit)` --references--> `PhotoUploadManager`  [EXTRACTED]
  improvements.md → app/src/main/java/com/raghav/whitecoffee/data/PhotoUploadManager.kt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **MVVM + Repository + Hilt layered stack** — developer_handbook_mvvm_repository_hilt, app_src_main_java_com_raghav_whitecoffee_core_uistate_uistate, app_src_main_java_com_raghav_whitecoffee_core_basefragment_basefragment, app_src_main_java_com_raghav_whitecoffee_data_repository_attendancerepository_attendancerepository [INFERRED 0.85]
- **Regularization end-to-end flow** — developer_handbook_regularization_workflow, app_src_main_java_com_raghav_whitecoffee_data_repository_regularizationrepository_regularizationrepository, app_src_main_java_com_raghav_whitecoffee_data_model_attendancestatusrecord_attendancestatusrecord, developer_handbook_compute_daily_attendance_status, developer_handbook_admin_web_portal [INFERRED 0.85]
- **Photo upload submission pipeline** — developer_handbook_photo_upload_system, app_src_main_java_com_raghav_whitecoffee_data_photouploadmanager_photouploadmanager, developer_handbook_mt_request_feature, app_src_main_java_com_raghav_whitecoffee_data_repository_requestrepository_requestrepository [INFERRED 0.85]

## Communities (46 total, 3 thin omitted)

### Community 0 - "Attendance Record & State Model"
Cohesion: 0.06
Nodes (52): AttendanceRecord, AttendanceState, AttendanceType, DayComplete, deriveAttendanceState(), fromDocument(), HomeCheckedIn, Any (+44 more)

### Community 1 - "Transfer & Work Progress Models"
Cohesion: 0.08
Nodes (25): fromDocument(), fromMap(), Any, DocumentSnapshot, List, Map, String, Transfer (+17 more)

### Community 2 - "Core UiState & Network Monitor"
Cohesion: 0.06
Nodes (30): Empty, Error, Loading, Offline, Success, UiState, Boolean, NetworkMonitor (+22 more)

### Community 3 - "Attendance Status & Leave Repos"
Cohesion: 0.06
Nodes (30): AttendanceStatusRecord, fromDocument(), DocumentSnapshot, fromDocument(), Any, DocumentSnapshot, Map, String (+22 more)

### Community 4 - "Web UI Components (JSX Mockup)"
Cohesion: 0.10
Nodes (40): dm(), glass(), HomeHeader(), InputField(), LeaveCard(), MOD_GLOW, MOD_GRAD, ModuleCard() (+32 more)

### Community 5 - "Attendance & Home Fragments"
Cohesion: 0.06
Nodes (22): AttendanceFragment, Bundle, Double, LayoutInflater, View, ViewGroup, HomeFragment, Bundle (+14 more)

### Community 6 - "Location Provider & MainActivity"
Cohesion: 0.08
Nodes (20): GpsDisabled, Boolean, LocationProvider, LocationState, LowAccuracy, PermissionDenied, Success, Timeout (+12 more)

### Community 7 - "Notifications Model & Repo"
Cohesion: 0.09
Nodes (23): AppNotification, fromDocument(), Any, DocumentSnapshot, Map, String, Int, List (+15 more)

### Community 8 - "User Model & Auth/Login"
Cohesion: 0.08
Nodes (19): fromDocument(), DocumentSnapshot, User, List, Result, String, Unit, UserRepository (+11 more)

### Community 9 - "Leave RecyclerView Adapters"
Cohesion: 0.09
Nodes (23): areContentsTheSame(), areItemsTheSame(), Int, ViewGroup, LeaveApprovalAdapter, VH, areContentsTheSame(), areItemsTheSame() (+15 more)

### Community 10 - "Home Compose Screen"
Cohesion: 0.12
Nodes (28): ActionButton(), AttendanceStatusChip(), HomeHeader(), HomeScreen(), HomeScreenPreview(), Boolean, Color, Int (+20 more)

### Community 11 - "M&T Purchase (Buy)"
Cohesion: 0.09
Nodes (22): fromDocument(), fromMap(), Any, DocumentSnapshot, List, Map, String, MaterialToolPurchase (+14 more)

### Community 12 - "M&T Request"
Cohesion: 0.09
Nodes (22): fromDocument(), fromMap(), Any, DocumentSnapshot, List, Map, String, MaterialToolRequest (+14 more)

### Community 13 - "Regularization UI (XML)"
Cohesion: 0.10
Nodes (20): areContentsTheSame(), areItemsTheSame(), Int, String, ViewGroup, RegularizationAdapter, VH, Bundle (+12 more)

### Community 14 - "Photo Picker & Work Progress"
Cohesion: 0.08
Nodes (20): ActivityResultLauncher, List, Uri, PhotoPickerHelper, Bundle, LayoutInflater, String, View (+12 more)

### Community 15 - "Office Attendance"
Cohesion: 0.12
Nodes (18): Bundle, LayoutInflater, View, ViewGroup, OfficeAttendanceFragment, DayEnded, DayStarted, Error (+10 more)

### Community 16 - "BaseFragment & Apply Leave"
Cohesion: 0.11
Nodes (13): BaseFragment, Bundle, LayoutInflater, View, ViewGroup, ApplyLeaveFragment, Bundle, LayoutInflater (+5 more)

### Community 17 - "Transfer Feature"
Cohesion: 0.17
Nodes (14): TransferItem, Bundle, LayoutInflater, View, ViewGroup, MaterialTransferFragment, Boolean, Deferred (+6 more)

### Community 18 - "Attendance ViewModel"
Cohesion: 0.15
Nodes (14): ActionState, AttendanceViewModel, Error, Idle, Boolean, Double, List, Result (+6 more)

### Community 19 - "Compose Design System (Theme/Components)"
Cohesion: 0.19
Nodes (24): WcColors, WcTile, WcTiles, AddItemButton(), EmptyState(), FieldLabel(), IconTile(), InfoBanner() (+16 more)

### Community 20 - "M&T Compose Screens"
Cohesion: 0.11
Nodes (20): BuyRow, Boolean, List, String, Uri, MaterialToolBuyScreen(), ItemEditorCard(), Boolean (+12 more)

### Community 21 - "Leave Model & Compose Screens"
Cohesion: 0.21
Nodes (20): fromDocument(), DocumentSnapshot, LeaveRequest, LeaveType, ApprovalCard(), DateBox(), FilledActionButton(), Boolean (+12 more)

### Community 22 - "Photo Upload Manager"
Cohesion: 0.16
Nodes (13): Int, List, Result, String, Unit, Uri, PhotoUploadManager, Bitmap (+5 more)

### Community 23 - "Leave Approvals"
Cohesion: 0.12
Nodes (11): Bundle, LayoutInflater, View, ViewGroup, LeaveApprovalsFragment, Boolean, List, StateFlow (+3 more)

### Community 24 - "Site Model & Repo"
Cohesion: 0.21
Nodes (9): fromDocument(), DocumentSnapshot, Site, Double, List, Result, String, Unit (+1 more)

### Community 26 - "Photo Upload Worker"
Cohesion: 0.22
Nodes (7): buildRequest(), List, Result, String, PhotoUploadWorker, CoroutineWorker, OneTimeWorkRequest

### Community 27 - "Firebase DI Module"
Cohesion: 0.25
Nodes (4): FirebaseModule, FirebaseAuth, FirebaseFirestore, FirebaseStorage

### Community 29 - "App DI Module"
Cohesion: 0.33
Nodes (4): AppModule, Context, FusedLocationProviderClient, WorkManager

### Community 30 - "Transfer Compose Screen"
Cohesion: 0.33
Nodes (6): Boolean, List, String, Uri, TransferScreen(), XferRow

### Community 31 - "Work Progress Compose Screen"
Cohesion: 0.38
Nodes (6): Boolean, List, String, Uri, StepButton(), WorkProgressScreen()

### Community 32 - "Material Symbols Icons"
Cohesion: 0.29
Nodes (6): Color, Modifier, String, Ms, MsIcon(), TextUnit

### Community 33 - "Application Class"
Cohesion: 0.33
Nodes (4): WhiteCoffeeApp, Application, Configuration, HiltWorkerFactory

### Community 34 - "Design System Concepts"
Cohesion: 0.33
Nodes (6): Jetpack Compose M3 Teal Design System, ComposeView Fragment Host Pattern, Claude Design Handoff Bundle, Midnight Indigo XML Redesign, White Coffee Print HTML Prototype, White Coffee HTML Design Prototype

### Community 35 - "Regularization Compose Screen"
Cohesion: 0.50
Nodes (4): FlaggedDayCard(), List, String, RegularizationScreen()

### Community 36 - "Shared Map Serialization"
Cohesion: 0.50
Nodes (3): Any, Map, String

### Community 37 - "Blank Screenshot Artifacts"
Cohesion: 0.67
Nodes (4): Empty Dark Screen Canvas (no rendered content), White Coffee Current Screenshot (blank), Device Status Bar (9:41, signal, wifi, battery), White Coffee Material 3 Teal Design Language

## Ambiguous Edges - Review These
- `Empty Dark Screen Canvas (no rendered content)` → `White Coffee Material 3 Teal Design Language`  [AMBIGUOUS]
  .design_import/whitecoffe/project/screenshots/current.png · relation: conceptually_related_to

## Knowledge Gaps
- **25 isolated node(s):** `WC`, `MOD_GRAD`, `MOD_GLOW`, `navHdr`, `STATUS_CFG` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Empty Dark Screen Canvas (no rendered content)` and `White Coffee Material 3 Teal Design Language`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `UiState` connect `Core UiState & Network Monitor` to `Attendance Record & State Model`, `Regularization Compose Screen`, `Notifications Model & Repo`, `User Model & Auth/Login`, `M&T Purchase (Buy)`, `M&T Request`, `Regularization UI (XML)`, `Photo Picker & Work Progress`, `BaseFragment & Apply Leave`, `Transfer Feature`, `Attendance ViewModel`, `Leave Model & Compose Screens`, `Leave Approvals`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `LeaveRequest` connect `Leave Model & Compose Screens` to `Core UiState & Network Monitor`, `Attendance Status & Leave Repos`, `Shared Map Serialization`, `Leave RecyclerView Adapters`, `Leave Approvals`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Why does `AttendanceRecord` connect `Attendance Record & State Model` to `Attendance ViewModel`, `Home Compose Screen`, `Regularization UI (XML)`, `Office Attendance`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `MsIcon()` (e.g. with `AttendanceScaffold()` and `CardActionButton()`) actually correct?**
  _`MsIcon()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WC`, `MOD_GRAD`, `MOD_GLOW` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Attendance Record & State Model` be split into smaller, more focused modules?**
  _Cohesion score 0.061457418788410885 - nodes in this community are weakly interconnected._