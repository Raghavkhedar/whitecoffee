# Holiday pay for operations, past-date holiday guard, late-approved leave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Operations staff who work a holiday lose the +1 holiday day (they are paid through OT approval instead); (2) block adding/removing holidays for past dates; (3) score leave that is approved after its days have already passed.

**Architecture:** A `salaryCredit` field on `Holiday` status docs (0 = +1 withdrawn), honoured by the two mirrored Days-NP weight sites. A pure client guard for past-date holiday edits. A pure, unit-tested planner plus a thin Admin-SDK Cloud Function trigger for late-approved leave (Admin SDK because `plBalance` writes are admin-only in `firestore.rules`).

**Tech Stack:** Node.js Cloud Functions (`node --test`), Next.js/TypeScript admin portal (`npx tsx` for pure lib tests).

**Spec:** `docs/superpowers/specs/2026-09-19-holiday-ops-and-retro-leave-design.md` (builds on `2026-09-18-schl-uschl-leave-status-design.md`)

## Global Constraints

- A Holiday dated on a Sunday credits 0 and stays that way — the Sheets month-to-date loop skips Sundays BEFORE the Holiday case; do not touch that.
- Readers treat ONLY a strict `salaryCredit === 0` on a `Holiday` doc as "+1 withdrawn". A `Holiday` doc with no `salaryCredit` (written before this change) is PAID.
- The Days-NP weights are mirrored in `tallyAttendanceStatus` (`firebase/functions/payrollDeductions.js`) and `dayWeight` (`firebase/functions/dailySpend.js`) — change both in the same task.
- All rest-day (Sunday/holiday) work is already raised as pending OT for admin approval (`computeDayLedger`) — do NOT change any OT ledger code.
- `firebase/firestore.rules` is NOT changed by this plan.
- Verification: from `firebase/functions`: `node --check index.js` and `npm test` (baseline 356 pass, 0 fail); from `admin`: `npx tsc --noEmit` (the ONLY allowed error is the pre-existing, unrelated `src/lib/compensation.test.ts(20,…)`).
- Shell note: in this worktree plain `git` may be blocked by a hook; use `\git <literal args>` as its own command (no `&&` chains, and avoid the word "git" inside heredocs).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Operations who work a holiday lose the +1 (salaryCredit on Holiday docs)

**Files:**
- Create: `firebase/functions/holidayCredit.js`, `firebase/functions/holidayCredit.test.js`
- Modify: `firebase/functions/payrollDeductions.js`, `firebase/functions/payrollDeductions.test.js`
- Modify: `firebase/functions/dailySpend.js`, `firebase/functions/dailySpend.test.js`
- Modify: `firebase/functions/index.js` (require + the nightly rest-day branch, ~L384-413)
- Modify: `admin/src/app/(admin)/attendance/page.tsx` (one string literal, the holiday note ~L660)
- Modify: `admin/CLAUDE.md`, `android/CLAUDE.md` (docs)

**Interfaces:**
- Produces: `resolveHolidayCredit(role: string, events: Array<{type: string, timestamp: {seconds: number}}>) => 0 | 1` and `istMinuteOfDay(epochSecs: number) => number` from `holidayCredit.js`.
- Produces: `tallyAttendanceStatus(tally, "Holiday", salaryCredit)` counts the day only when `salaryCredit !== 0`; `dayWeight("Holiday", salaryCredit)` is `salaryCredit === 0 ? 0 : 1`.

- [ ] **Step 1: Write the failing tests for `resolveHolidayCredit`**

Create `firebase/functions/holidayCredit.test.js`:

