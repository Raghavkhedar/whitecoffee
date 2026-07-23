# Daily Spend Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a per-employee, per-day spend snapshot (salary, conveyance, PF, ESI, OT/WO, imprest + net total) to a new Firestore `dailySpend` collection, recomputed nightly for unlocked months and frozen once a month is Settled & Locked.

**Architecture:** A new pure module `dailySpend.js` holds the per-day decomposition math (Firestore-free, unit-tested). A per-date OT/WO helper is added to `otAggregate.js` and proven to sum to the existing monthly ledger. A new scheduled Cloud Function `snapshotDailySpend` orchestrates: it finalizes newly-locked months (recompute once, mark `frozen:true`) and recomputes the current + any still-unlocked prior months (`frozen:false`), writing one doc per employee per working day. A `dailySpend` rule denies all client writes and restricts reads to admin.

**Tech Stack:** Firebase Cloud Functions v2 (`onSchedule`), Node.js CommonJS, `node --test` (no new deps), Firestore Admin SDK, Firestore security rules + `@firebase/rules-unit-testing` emulator suite.

## Global Constraints

- **No new dependencies.** Validate with `node --check` + `npm test` in `firebase/functions/`; the eslint config is stale (do not lint).
- **UTC clock → IST dates.** Cloud functions run on UTC. Derive IST dates by shifting `+05:30` and reading `getUTC*` / `getUTCDay()`; never use bare `new Date()` / `getDay()` for an IST date.
- **Pure modules stay Firestore-free.** `dailySpend.js` and the new `otAggregate.js` helper take plain arrays/values, no `admin.firestore()`.
- **Rules are the only defence** (client SDK). Run `cd firebase/rules-tests && npm test` before and after any `firestore.rules` change.
- **Role capabilities route through the table.** Use `usesOtShortageLedger(role)` / `usesConveyance(role)` from `roleCapabilities.js`; never re-implement role branching inline.
- **Snapshot semantics:** one row = that day's incremental spend. `totalSpend = salary + conveyance + imprest + otWo − pf − esi` (mirrors Employee Dashboard TOTAL DUE). Sundays produce no row.
- **Deduction base is NOT floored per-day** (exact reconciliation): daily `pf/esi/imprest` base = that day's salary, which may be negative on an Absent day.

---

### Task 1: `dailySpend.js` — attendance weight & daily salary

**Files:**
- Create: `firebase/functions/dailySpend.js`
- Test: `firebase/functions/dailySpend.test.js`

**Interfaces:**
- Produces: `dayWeight(status: string) → number`; `dailySalary(salaryRate: number, status: string) → number` (rounded to 2dp); `round2(n) → number`.

- [ ] **Step 1: Write the failing test**

```js
// firebase/functions/dailySpend.test.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dayWeight, dailySalary } = require("./dailySpend");

test("dayWeight: each status maps to its payroll multiplier", () => {
  assert.equal(dayWeight("Present"), 1);
  assert.equal(dayWeight("SL"), 0.75);
  assert.equal(dayWeight("HalfDay"), 0.5);
  assert.equal(dayWeight("LNF"), 0.5);
  assert.equal(dayWeight("SLNF"), 0.5);
  assert.equal(dayWeight("PL"), 1);
  assert.equal(dayWeight("LWP"), 0);
  assert.equal(dayWeight("Absent"), -2);
  assert.equal(dayWeight("Unknown"), 0); // unmapped → 0
});

test("dailySalary: rate × weight, negative on an Absent day", () => {
  assert.equal(dailySalary(1000, "Present"), 1000);
  assert.equal(dailySalary(1000, "SL"), 750);
  assert.equal(dailySalary(1000, "Absent"), -2000);
  assert.equal(dailySalary(0, "Present"), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test dailySpend.test.js`
Expected: FAIL — `Cannot find module './dailySpend'`.

- [ ] **Step 3: Write minimal implementation**

