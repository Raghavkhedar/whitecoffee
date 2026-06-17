# WhiteCoffee — Stress Test & Edge Case Scenarios

> Field Operations Management App — Senken Engineering
> Last Updated: 2026-06-15

---

## Priority Legend
- 🔴 **P1** — Most likely to happen in real field use; test first
- 🟡 **P2** — Possible but less frequent
- 🟢 **P3** — Rare / extreme conditions

---

## 1. Network / Connectivity 🔴

These are the most likely real-world failures for a field ops app where workers operate at construction sites and markets with poor connectivity.

| # | Scenario | How to Test | What Can Break |
|---|---|---|---|
| 1.1 | No internet at check-in | Toggle airplane mode before tapping Check In | Does Firestore offline cache save the event? Does the UI freeze or show an error? |
| 1.2 | Internet drops mid photo upload | Start uploading 3+ photos, toggle airplane mid-upload | Is the doc saved but `photoUrls` left empty? Can the user retry? |
| 1.3 | Flaky 2G / EDGE connection | Android Emulator → AVD Settings → Cellular → EDGE | Upload timeout behavior; spinner never stopping |
| 1.4 | Come back online after offline check-in | Check in while offline, then reconnect | Does the cached Firestore write flush correctly? Does the optimistic UI match the actual Firestore state? |
| 1.5 | App reopened after long offline period | Stay offline for 30+ minutes, reopen app | Does stale cached state show correctly? Does re-fetch trigger on reconnect? |

---

## 2. Attendance — Double-Tap & Race Conditions 🔴

| # | Scenario | How to Test | What Can Break |
|---|---|---|---|
| 2.1 | Rapid double-tap on Check In button | Tap Check In twice as fast as possible | May create two attendance docs for the same event type |
| 2.2 | Check in at 11:59 PM | Set device clock to 11:59 PM, tap Check In | Does the `date` field (`yyyy-MM-dd`) match correctly if the Firestore write lands after midnight? |
| 2.3 | Kill app immediately after tapping Check In | Tap → immediately swipe away from recents | Does the Firestore doc exist? Does the UI recover correctly on reopen? |
| 2.4 | Office user: 10+ cycles in one day | Check in/out 10 times in a row | Does the timeline scroll correctly? Does state still derive from the last event only? |
| 2.5 | Back button during check-in dialog | Open the Site Name dialog, tap Back | Does the partial dialog state clear? Can the user re-open it cleanly? |
| 2.6 | Screen rotation during check-in | Rotate device while GPS is being acquired | Does the spinner stop? Does state survive rotation via ViewModel? |

---

## 3. GPS / Location 🔴

Field workers are often inside buildings, basements, or in areas with poor GPS signal.

| # | Scenario | How to Test | What Can Break |
|---|---|---|---|
| 3.1 | Location permission denied at runtime | Deny location permission when prompted | Does the app show a clear error, or silently save `0,0` coordinates? |
| 3.2 | GPS permanently denied (never ask again) | Deny twice so system blocks the prompt | Is the user directed to Settings, or does the app get stuck? |
| 3.3 | GPS timeout — no signal | Enter a basement or disable GPS in dev options | How long does the spinner run? Is there a timeout with a fallback message? |
| 3.4 | Airplane mode (no GPS) | Check in with airplane mode on | What coordinates get saved — `0,0`? Last known location? Does it crash? |
| 3.5 | Mock location app running | Enable mock locations via developer app | Coordinates will be wrong but the app should not crash — just save what GPS reports |
| 3.6 | Location permission revoked mid-session | Grant permission → check in → go to Settings → revoke → try again | Does the app handle the missing permission gracefully on the second attempt? |

---

## 4. Photo Upload 🟡

