# SCHL / USCHL Leave Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the `PL`/`LWP` attendance statuses in favor of `SCHL` (auto, balance-aware via a per-day `salaryCredit` flag) and `USCHL` (admin-only, via Regularization), and fix `Holiday`'s payroll credit (currently 0, should be 1 day).

**Architecture:** Two new pure, unit-tested functions in `firebase/functions/` (`resolveLeaveStatus` in `attendanceRules.js`, `computeDaysNP` in `payrollDeductions.js`) replace inline untested arithmetic in `computeDailyAttendanceStatus` and the Employee Dashboard Sheets export. The admin portal's status union, badges, Regularization outcome list, and Leave-cancellation refund logic follow the same status/field rename. No Android changes — verified the app never hardcodes a leave-status literal, it only displays whatever string is in the doc.

**Tech Stack:** Node.js Cloud Functions (`node --test`), Next.js/TypeScript admin portal, Firestore.

**Spec:** `docs/superpowers/specs/2026-09-18-schl-uschl-leave-status-design.md`

## Global Constraints

- No historical migration: existing `PL`/`LWP` docs stay exactly as written; only new writes use `SCHL`/`USCHL`.
- `USCHL` never carries `salaryCredit`; it is written only by `approveRegularization`, never by the nightly function.
- `SCHL` carries `salaryCredit: 0 | 1`; `Holiday` credits a flat `+1`; both computed by `computeDaysNP`, not by ad-hoc arithmetic.
- `plBalance` field name and its monthly accrual are unchanged — out of scope.
- Run `firebase/functions`' `npm test` (node --test) and `firebase/rules-tests`' `npm test` (110 tests) before considering Cloud-Functions/rules work done. Run `admin`'s `npm run build` before considering portal work done (no test framework there per repo convention).

---

### Task 1: `resolveLeaveStatus` — pure leave-status/credit resolver

**Files:**
- Modify: `firebase/functions/attendanceRules.js`
- Test: `firebase/functions/attendanceRules.test.js`

**Interfaces:**
- Produces: `resolveLeaveStatus(plBalance: number) => { status: "SCHL", salaryCredit: 0 | 1 }` — exported alongside the module's existing functions. `salaryCredit` is `1` when `plBalance > 0`, else `0`.

- [ ] **Step 1: Write the failing tests**

Add to `firebase/functions/attendanceRules.test.js`, after the existing `resolveRestDayType` tests:

```js
test("resolveLeaveStatus: positive balance is SCHL with salaryCredit 1", () => {
  assert.deepStrictEqual(resolveLeaveStatus(2), { status: "SCHL", salaryCredit: 1 });
});

test("resolveLeaveStatus: zero balance is SCHL with salaryCredit 0", () => {
  assert.deepStrictEqual(resolveLeaveStatus(0), { status: "SCHL", salaryCredit: 0 });
});

test("resolveLeaveStatus: negative/undefined balance is treated as exhausted (salaryCredit 0)", () => {
  assert.deepStrictEqual(resolveLeaveStatus(-1), { status: "SCHL", salaryCredit: 0 });
  assert.deepStrictEqual(resolveLeaveStatus(undefined), { status: "SCHL", salaryCredit: 0 });
});
```

Also update the `require` at the top of the file:

```js
const {
  toMinutes,
  classify,
  resolveOpsWindow,
  resolveRestDayType,
  resolveLeaveStatus,
} = require("./attendanceRules");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && npm test 2>&1 | grep -A3 resolveLeaveStatus`
Expected: FAIL — `resolveLeaveStatus is not a function` (or `undefined`).

- [ ] **Step 3: Implement it**

In `firebase/functions/attendanceRules.js`, add after `resolveRestDayType`:

```js
/**
 * Resolve a day inside an approved-but-unpunched leave range into its status and whether it
 * draws paid salary credit. The status is uniformly "SCHL" regardless of balance — a single
 * leave request can straddle the balance boundary (e.g. 4 days approved, 2 days of balance
 * left), and the days should read the same on the calendar either way. Payroll still needs to
 * know which days were actually paid, which is what `salaryCredit` is for.
 */
function resolveLeaveStatus(plBalance) {
  const balance = Number(plBalance) || 0;
  return { status: "SCHL", salaryCredit: balance > 0 ? 1 : 0 };
}
```