```js
// firebase/functions/dailySpend.js
"use strict";

// Pure per-day spend decomposition for the Daily Spend Snapshot. Firestore-free so it can be
// unit-tested via `npm test`. See docs/superpowers/specs/2026-07-24-daily-spend-snapshot-design.md.

// Attendance-status → payroll multiplier. Mirrors the MTD `daysNP` weights in index.js:
// Present ×1, SL ×0.75, HalfDay/LNF/SLNF ×0.5, PL ×1, LWP ×0, Absent ×−2 (the −2 penalty).
const STATUS_WEIGHT = {
  Present: 1, SL: 0.75, HalfDay: 0.5, LNF: 0.5, SLNF: 0.5, PL: 1, LWP: 0, Absent: -2,
};

function round2(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

function dayWeight(status) {
  return STATUS_WEIGHT[status] ?? 0;
}

function dailySalary(salaryRate, status) {
  return round2((Number(salaryRate) || 0) * dayWeight(status));
}

module.exports = { round2, dayWeight, dailySalary };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test dailySpend.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/dailySpend.js firebase/functions/dailySpend.test.js
git commit -m "feat(functions): dailySpend dayWeight + dailySalary helpers"
```

---

### Task 2: `dailySpend.js` — per-day deductions (no floor) & total

**Files:**
- Modify: `firebase/functions/dailySpend.js`
- Test: `firebase/functions/dailySpend.test.js`

**Interfaces:**
- Consumes: `round2` (Task 1).
- Produces:
  - `dailyDeductions({ salary, pfPercent, esiPercent, imprestPercent, efficiency }) → { pf, esi, imprest }` — each = `percent% × salary` (imprest also × efficiency), rounded 2dp, **no `max(0, …)` floor**. Missing percent → 0; missing efficiency → 1; explicit 0 efficiency honoured.
  - `dailyTotal({ salary, conveyance, imprest, otWo, pf, esi }) → number` = `salary + conveyance + imprest + otWo − pf − esi`, 2dp.

- [ ] **Step 1: Write the failing test**

```js
// append to firebase/functions/dailySpend.test.js
const { dailyDeductions, dailyTotal } = require("./dailySpend");

test("dailyDeductions: flat % of the day's salary, no floor", () => {
  const d = dailyDeductions({ salary: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 });
  assert.equal(d.pf, 120);
  assert.equal(d.esi, 7.5);
  assert.equal(d.imprest, 50);
});

test("dailyDeductions: negative salary yields negative components (exact reconciliation)", () => {
  const d = dailyDeductions({ salary: -2000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 });
  assert.equal(d.pf, -240);
  assert.equal(d.esi, -15);
  assert.equal(d.imprest, -100);
});

test("dailyDeductions: missing percents → 0; missing efficiency → 1; explicit 0 honoured", () => {
  assert.deepEqual(dailyDeductions({ salary: 1000 }), { pf: 0, esi: 0, imprest: 0 });
  assert.equal(dailyDeductions({ salary: 1000, imprestPercent: 5 }).imprest, 50); // eff defaults 1
  assert.equal(dailyDeductions({ salary: 1000, imprestPercent: 5, efficiency: 0 }).imprest, 0);
});

test("dailyTotal: mirrors TOTAL DUE (salary + covy + imprest + otWo − pf − esi)", () => {
  assert.equal(dailyTotal({ salary: 1000, conveyance: 120, imprest: 50, otWo: 300, pf: 120, esi: 7.5 }), 1342.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test dailySpend.test.js`