| # | Scenario | How to Test | What Can Break |
|---|---|---|---|
| 4.1 | Submit with 0 photos | Leave photo section empty and submit | All photo-enabled forms should allow this; verify no crash or validation block |
| 4.2 | Very large image (20MB RAW) | Select a high-res camera RAW photo | Compression in `PhotoUploadManager` is memory-intensive; may OOM on low-RAM devices |
| 4.3 | Cancel photo picker mid-selection | Open picker, select 2 photos, then press Back | Does the form reset gracefully or show phantom thumbnails? |
| 4.4 | Upload 5 photos on slow connection | Select 5 photos, throttle to EDGE in emulator, submit | Does the upload progress state stay consistent? Do all 5 URLs appear in Firestore? |
| 4.5 | Toggle airplane mid-upload | Start upload with 3 photos, disable wifi halfway | Is the doc saved with partial `photoUrls`? Is the user notified of failure? |
| 4.6 | Camera capture vs gallery pick | Use camera capture (URI) and gallery (content URI) | `PhotoPickerHelper` must handle both URI types; one may compress differently |
| 4.7 | App sent to background during upload | Start upload, switch to another heavy app, return | Does the upload complete silently, fail silently, or show a result on return? |

---

## 5. Form Input — Extremes & Boundary Values 🟡

### Text Fields

| Field | Edge Case to Test |
|---|---|
| Site Name | 500-character string — does the layout break? |
| Site Name | Emoji: `🏗️ Site A` — does Firestore save/load correctly? |
| Site Name | Special characters: `Site <A> & "B"` — no XSS risk (Firestore is safe) but test display |
| Site Name / Notes | Hindi / Arabic / Cyrillic text — Unicode rendering check |
| Location Name (office) | Blank — is it allowed? What gets saved to Firestore? |
| Leave reason | 1000-character reason — does the text field scroll? Does Firestore save it? |

### Numeric Fields

| Field | Edge Case to Test |
|---|---|
| Quantity | `0` — should this be blocked? |
| Quantity | `-1` or `-0.5` — negative values should be blocked |
| Quantity | `999999.99` — very large number; check display in item list |
| Quantity | Blank — submit should be blocked |
| Price Per Unit | `0.001` — fractional paise; does grand total display sensibly? |
| Grand Total (M&T Buy) | 50 items × ₹99,999 — does `grandTotal` Double display without scientific notation? |
| Hours Worked | `0` — should this be valid work progress? |
| Hours Worked | `25` or `48` — more than a day's hours; no validation currently |
| Hours Worked | Blank — submit should be blocked |

### Date Fields (Leave)

| Scenario | Expected Behaviour |
|---|---|
| `toDate` before `fromDate` | Should be blocked; `totalDays` would be 0 or negative |
| Same day leave (`fromDate` = `toDate`) | Should result in `totalDays = 1` |
| Leave spanning year boundary (Dec 30 → Jan 3) | Does `totalDays` calculate correctly across year rollover? |
| Leave for a past date | Currently allowed — confirm if this is intentional |
| Leave for today | Should be allowed |

---

## 6. Session / Auth Edge Cases 🟡