```js
"use strict";

// Boundary suite for the holiday credit rule. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveHolidayCredit } = require("./holidayCredit");

// Epoch seconds for an IST wall-clock time on 2026-09-21.
const at = (h, m, s = 0) => Date.UTC(2026, 8, 21, h, m, s) / 1000 - 19800;
const ev = (type, seconds) => ({ type, timestamp: { seconds } });

test("ops with a complete site in/out window that day: +1 withdrawn (paid through OT instead)", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0)), ev("site_out", at(14, 0))]), 0);
});

test("ops market visit counts, and site_in + market_out mixes", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("market_in", at(9, 0)), ev("market_out", at(11, 0))]), 0);
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(9, 0)), ev("market_out", at(11, 0))]), 0);
});

test("ops with only a check-in (forgot to check out): nothing to approve, keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0))]), 1);
});

test("ops with no punches, or events missing: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", []), 1);
  assert.equal(resolveHolidayCredit("operations", undefined), 1);
});

test("home_in / home_out are commute markers, never work: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("home_in", at(8, 0)), ev("home_out", at(20, 0))]), 1);
});

test("in and out inside the same minute is zero worked minutes: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0, 10)), ev("site_out", at(10, 0, 50))]), 1);
});

test("uses minute-of-day arithmetic exactly like the OT ledger (20s straddling a minute = 1 worked minute)", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0, 50)), ev("site_out", at(10, 1, 10))]), 0);
});

test("unsorted events are handled (first in / last out)", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_out", at(14, 0)), ev("site_in", at(10, 0))]), 0);
});

test("out before in (bad data) is not worked time: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(14, 0)), ev("site_out", at(10, 0))]), 1);
});

test("office, admin, sales and unknown roles always keep the +1", () => {
  const worked = [ev("office_in", at(10, 0)), ev("office_out", at(18, 0)), ev("site_in", at(10, 0)), ev("site_out", at(18, 0))];
  for (const role of ["office", "admin", "sales", "mystery", ""]) {
    assert.equal(resolveHolidayCredit(role, worked), 1, role);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd firebase/functions && node --test holidayCredit.test.js 2>&1 | tail -15`
Expected: FAIL — `Cannot find module './holidayCredit'`.

- [ ] **Step 3: Implement `holidayCredit.js`**

Create `firebase/functions/holidayCredit.js`:

```js
"use strict";

/**
 * Whether a Holiday status day still pays its +1 to an employee.
 *
 * All Sunday/holiday work is already raised as PENDING OT for an admin to approve
 * (computeDayLedger: on a rest day the whole worked window becomes pendingExtraMins), so an
 * operations employee who actually works a holiday is paid through that approval — the +1
 * holiday day would pay them twice. Withdraw it: salaryCredit 0. Everyone else keeps it: 1.
 *
 * "Actually worked" is deliberately the same test that makes the ledger raise pending OT:
 * a complete first-in / last-out pair with > 0 worked minutes, in IST minute-of-day
 * arithmetic. One-sided punches (no checkout) or a same-minute in/out raise nothing to
 * approve, so they keep the +1. Only roles that run the OT ledger (operations) are affected.
 *
 * Readers treat ONLY a strict 0 as "withdrawn"; a legacy Holiday doc with no salaryCredit is paid.
 */

const { attendanceInTypes, attendanceOutTypes, usesOtShortageLedger } = require("./roleCapabilities");

// Epoch seconds → IST minute-of-day. Same arithmetic as admin/src/lib/otLedger.ts's
// istMinuteOfDay, so this module and the ledger agree on what counts as worked minutes.
function istMinuteOfDay(epochSecs) {
  return Math.floor(((((epochSecs + 19800) % 86400) + 86400) % 86400) / 60);
}

/**
 * @param {string} role
 * @param {Array<{type: string, timestamp: {seconds: number}}>} events that user's punches for the date
 * @returns {0 | 1}
 */
function resolveHolidayCredit(role, events) {
  if (!usesOtShortageLedger(role)) return 1;
  const list = Array.isArray(events) ? events : [];
  const secs = (e) => (e && e.timestamp ? Number(e.timestamp.seconds) : NaN);
  const inTypes = attendanceInTypes(role);
  const outTypes = attendanceOutTypes(role);
  const byTime = (a, b) => secs(a) - secs(b);
  const ins = list.filter((e) => inTypes.includes(e.type) && Number.isFinite(secs(e))).sort(byTime);
  const outs = list.filter((e) => outTypes.includes(e.type) && Number.isFinite(secs(e))).sort(byTime);
  if (ins.length === 0 || outs.length === 0) return 1;
  const worked = istMinuteOfDay(secs(outs[outs.length - 1])) - istMinuteOfDay(secs(ins[0]));
  return worked > 0 ? 0 : 1;
}

module.exports = { resolveHolidayCredit, istMinuteOfDay };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd firebase/functions && node --test holidayCredit.test.js 2>&1 | tail -8`
Expected: all 10 PASS.

- [ ] **Step 5: Write failing tests for the two mirrored weight sites**