Expected: FAIL — `dailyDeductions is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// firebase/functions/dailySpend.js — add above module.exports

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Missing efficiency → 1 (matrix not built yet, see payrollDeductions.js); explicit 0 honoured.
function resolveEfficiency(v) {
  if (v === null || v === undefined || v === "") return 1;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

// PF/ESI/Imprest as flat percentages of the DAY's salary. Deliberately NOT floored at 0
// (unlike the monthly computeDeductions): a negative Absent-day salary yields negative
// components so the daily rows sum exactly to the monthly figure when monthly salary ≥ 0.
function dailyDeductions({ salary, pfPercent, esiPercent, imprestPercent, efficiency } = {}) {
  const base = toNum(salary);
  return {
    pf:      round2(base * toNum(pfPercent) / 100),
    esi:     round2(base * toNum(esiPercent) / 100),
    imprest: round2(base * toNum(imprestPercent) / 100 * resolveEfficiency(efficiency)),
  };
}

function dailyTotal({ salary, conveyance, imprest, otWo, pf, esi } = {}) {
  return round2(toNum(salary) + toNum(conveyance) + toNum(imprest) + toNum(otWo) - toNum(pf) - toNum(esi));
}
```

Update the exports line:

```js
module.exports = { round2, dayWeight, dailySalary, dailyDeductions, dailyTotal };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test dailySpend.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/dailySpend.js firebase/functions/dailySpend.test.js
git commit -m "feat(functions): dailySpend per-day deductions (no floor) + total"
```

---

### Task 3: `dailySpend.js` — month arithmetic & open recompute window

**Files:**
- Modify: `firebase/functions/dailySpend.js`
- Test: `firebase/functions/dailySpend.test.js`

**Interfaces:**
- Produces:
  - `addMonths(monthKey: "YYYY-MM", delta: number) → "YYYY-MM"`.
  - `openWindowMonths(currentKey: "YYYY-MM", lockedSet: Set<string>, cap = 3) → string[]` — the current month plus consecutive *unlocked* prior months walking back, stopping at the first locked month or after `cap` priors. Sorted ascending. Current month is always included even if (erroneously) present in `lockedSet`.

- [ ] **Step 1: Write the failing test**

```js
// append to firebase/functions/dailySpend.test.js
const { addMonths, openWindowMonths } = require("./dailySpend");

test("addMonths: rolls year boundaries both directions", () => {
  assert.equal(addMonths("2026-07", -1), "2026-06");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("openWindowMonths: steady state = current month only", () => {
  const locked = new Set(["2026-06", "2026-05"]);
  assert.deepEqual(openWindowMonths("2026-07", locked), ["2026-07"]);
});

test("openWindowMonths: a lagging unlocked prior month is included", () => {
  const locked = new Set(["2026-05"]); // June not yet settled
  assert.deepEqual(openWindowMonths("2026-07", locked), ["2026-06", "2026-07"]);
});

test("openWindowMonths: stops at cap even if priors stay unlocked", () => {
  const locked = new Set(); // nothing locked
  assert.deepEqual(openWindowMonths("2026-07", locked, 2), ["2026-05", "2026-06", "2026-07"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test dailySpend.test.js`
Expected: FAIL — `addMonths is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// firebase/functions/dailySpend.js — add above module.exports

function addMonths(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const idx = (y * 12 + (m - 1)) + delta;      // month index since year 0
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

// Months to recompute each run: current month + consecutive unlocked priors (walking back),
// stopping at the first locked month or after `cap` priors. Ascending order.
function openWindowMonths(currentKey, lockedSet, cap = 3) {
  const months = [currentKey];
  for (let i = 1; i <= cap; i++) {
    const prev = addMonths(currentKey, -i);
    if (lockedSet.has(prev)) break;
    months.push(prev);
  }
  return months.sort();
}
```

Update exports:

```js
module.exports = { round2, dayWeight, dailySalary, dailyDeductions, dailyTotal, addMonths, openWindowMonths };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test dailySpend.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/dailySpend.js firebase/functions/dailySpend.test.js
git commit -m "feat(functions): dailySpend month arithmetic + open recompute window"
```

---

### Task 4: `otAggregate.js` — per-date OT/WO cash (reconciles to monthly)

**Files:**
- Modify: `firebase/functions/otAggregate.js`
- Test: `firebase/functions/otAggregate.test.js`