| # | Scenario | What to Watch |
|---|---|---|
| 6.1 | Same account on two devices simultaneously | Check-in on Device A; does Device B's home screen reflect the state? FCM token: Device B's token will overwrite Device A's on next login — push only goes to last device |
| 6.2 | Long offline period (1+ hours) | Firebase Auth token auto-refreshes every hour. With no internet for >1 hour, test if the app recovers on reconnect without forcing re-login |
| 6.3 | Role changed in admin portal while user is logged in | Change `role` field in Firestore while the user is active. `SessionManager` caches the old role in SharedPreferences — user sees stale role until logout. This is by design (Decision #4) but should be documented for admins |
| 6.4 | User deleted from Firebase Auth while logged in | Delete the user in Firebase Console while they have an active session. What happens on the next Firestore write? |
| 6.5 | App force-stopped mid form submission | Fill in a large M&T Request form, force-stop before tapping Submit | No data loss expected (nothing submitted), but verify form state on reopen |

---

## 7. Leave Management Edge Cases 🟡

| # | Scenario | What Can Break |
|---|---|---|
| 7.1 | Submit while another leave request is pending | No duplicate check exists — two pending requests for overlapping dates are possible |
| 7.2 | Admin approves an already-approved request | Re-approving should be a no-op, but check if `reviewedAt` timestamp is overwritten |
| 7.3 | Admin rejects with a very long comment | Does the `approverComment` field display without layout breakage in `LeaveApprovalAdapter`? |
| 7.4 | 50+ leave requests in list | Does `LeaveFragment` RecyclerView scroll smoothly? Any pagination needed? |
| 7.5 | Leave Approvals screen with 100+ pending requests | The `collectionGroup` query with no limit — does it load all docs into memory? |

---

## 8. Low-Resource Device Scenarios 🟡

| # | Scenario | How to Test | Risk |
|---|---|---|---|
| 8.1 | Low RAM during photo upload | Developer Options → Background process limit: 1 → upload photos | `Bitmap` compression in `PhotoUploadManager` allocates large buffers; may OOM |
| 8.2 | Low storage | Fill device storage to <100MB, try photo upload | Compression writes temp files; may fail silently if storage is full |
| 8.3 | App backgrounded and killed during upload | Start upload, open 3 heavy apps, return | Upload will fail silently; user won't know `photoUrls` is empty in the saved doc |
| 8.4 | Very old / slow device | Test on API 26 (Android 8) or a budget phone | RecyclerView scroll jank, slow Hilt injection, Firestore listener delays |

---

## 9. Notifications Edge Cases 🟢

| # | Scenario | What Can Break |
|---|---|---|
| 9.1 | 100+ unread notifications | Does the bell badge display `99+` or just a large number? Badge counts may overflow the oval shape |
| 9.2 | FCM push while app is backgrounded | Send from admin portal; notification should appear in system tray (requires Cloud Functions — Phase 4) |
| 9.3 | Mark all read when 0 unread | Button should be hidden, but test if tapping it programmatically causes a crash |
| 9.4 | Notification with empty title or body | Admin sends blank title/body from portal — does `NotificationAdapter` render an empty row gracefully? |

---

## 10. Data Consistency Checks 🟢

These are harder to test but important for data integrity:

| # | Scenario | How to Verify |
|---|---|---|
| 10.1 | Optimistic UI vs Firestore truth | After check-in, immediately open Firebase Console → verify the doc exists with correct fields |
| 10.2 | `photoUrls` completeness | After photo upload, check Firestore doc — all selected photos should appear as Storage URLs |
| 10.3 | `grandTotal` accuracy (M&T Buy) | Enter 5 items with decimal quantities and prices, verify the displayed grand total matches sum |
| 10.4 | Attendance state after app restart | Check in, kill app, reopen — UI state should match the last event in Firestore (re-derived from `getTodayData()`) |
| 10.5 | Unread badge count vs actual unread | Open notifications, mark all read — badge on home screen should go to 0 |

---

## Practical Testing Setup

### Android Emulator Network Throttle
`AVD Manager → Edit → Show Advanced Settings → Network → Speed: EDGE / GPRS`

### Force Background Kill
`Developer Options → Background process limit → 1 process`
This aggressively kills backgrounded apps, simulating low-RAM devices.

### Firebase Local Emulator
Run against the Firebase Emulator Suite for destructive tests (delete users, flood collections) without touching production data.
```
firebase emulators:start
```

### What to Log for Each Bug Found
1. **Screen** — which fragment
2. **Action** — exactly what was tapped / entered
3. **UI result** — what the app showed
4. **Firestore result** — what actually exists in the database
5. **Logcat output** — any exception or warning

> The optimistic update pattern (Architecture Decision #19) means the **UI can show success even if the Firestore write fails** — always cross-check the UI against actual Firestore state when testing check-in flows.

---

## Top 3 — Test These First

| Priority | Scenario | Why |
|---|---|---|
| 🔴 #1 | Double-tap on attendance Check In | Most likely to create duplicate Firestore docs; hardest to clean up |
| 🔴 #2 | Photo upload with airplane mode toggled mid-upload | Silent partial failure — doc saved, photos missing, no user feedback |
| 🔴 #3 | Offline check-in then reconnect | Firestore offline cache is not tested; may flush incorrectly or not at all |
