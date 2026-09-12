# Mark Sundays and Holidays as an Attendance Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a payroll-neutral `Sunday`/`Holiday` `attendance_status` doc for every active employee on Sundays and company holidays, instead of leaving no doc at all, and backfill the same for past dates.

**Architecture:** A new pure helper (`resolveRestDayType`) decides which label (if any) applies to a date; `computeDailyAttendanceStatus` calls it before its existing per-user scoring loop and batch-writes the label for any user who doesn't already have a doc for that date. The admin portal's client-side preview (`deriveStatus`) gets the same helper's logic (ported, since it runs in the browser) so the label shows even before the nightly write lands. A one-time backfill applies the same rule to past dates.

**Tech Stack:** Node.js Cloud Functions (Firebase Functions v2, `firebase-admin`), Next.js/TypeScript admin portal, Firestore.

**Spec:** `docs/superpowers/specs/2026-09-12-sunday-holiday-status-design.md`

## Global Constraints

- New status values: `'Sunday'` and `'Holiday'` only — no other status strings introduced.
- Payroll-neutral: never write `daily_hours`, never affect `daysNP`/PL/Absent counting.
- Holiday takes precedence over Sunday when a date is both.
- Never overwrite an existing `attendance_status` doc (any `markedBy`) for that user+date.
- Android and `otLedger.ts`/`otAggregate.ts` are out of scope — do not touch them.
- Backfill start date: `2026-07-01` (the existing `LAUNCH_DATE` constant in `admin/src/lib/config.ts` — the app's own definition of "before this, data is test data wiped," so there's nothing meaningful to backfill earlier).

---

## Task 1: Pure `resolveRestDayType` helper + tests

**Files:**
- Modify: `firebase/functions/attendanceRules.js`
- Test: `firebase/functions/attendanceRules.test.js`

**Interfaces:**
- Produces: `resolveRestDayType(dateStr: string, isHoliday: boolean): 'Holiday' | 'Sunday' | null` — exported alongside the existing `classify`/`resolveOpsWindow`. Used by Task 2 (Cloud Function) and Task 3 (backfill).

- [ ] **Step 1: Write the failing tests**