**Interfaces:**
- Consumes: `computeRangeLedger`, `settlementCash` (existing).
- Produces: `dailyOtWoCash(userId, salaryRate, events, planned, approvals, statuses, holidays) → Map<dateStr, number>` — each date's OT/WO rupees, **unrounded** (the caller rounds). The sum over all dates equals `settlementCash(salaryRate, woDates.length, netMins)` from `computeRangeLedger` on the same inputs.

- [ ] **Step 1: Write the failing test**

```js
// append to firebase/functions/otAggregate.test.js
const { dailyOtWoCash } = require("./otAggregate");

test("dailyOtWoCash: per-date values sum to the monthly settlementCash exactly", () => {
  const rate = 1000; // ₹/day → ₹/min = 1000/480
  // Day 1 (Mon): shift 10–18, worked 10–19 with declared 60 → 60 auto OT.
  // Day 2 (Tue): worked 10–17 → 60 shortage (left early).
  // Day 3 (Sun): rest day, otAuthorized, worked 10–14 → 240 rest-day OT.
  // Day 4 (Wed): WO status, unworked → nets to 0.
  const planned = [
    { userId: U, date: "2026-06-01", startTime: "10:00", endTime: "18:00", declaredOtMins: 60 },
    { userId: U, date: "2026-06-02", startTime: "10:00", endTime: "18:00", declaredOtMins: 0 },
    { userId: U, date: "2026-06-07", startTime: "10:00", endTime: "18:00", declaredOtMins: 0, otAuthorized: true },
  ];
  const events = [
    ev(U, "2026-06-01", "site_in", "10:00"), ev(U, "2026-06-01", "site_out", "19:00"),
    ev(U, "2026-06-02", "site_in", "10:00"), ev(U, "2026-06-02", "site_out", "17:00"),
    ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "14:00"),
  ];
  const statuses = [{ userId: U, date: "2026-06-04", status: "WO" }];

  const cash = dailyOtWoCash(U, rate, events, planned, [], statuses, noHol);
  const sum = [...cash.values()].reduce((s, v) => s + v, 0);

  const led = computeRangeLedger(U, events, planned, [], statuses, noHol);
  const monthly = settlementCash(rate, led.woDates.length, led.netMins);

  assert.equal(Math.round(sum * 100) / 100, monthly);
});

test("dailyOtWoCash: a shortage-only day is negative", () => {
  const planned = [{ userId: U, date: "2026-06-02", startTime: "10:00", endTime: "18:00", declaredOtMins: 0 }];
  const events = [ev(U, "2026-06-02", "site_in", "10:00"), ev(U, "2026-06-02", "site_out", "17:00")];
  const cash = dailyOtWoCash(U, 480, events, planned, [], [], noHol); // rate 480 → ₹1/min
  assert.equal(cash.get("2026-06-02"), -60); // 60 min shortage × ₹1/min
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test otAggregate.test.js`
Expected: FAIL — `dailyOtWoCash is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// firebase/functions/otAggregate.js — add before module.exports

// Per-date OT/WO cash for one ops employee. Mirrors computeRangeLedger's accrual but emits each
// date's rupees instead of summing, so a daily snapshot can freeze per day. Returns UNROUNDED
// values (caller rounds); their sum equals settlementCash(rate, woDates.length, netMins) exactly.
function dailyOtWoCash(userId, salaryRate, events, planned, approvals, statuses, holidays) {
  const rate = Number(salaryRate) || 0;

  const plannedByDate = new Map();
  const otAuthByDate = new Set();
  planned.filter((p) => p.userId === userId).forEach((p) => {
    const startMin = hhmmToMin(p.startTime), endMin = hhmmToMin(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins || 0) });
    if (p.otAuthorized) otAuthByDate.add(p.date);
  });

  const eventsByDate = new Map();
  events.filter((e) => e.userId === userId).forEach((e) => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date).push(e);
  });

  const apprByDate = new Map();
  approvals.filter((a) => a.userId === userId).forEach((a) => apprByDate.set(a.date, a));

  const overrideByDate = new Map();
  statuses.filter((s) => s.userId === userId && s.status === "Present" && s.inTime && s.outTime).forEach((s) => {
    const inMin = hhmmToMin(s.inTime), outMin = hhmmToMin(s.outTime);
    if (outMin > inMin) overrideByDate.set(s.date, { inMin, outMin });
  });

  const woByDate = new Set(
    statuses.filter((s) => s.userId === userId && s.status === "WO").map((s) => s.date),
  );

  const perDate = new Map(); // date → { autoOtMins, restDayOtMins, shortageMins }
  const ensure = (d) => {
    if (!perDate.has(d)) perDate.set(d, { autoOtMins: 0, restDayOtMins: 0, shortageMins: 0 });
    return perDate.get(d);
  };
  const accrueDay = (date, inMin, outMin) => {
    const info = plannedByDate.get(date);
    const led = computeDayLedger({
      shiftStartMin: info ? info.startMin : DEFAULT_SHIFT_START_MIN,
      shiftEndMin:   info ? info.endMin   : DEFAULT_SHIFT_END_MIN,
      inMin, outMin,
      declaredOtMins: info ? info.declared : 0,
      isRestDay: isSunday(date) || holidays.has(date),
      otAuthorized: otAuthByDate.has(date),
    });
    const acc = ensure(date);
    acc.shortageMins  += led.shortageMins;
    acc.autoOtMins    += led.autoOtMins;
    acc.restDayOtMins += led.restDayOtMins;
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return; // regularization in/out is authoritative
    const ins  = dayEvents.filter((e) => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter((e) => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return;
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });
  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  // Union of every date carrying a contribution: worked/override, approval, or WO.
  const dates = new Set([...perDate.keys(), ...apprByDate.keys(), ...woByDate]);
  const cash = new Map();
  dates.forEach((date) => {
    const p = perDate.get(date) || { autoOtMins: 0, restDayOtMins: 0, shortageMins: 0 };
    const granted = Number((apprByDate.get(date) || {}).approvedMins) || 0;
    const isWO = woByDate.has(date);
    const woDebit = isWO ? WO_DEBIT_MINS : 0;
    const netMins = p.autoOtMins + p.restDayOtMins + granted - p.shortageMins - woDebit;
    cash.set(date, (isWO ? rate : 0) + (netMins / WO_DEBIT_MINS) * rate);
  });
  return cash;
}
```