And update the `module.exports` block to include `resolveLeaveStatus`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && npm test`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
cd firebase/functions
git add attendanceRules.js attendanceRules.test.js
git commit -m "$(cat <<'EOF'
feat(functions): add resolveLeaveStatus for SCHL/salaryCredit

Pure, tested replacement for the inline PL/LWP balance fork —
status is always SCHL now, salaryCredit carries the paid/unpaid split.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `computeDaysNP` — pure Days-NP formula

**Files:**
- Modify: `firebase/functions/payrollDeductions.js`
- Test: `firebase/functions/payrollDeductions.test.js`

**Interfaces:**
- Produces: `computeDaysNP({ present, sl, halfDay, lnf, schlPaid, holiday, absent }) => number` — exported alongside `computeDeductions`. Missing fields default to 0.

- [ ] **Step 1: Write the failing tests**

Add to `firebase/functions/payrollDeductions.test.js`:

```js
const { computeDeductions, computeDaysNP } = require("./payrollDeductions");

// ── Days NP ───────────────────────────────────────────────────────────────

test("computeDaysNP: a full Present day counts as 1", () => {
  assert.equal(computeDaysNP({ present: 1 }), 1);
});

test("computeDaysNP: SL/HalfDay/LNF use their fractional weights", () => {
  assert.equal(computeDaysNP({ sl: 1 }), 0.75);
  assert.equal(computeDaysNP({ halfDay: 1 }), 0.5);
  assert.equal(computeDaysNP({ lnf: 1 }), 0.5);
});

test("computeDaysNP: only the paid slice of SCHL counts (the 4-day/2-balance example)", () => {
  // 4 SCHL days, balance covered 2 of them → schlPaid=2, the other 2 are salaryCredit 0
  // and simply aren't counted (they're not passed at all).
  assert.equal(computeDaysNP({ schlPaid: 2 }), 2);
});

test("computeDaysNP: USCHL is not a field — it contributes nothing by construction", () => {
  assert.equal(computeDaysNP({ present: 5 }), 5); // no uschl param exists to add
});

test("computeDaysNP: Holiday credits a full day", () => {
  assert.equal(computeDaysNP({ holiday: 1 }), 1);
});

test("computeDaysNP: Absent is a -2 day penalty", () => {
  assert.equal(computeDaysNP({ absent: 1 }), -2);
});

test("computeDaysNP: a realistic mixed month", () => {
  // 18 Present, 1 SL, 1 HalfDay, 1 LNF, 2 SCHL paid, 1 Holiday, 1 Absent
  const r = computeDaysNP({ present: 18, sl: 1, halfDay: 1, lnf: 1, schlPaid: 2, holiday: 1, absent: 1 });
  assert.equal(r, 18 + 0.75 + 0.5 + 0.5 + 2 + 1 - 2);
});