Open `firebase/functions/attendanceRules.test.js` and add (matching the file's existing `node:test` style — check the top of the file for the exact `require`/`describe` pattern already in use and match it):

```js
test("resolveRestDayType: a plain Tuesday is not a rest day", () => {
  assert.strictEqual(resolveRestDayType("2026-09-15", false), null); // Tuesday
});

test("resolveRestDayType: Sunday with no holiday is Sunday", () => {
  assert.strictEqual(resolveRestDayType("2026-09-13", false), "Sunday"); // Sunday
});

test("resolveRestDayType: a weekday marked as a holiday is Holiday", () => {
  assert.strictEqual(resolveRestDayType("2026-09-15", true), "Holiday"); // Tuesday, marked holiday
});

test("resolveRestDayType: Sunday marked as a holiday is Holiday, not Sunday", () => {
  assert.strictEqual(resolveRestDayType("2026-09-13", true), "Holiday"); // Sunday + holiday
});
```

(2026-09-15 is a Tuesday and 2026-09-13 is a Sunday — confirm both against a calendar before committing; do not guess.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && npm test`
Expected: FAIL — `resolveRestDayType is not defined` (or a `TypeError: resolveRestDayType is not a function`).

- [ ] **Step 3: Implement the helper**

In `firebase/functions/attendanceRules.js`, add above the `module.exports` block:

```js
/**
 * Which auto rest-day status (if any) applies to a date. `isHoliday` is whether
 * `holidays/{dateStr}` exists — the caller looks that up, since this module has
 * no Firestore access. Holiday wins over Sunday when both apply (more
 * informative — the caller can still surface the holiday's title separately).
 */
function resolveRestDayType(dateStr, isHoliday) {
  if (isHoliday) return "Holiday";
  const dayOfWeek = new Date(dateStr + "T00:00:00Z").getUTCDay();
  return dayOfWeek === 0 ? "Sunday" : null;
}
```

Add `resolveRestDayType` to the `module.exports` object at the bottom of the file (alongside `OFFICE_START_MIN`, `OFFICE_END_MIN`, `toMinutes`, `classify`, `resolveOpsWindow`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && npm test`
Expected: PASS, all tests including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/attendanceRules.js firebase/functions/attendanceRules.test.js
git commit -m "feat(functions): add resolveRestDayType helper for Sunday/holiday status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

---

## Task 2: Write Sunday/Holiday status docs from `computeDailyAttendanceStatus`

**Files:**
- Modify: `firebase/functions/index.js:383-398`

**Interfaces:**
- Consumes: `resolveRestDayType(dateStr, isHoliday)` from Task 1; `priorStatus: Map<userId, status>` and `allUsers: Array<{id, name, employeeId, role, ...}>` already built earlier in the same function (lines 334-366 — do not change how these are built).
- Produces: nothing new consumed elsewhere in this plan.

- [ ] **Step 1: Confirm the require line pulls in the new helper**

`index.js` already does `const { classify, resolveOpsWindow, ... } = require("./attendanceRules");` near the top — find that line and add `resolveRestDayType` to the destructured names. Read the current import line first (`grep -n "require(\"./attendanceRules\")" firebase/functions/index.js`) before editing, since the exact destructured list must match what's already there.

- [ ] **Step 2: Replace the two early-returns with the batch write**

Replace this block (currently at `index.js:383-398`):

```js
    // Skip Sundays — no status written, no penalty.
    // `today` is the IST date string; read the weekday in UTC to avoid the
    // runtime's UTC timezone shifting a "+05:30 midnight" back to the prior day
    // (which made Mondays read as Sundays and vice-versa).
    const todayDate = new Date(today + "T00:00:00Z");
    if (todayDate.getUTCDay() === 0) {
      console.log(`computeDailyAttendanceStatus: skipping Sunday ${today}`);
      return;
    }

    // Skip company-wide holidays the same way — no status, no Absent penalty.
    const holidayDoc = await db.doc(`holidays/${today}`).get();
    if (holidayDoc.exists) {
      console.log(`computeDailyAttendanceStatus: skipping holiday ${today} (${holidayDoc.data().title || ""})`);
      return;
    }
```

with:

```js
    // Sundays and company-wide holidays get a payroll-neutral Sunday/Holiday status
    // instead of being left doc-less: same zero salary effect, but now visible in the
    // portal and Sheets export instead of a blank cell. `today` is the IST date string;
    // resolveRestDayType reads the weekday in UTC to avoid the runtime's UTC timezone
    // shifting a "+05:30 midnight" back to the prior day (which made Mondays read as
    // Sundays and vice-versa).
    const holidayDoc = await db.doc(`holidays/${today}`).get();
    const restDayType = resolveRestDayType(today, holidayDoc.exists);

    if (restDayType) {
      const restDayBatch = db.batch();
      let restDayCount = 0;
      for (const user of allUsers) {
        if (priorStatus.has(user.id)) continue; // any existing doc (auto or admin) wins
        restDayBatch.set(db.doc(`users/${user.id}/attendance_status/${today}`), {
          status: restDayType,
          markedBy: "auto",
          date: today,
          userId: user.id,
          userName: user.name || "",
          employeeId: user.employeeId || "",
          role: user.role || "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        restDayCount++;
      }
      await restDayBatch.commit();
      console.log(`computeDailyAttendanceStatus: marked ${restDayType} for ${today} (${restDayCount}/${allUsers.length} users; ${allUsers.length - restDayCount} already had a doc)`);
      return;
    }
```

`allUsers` is already filtered to `active !== false` earlier in the function — offboarded users stay untouched, unchanged from today's behavior. `priorStatus` was populated by `statusChecks` a few lines above this block (unchanged) — reusing it here means no extra Firestore reads.

- [ ] **Step 3: Static-check the file**

Run: `cd firebase/functions && node --check index.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Run the existing boundary suite**

Run: `cd firebase/functions && npm test`
Expected: PASS — this suite doesn't exercise `computeDailyAttendanceStatus` directly (per the spec, it's the untested integration path), so this is a regression check on everything else, not new coverage.

- [ ] **Step 5: Manual emulator verification**

Start the emulator suite (`firebase emulators:start --only functions,firestore` from the repo root) and seed:
- A `holidays/2026-09-13` doc (`{title: "Test Holiday"}`) — 2026-09-13 is a Sunday, so this exercises the Holiday-wins-over-Sunday path.
- Two `users/{uid}` docs: one plain (role `operations`, `active: true`), one with an existing `attendance_status/2026-09-13` doc (`{status: "Present", markedBy: "admin"}`) to verify the no-clobber path.

Manually invoke the function body against `today = "2026-09-13"` (either by temporarily changing the schedule to `onRequest` for local testing, or via `firebase functions:shell` calling `computeDailyAttendanceStatus()` if the emulator shell exposes it for `onSchedule` functions — confirm which works in this environment before relying on it). Verify:
- The plain user's doc reads `{status: "Holiday", markedBy: "auto"}`.
- The admin-marked user's doc is untouched (`{status: "Present", markedBy: "admin"}`).
- No `daily_hours/2026-09-13` doc was created for either user.

Revert any temporary `onSchedule`→`onRequest` change made only for this manual check before committing.

- [ ] **Step 6: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): mark Sundays and holidays as an attendance status

Instead of skipping the day entirely, computeDailyAttendanceStatus now
writes a payroll-neutral Sunday/Holiday status doc for every user who
doesn't already have one for that date.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

---

## Task 3: Widen the admin `AttendanceStatus.status` type

**Files:**
- Modify: `admin/src/types/index.ts:85`

**Interfaces:**
- Produces: `AttendanceStatus['status']` now includes `'Sunday' | 'Holiday'`, consumed by Task 4 and Task 5.

- [ ] **Step 1: Widen the union**

Change:

```ts
  status: 'Present' | 'HalfDay' | 'SL' | 'LNF' | 'SLNF' | 'Absent' | 'PL' | 'LWP' | 'WO';
```

to:

```ts
  status: 'Present' | 'HalfDay' | 'SL' | 'LNF' | 'SLNF' | 'Absent' | 'PL' | 'LWP' | 'WO' | 'Sunday' | 'Holiday';
```

- [ ] **Step 2: Type-check**

Run: `cd admin && npx tsc --noEmit`
Expected: PASS (this is a pure widening of a union — nothing narrows against it exhaustively today, but this step catches it if something does).

- [ ] **Step 3: Commit**

```bash
git add admin/src/types/index.ts
git commit -m "feat(admin): add Sunday/Holiday to the AttendanceStatus type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

---

## Task 4: Badge styling for the two new statuses

**Files:**
- Modify: `admin/src/components/ui.tsx:38-48`

**Interfaces:**
- Consumes: `AttendanceStatus['status']` widened in Task 3.

- [ ] **Step 1: Add the two entries**

In `STATUS_MAP`, add (after the `WO` entry):

```ts
  Sunday:    { label: 'Sunday',        bg: '#F2F0ED', color: '#8A817A' },
  Holiday:   { label: 'Holiday',       bg: '#F2F0ED', color: '#8A817A' },
```

Same neutral gray used by `StatusBadge`'s existing unknown-status fallback (line 51) — deliberately flat and unremarkable, distinct from every work-status color and from `WO`'s blue.

- [ ] **Step 2: Visual check**

Run `cd admin && npm run dev`, open `/attendance` for any date, and confirm no visual regression on existing badges (this change is additive-only — no existing entry was touched). A live check of the new badges themselves happens in Task 5 once `deriveStatus` can produce them.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/ui.tsx
git commit -m "feat(admin): style Sunday/Holiday attendance badges

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

---

## Task 5: Client-side preview shows Sunday/Holiday instead of blank

**Files:**
- Modify: `admin/src/app/(admin)/attendance/page.tsx` (`deriveStatus` at lines 88-141, and both call sites at ~440 and ~803)

**Interfaces:**
- Consumes: `AttendanceStatus['status']` from Task 3.
- Produces: `deriveStatus(role, userEvents, date, planned, isHoliday)` — note the new 5th parameter; both call sites must pass it.

- [ ] **Step 1: Add the `isHoliday` parameter and rest-day branch to `deriveStatus`**

Change the signature (currently lines 88-93):

```ts
function deriveStatus(
  role: string,
  userEvents: AttendanceRecord[],
  date: string,
  planned?: PlannedHours,
): AttendanceStatus['status'] | null {
  if (date < LAUNCH_DATE) return null; // pre-launch (test data wiped) — never render a status
  const dayOfWeek = new Date(date + 'T00:00:00').getDay();
  if (dayOfWeek === 0) return null; // Sunday — no status
```

to:

```ts
function deriveStatus(
  role: string,
  userEvents: AttendanceRecord[],
  date: string,
  planned?: PlannedHours,
  isHoliday?: boolean,
): AttendanceStatus['status'] | null {
  if (date < LAUNCH_DATE) return null; // pre-launch (test data wiped) — never render a status
  if (isHoliday) return 'Holiday'; // holiday wins over Sunday when both apply
  const dayOfWeek = new Date(date + 'T00:00:00').getDay();
  if (dayOfWeek === 0) return 'Sunday';
```

(This mirrors `resolveRestDayType` from Task 1 — TypeScript/JS across the repo don't share a build graph, so this is a deliberate, matching port, same as `attendanceRules.ts` already is for `classify`/`resolveOpsWindow`.)

- [ ] **Step 2: Update the first call site (single-date summary chips)**

This is the `effectiveStatuses` block. Currently (lines 433-451):

```ts
  const effectiveStatuses = useMemo(() => {
    const map = new Map<string, AttendanceStatus['status']>();
    users.forEach(user => {
      // Ignore pre-launch stored docs (wiped test/backfill data); deriveStatus already guards this.
      const stored = selectedDate < LAUNCH_DATE ? undefined : selectedDayMap.get(user.id)?.status;
      if (stored) {
        map.set(user.id, stored);
      } else if (!eventsLoading && !selectedHoliday) {
        const derived = deriveStatus(
          user.role,
          selectedEvents.filter(e => e.userId === user.id),
          selectedDate,
          selectedPlanMap.get(user.id),
        );
        if (derived) map.set(user.id, derived);
      }
    });
    return map;
  }, [users, selectedDayMap, selectedPlanMap, selectedEvents, eventsLoading, selectedHoliday]);
```

Change the `else if` branch to stop excluding holidays, and pass the flag through:

```ts
      } else if (!eventsLoading) {
        const derived = deriveStatus(
          user.role,
          selectedEvents.filter(e => e.userId === user.id),
          selectedDate,
          selectedPlanMap.get(user.id),
          !!selectedHoliday,
        );
        if (derived) map.set(user.id, derived);
      }
```

Also update the stale comment immediately above (`// Holidays are skipped like Sundays — no live status is derived for them.`) to:

```ts
  // Sunday/holiday now derive a real status ('Sunday'/'Holiday') via deriveStatus, same as
  // every other day — no special-casing needed here beyond passing the holiday flag through.
```

- [ ] **Step 3: Update the second call site (per-user table row)**

Currently (lines 801-806):

```ts
                    // Derive status live from events (+ planned window for ops) until the Cloud
                    // Function runs. Holidays are skipped like Sundays — no live status.
                    const derivedStatus = !status && !eventsLoading && !selectedHoliday
                      ? deriveStatus(user.role, userEvents, selectedDate, planned)
                      : null;
```

Change to:

```ts
                    // Derive status live from events (+ planned window for ops) until the Cloud
                    // Function runs — Sunday/holiday now derive 'Sunday'/'Holiday' the same way.
                    const derivedStatus = !status && !eventsLoading
                      ? deriveStatus(user.role, userEvents, selectedDate, planned, !!selectedHoliday)
                      : null;
```

`selectedHoliday` is already in scope at this point in the component (defined at line 427, `const selectedHoliday = holidaysByDate.get(selectedDate);`).

- [ ] **Step 4: Manual check in the dev server**

Run `cd admin && npm run dev`, open `/attendance`, and:
- Pick a past or current Sunday with no stored status doc yet: confirm the row shows a "Sunday" badge with the "live" italic marker (since it's derived, not stored).
- Mark a holiday on a weekday via the calendar (existing "Mark Holiday" UI) and reload that date: confirm the row shows a "Holiday" badge.
- Pick a **future** Sunday (e.g. next week): confirm it also shows "Sunday" — this is new behavior (future dates were never previewed before), and correct per the spec (day-type is knowable in advance, unlike work statuses).

- [ ] **Step 5: Commit**

```bash
git add "admin/src/app/(admin)/attendance/page.tsx"
git commit -m "feat(admin): derive Sunday/Holiday status client-side instead of blank

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

---

## Task 6: Fix `firestore.ts` — stale comment + a real cancelLeave regression

**Files:**
- Modify: `admin/src/lib/firestore.ts:370-376`

**Interfaces:** none (self-contained fix inside `cancelLeave`).

This task exists because of a genuine correctness issue this change would otherwise introduce, found during planning, not called out in the spec: `cancelLeave`'s revert loop treats "no doc" as "nothing to undo, not a skip." Once past Sundays/holidays get a real `Sunday`/`Holiday` doc (from Task 2 going forward, and the Task 7 backfill for history), a cancelled leave date that happens to land on one of those days would newly have `snap.exists() === true` with a non-leave status, falling into the `skippedDates` branch and showing the admin a spurious "this day couldn't be reverted" warning — even though it was never scored as leave in the first place (the leave-approval UI already flags Sundays/holidays as "never leave days," but the multi-select picker doesn't forbid ticking them, so they can end up in `approvedDates`/`cancelledDates`).

- [ ] **Step 1: Read the current code**

```ts
  statusSnaps.forEach((snap, i) => {
    // No doc = never scored (a future date, a Sunday, a holiday). Nothing to undo,
    // and NOT a skip — the cancellation lands cleanly.
    if (!snap.exists()) return;
    const data = snap.data() as AttendanceStatus;
    const scoredAsLeave = data.status === 'PL' || data.status === 'LWP';
    if (!scoredAsLeave || data.markedBy !== 'auto') { skippedDates.push(cancelling[i]); return; }
```

- [ ] **Step 2: Update it**

```ts
  statusSnaps.forEach((snap, i) => {
    // No doc = never scored (a future date, or a Sunday/holiday before this feature's
    // deploy date). Nothing to undo, and NOT a skip — the cancellation lands cleanly.
    if (!snap.exists()) return;
    const data = snap.data() as AttendanceStatus;
    // A Sunday/Holiday doc is never a leave day either — same "nothing to undo" case as
    // no doc at all, just now backed by a real record instead of an absent one.
    if (data.status === 'Sunday' || data.status === 'Holiday') return;
    const scoredAsLeave = data.status === 'PL' || data.status === 'LWP';
    if (!scoredAsLeave || data.markedBy !== 'auto') { skippedDates.push(cancelling[i]); return; }
```

- [ ] **Step 3: Type-check**

Run: `cd admin && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual check**

There's no existing automated test for `cancelLeave` (firestore.ts has no test file, per the codebase's own convention of leaving Firestore-integration functions untested and only unit-testing pure logic modules). Manually verify in the dev server: approve a leave request whose range includes a Sunday, confirm the Sunday date is tickable in the approval picker (existing behavior, unchanged), then cancel that same date from the "Cancel leave" flow and confirm no amber "skipped" note appears for it.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/firestore.ts
git commit -m "fix(admin): don't flag Sunday/Holiday days as unrevertable in cancelLeave

A Sunday/Holiday attendance_status doc is never a leave day, so
cancelLeave must treat it the same as no doc at all (nothing to
undo), not as a day that couldn't be reverted.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

---

## Task 7: One-time backfill for past Sundays/holidays

**Files:**
- Modify: `firebase/functions/index.js` (temporary export, removed in Step 8)

**Interfaces:**
- Consumes: `resolveRestDayType` from Task 1, `assertAdmin` (already defined at `index.js:73-81`).

- [ ] **Step 1: Add the temporary callable function**

Add near the other `onCall` exports (e.g. after `exports.setUserActive`), reusing the exact same `assertAdmin` gate every other admin-only callable in this file uses:

```js
// ⚠️ TEMPORARY — one-time backfill for the Sunday/Holiday attendance_status rollout
// (2026-09-12). Deploy, dry-run, review, run for real, then DELETE this export and
// redeploy. Matches the 2026-07-17 backfill precedent (see admin/CLAUDE.md).
exports.backfillSundayHolidayStatuses = onCall(async (request) => {
  await assertAdmin(request);
  const dryRun = request.data?.dryRun !== false; // default true — must opt OUT explicitly
  const startDate = request.data?.startDate || "2026-07-01"; // LAUNCH_DATE

  const todayIST = (() => {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
  })();

  const usersSnap = await admin.firestore().collection("users").get();
  const allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })); // inactive INCLUDED, per the 2026-07-17 precedent

  const holidaysSnap = await admin.firestore().collection("holidays")
    .where("date", ">=", startDate).where("date", "<=", todayIST).get();
  const holidaySet = new Set(holidaysSnap.docs.map((h) => h.id));

  let wouldWrite = 0, written = 0, alreadyHadDoc = 0;
  const batch = admin.firestore().batch();
  let batchOps = 0;

  for (const user of allUsers) {
    let d = new Date(startDate + "T00:00:00Z");
    const end = new Date(todayIST + "T00:00:00Z");
    while (d < end) { // strictly before today — today is computeDailyAttendanceStatus's job
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const restDayType = resolveRestDayType(dateStr, holidaySet.has(dateStr));
      if (restDayType) {
        const ref = admin.firestore().doc(`users/${user.id}/attendance_status/${dateStr}`);
        const existing = await ref.get();
        if (existing.exists) {
          alreadyHadDoc++;
        } else {
          wouldWrite++;
          if (!dryRun) {
            batch.set(ref, {
              status: restDayType, markedBy: "backfill", date: dateStr,
              userId: user.id, userName: user.name || "", employeeId: user.employeeId || "",
              role: user.role || "", updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            batchOps++;
            written++;
            if (batchOps >= 400) { await batch.commit(); batchOps = 0; } // stay under the 500-op batch limit
          }
        }
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  if (!dryRun && batchOps > 0) await batch.commit();

  return { dryRun, startDate, endDate: todayIST, usersScanned: allUsers.length, wouldWrite, written, alreadyHadDoc };
});
```

Note this per-date-per-user `existing.get()` check (rather than reusing a bulk `priorStatus`-style map like Task 2) is deliberately simple and read-heavy — it's a one-time, temporary, low-QPS job over a bounded date range, not a hot path, so clarity wins over the optimization Task 2 needed for its nightly, all-users-every-day cost profile.

- [ ] **Step 2: Static-check and deploy**

```bash
cd firebase/functions && node --check index.js
```
Expected: no output.

```bash
firebase deploy --only functions:backfillSundayHolidayStatuses
```
Run from the **repo root** (per `admin/CLAUDE.md`'s standing note that Firebase CLI commands must run from the root for this monorepo's single `firebase.json`).

- [ ] **Step 3: Get an admin ID token**

Using the admin's own login (test credentials or the real admin account) and the Web API key from `admin/.env.local`'s `NEXT_PUBLIC_FIREBASE_API_KEY`:

```bash
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<NEXT_PUBLIC_FIREBASE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-login-email>","password":"<admin-password>","returnSecureToken":true}' \
  | grep -o '"idToken": *"[^"]*"'
```

Copy the token value (without the `idToken": "` prefix/trailing quote) into `$ID_TOKEN` for the next steps.

- [ ] **Step 4: Dry run**

```bash
curl -s -X POST "https://us-central1-white-coffee-92c27.cloudfunctions.net/backfillSundayHolidayStatuses" \
  -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
  -d '{"data": {"dryRun": true}}'
```

Expect a JSON body like `{"result": {"dryRun": true, "startDate": "2026-07-01", "endDate": "...", "usersScanned": N, "wouldWrite": M, "written": 0, "alreadyHadDoc": K}}`. Sanity-check `wouldWrite` against a rough hand estimate (roughly `usersScanned × (weeks between startDate and today) × (1 Sunday/week + a few holidays)`) before proceeding — do not run the real pass on a number that looks obviously wrong.

- [ ] **Step 5: Real run**

```bash
curl -s -X POST "https://us-central1-white-coffee-92c27.cloudfunctions.net/backfillSundayHolidayStatuses" \
  -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
  -d '{"data": {"dryRun": false}}'
```

Confirm the response's `written` count matches the dry run's `wouldWrite` count.

- [ ] **Step 6: Spot-check in the portal**

Open `/attendance` for a past Sunday and a past marked holiday from before this feature's deploy date; confirm the "Daily Status" column now shows "Sunday"/"Holiday" badges (stored, not "live") for users who previously showed a blank cell.

- [ ] **Step 7: Remove the temporary function and redeploy**

```bash
git log -1 --format=%H -- firebase/functions/index.js  # note the commit that added it, for reference
```

Delete the `exports.backfillSundayHolidayStatuses` block from `index.js` entirely.

```bash
cd firebase/functions && node --check index.js
firebase deploy --only functions:backfillSundayHolidayStatuses
```

(Deploying with the export removed from source tells Firebase to delete the deployed function — confirm the CLI prompts to delete it and accept.)

- [ ] **Step 8: Commit the removal**

```bash
git add firebase/functions/index.js
git commit -m "chore(functions): remove one-time Sunday/Holiday backfill function

Ran successfully against production; the function and its deployment
are gone per the 2026-07-17 backfill precedent (temporary tools are
removed from source once used, not left dormant).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0171ZEZn3ypEGm5uADgSQxPX"
```

*(The add-and-deploy step and the remove-and-redeploy step are two separate commits by design — the backfill's presence in git history for its brief life matches the 2026-07-17 precedent of "deployed, dry-run, committed, then deleted," giving a clean audit trail of exactly what ran against production.)*

---

## Task 8: Full regression pass

**Files:** none modified — verification only.

- [ ] **Step 1: Functions boundary suite**

```bash
cd firebase/functions && node --check index.js && npm test
```
Expected: PASS.

- [ ] **Step 2: Firestore rules suite**

```bash
cd firebase/rules-tests && npm test
```
Expected: all 72 (or however many currently exist) tests PASS, unchanged — this change touches no rule (`firestore.rules`'s `attendance_status` write rule doesn't inspect the `status` field's value, confirmed by reading the rule during planning).

- [ ] **Step 3: Admin build**

```bash
cd admin && npm run build
```
Expected: PASS (static export succeeds; this also re-runs the TypeScript compiler over the whole app, catching any exhaustiveness issue Tasks 3/5/6 missed).

- [ ] **Step 4: Report results to the user**

Summarize pass/fail for all three, and confirm the backfill's final numbers (from Task 7) are recorded somewhere findable (this plan's checklist, or a follow-up note) in case they're needed later.