Update the exports at the bottom of `otAggregate.js` to include `dailyOtWoCash`:

```js
module.exports = { computeRangeLedger, settlementCash, dailyOtWoCash };
```

(Keep any other names already exported — add `dailyOtWoCash` to the existing list rather than replacing it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test otAggregate.test.js`
Expected: PASS (all existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/otAggregate.js firebase/functions/otAggregate.test.js
git commit -m "feat(functions): per-date OT/WO cash helper reconciling to monthly ledger"
```

---

### Task 5: `snapshotDailySpend` scheduled function

**Files:**
- Modify: `firebase/functions/index.js` (add a new `exports.snapshotDailySpend` at the end, after `exports.regularizationReminder`)

**Interfaces:**
- Consumes: `dailySalary`, `dailyDeductions`, `dailyTotal`, `round2`, `addMonths`, `openWindowMonths` (`dailySpend.js`); `dailyOtWoCash` (`otAggregate.js`); `usesConveyance`, `usesOtShortageLedger` (`roleCapabilities.js`); `withPay` (`compensation.js`).
- Produces: `dailySpend/{uid}__{YYYY-MM-DD}` documents (schema in the spec).

- [ ] **Step 1: Add the requires**

At the top of `firebase/functions/index.js`, alongside the existing `require`s, add:

```js
const { dailySalary, dailyDeductions, dailyTotal, round2, openWindowMonths } = require("./dailySpend");
const { dailyOtWoCash } = require("./otAggregate");
```

If `roleCapabilities` / `compensation` are not already required at module scope, confirm how the existing code imports `usesConveyance` / `usesOtShortageLedger` / `withPay` (search the file) and reuse that same import.

- [ ] **Step 2: Add the scheduled function**

Append to `firebase/functions/index.js`:

```js
// ── Daily Spend Snapshot ────────────────────────────────────────────────
// One dailySpend/{uid}__{date} doc per employee per working day. Runs after
// computeDailyAttendanceStatus so statuses are final. Recomputes the current + any still-unlocked
// prior months (frozen:false); finalizes a newly-locked month once (recompute + frozen:true) then
// never rewrites it. See docs/superpowers/specs/2026-07-24-daily-spend-snapshot-design.md.
exports.snapshotDailySpend = onSchedule(
  { schedule: "30 22 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300, memory: "512MiB" },
  async () => {
    const db = admin.firestore();

    // IST date components (UTC clock → shift +05:30, read getUTC*).
    const nowIST   = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const istYear  = nowIST.getUTCFullYear();
    const istMonth = nowIST.getUTCMonth(); // 0-based
    const istDay   = nowIST.getUTCDate();
    const pad2 = (n) => String(n).padStart(2, "0");
    const currentKey = `${istYear}-${pad2(istMonth + 1)}`;
    const today = `${istYear}-${pad2(istMonth + 1)}-${pad2(istDay)}`;

    // Users + pay (same pattern as exportToSheets).
    const allUsersSnap = await db.collection("users").get();
    const compSnap = await db.collectionGroup("compensation").get();
    const compById = new Map();
    compSnap.docs.forEach((d) => { compById.set(d.ref.parent.parent.id, d.data()); });
    const users = allUsersSnap.docs.map((d) => withPay({ id: d.id, ...d.data() }, compById.get(d.id)));

    // Locked months (company-wide freeze signal): any settlement doc with locked == true.
    const settleSnap = await db.collectionGroup("settlements").where("locked", "==", true).get();
    const lockedSet = new Set(settleSnap.docs.map((d) => d.id)); // settlement doc id === "YYYY-MM"

    // Months to recompute this run, and the earliest for range-scoped source loads.
    const windowMonths = openWindowMonths(currentKey, lockedSet);
    const earliest = windowMonths[0];
    const rangeStart = `${earliest}-01`;

    // Per-day sources scoped to [rangeStart, today].
    const inRange = (d) => d.date >= rangeStart && d.date <= today;
    const uidOf = (doc) => doc.ref.parent.parent.id;

    const statusDocs = (await db.collectionGroup("attendance_status").get()).docs
      .map((doc) => ({ ...doc.data(), userId: doc.data().userId })).filter(inRange);
    const eventDocs = (await db.collectionGroup("attendance").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);
    const plannedDocs = (await db.collectionGroup("planned_hours").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);
    const approvalDocs = (await db.collectionGroup("ot_approvals").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);

    const holidaySnap = await db.collection("holidays")
      .where("date", ">=", rangeStart).where("date", "<=", today).get();
    const holidaySet = new Set(holidaySnap.docs.map((h) => h.id));

    const convSnap = await db.collection("conveyance")
      .where("date", ">=", rangeStart).where("date", "<=", today).get();
    const convByKey = new Map(); // `${uid}__${date}` → ₹
    convSnap.docs.forEach((d) => { const c = d.data(); convByKey.set(`${c.userId}__${c.date}`, Number(c.conveyance) || 0); });

    // Statuses grouped by user for salary; the ledger helper filters internally.
    const statusesByUser = new Map();
    statusDocs.forEach((s) => {
      if (!statusesByUser.has(s.userId)) statusesByUser.set(s.userId, []);
      statusesByUser.get(s.userId).push(s);
    });

    const monthOf = (dateStr) => dateStr.slice(0, 7);
    const isSunday = (dateStr) => new Date(dateStr + "T00:00:00Z").getUTCDay() === 0;

    let batch = db.batch();
    let ops = 0;
    const commitIfFull = async () => { if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; } };

    for (const user of users) {
      const rate = user.salaryRate || 0;
      const otMap = usesOtShortageLedger(user.role)
        ? dailyOtWoCash(user.id, rate, eventDocs, plannedDocs, approvalDocs, statusesByUser.get(user.id) || [], holidaySet)
        : new Map();

      for (const s of (statusesByUser.get(user.id) || [])) {
        if (isSunday(s.date)) continue;               // no row for Sundays
        if (!windowMonths.includes(monthOf(s.date))) continue; // locked month → never rewritten

        const salary = dailySalary(rate, s.status);
        const conveyance = usesConveyance(user.role) ? (convByKey.get(`${user.id}__${s.date}`) || 0) : 0;
        const otWo = round2(otMap.get(s.date) || 0);
        const { pf, esi, imprest } = dailyDeductions({
          salary, pfPercent: user.pfPercent, esiPercent: user.esiPercent, imprestPercent: user.imprestPercent,
        });
        const totalSpend = dailyTotal({ salary, conveyance, imprest, otWo, pf, esi });

        batch.set(db.collection("dailySpend").doc(`${user.id}__${s.date}`), {
          userId: user.id, employeeId: user.employeeId || "", name: user.name || "", role: user.role || "",
          date: s.date, month: monthOf(s.date),
          salary, conveyance, pf, esi, otWo, imprest, totalSpend,
          frozen: false,
          computedAt: admin.firestore.Timestamp.now(),
        }, { merge: false });
        ops++;
        await commitIfFull();
      }
    }
    if (ops > 0) await batch.commit();
    console.log(`dailySpend: recomputed months [${windowMonths.join(", ")}] up to ${today}`);
  },
);
```

> **Freeze finalization (`frozen:true`):** the recompute pass above only writes unlocked months, so locked-month rows keep the `frozen:false` from their last unlocked run. Implement the finalize pass as follows and place it right before the recompute loop. For each locked month `M` that appears in `lockedSet` and is `addMonths(currentKey, -1)` or `addMonths(currentKey, -2)` (the recently-closed window), query `db.collection("dailySpend").where("month", "==", M).where("frozen", "==", false).limit(1).get()`; if non-empty, page through `where("month", "==", M)` in batches and `update({ frozen: true })` on each doc **without recomputing values** — this relabels the already-final rows exactly once (subsequent runs find no `frozen == false` docs and skip). This needs a composite index on `(month asc, frozen asc)`; create it in Task 6.

Verify against the file: confirm the actual names used for `withPay`, the compensation attach pattern, and `usesConveyance`/`usesOtShortageLedger` imports match how `exportToSheets` does it (lines ~438–451, ~1015–1020). Adjust the `compById`/`withPay` wiring to match the existing helper's exact signature.

- [ ] **Step 3: Validate syntax and the whole suite**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` prints nothing (valid); `npm test` passes (all suites including the new `dailySpend.test.js` and `otAggregate.test.js` additions).

- [ ] **Step 4: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): snapshotDailySpend scheduled function"
```

---

### Task 6: Firestore rule + composite index for `dailySpend`

**Files:**
- Modify: `firebase/firestore.rules`
- Modify: `firebase/firestore.indexes.json` (add the `(month, frozen)` composite index)
- Test: `firebase/rules-tests/` (add a `dailySpend` case to the existing suite)

**Interfaces:**
- Produces: client reads to `dailySpend` allowed only for admin; all client writes denied. Server (Admin SDK) bypasses rules.

- [ ] **Step 1: Write the failing rules test**

Locate the existing rules-test file (e.g. `firebase/rules-tests/*.test.js`) and add, following its existing helpers for authed contexts:

```js
// in the rules-tests suite (match the file's existing style/imports)
test("dailySpend: admin can read, non-admin cannot, nobody can write", async () => {
  const admin = authed({ role: "admin" });        // use the suite's existing context helper
  const office = authed({ role: "office" });
  const ref = "dailySpend/u1__2026-07-24";

  await assertSucceeds(getDoc(doc(admin.firestore(), ref)));
  await assertFails(getDoc(doc(office.firestore(), ref)));
  await assertFails(setDoc(doc(admin.firestore(), ref), { salary: 1 })); // even admin cannot write via client
});
```

Match the suite's actual import names (`assertSucceeds` / `assertFails` / context factory). If a seeded doc is required for the read to resolve, seed `dailySpend/u1__2026-07-24` via the admin/bypass context the suite already uses for setup.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd firebase/rules-tests && npm test`
Expected: FAIL — reads/writes not yet governed (default-deny may make the admin read fail, or an over-broad rule may let the write succeed).

- [ ] **Step 3: Add the rule**

In `firebase/firestore.rules`, add a top-level match block (mirror the `conveyance` block's placement, inside `match /databases/{database}/documents`):

```
    // Daily spend snapshot — authored only by the Cloud Function (Admin SDK bypasses rules).
    // No client writes; reads are admin-only.
    match /dailySpend/{docId} {
      allow read:  if isLoggedIn() && isAdmin();
      allow write: if false;
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd firebase/rules-tests && npm test`
Expected: PASS (all 63 existing + the new case).

- [ ] **Step 5: Add the composite index**

In `firebase/firestore.indexes.json`, add to the `indexes` array (match the file's existing entry shape):

```json
{
  "collectionGroup": "dailySpend",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "month", "order": "ASCENDING" },
    { "fieldPath": "frozen", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 6: Commit**

```bash
git add firebase/firestore.rules firebase/firestore.indexes.json firebase/rules-tests
git commit -m "feat(rules): dailySpend read-admin/deny-write + (month,frozen) index"
```

---

## Deployment (after all tasks pass review)

```bash
node --check firebase/functions/index.js
cd firebase/functions && npm test
cd ../rules-tests && npm test
# from repo root:
firebase deploy --only functions:snapshotDailySpend,firestore:rules,firestore:indexes
```

Deploy the function/rules/indexes together. The first nightly run backfills the current month; a month already Settled & Locked before deploy is treated as frozen and is never backfilled (expected — no re-opening of closed periods).

---

## Self-Review

**Spec coverage:**
- Purpose / daily decomposition → Tasks 1–4. ✅
- Snapshot semantics + `totalSpend` = TOTAL DUE → Task 2 (`dailyTotal`), Task 5 (assembly). ✅
- All-roles coverage; OT/WO 0 for non-ledger, conveyance 0 for non-conveyance → Task 5 (`usesOtShortageLedger`/`usesConveyance` guards). ✅
- Freeze on Settle & Lock; unlocked-window recompute; no data loss → Task 3 (`openWindowMonths`) + Task 5 (window skip + finalize pass). ✅
- Data model / `dailySpend/{uid}__{date}` schema → Task 5. ✅
- Per-day computation (weights, no-floor deductions, per-date OT reconciliation) → Tasks 1, 2, 4. ✅
- Nightly, not real-time → Task 5 (`onSchedule`). ✅
- Rules (deny client write, admin read) → Task 6. ✅
- Testing (`node --test`, reconciliation, rules emulator) → Tasks 1–4 (`npm test`), Task 6 (rules-tests). ✅

**Placeholder scan:** No TBD/TODO. The one instruction requiring the implementer to confirm existing import shapes (`withPay`/compensation attach in Task 5) is a verification step against named line ranges, not a placeholder — the reference implementation is shown in full.

**Type consistency:** `dailySalary`/`dailyDeductions`/`dailyTotal`/`round2`/`openWindowMonths`/`addMonths` (from `dailySpend.js`) and `dailyOtWoCash` (from `otAggregate.js`) are named identically in their defining task and every consuming task. `dailyDeductions` takes `{ salary, … }` (not `dailySalary`) consistently in Tasks 2 and 5. `otWo` is the doc field; `dailyOtWoCash` returns a `Map<date, ₹>` consumed as `otMap.get(date)` in Task 5.