test("computeDaysNP: missing fields default to 0", () => {
  assert.equal(computeDaysNP({}), 0);
  assert.equal(computeDaysNP(), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd firebase/functions && npm test 2>&1 | grep -A3 computeDaysNP`
Expected: FAIL — `computeDaysNP is not a function`.

- [ ] **Step 3: Implement it**

In `firebase/functions/payrollDeductions.js`, add after `computeDeductions` (before `module.exports`):

```js
/**
 * Days NP ("net pay days") for the Employee Dashboard tab — the day-count that
 * `salaryDue = daysNP × salaryRate` is built from.
 *
 * SCHL's pay is per-day, not per-status (see attendanceRules.resolveLeaveStatus): pass only
 * the PAID slice as `schlPaid` (the sum of `salaryCredit` across that user's SCHL docs this
 * month) — the unpaid slice contributes nothing, same as USCHL, which has no parameter here
 * at all because it never earns credit.
 *
 * @param present   count of Present days (×1)
 * @param sl        count of SL (Short Leave) days (×0.75)
 * @param halfDay   count of HalfDay days (×0.5)
 * @param lnf       count of LNF (Log Not Found) days (×0.5)
 * @param schlPaid  sum of `salaryCredit` across this month's SCHL days (×1 each)
 * @param holiday   count of Holiday days (×1)
 * @param absent    count of Absent days (×-2, the no-show penalty)
 */
function computeDaysNP({ present, sl, halfDay, lnf, schlPaid, holiday, absent } = {}) {
  const n = (v) => Number(v) || 0;
  return n(present) + n(sl) * 0.75 + n(halfDay) * 0.5 + n(lnf) * 0.5
    + n(schlPaid) + n(holiday) - n(absent) * 2;
}
```

Update `module.exports` to `{ computeDeductions, computeDaysNP }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && npm test`
Expected: PASS, all tests including the 8 new ones.

- [ ] **Step 5: Commit**

```bash
cd firebase/functions
git add payrollDeductions.js payrollDeductions.test.js
git commit -m "$(cat <<'EOF'
feat(functions): add computeDaysNP, extracted and tested

Replaces the inline Days-NP arithmetic in the Sheets export with a
pure tested function; adds Holiday's missing +1 payroll credit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `resolveLeaveStatus` into `computeDailyAttendanceStatus`

**Files:**
- Modify: `firebase/functions/index.js:257-551` (the nightly function — see exact line refs below)

**Interfaces:**
- Consumes: `resolveLeaveStatus` from Task 1 (`./attendanceRules`).

- [ ] **Step 1: Update the `priorStatus` map to carry `salaryCredit`**

`index.js` around line 360-366 currently reads:

```js
    const priorStatus    = new Map(); // userId → status already recorded for today
    const statusChecks = allUsers.map(async (user) => {
      const statusDoc = await db.doc(`users/${user.id}/attendance_status/${today}`).get();
      if (statusDoc.exists) {
        if (statusDoc.data().markedBy === "admin") adminOverrides.add(user.id);
        priorStatus.set(user.id, statusDoc.data().status);
      }
    });
```

Change the map to carry the whole `{status, salaryCredit}` shape:

```js
    const priorStatus    = new Map(); // userId → { status, salaryCredit } already recorded for today
    const statusChecks = allUsers.map(async (user) => {
      const statusDoc = await db.doc(`users/${user.id}/attendance_status/${today}`).get();
      if (statusDoc.exists) {
        const d = statusDoc.data();
        if (d.markedBy === "admin") adminOverrides.add(user.id);
        priorStatus.set(user.id, { status: d.status, salaryCredit: d.salaryCredit });
      }
    });
```

`priorStatus.has(user.id)` (line 397) is unaffected — it only checks presence.

- [ ] **Step 2: Replace the PL/LWP fork with `resolveLeaveStatus`**

Add the import near the top of `index.js` where `attendanceRules` is already required (find the existing `require("./attendanceRules")` line and add `resolveLeaveStatus` to its destructure).

Replace the block at ~lines 464-497:

```js
        let status;

        if (checkIns.length > 0 && checkOuts.length > 0) {
          const firstIn  = checkIns[0];
          const lastOut  = checkOuts[checkOuts.length - 1];
          const inMinutes  = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
          const outMinutes = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);

          status = classify(inMinutes, outMinutes, startMin, endMin);
        } else if (checkIns.length > 0 || checkOuts.length > 0) {
          status = "LNF";
        } else {
          if (leave) {
            const balance = user.plBalance || 0;
            if (balance > 0) {
              status = "PL";
              // Only deduct when today wasn't already counted as PL, so a re-run
              // (manual trigger / retry) doesn't decrement the balance twice.
              if (priorStatus.get(user.id) !== "PL") plDeductions.push(user.id);
            } else {
              status = "LWP";
            }
          } else {
            status = "Absent";
          }
        }

        batch.set(db.doc(`users/${user.id}/attendance_status/${today}`), {
          date: today, userId: user.id, userName: user.name || "",
          employeeId: user.employeeId || "", role: user.role, status,
          markedBy: "auto", updatedAt: admin.firestore.Timestamp.now(),
        });
```

with:

```js
        let status;
        let salaryCredit; // only set for SCHL

        if (checkIns.length > 0 && checkOuts.length > 0) {
          const firstIn  = checkIns[0];
          const lastOut  = checkOuts[checkOuts.length - 1];
          const inMinutes  = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
          const outMinutes = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);

          status = classify(inMinutes, outMinutes, startMin, endMin);
        } else if (checkIns.length > 0 || checkOuts.length > 0) {
          status = "LNF";
        } else {
          if (leave) {
            const balance = user.plBalance || 0;
            const resolved = resolveLeaveStatus(balance);
            status = resolved.status;
            salaryCredit = resolved.salaryCredit;
            // Only deduct when today wasn't already recorded as a paid SCHL day, so a re-run
            // (manual trigger / retry) doesn't decrement the balance twice.
            if (salaryCredit === 1 && priorStatus.get(user.id)?.salaryCredit !== 1) {
              plDeductions.push(user.id);
            }
          } else {
            status = "Absent";
          }
        }

        batch.set(db.doc(`users/${user.id}/attendance_status/${today}`), {
          date: today, userId: user.id, userName: user.name || "",
          employeeId: user.employeeId || "", role: user.role, status,
          ...(salaryCredit !== undefined ? { salaryCredit } : {}),
          markedBy: "auto", updatedAt: admin.firestore.Timestamp.now(),
        });
```

- [ ] **Step 3: Verify with node --check and the boundary suite**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` prints nothing (syntax OK); `npm test` all PASS (eslint is stale per repo convention — do not run it).

- [ ] **Step 4: Commit**

```bash
cd firebase/functions
git add index.js
git commit -m "$(cat <<'EOF'
feat(functions): write SCHL/salaryCredit in the nightly compute

Replaces the PL/LWP balance fork with resolveLeaveStatus; the
idempotency guard now keys off salaryCredit instead of the status
string, since SCHL no longer implies a fixed credit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Employee Dashboard MTD counters, Days-NP call, and Sheets columns

**Files:**
- Modify: `firebase/functions/index.js` (MTD switch ~L922-943, row-build ~L1784-1854)

**Interfaces:**
- Consumes: `computeDaysNP` from Task 2 (`./payrollDeductions`, already imported for `computeDeductions` — add to the same destructure).

- [ ] **Step 1: Update the MTD counter map and switch**

Replace (~L922-943):

```js
    const userAttendanceMTD = new Map(); // userId → {present, halfDay, pl, lwp, absent}
    statusSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.date < monthStart || d.date > today) return;
      const dayOfWeek = new Date(d.date + "T00:00:00Z").getUTCDay();
      if (dayOfWeek === 0) return;
      if (!userAttendanceMTD.has(d.userId))
        userAttendanceMTD.set(d.userId, { present: 0, halfDay: 0, sl: 0, slnf: 0, pl: 0, lwp: 0, absent: 0});
      const ua = userAttendanceMTD.get(d.userId);
      switch (d.status) {
        case "Present":  ua.present++;  break;
        case "HalfDay":  ua.halfDay++;  break;
        case "SL":       ua.sl++;       break;
        case "LNF":      ua.slnf++;     break; // "Log Not Found"
        case "SLNF":     ua.slnf++;     break; // legacy value, same bucket
        case "PL":       ua.pl++;       break;
        case "LWP":      ua.lwp++;      break;
        case "Absent":   ua.absent++;   break;
      }
    });
```

with:

```js
    const userAttendanceMTD = new Map(); // userId → {present, halfDay, sl, slnf, schl, schlPaid, uschl, holiday, absent}
    statusSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.date < monthStart || d.date > today) return;
      const dayOfWeek = new Date(d.date + "T00:00:00Z").getUTCDay();
      if (dayOfWeek === 0) return;
      if (!userAttendanceMTD.has(d.userId))
        userAttendanceMTD.set(d.userId, {
          present: 0, halfDay: 0, sl: 0, slnf: 0,
          schl: 0, schlPaid: 0, uschl: 0, holiday: 0, absent: 0,
        });
      const ua = userAttendanceMTD.get(d.userId);
      switch (d.status) {
        case "Present":  ua.present++;  break;
        case "HalfDay":  ua.halfDay++;  break;
        case "SL":       ua.sl++;       break;
        case "LNF":      ua.slnf++;     break; // "Log Not Found"
        case "SLNF":     ua.slnf++;     break; // legacy value, same bucket
        case "SCHL":
          ua.schl++;
          if (d.salaryCredit === 1) ua.schlPaid++;
          break;
        // A PAST month's PL/LWP docs are frozen history and never reach this map (the
        // date filter above restricts to monthStart..today). But THIS map covers the
        // CURRENT month, rebuilt live every run — a mid-month deploy leaves early-month
        // days still scored "PL"/"LWP" from before the deploy, sitting right next to
        // "SCHL" days scored after it, in the same live block. Map them onto the same
        // buckets SCHL uses (PL behaved exactly like salaryCredit:1, LWP like
        // salaryCredit:0) so Days NP and the Sheets columns stay correct through the
        // transition instead of silently losing credit for leave already taken this month.
        case "PL":       ua.schl++; ua.schlPaid++; break;
        case "LWP":      ua.schl++;                break;
        case "USCHL":    ua.uschl++;    break;
        case "Holiday":  ua.holiday++;  break;
        case "Absent":   ua.absent++;   break;
      }
    });
```

- [ ] **Step 2: Update the header, per-row formula, and row array**

Replace the header (~L1784-1791):

```js
      const header = [
        "Date", "EMP Name", "EMP ID", "Level", "Days Passed in Month",
        "Present (×1)", "SL (×0.75)", "Half Day (×0.5)", "LNF (×0.5)", "PL (×1)", "LWP (×0)", "Absent (×-2)",
        "Leaves", "Days NP",
        "Salary Rate", "Salary Due MTD",
        "Covy Due (approx avg)", "Imprest Due MTD", "OT/WO amount (₹)", "SA",
        "PF (−)", "ESI (−)", "TOTAL DUE",
      ];
```

with:

```js
      const header = [
        "Date", "EMP Name", "EMP ID", "Level", "Days Passed in Month",
        "Present (×1)", "SL (×0.75)", "Half Day (×0.5)", "LNF (×0.5)",
        "SCHL (Paid) (×1)", "SCHL (Unpaid) (×0)", "USCHL (×0)", "Holiday (×1)", "Absent (×-2)",
        "Leaves", "Days NP",
        "Salary Rate", "Salary Due MTD",
        "Covy Due (approx avg)", "Imprest Due MTD", "OT/WO amount (₹)", "SA",
        "PF (−)", "ESI (−)", "TOTAL DUE",
      ];
```

Replace (~L1802-1808):

```js
      sortedUsers.forEach((user) => {
        const empId    = user.employeeId || "";
        const ua       = userAttendanceMTD.get(user.id) || { present: 0, halfDay: 0, sl: 0, slnf: 0, pl: 0, lwp: 0, absent: 0};

        // Absent = 2-day penalty (lose the day + a penalty day) → ×-2. LWP = unpaid, contributes 0.
        const daysNP   = ua.present + ua.sl * 0.75 + ua.halfDay * 0.5 + ua.slnf * 0.5 + ua.pl - ua.absent * 2;
        const leaves   = ua.pl + ua.lwp; // all leave types shown together
```

with:

```js
      sortedUsers.forEach((user) => {
        const empId    = user.employeeId || "";
        const ua       = userAttendanceMTD.get(user.id) || {
          present: 0, halfDay: 0, sl: 0, slnf: 0,
          schl: 0, schlPaid: 0, uschl: 0, holiday: 0, absent: 0,
        };

        // Absent = 2-day penalty (lose the day + a penalty day) → ×-2. Only the PAID slice of
        // SCHL counts (schlPaid); USCHL never counts. Holiday is a full paid day off.
        const daysNP   = computeDaysNP({
          present: ua.present, sl: ua.sl, halfDay: ua.halfDay, lnf: ua.slnf,
          schlPaid: ua.schlPaid, holiday: ua.holiday, absent: ua.absent,
        });
        const leaves   = ua.schl + ua.uschl; // all leave types shown together
```

Replace the row-push array (~L1837-1855; keep everything outside the attendance-count slice untouched):

```js
        empRows.push([
          monthLabel,
          user.name || "",
          empId,
          user.level || "",
          daysPassed,
          ua.present, ua.sl, ua.halfDay, ua.slnf, ua.pl, ua.lwp, ua.absent,
          leaves,
          daysNP,
```

with:

```js
        empRows.push([
          monthLabel,
          user.name || "",
          empId,
          user.level || "",
          daysPassed,
          ua.present, ua.sl, ua.halfDay, ua.slnf, ua.schlPaid, (ua.schl - ua.schlPaid), ua.uschl, ua.holiday, ua.absent,
          leaves,
          daysNP,
```

(the rest of the array — `salaryRate, salaryDue, covy, imprest, settlement, sa, pf, esi, totalDue` — is unchanged, just keep whatever follows in the file as-is).

Also add `computeDaysNP` to the existing `require("./payrollDeductions")` destructure at the top of `index.js` (find `computeDeductions` and add it alongside).

- [ ] **Step 3: Verify**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` silent; `npm test` all PASS.

- [ ] **Step 4: Commit**

```bash
cd firebase/functions
git add index.js
git commit -m "$(cat <<'EOF'
feat(functions): SCHL/USCHL/Holiday in the Sheets export

Employee Dashboard tab: PL/LWP columns replaced with SCHL (Paid),
SCHL (Unpaid), USCHL, and Holiday; Days NP now uses computeDaysNP
and gives Holiday its +1 credit (was silently 0).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Firestore rules comments + rules-tests regression check

**Files:**
- Modify: `firebase/firestore.rules` (comments only, ~L414, ~L460)
- Verify: `firebase/rules-tests/` (110 tests, no code change expected)

**Interfaces:** none (comment-only change; this task's job is to prove no functional rule depends on the `PL`/`LWP` string).

- [ ] **Step 1: Update the stale comments**

In `firebase/firestore.rules`, around line 414, change:

```
        // Must be created pending — a self-approved leave would otherwise be
        // counted as PL by the nightly computeDailyAttendanceStatus function.
```

to:

```
        // Must be created pending — a self-approved leave would otherwise be
        // counted as SCHL by the nightly computeDailyAttendanceStatus function.
```

No other line in `firestore.rules` branches on the literal `PL`/`LWP`/`SCHL`/`USCHL` (confirmed by grep during design) — this is the only comment update needed.

- [ ] **Step 2: Run the rules-tests suite (regression baseline)**

Run: `cd firebase/rules-tests && npm test`
Expected: all 110 tests PASS, unchanged from before this plan — proves the comment-only edit didn't touch behavior, and that no existing test encodes an assumption about the `PL`/`LWP` status strings.

- [ ] **Step 3: Commit**

```bash
cd firebase
git add firestore.rules
git commit -m "$(cat <<'EOF'
docs(rules): update stale PL comment to SCHL

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Admin portal — types and status badges

**Files:**
- Modify: `admin/src/types/index.ts:81-96`
- Modify: `admin/src/components/ui.tsx` (status badge map, ~L45-49)

**Interfaces:**
- Produces: `AttendanceStatus['status']` now includes `'SCHL' | 'USCHL'` (not `'PL' | 'LWP'`); `AttendanceStatus.salaryCredit?: 0 | 1`. Every later admin task in this plan consumes this type.

- [ ] **Step 1: Update the type**

In `admin/src/types/index.ts`, replace:

```ts
export interface AttendanceStatus {
  id: string;
  date: string;
  userId: string;
  userName: string;
  employeeId: string;
  role: string;
  status: 'Present' | 'HalfDay' | 'SL' | 'LNF' | 'SLNF' | 'Absent' | 'PL' | 'LWP' | 'WO' | 'Sunday' | 'Holiday';
  markedBy: 'auto' | 'admin';
  // Effective worked window captured when an admin regularizes a day to Present (missed-punch
  // fix). When present on a Present day, the OT/shortage ledger uses these instead of raw
  // events so the corrected day can carry shortage/OT. "HH:MM" 24h, ops only.
  inTime?: string;
  outTime?: string;
  updatedAt?: Timestamp;
}
```

with:

```ts
export interface AttendanceStatus {
  id: string;
  date: string;
  userId: string;
  userName: string;
  employeeId: string;
  role: string;
  status: 'Present' | 'HalfDay' | 'SL' | 'LNF' | 'SLNF' | 'Absent' | 'SCHL' | 'USCHL' | 'WO' | 'Sunday' | 'Holiday';
  markedBy: 'auto' | 'admin';
  // Effective worked window captured when an admin regularizes a day to Present (missed-punch
  // fix). When present on a Present day, the OT/shortage ledger uses these instead of raw
  // events so the corrected day can carry shortage/OT. "HH:MM" 24h, ops only.
  inTime?: string;
  outTime?: string;
  // Only present on a SCHL day: whether it drew paid salary credit from plBalance (1) or the
  // balance was already exhausted (0) — see docs/superpowers/specs/2026-09-18-schl-uschl-...
  salaryCredit?: 0 | 1;
  updatedAt?: Timestamp;
}
```

- [ ] **Step 2: Update the status badge map**

In `admin/src/components/ui.tsx`, find the badge map containing:

```ts
LWP:       { label: 'LWP',           bg: '#F2EFEC', color: '#6B5E54' },
```

(and the neighboring `PL` entry just above/below it — read the surrounding ~10 lines to see the exact key ordering before editing). Replace both the `PL` and `LWP` entries with:

```ts
SCHL:      { label: 'SCHL',          bg: '#E3EEFB', color: '#1A5FAF' },
USCHL:     { label: 'USCHL',         bg: '#F2EFEC', color: '#6B5E54' },
```

(reuse the old `PL` entry's colors for `SCHL` and the old `LWP` entry's colors for `USCHL`, so the visual meaning — "the paid-leave-family color" vs "the unpaid-leave-family color" — carries over unchanged for anyone used to the old badges).

- [ ] **Step 3: Verify the type-checks**

Run: `cd admin && npx tsc --noEmit 2>&1 | head -50`
Expected: errors listing every remaining file that still references `'PL'`/`'LWP'` as a status literal — this is the worklist for Tasks 7-9. (If `npx tsc --noEmit` isn't wired to the project's tsconfig cleanly, use `npm run build` instead and read the type-error output the same way.)

- [ ] **Step 4: Commit**

```bash
cd admin
git add src/types/index.ts src/components/ui.tsx
git commit -m "$(cat <<'EOF'
feat(admin): SCHL/USCHL in the AttendanceStatus type and badges

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Admin portal — Regularization page outcome list

**Files:**
- Modify: `admin/src/app/(admin)/regularization/page.tsx:15,33` (and any other `PL`/`LWP` literal `npx tsc` surfaces in this file)
- Modify: `admin/src/lib/firestore.ts` (`approveRegularization` comment, ~L540)

**Interfaces:**
- Consumes: the `AttendanceStatus` type from Task 6.

- [ ] **Step 1: Update the outcome list and badge colors**

In `admin/src/app/(admin)/regularization/page.tsx`, replace:

```ts
const ATTENDANCE_STATUSES = ['Present', 'HalfDay', 'Absent', 'PL', 'LWP', 'WO'] as const;
```

with:

```ts
const ATTENDANCE_STATUSES = ['Present', 'HalfDay', 'Absent', 'USCHL', 'WO'] as const;
```

Find the badge-color map in the same file (the one containing `LWP: { label: 'LWP', bg: '#F2EFEC', color: '#6B5E54' },` around line 33) and replace the `PL`/`LWP` entries with a single `USCHL` entry, reusing the old `LWP` colors (USCHL is unpaid, same as LWP was):

```ts
USCHL:    { label: 'USCHL',          bg: '#F2EFEC', color: '#6B5E54' },
```

- [ ] **Step 2: Update the stale comment in `firestore.ts`**

In `admin/src/lib/firestore.ts`, find (~L540):

```ts
  // Re-checked here, not trusted from the page: conveyance is only claimable on a worked-day
  // outcome. Absent/LWP/WO/PL either dock salary or formally assert the day was not worked —
  // crediting travel reimbursement on the same day would be internally contradictory.
```

Replace with:

```ts
  // Re-checked here, not trusted from the page: conveyance is only claimable on a worked-day
  // outcome. Absent/USCHL/WO/SCHL either dock salary or formally assert the day was not worked —
  // crediting travel reimbursement on the same day would be internally contradictory.
```

(Note: `SCHL` can't actually reach `approveRegularization` — it's nightly-only — but the comment is describing the general "non-worked outcome" family for context, matching its original intent.)

- [ ] **Step 3: Verify**

Run: `cd admin && npx tsc --noEmit 2>&1 | grep -i "regularization\|firestore.ts"`
Expected: no errors referencing `'PL'`/`'LWP'` in these two files anymore.

- [ ] **Step 4: Commit**

```bash
cd admin
git add "src/app/(admin)/regularization/page.tsx" src/lib/firestore.ts
git commit -m "$(cat <<'EOF'
feat(admin): USCHL replaces PL/LWP as a Regularization outcome

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Admin portal — Leave cancellation refund logic

**Files:**
- Modify: `admin/src/lib/firestore.ts:333-436` (`cancelLeave` and its doc comment)

**Interfaces:**
- Consumes: `AttendanceStatus.salaryCredit` from Task 6.

- [ ] **Step 1: Update the doc comment**

Replace the two comment paragraphs (~L333-346):

```ts
 *  - **Already-scored dates** are reverted to `Absent` — a PL/LWP day has zero
 *    punches by construction, so with the leave gone it is exactly the scorer's own
 *    `no leave → Absent` fallback.
 *
 * ...
 *
 * ⚠️ Only a **PL** day refunds `plBalance`. LWP is leave taken with a zero balance —
 * it never decremented anything, so refunding it would mint leave out of nothing.
```

with:

```ts
 *  - **Already-scored dates** are reverted to `Absent` — a SCHL day has zero
 *    punches by construction, so with the leave gone it is exactly the scorer's own
 *    `no leave → Absent` fallback.
 *
 * ...
 *
 * ⚠️ Only a SCHL day with **`salaryCredit === 1`** refunds `plBalance`. A `salaryCredit: 0`
 * SCHL day (or a USCHL day) never decremented anything, so refunding it would mint leave
 * out of nothing.
```

(Keep the surrounding lines — including the `⚠️ Rest days...` paragraph a few lines below, which references "no PL/LWP doc is ever written there going forward" — update that occurrence to "no SCHL/USCHL doc" too, and "a legacy PL/LWP doc sitting on a rest date" to "a legacy PL/LWP/SCHL/USCHL doc", since a doc from BEFORE this change could still be either.)

- [ ] **Step 2: Update the function body**

Replace (~L427-436):

```ts
    if (data.status === 'Sunday' || data.status === 'Holiday') return;
    const scoredAsLeave = data.status === 'PL' || data.status === 'LWP';
    if (!scoredAsLeave || data.markedBy !== 'auto') { skippedDates.push(date); return; }

    batch.set(
      statusRefs[i],
      stamped({ status: 'Absent', markedBy: 'admin', updatedAt: Timestamp.now() }),
      { merge: true },
    );
    if (data.status === 'PL') refundedDays += 1; // PL only — see the LWP note above
```

with:

```ts
    if (data.status === 'Sunday' || data.status === 'Holiday') return;
    const scoredAsLeave = data.status === 'SCHL';
    if (!scoredAsLeave || data.markedBy !== 'auto') { skippedDates.push(date); return; }

    batch.set(
      statusRefs[i],
      stamped({ status: 'Absent', markedBy: 'admin', updatedAt: Timestamp.now() }),
      { merge: true },
    );
    if (data.salaryCredit === 1) refundedDays += 1; // paid SCHL only — see the note above
```

(`USCHL` days are never in `stillGranted`'s covered range to begin with — they're not tied to a leave request — so `scoredAsLeave = false` already routes them to `skippedDates` correctly, same as any other non-leave status. No separate USCHL branch is needed.)

- [ ] **Step 3: Verify**

Run: `cd admin && npx tsc --noEmit 2>&1 | grep -i "firestore.ts"`
Expected: no type errors in this file.

- [ ] **Step 4: Commit**

```bash
cd admin
git add src/lib/firestore.ts
git commit -m "$(cat <<'EOF'
feat(admin): cancelLeave refunds plBalance via salaryCredit

scoredAsLeave now checks status === 'SCHL'; the plBalance refund
is gated on salaryCredit === 1 instead of the retired PL status.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Admin portal — Attendance page (legend, monthly counts, comments)

**Files:**
- Modify: `admin/src/app/(admin)/attendance/page.tsx` (~L96-116, ~L259, ~L446, ~L608)

**Interfaces:**
- Consumes: the `AttendanceStatus` type from Task 6.

- [ ] **Step 1: Update `deriveStatus`'s comment**

Around line 116, replace:

```ts
// PL/LWP always arrive via the stored doc the nightly run writes.)
```

with:

```ts
// SCHL/USCHL always arrive via the stored doc the nightly run writes.)
```

(No logic change — `deriveStatus` never invents a leave status live today, and that stays true.)

- [ ] **Step 2: Update the monthly leave-count filters**

Read the exact surrounding code at line 259 and line 446 first (`Read admin/src/app/\(admin\)/attendance/page.tsx` around those lines) — both currently match the pattern `s.status === 'PL' || s.status === 'LWP'` (line 259, inside a per-day summary) and `s === 'PL' || s === 'LWP'` (line 446, `totalLeave` computation). Replace each with the SCHL/USCHL equivalent, preserving the exact surrounding structure (variable names, `else if` chains, etc. — these are two different call sites, not a single shared helper, so edit both independently):

```ts
s.status === 'SCHL' || s.status === 'USCHL'
```

and

```ts
s === 'SCHL' || s === 'USCHL'
```

- [ ] **Step 3: Update the legend**

Around line 608-609, replace:

```ts
{ label: 'L = PL / LWP',     cls: 'bg-blue-100 text-blue-700' },
{ label: 'Holiday',           cls: 'bg-purple-100 text-purple-700' },
```

with:

```ts
{ label: 'L = SCHL / USCHL', cls: 'bg-blue-100 text-blue-700' },
{ label: 'Holiday',           cls: 'bg-purple-100 text-purple-700' },
```

(Only the label text changes — the `Holiday` entry is untouched, shown for context so the edit lands in the right spot.)

- [ ] **Step 4: Verify**

Run: `cd admin && npx tsc --noEmit 2>&1 | grep -i "attendance/page"`
Expected: no type errors in this file.

Run: `cd admin && grep -rn "'PL'\|\"PL\"\|'LWP'\|\"LWP\"" src/` (excluding this plan/spec doc)
Expected: no matches anywhere left in `admin/src` — this is the completeness check for the whole portal side.

- [ ] **Step 5: Commit**

```bash
cd admin
git add "src/app/(admin)/attendance/page.tsx"
git commit -m "$(cat <<'EOF'
feat(admin): SCHL/USCHL in the Attendance page legend and counts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Cloud Functions suite**

Run: `cd firebase/functions && node --check index.js && node --check attendanceRules.js && node --check payrollDeductions.js && npm test`
Expected: all PASS.

- [ ] **Step 2: Firestore rules-tests**

Run: `cd firebase/rules-tests && npm test`
Expected: all 110 PASS (no regression from the Task 5 comment edit).

- [ ] **Step 3: Admin build**

Run: `cd admin && npm run build`
Expected: succeeds (static export to `/out`) — this is the admin side's only automated check per repo convention (no test framework).

- [ ] **Step 4: Manual browser walkthrough**

Start the admin dev server and, using the Browser pane:
1. Open `/regularization` — confirm the outcome dropdown shows Present/HalfDay/Absent/USCHL/WO (no PL/LWP).
2. Open `/attendance` — confirm the legend reads "L = SCHL / USCHL" and a Holiday-marked day still renders as `Holiday`.
3. Open `/leaves` — confirm the page loads without console errors (cancelLeave's changed logic isn't directly visible without live data, but the page must render and the cancel-picker must open on an approved leave).

Run: `cd admin && npm run dev` (then drive via the Browser pane tools), or ask the user to confirm on staging if no seeded leave/regularization data exists locally.

- [ ] **Step 5: Report**

Summarize: which of Tasks 1-9 are committed, the full verification output, and explicitly call out that Android required no changes (verified in the design phase, not re-verified here since nothing in this plan touches Android).