Append to `firebase/functions/payrollDeductions.test.js` (keep the file's existing `require` of `tallyAttendanceStatus`/`newAttendanceTally`; add them to the destructure only if missing):

```js
// ── Holiday credit (operations who worked the holiday are paid through OT instead) ──────────

test("tally: a Holiday with no salaryCredit (legacy doc) is paid", () => {
  const t = tallyAttendanceStatus(newAttendanceTally(), "Holiday", undefined);
  assert.equal(t.holiday, 1);
});

test("tally: a Holiday with salaryCredit 1 is paid", () => {
  assert.equal(tallyAttendanceStatus(newAttendanceTally(), "Holiday", 1).holiday, 1);
});

test("tally: a Holiday with salaryCredit 0 is NOT counted (paid via OT instead)", () => {
  assert.equal(tallyAttendanceStatus(newAttendanceTally(), "Holiday", 0).holiday, 0);
});
```

Append to `firebase/functions/dailySpend.test.js` (use the file's existing require names for `dayWeight`/`dailySalary`):

```js
test("Holiday: legacy doc (no salaryCredit) and salaryCredit 1 pay a day; salaryCredit 0 pays nothing", () => {
  assert.equal(dayWeight("Holiday"), 1);
  assert.equal(dayWeight("Holiday", 1), 1);
  assert.equal(dayWeight("Holiday", 0), 0);
  assert.equal(dailySalary(1000, "Holiday", 0), 0);
  assert.equal(dailySalary(1000, "Holiday", 1), 1000);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd firebase/functions && node --test payrollDeductions.test.js dailySpend.test.js 2>&1 | grep -E "^ℹ (pass|fail)|not ok" | head`
Expected: FAIL — the `salaryCredit 0` cases (tally counts 1, `dayWeight("Holiday", 0)` is 1).

- [ ] **Step 7: Implement in the two mirrored sites**

In `firebase/functions/payrollDeductions.js`, `tallyAttendanceStatus`, replace
```js
    case "Holiday":  tally.holiday++; break;
```
with
```js
    case "Holiday":  if (salaryCredit !== 0) tally.holiday++; break; // 0 = operations worked it, paid via OT instead
```
and add one sentence to that function's doc comment: `A Holiday counts unless salaryCredit is exactly 0 (an operations employee who worked it is paid through OT approval instead); a legacy Holiday doc with no salaryCredit counts.`

In `firebase/functions/dailySpend.js`, `dayWeight`, replace
```js
function dayWeight(status, salaryCredit) {
  if (status === "SCHL") return salaryCredit === 1 ? 1 : 0;
  return STATUS_WEIGHT[status] ?? 0;
}
```
with
```js
function dayWeight(status, salaryCredit) {
  if (status === "SCHL") return salaryCredit === 1 ? 1 : 0;
  if (status === "Holiday") return salaryCredit === 0 ? 0 : 1; // 0 = operations worked it, paid via OT instead
  return STATUS_WEIGHT[status] ?? 0;
}
```
and update the header comment above `STATUS_WEIGHT` so it says Holiday ×1 unless `salaryCredit` is exactly 0.
(The `Holiday: 1` entry may stay in `STATUS_WEIGHT`; the new branch takes precedence.)

- [ ] **Step 8: Run to verify they pass**

Run: `cd firebase/functions && node --test payrollDeductions.test.js dailySpend.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: 0 fail.

- [ ] **Step 9: Wire it into the nightly rest-day branch**

In `firebase/functions/index.js` add to the requires (next to the other local `require("./attendanceRules")` style lines):
```js
const { resolveHolidayCredit } = require("./holidayCredit");
```
In the rest-day block (`if (restDayType) { ... }`, ~L393-413) change the loop so a Holiday doc carries `salaryCredit`. Current loop body:
```js
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
```
New:
```js
        if (priorStatus.has(user.id)) continue; // any existing doc (auto or admin) wins
        // Holiday only: an operations employee who actually worked it is paid through the
        // OT-approval flow instead (all rest-day work is raised as pending OT), so the +1 day
        // is withdrawn (salaryCredit 0). A Sunday doc carries no credit field.
        const holidayCredit = restDayType === "Holiday"
          ? resolveHolidayCredit(user.role, eventsByUser.get(user.id) || [])
          : undefined;
        if (holidayCredit === 0) holidayWithdrawn++;
        restDayBatch.set(db.doc(`users/${user.id}/attendance_status/${today}`), {
          status: restDayType,
          ...(holidayCredit !== undefined ? { salaryCredit: holidayCredit } : {}),
          markedBy: "auto",
          date: today,
          userId: user.id,
          userName: user.name || "",
          employeeId: user.employeeId || "",
          role: user.role || "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        restDayCount++;
```
Declare `let holidayWithdrawn = 0;` next to `let restDayCount = 0;` and append ` (${holidayWithdrawn} holiday +1 withdrawn: worked, paid via OT)` to the existing `console.log` summary line in that block. `eventsByUser` is already populated earlier in the function (before this block) — confirm by reading, do not re-query.

- [ ] **Step 10: Update the holiday note shown in the Attendance page**

In `admin/src/app/(admin)/attendance/page.tsx` (~L660) the `<p>` currently reads
`Paid day off — credits 1 day of salary (a holiday that falls on a Sunday adds nothing extra) and is excluded from expected hours.`
Replace only that text with:
`Paid day off — credits 1 day of salary and is excluded from expected hours. Operations staff who work it are paid through OT approval instead (no day credit). A holiday that falls on a Sunday adds nothing extra.`

- [ ] **Step 11: Update the docs**

- `admin/CLAUDE.md`: (a) the `holidays/{date}` bullet, the Attendance Status Logic intro sentence and the status-table `Holiday` row: add that an operations employee who worked the holiday (complete in/out, worked minutes > 0) gets `salaryCredit: 0` on the Holiday doc — no +1, paid through OT approval; everyone else `salaryCredit: 1`; a legacy doc with no field is paid. (b) the `Days NP` line: `holiday` counts non-Sunday Holiday docs whose `salaryCredit` is not 0. (c) the `attendance_status` collection bullet: mention `salaryCredit` also lives on `Holiday` docs. (d) The "Rest-day OT" paragraph under "Shortage & Overtime" is STALE — it describes an `otAuthorized` gate that the OT redesign removed. Run `grep -rn "otAuthorized" admin/src firebase/functions android/app/src/main` first and report every hit; then rewrite the paragraph to match the code: all worked minutes on a Sunday/holiday (and on an admin-marked WO date) become PENDING OT (`pendingExtraMins`) that an admin approves or adjusts — never auto-credited, no shortage, the declared-OT ceiling does not apply. Also fix the `planned_hours` bullet's `otAuthorized` sentence the same way if the grep shows the field is no longer read anywhere (if it IS still read somewhere, say what reads it and keep that part). Do not touch anything else in that section.
- `android/CLAUDE.md`: in the `attendance_status` paragraph, add one clause that `Holiday` credits +1 unless `salaryCredit` is 0 (operations who worked it — paid via OT).

- [ ] **Step 12: Verify and commit**

Run: `cd firebase/functions && node --check index.js && node --check holidayCredit.js && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` — expected 0 fail (baseline 356 + new tests).
Run: `cd admin && npx tsc --noEmit 2>&1 | head -5` — only the pre-existing `compensation.test.ts(20,…)` error.
Commit in two commits: `feat(functions): withdraw the holiday +1 from operations who worked it` (all firebase/functions files + index.js) and `docs: holiday credit for operations, correct stale rest-day OT text` (attendance page string + both CLAUDE.md files).

---

### Task 2: Block adding/removing holidays for past dates

**Files:**
- Create: `admin/src/lib/holidayGuard.ts`, `admin/src/lib/holidayGuard.test.ts`
- Modify: `admin/src/lib/firestore.ts` (`setHoliday`, `deleteHoliday`, ~L1209-1219)
- Modify: `admin/src/app/(admin)/attendance/page.tsx` (holiday editor UI + its two handlers, ~L366-402 and ~L640-700)
- Modify: `admin/CLAUDE.md` (the `holidays/{date}` bullet, one clause)

**Interfaces:**
- Produces: `HOLIDAY_PAST_MESSAGE: string` and `holidayEditError(date: string, todayStr: string): string | null` from `holidayGuard.ts` (null = allowed).

- [ ] **Step 1: Write the failing test**

Create `admin/src/lib/holidayGuard.test.ts` (same style as `compensation.test.ts`):

```ts
/**
 * Run: npx tsx src/lib/holidayGuard.test.ts
 */

import { holidayEditError, HOLIDAY_PAST_MESSAGE } from './holidayGuard';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log('holidayEditError:');
check('a past date is refused with the Regularization message', holidayEditError('2026-09-18', '2026-09-19') === HOLIDAY_PAST_MESSAGE);
check('today is allowed', holidayEditError('2026-09-19', '2026-09-19') === null);
check('a future date is allowed', holidayEditError('2026-10-02', '2026-09-19') === null);
check('a date across a month/year boundary is compared as a date, not a number', holidayEditError('2025-12-31', '2026-01-01') === HOLIDAY_PAST_MESSAGE);
check('the message points at Regularization', /Regularization/.test(HOLIDAY_PAST_MESSAGE));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd admin && npx tsx src/lib/holidayGuard.test.ts 2>&1 | tail -5`
Expected: FAIL — cannot resolve `./holidayGuard`.

- [ ] **Step 3: Implement the guard**

Create `admin/src/lib/holidayGuard.ts`:

```ts
// A holiday can only be added or removed for today or a later date. By the time a day has
// passed, the nightly run has already scored it: adding a holiday afterwards would leave every
// Absent (−2) in place, and removing one would leave every employee's Holiday +1 in place.
// Fixing an already-scored day is Regularization's job. Dates are "yyyy-mm-dd", so a string
// compare is chronological.

export const HOLIDAY_PAST_MESSAGE =
  'Holidays can only be added or removed for today or a later date. An already-scored day is fixed through Regularization.';

export function holidayEditError(date: string, todayStr: string): string | null {
  return date < todayStr ? HOLIDAY_PAST_MESSAGE : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd admin && npx tsx src/lib/holidayGuard.test.ts 2>&1 | tail -4`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Enforce it in `setHoliday` / `deleteHoliday`**

In `admin/src/lib/firestore.ts` add `import { holidayEditError } from './holidayGuard';` beside the other local imports, and make both functions refuse past dates before writing:

```ts
export async function setHoliday(date: string, title: string, description: string, createdBy: string): Promise<void> {
  const blocked = holidayEditError(date, istTodayStr());
  if (blocked) throw new Error(blocked);
  await setDoc(
    doc(db, 'holidays', date),
    stamped({ date, title: title.trim(), description: description.trim(), createdBy, createdAt: Timestamp.now() }),
    { merge: true },
  );
}

export async function deleteHoliday(date: string): Promise<void> {
  const blocked = holidayEditError(date, istTodayStr());
  if (blocked) throw new Error(blocked);
  await deleteDoc(doc(db, 'holidays', date));
}
```
(`istTodayStr` is already imported in this file.)

- [ ] **Step 6: Wire the Attendance page**

Read the holiday editor in `attendance/page.tsx` first (the handlers around L366-402 that call `setHoliday`/`deleteHoliday` and set `holidayError`, and the JSX around L640-700 that renders the marked-holiday card and the "mark as holiday" control). Then:
1. In both handlers' `catch`, show the guard's message when that is what was thrown, else keep the existing generic text: `setHolidayError(err instanceof Error && err.message === HOLIDAY_PAST_MESSAGE ? err.message : '<the existing generic message>')` (import `HOLIDAY_PAST_MESSAGE` from `@/lib/holidayGuard` or the relative path the file already uses for lib imports).
2. For a selected date before today (`selectedDate < todayStr` — the page already has `todayStr = istTodayStr()`), do not render the controls that mark, edit or remove a holiday. If that date IS a holiday show the existing card without its edit/remove buttons; otherwise show nothing new. Add one muted line in the holiday area for past dates: `Holidays can't be changed for past dates — fix a scored day through Regularization.`
Change nothing else in the page.

- [ ] **Step 7: Docs**

In `admin/CLAUDE.md`, the `holidays/{date}` bullet's "Managed via `setHoliday`/`deleteHoliday`" sentence: add that both refuse any date before today (IST) — a past day is already scored, so it is fixed through Regularization (`admin/src/lib/holidayGuard.ts`).

- [ ] **Step 8: Verify and commit**

Run: `cd admin && npx tsx src/lib/holidayGuard.test.ts && npx tsc --noEmit 2>&1 | head -5` — only the pre-existing `compensation.test.ts(20,…)` error may remain.
Commit: `feat(admin): block adding or removing holidays for past dates` (all files of this task).

---

### Task 3: Score leave that is approved after its days have passed

**Files:**
- Create: `firebase/functions/retroLeaveScoring.js`, `firebase/functions/retroLeaveScoring.test.js`
- Modify: `firebase/functions/index.js` (require + new exported trigger)
- Modify: `admin/CLAUDE.md` (Leaves Page section, one bullet)

**Interfaces:**
- Consumes: `leaveCoversDate(leave, date)` from `leaveCoverage.js`; `resolveLeaveStatus(plBalance)` from `attendanceRules.js`.
- Produces: `pastGrantedDates(leave, todayIST) => string[]` (ascending, covered, strictly before `todayIST`), `planRetroLeaveScoring({ leave, todayIST, statusByDate, plBalance }) => { updates: Array<{date, status: "SCHL", salaryCredit: 0|1}>, paidDays: number }` where `statusByDate` is a `Map<date, {status, markedBy}>`.

- [ ] **Step 1: Write the failing tests**

Create `firebase/functions/retroLeaveScoring.test.js`:

```js
"use strict";

// Boundary suite for late-approved leave scoring. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pastGrantedDates, planRetroLeaveScoring } = require("./retroLeaveScoring");

const TODAY = "2026-09-21";
const leave = (over = {}) => ({ status: "approved", fromDate: "2026-09-14", toDate: "2026-09-17", ...over });
const absentAuto = { status: "Absent", markedBy: "auto" };
const statuses = (dates, s = absentAuto) => new Map(dates.map((d) => [d, s]));
const D4 = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];

test("the 4-day / balance-2 example: first two days paid, last two unpaid, balance used = 2", () => {
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: statuses(D4), plBalance: 2 });
  assert.deepEqual(r.updates.map((u) => [u.date, u.status, u.salaryCredit]), [
    ["2026-09-14", "SCHL", 1], ["2026-09-15", "SCHL", 1], ["2026-09-16", "SCHL", 0], ["2026-09-17", "SCHL", 0],
  ]);
  assert.equal(r.paidDays, 2);
});

test("zero, missing or negative balance: every day is unpaid SCHL, nothing decremented", () => {
  for (const bal of [0, undefined, -3]) {
    const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: statuses(D4), plBalance: bal });
    assert.equal(r.updates.length, 4);
    assert.ok(r.updates.every((u) => u.salaryCredit === 0));
    assert.equal(r.paidDays, 0);
  }
});

test("only dates strictly before today are scored — today and the future are the nightly run's job", () => {
  const l = leave({ fromDate: "2026-09-19", toDate: "2026-09-23" });
  const r = planRetroLeaveScoring({ leave: l, todayIST: TODAY, statusByDate: statuses(["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"]), plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-19", "2026-09-20"]);
});

test("days with punches are never overwritten (only Absent by the auto scorer)", () => {
  const map = statuses(D4);
  map.set("2026-09-15", { status: "Present", markedBy: "auto" });
  map.set("2026-09-16", { status: "HalfDay", markedBy: "auto" });
  map.set("2026-09-17", { status: "LNF", markedBy: "auto" });
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-14"]);
});

test("an admin-marked Absent is a decision and is never rewritten", () => {
  const map = statuses(D4);
  map.set("2026-09-14", { status: "Absent", markedBy: "admin" });
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-15", "2026-09-16", "2026-09-17"]);
});

test("Sunday / Holiday / SCHL / USCHL / WO docs are left alone, and a date with no doc is skipped", () => {
  const map = new Map([
    ["2026-09-14", { status: "Sunday", markedBy: "auto" }],
    ["2026-09-15", { status: "Holiday", markedBy: "auto" }],
    ["2026-09-16", { status: "SCHL", markedBy: "auto" }],
    // 2026-09-17 has no doc at all
  ]);
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.equal(r.updates.length, 0);
});

test("cancelled and ungranted dates are not scored (partial approval + cancellation respected)", () => {
  const l = leave({ approvedDates: ["2026-09-14", "2026-09-15", "2026-09-16"], cancelledDates: ["2026-09-15"] });
  const r = planRetroLeaveScoring({ leave: l, todayIST: TODAY, statusByDate: statuses(D4), plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-14", "2026-09-16"]);
});

test("a leave that is not approved scores nothing", () => {
  for (const status of ["pending", "rejected", undefined]) {
    const r = planRetroLeaveScoring({ leave: leave({ status }), todayIST: TODAY, statusByDate: statuses(D4), plBalance: 9 });
    assert.equal(r.updates.length, 0);
  }
});

test("idempotent: once the days are SCHL, planning again changes nothing", () => {
  const scored = new Map(D4.map((d) => [d, { status: "SCHL", markedBy: "auto" }]));
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: scored, plBalance: 0 });
  assert.equal(r.updates.length, 0);
  assert.equal(r.paidDays, 0);
});

test("malformed input never throws", () => {
  assert.deepEqual(planRetroLeaveScoring({}), { updates: [], paidDays: 0 });
  assert.deepEqual(pastGrantedDates(null, TODAY), []);
  assert.deepEqual(pastGrantedDates(leave({ fromDate: "garbage" }), TODAY), []);
  assert.deepEqual(pastGrantedDates(leave(), undefined), []);
});

test("pastGrantedDates is ascending and bounded", () => {
  assert.deepEqual(pastGrantedDates(leave(), TODAY), D4);
  const huge = leave({ fromDate: "2020-01-01", toDate: "2030-01-01" });
  assert.ok(pastGrantedDates(huge, TODAY).length <= 400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd firebase/functions && node --test retroLeaveScoring.test.js 2>&1 | tail -10`
Expected: FAIL — `Cannot find module './retroLeaveScoring'`.

- [ ] **Step 3: Implement the pure planner**

Create `firebase/functions/retroLeaveScoring.js`:

```js
"use strict";

/**
 * Score leave that is approved AFTER its days have already passed.
 *
 * The nightly scorer only ever writes TODAY, so a day that had no punches and no approved
 * leave when its night ran was written Absent (−2). Approving the leave afterwards used to
 * leave that Absent standing. This turns those days into SCHL — paid or unpaid by the running
 * plBalance, exactly as the nightly run would have decided — and reports how many paid days
 * were drawn so the caller can decrement plBalance in the same transaction.
 *
 * Only an Absent day written by the auto scorer is rewritten. Days with punches, admin-marked
 * days (a regularization or a cancelLeave revert is a decision), Sunday/Holiday docs, days
 * with no doc, and cancelled/ungranted dates are all left alone. Idempotent by construction:
 * once a day is SCHL it is no longer Absent.
 *
 * Pure (no Firestore) so it is unit-tested via `npm test`; the trigger in index.js is a thin
 * wrapper that reads the docs, calls this, and writes the result in one transaction.
 */

const { leaveCoversDate } = require("./leaveCoverage");
const { resolveLeaveStatus } = require("./attendanceRules");

// A leave range is bounded by firestore.rules; this only stops a malformed doc from looping.
const MAX_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dates an approved leave grants that are strictly before todayIST ("yyyy-MM-dd"), ascending. */
function pastGrantedDates(leave, todayIST) {
  if (!leave || leave.status !== "approved" || !todayIST) return [];
  if (!DATE_RE.test(leave.fromDate || "") || !DATE_RE.test(leave.toDate || "")) return [];
  const out = [];
  let d = leave.fromDate;
  for (let i = 0; i < MAX_DAYS && d <= leave.toDate && d < todayIST; i += 1) {
    if (leaveCoversDate(leave, d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/**
 * @param {{ leave: object, todayIST: string, statusByDate: Map<string, {status: string, markedBy: string}>, plBalance: number }} args
 * @returns {{ updates: Array<{date: string, status: "SCHL", salaryCredit: 0|1}>, paidDays: number }}
 */
function planRetroLeaveScoring({ leave, todayIST, statusByDate, plBalance } = {}) {
  const updates = [];
  let balance = Number(plBalance) || 0;
  let paidDays = 0;
  for (const date of pastGrantedDates(leave, todayIST)) {
    const existing = statusByDate && statusByDate.get(date);
    if (!existing || existing.status !== "Absent" || existing.markedBy !== "auto") continue;
    const resolved = resolveLeaveStatus(balance);
    updates.push({ date, status: resolved.status, salaryCredit: resolved.salaryCredit });
    if (resolved.salaryCredit === 1) {
      balance -= 1;
      paidDays += 1;
    }
  }
  return { updates, paidDays };
}

module.exports = { pastGrantedDates, planRetroLeaveScoring, addDays };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd firebase/functions && node --test retroLeaveScoring.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: 11 tests, 0 fail.

- [ ] **Step 5: Add the trigger to `index.js`**

Add near the other local requires: `const { pastGrantedDates, planRetroLeaveScoring } = require("./retroLeaveScoring");`. Find how the nightly function computes its IST `today` string (the helper it uses — read it, do not reinvent it) and use that same helper below. Add, next to the other exported triggers (`onDocumentWritten` is already imported):

```js
// ── Late-approved leave ──────────────────────────────────────────────────────────────────
// The nightly run only ever writes today, so leave approved after its days have passed used
// to leave those days Absent (−2). Score them as SCHL (paid or unpaid by the running
// plBalance) and decrement plBalance, all in one transaction. Cloud Function rather than the
// portal on purpose: plBalance writes are admin-only in firestore.rules and status writes are
// tab-gated, so a client-side version would fail for a non-admin Leaves manager or need the
// rules widened. The decision logic lives in retroLeaveScoring.js (unit-tested).
exports.scoreRetroactiveLeave = onDocumentWritten("users/{userId}/leave_requests/{requestId}", async (event) => {
  const after = event.data && event.data.after;
  if (!after || !after.exists) return;
  const leave = after.data();
  if (leave.status !== "approved") return;

  const userId = event.params.userId;
  const todayIST = /* the same IST-date helper the nightly function uses for `today` */;
  const dates = pastGrantedDates(leave, todayIST);
  if (dates.length === 0) return;

  const userRef = db.doc(`users/${userId}`);
  const statusRefs = dates.map((d) => db.doc(`users/${userId}/attendance_status/${d}`));

  const plan = await db.runTransaction(async (tx) => {
    // Every read before any write (Firestore transaction rule).
    const [userSnap, ...statusSnaps] = await tx.getAll(userRef, ...statusRefs);
    if (!userSnap.exists) return { updates: [], paidDays: 0 };
    const statusByDate = new Map();
    statusSnaps.forEach((snap, i) => { if (snap.exists) statusByDate.set(dates[i], snap.data()); });
    const result = planRetroLeaveScoring({ leave, todayIST, statusByDate, plBalance: userSnap.data().plBalance });
    result.updates.forEach((u) => {
      tx.set(db.doc(`users/${userId}/attendance_status/${u.date}`), {
        status: u.status,
        salaryCredit: u.salaryCredit,
        markedBy: "auto",
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });
    });
    if (result.paidDays > 0) {
      tx.update(userRef, { plBalance: admin.firestore.FieldValue.increment(-result.paidDays) });
    }
    return result;
  });

  if (plan.updates.length > 0) {
    console.log(`scoreRetroactiveLeave: ${userId} leave ${event.params.requestId} → ${plan.updates.length} past day(s) scored SCHL (${plan.paidDays} paid)`);
  }
});
```
Replace the `/* … */` placeholder with the real helper call. The trigger writes only `attendance_status` and the user doc, never `leave_requests`, so it cannot re-trigger itself.

- [ ] **Step 6: Docs**

In `admin/CLAUDE.md`, Leaves Page section: add one bullet — leave approved AFTER its days have passed is scored by the `scoreRetroactiveLeave` Cloud Function (`firebase/functions/retroLeaveScoring.js`): every granted past day whose status is an auto-written `Absent` becomes `SCHL` (paid/unpaid by the running `plBalance`, which is decremented in the same transaction); days with punches, admin-marked days, `Sunday`/`Holiday` docs and days with no doc are untouched; needs `firebase deploy --only functions`. Also in the `attendance_status` collection bullet's `SCHL` description add "(written nightly for today, or by `scoreRetroactiveLeave` for days that had already passed when the leave was approved)". If `admin/CLAUDE.md` says anywhere that a leave approved after the fact stays Absent, correct it.

- [ ] **Step 7: Verify and commit**

Run: `cd firebase/functions && node --check index.js && node --check retroLeaveScoring.js && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"` — 0 fail. Grep `index.js` for the literal text `the same IST-date helper` — it MUST be gone — and read the `todayIST` assignment line to confirm it calls the real helper the nightly function uses (and that the helper's result is a `yyyy-MM-dd` IST date string, not a Date object).
Commit: `feat(functions): score leave that is approved after its days have passed` (module + test + index.js) and `docs: describe late-approved leave scoring` (admin/CLAUDE.md).
