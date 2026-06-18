# Session 21 — Post-Build Deployment Checklist

## What was built
Attendance Regularization feature — employees see flagged days (HalfDay/Absent), submit a reason, admin approves/rejects in admin portal. Approved requests flip attendance_status to Present (affects salary).

---

## TODO (do these in order)

### ~~1-3. SendGrid~~ — REMOVED (not needed, admin checks portal directly)

### 4. Deploy Firestore security rules
- Open Firebase Console → Firestore → Rules
- Paste the contents of `C:\Users\ragha\AndroidStudioProjects\WhiteCoffee2\firestore.rules`
- Click Publish

### 5. Deploy Cloud Functions
```
cd C:\Users\ragha\AndroidStudioProjects\whitecoffee-admin
firebase deploy --only functions
```

### 6. Deploy Admin Portal
```
cd C:\Users\ragha\AndroidStudioProjects\whitecoffee-admin
npm run deploy
```

### 7. Test the feature
1. Build and run the Android app from Android Studio
2. Login as any user → Home screen should show "Regularization" card at the bottom
3. Tap it → should show month view with any flagged days (if attendance_status has HalfDay/Absent records)
4. If no flagged days exist yet, wait for the nightly Cloud Function to run, or manually create a test `attendance_status` doc in Firestore:
   - Path: `/users/{testUserId}/attendance_status/2026-06-17`
   - Fields: `date: "2026-06-17"`, `userId: "{testUserId}"`, `userName: "Test"`, `employeeId: "EMP001"`, `role: "operations"`, `status: "HalfDay"`, `markedBy: "auto"`, `updatedAt: now`
5. Submit a reason for a flagged day in the app
6. Open admin portal → Regularization tab → approve or reject
7. Verify approved request changed `attendance_status` to `status: "Present"` and `markedBy: "admin"`

---

## Files created/modified in this session

### Android App (new files):
- `app/src/main/java/com/raghav/whitecoffee/data/model/AttendanceStatusRecord.kt`
- `app/src/main/java/com/raghav/whitecoffee/data/model/RegularizationRequest.kt`
- `app/src/main/java/com/raghav/whitecoffee/data/repository/RegularizationRepository.kt`
- `app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationViewModel.kt`
- `app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationAdapter.kt`
- `app/src/main/java/com/raghav/whitecoffee/ui/attendance/RegularizationFragment.kt`
- `app/src/main/res/layout/fragment_regularization.xml`
- `app/src/main/res/layout/item_regularization_day.xml`
- `app/src/main/res/drawable/icon_bg_indigo.xml`

### Android App (modified files):
- `app/src/main/res/navigation/nav_graph.xml` — added regularizationFragment + action
- `app/src/main/res/layout/fragment_home.xml` — added barrier_row4 + card_regularization
- `app/src/main/java/com/raghav/whitecoffee/ui/home/HomeFragment.kt` — added click listener
- `firestore.rules` — added regularization_requests rules

### Admin Portal (new files):
- `src/app/(admin)/regularization/page.tsx`

### Admin Portal (modified files):
- `src/types/index.ts` — added RegularizationRequest interface
- `src/lib/firestore.ts` — added regularization query/approve/reject functions
- `src/components/Sidebar.tsx` — added Regularization nav entry

### Cloud Functions (modified files):
- `functions/index.js` — updated computeDailyAttendanceStatus + added regularizationReminder
- `functions/package.json` — added @sendgrid/mail dependency
