# Live "OT/WO amount" Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Employee Dashboard tab's locked-only `Settlement` column with a live, nightly-recomputed **`OT/WO amount (₹)`** showing each ops employee's authorized OT net of shortage/WO.

**Architecture:** Port the admin portal's already-tested pure ledger math (`otLedger.ts`, `otAggregate.ts`) to two CommonJS modules under `firebase/functions/`, unit-tested with `node --test`. `index.js` calls them to build an `otWoAmountByUserId` map and feeds it into the Employee Dashboard section (§9) in place of the locked-settlement read. As a side cleanup, the inline `computeDayLedger` duplicated in `index.js` is removed in favour of the new shared module.

**Tech Stack:** Node.js CommonJS, Firebase Cloud Functions, `node:test` + `node:assert/strict` (no extra deps), Google Sheets API.

## Global Constraints

- Cloud functions run on a **UTC** clock. Derive an IST weekday with `new Date(date + "T00:00:00Z").getUTCDay()` (0 = Sunday); never bare `new Date()`/`getDay()`. (repo CLAUDE.md)
- Validate JS with `node --check <file>` + `npm test`; **do not** run eslint (config is stale, parse-errors on modern JS). (repo CLAUDE.md)
- All ledger values are **minutes**; money rounds to 2dp.
- `WO_DEBIT_MINS = 480`, `DEFAULT_SHIFT_START_MIN = 600` (10:00), `DEFAULT_SHIFT_END_MIN = 1080` (18:00).
- Authorized OT only: `net = (autoOt + restDayOt + grantedOt) − shortage − woDebit`; pending/unauthorized excluded.
- `settlementCash = woDays × rate + (netMins ÷ 480) × rate`, signed.
- Column header: exactly `OT/WO amount (₹)`.
- Non-ledger roles (`!usesOtShortageLedger(role)`) show `0`.
- All work in `firebase/functions/`; deploy is `firebase deploy --only functions` from repo root.

---

### Task 1: Pure per-day ledger module (`otLedger.js`)

Port `admin/src/lib/otLedger.ts` to CommonJS. Adds `shortageMins` to the returned shape (the inline copy in `index.js` omits it).

**Files:**
- Create: `firebase/functions/otLedger.js`
- Test: `firebase/functions/otLedger.test.js`

**Interfaces:**
- Produces:
  - `computeDayLedger({ shiftStartMin, shiftEndMin, inMin, outMin, declaredOtMins, isRestDay, otAuthorized }) → { shortageMins, autoOtMins, pendingExtraMins, restDayOtMins, unauthorizedRestDay }`
  - `netLedgerMins({ autoOtMins, restDayOtMins, approvedGrantedMins, shortageMins, woDebitMins }) → number`
  - `istMinuteOfDay(epochSecs) → number` (0–1439)
  - constants `WO_DEBIT_MINS`, `DEFAULT_SHIFT_START_MIN`, `DEFAULT_SHIFT_END_MIN`

- [ ] **Step 1: Write the failing test**

Create `firebase/functions/otLedger.test.js`:

```js
"use strict";

// Boundary suite for the pure per-day OT/shortage/WO ledger math.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDayLedger, netLedgerMins, istMinuteOfDay,
  WO_DEBIT_MINS, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");

const shift = { shiftStartMin: 600, shiftEndMin: 1080, declaredOtMins: 0, isRestDay: false, otAuthorized: false };

test("constants", () => {
  assert.equal(WO_DEBIT_MINS, 480);
  assert.equal(DEFAULT_SHIFT_START_MIN, 600);
  assert.equal(DEFAULT_SHIFT_END_MIN, 1080);
});

test("late-out earns OT, split by declared", () => {
  // in 10:00 (600), out 19:00 (1140): 60 OT; declared 30 → auto 30, pending 30
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 1140, declaredOtMins: 30 });
  assert.equal(led.autoOtMins, 30);
  assert.equal(led.pendingExtraMins, 30);
  assert.equal(led.shortageMins, 0);
});

test("early-in earns nothing; early-out is shortage", () => {
  // in 09:50 (590) → early-in ignored; out 17:56 (1076) → 4 shortage
  const led = computeDayLedger({ ...shift, inMin: 590, outMin: 1076 });
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 4);
});

test("late-in and early-out both accrue shortage", () => {
  // in 10:30 (630) → 30 late; out 17:00 (1020) → 60 early = 90 shortage
  const led = computeDayLedger({ ...shift, inMin: 630, outMin: 1020 });
  assert.equal(led.shortageMins, 90);
  assert.equal(led.autoOtMins, 0);
});

test("authorized rest day: all worked minutes are OT", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 900, isRestDay: true, otAuthorized: true });
  assert.equal(led.restDayOtMins, 300);
  assert.equal(led.unauthorizedRestDay, false);
  assert.equal(led.shortageMins, 0);
});

test("unauthorized rest day: 0 OT, flagged", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 900, isRestDay: true, otAuthorized: false });
  assert.equal(led.restDayOtMins, 0);
  assert.equal(led.unauthorizedRestDay, true);
});

test("no valid shift (end <= start) and not rest day: nothing accrues", () => {
  const led = computeDayLedger({ ...shift, shiftStartMin: 600, shiftEndMin: 600, inMin: 600, outMin: 1140 });
  assert.equal(led.autoOtMins, 0);
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 0);
});

test("netLedgerMins nets approved OT minus shortage minus WO debit", () => {
  assert.equal(netLedgerMins({ autoOtMins: 30, restDayOtMins: 0, approvedGrantedMins: 30, shortageMins: 0, woDebitMins: 0 }), 60);
  assert.equal(netLedgerMins({ autoOtMins: 0, restDayOtMins: 0, approvedGrantedMins: 0, shortageMins: 0, woDebitMins: 480 }), -480);
  assert.equal(netLedgerMins({ autoOtMins: 0, restDayOtMins: 300, approvedGrantedMins: 0, shortageMins: 0, woDebitMins: 480 }), -180);
});

test("istMinuteOfDay converts epoch seconds to IST minute-of-day", () => {
  // 2026-06-01 10:00:00 +05:30
  const secs = Math.floor(new Date("2026-06-01T10:00:00+05:30").getTime() / 1000);
  assert.equal(istMinuteOfDay(secs), 600);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && npm test`
Expected: FAIL — `Cannot find module './otLedger'`.

- [ ] **Step 3: Write the implementation**

Create `firebase/functions/otLedger.js`:

```js
"use strict";

// Pure OT / shortage / WO ledger math — CommonJS port of admin/src/lib/otLedger.ts.
// The single per-day source of truth for the Sheets export. All values are MINUTES.
// Pure (no Firestore) so it can be unit-tested via `npm test`.

const WO_DEBIT_MINS = 8 * 60; // a WO (paid no-work day off) owes a standard 8h

// Default operations shift (10:00–18:00) used when no valid plan exists for a worked day.
const DEFAULT_SHIFT_START_MIN = 10 * 60; // 600
const DEFAULT_SHIFT_END_MIN   = 18 * 60; // 1080

// Epoch seconds → IST (UTC+5:30, no DST) minute-of-day in [0, 1439].
function istMinuteOfDay(epochSecs) {
  const IST_OFFSET = 5.5 * 3600;
  return Math.floor(((((epochSecs + IST_OFFSET) % 86400) + 86400) % 86400) / 60);
}

const ZERO = {
  shortageMins: 0, autoOtMins: 0, pendingExtraMins: 0, restDayOtMins: 0, unauthorizedRestDay: false,
};

// Per-day ledger for one operations worked day (both check-in and check-out present).
// Each shift edge is scored against the plain window and edges never cancel:
//   • in before shift start → nothing (early-in NEVER earns OT); after → shortage (late-in)
//   • out after shift end   → OT (late-out); before → shortage (early-out)
// Declared OT is a pre-approval CEILING on that OT (auto up to declared, beyond is pending).
function computeDayLedger({ shiftStartMin, shiftEndMin, inMin, outMin, declaredOtMins, isRestDay, otAuthorized }) {
  const worked = Math.max(0, outMin - inMin);

  if (isRestDay) {
    // Sunday/holiday: every worked minute is OT, but only when admin-authorized.
    if (otAuthorized) return { ...ZERO, restDayOtMins: worked };
    return { ...ZERO, unauthorizedRestDay: true };
  }

  if (shiftEndMin > shiftStartMin) {
    const lateIn   = Math.max(0, inMin - shiftStartMin);   // came late → shortage
    const earlyOut = Math.max(0, shiftEndMin - outMin);    // left early → shortage
    const otEarned = Math.max(0, outMin - shiftEndMin);    // left late → OT (early-in earns nothing)
    const declared = Math.max(0, declaredOtMins || 0);
    return {
      ...ZERO,
      shortageMins: lateIn + earlyOut,
      autoOtMins: Math.min(otEarned, declared),
      pendingExtraMins: Math.max(0, otEarned - declared),
    };
  }

  // No shift and not a rest day → nothing accrues.
  return { ...ZERO };
}

// Monthly/range net: approved OT (auto + rest-day + granted) minus shortage minus WO debit.
// Pending (un-approved) OT is intentionally excluded — not credited until approved.
function netLedgerMins(p) {
  return (p.autoOtMins + p.restDayOtMins + p.approvedGrantedMins) - p.shortageMins - p.woDebitMins;
}

module.exports = {
  WO_DEBIT_MINS, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
  istMinuteOfDay, computeDayLedger, netLedgerMins,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && node --check otLedger.js && npm test`
Expected: PASS — all `otLedger.test.js` tests green.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/otLedger.js firebase/functions/otLedger.test.js
git commit -m "feat(functions): pure per-day OT/shortage/WO ledger module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Range aggregation module (`otAggregate.js`)

Port `admin/src/lib/otAggregate.ts` — `computeRangeLedger` + `settlementCash`. Same signature as the TS source so the admin's test cases port verbatim. One deliberate divergence: `isSunday` uses UTC-safe `getUTCDay()` per the Global Constraints.

**Files:**
- Create: `firebase/functions/otAggregate.js`
- Test: `firebase/functions/otAggregate.test.js`

**Interfaces:**
- Consumes (from Task 1): `computeDayLedger`, `netLedgerMins`, `WO_DEBIT_MINS`, `istMinuteOfDay`, `DEFAULT_SHIFT_START_MIN`, `DEFAULT_SHIFT_END_MIN`.
- Produces:
  - `computeRangeLedger(userId, events, planned, approvals, statuses, holidays) → { autoOtMins, restDayOtMins, grantedOtMins, shortageMins, woDates, woDebitMins, netMins, pendingDates, pendingOtMins, unauthorizedRestDates }`
    - `events[]`: `{ userId, date, type, timestamp: { seconds } }`
    - `planned[]`: `{ userId, date, startTime, endTime, declaredOtMins?, otAuthorized? }`
    - `approvals[]`: `{ userId, date, approvedMins, status }`
    - `statuses[]`: `{ userId, date, status, inTime?, outTime? }`
    - `holidays`: `Set<string>` of `YYYY-MM-DD`
  - `settlementCash(salaryRate, woDays, netMins) → number` (2dp, signed)

- [ ] **Step 1: Write the failing test**

Create `firebase/functions/otAggregate.test.js` (ported from `admin/src/lib/otAggregate.test.ts`):

```js
"use strict";

// Boundary suite for the range/month OT aggregation. Run: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeRangeLedger, settlementCash } = require("./otAggregate");

// An attendance event at a real IST wall-clock time (the ledger reads timestamps as IST).
const ev = (userId, date, type, hhmm) => ({
  id: `${date}-${type}-${hhmm}`, userId, date, type,
  timestamp: { seconds: Math.floor(new Date(`${date}T${hhmm}:00+05:30`).getTime() / 1000) },
});

const U = "u1";
const noHol = new Set();

// 2026-06-01 Monday. Shift 10:00–18:00 + declared 30. Worked 10:00–19:00 → 60 OT (auto 30, pending 30).
const planNormal = [{ id: "2026-06-01", userId: U, date: "2026-06-01", startTime: "10:00", endTime: "18:00", declaredOtMins: 30 }];
const evNormal = [ev(U, "2026-06-01", "site_in", "10:00"), ev(U, "2026-06-01", "site_out", "19:00")];

test("normal day: auto 30, pending 30, net 30 (pending not credited)", () => {
  const r = computeRangeLedger(U, evNormal, planNormal, [], [], noHol);
  assert.equal(r.autoOtMins, 30);
  assert.equal(r.pendingOtMins, 30);
  assert.equal(r.pendingDates.length, 1);
  assert.equal(r.shortageMins, 0);
  assert.equal(r.netMins, 30);
});

test("beyond-declared +30 approved via ot_approvals → net 60", () => {
  const appr = [{ id: "2026-06-01", userId: U, date: "2026-06-01", approvedMins: 30, status: "approved" }];
  const r = computeRangeLedger(U, evNormal, planNormal, appr, [], noHol);
  assert.equal(r.grantedOtMins, 30);
  assert.equal(r.pendingDates.length, 0);
  assert.equal(r.netMins, 60);
});

test("authorized Sunday rest-day work (2026-06-07) 300 min → net 300", () => {
  const planSun = [{ id: "2026-06-07", userId: U, date: "2026-06-07", startTime: "", endTime: "", otAuthorized: true }];
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const r = computeRangeLedger(U, evSun, planSun, [], [], noHol);
  assert.equal(r.restDayOtMins, 300);
  assert.equal(r.netMins, 300);
  assert.equal(r.unauthorizedRestDates.length, 0);
});

test("unauthorized Sunday work → net 0, flagged", () => {
  const evSun = [ev(U, "2026-06-07", "site_in", "10:00"), ev(U, "2026-06-07", "site_out", "15:00")];
  const r = computeRangeLedger(U, evSun, [], [], [], noHol);
  assert.equal(r.restDayOtMins, 0);
  assert.equal(r.unauthorizedRestDates.length, 1);
  assert.equal(r.netMins, 0);
});

test("WO status counted: woDates 1, woDebit 480, net -480", () => {
  const woStatus = [{ id: "2026-06-02", userId: U, date: "2026-06-02", status: "WO" }];
  const r = computeRangeLedger(U, [], [], [], woStatus, noHol);
  assert.equal(r.woDates.length, 1);
  assert.equal(r.woDebitMins, 480);
  assert.equal(r.netMins, -480);
});

test("regularized-to-Present in/out with no events accrues shortage (net -90)", () => {
  const planReg = [{ id: "2026-06-03", userId: U, date: "2026-06-03", startTime: "10:00", endTime: "18:00" }];
  const statusReg = [{ id: "2026-06-03", userId: U, date: "2026-06-03", status: "Present", inTime: "10:00", outTime: "16:30" }];
  const r = computeRangeLedger(U, [], planReg, [], statusReg, noHol);
  assert.equal(r.shortageMins, 90);
  assert.equal(r.netMins, -90);
});

test("regularized in/out OVERRIDES raw events for the same date", () => {
  const statusReg2 = [{ id: "2026-06-01", userId: U, date: "2026-06-01", status: "Present", inTime: "10:00", outTime: "18:30" }];
  const r = computeRangeLedger(U, evNormal, planNormal, [], statusReg2, noHol);
  assert.equal(r.autoOtMins, 30);
  assert.equal(r.pendingOtMins, 0);
  assert.equal(r.shortageMins, 0);
});

test("manual OT grant on a day with no events counts as granted (net 120)", () => {
  const manualAppr = [{ id: "2026-06-04", userId: U, date: "2026-06-04", approvedMins: 120, status: "approved", manual: true }];
  const r = computeRangeLedger(U, [], [], manualAppr, [], noHol);
  assert.equal(r.grantedOtMins, 120);
  assert.equal(r.netMins, 120);
});

test("ops with no plan falls back to default 10:00–18:00", () => {
  const evNoPlan = [ev(U, "2026-06-09", "site_in", "10:00"), ev(U, "2026-06-09", "site_out", "19:00")];
  const r = computeRangeLedger(U, evNoPlan, [], [], [], noHol);
  assert.equal(r.pendingOtMins, 60);
  assert.equal(r.shortageMins, 0);
});

test("inverted window (end<=start) treated as no plan → default", () => {
  const evInv = [ev(U, "2026-06-10", "site_in", "09:50"), ev(U, "2026-06-10", "site_out", "17:56")];
  const planInv = [{ id: "2026-06-10", userId: U, date: "2026-06-10", startTime: "10:00", endTime: "06:00", declaredOtMins: 0 }];
  const r = computeRangeLedger(U, evInv, planInv, [], [], noHol);
  assert.equal(r.pendingOtMins, 0);
  assert.equal(r.shortageMins, 4);
});

test("settlementCash (rate 800)", () => {
  assert.equal(settlementCash(800, 1, -480), 0);   // unworked WO
  assert.equal(settlementCash(800, 1, 0), 800);    // WO worked off
  assert.equal(settlementCash(800, 1, -180), 500); // WO + 300 rest-day
  assert.equal(settlementCash(800, 0, 480), 800);  // pure OT
  assert.equal(settlementCash(800, 0, -240), -400); // pure shortage
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && npm test`
Expected: FAIL — `Cannot find module './otAggregate'`.

- [ ] **Step 3: Write the implementation**

Create `firebase/functions/otAggregate.js`:

```js
"use strict";

// Range/month OT/shortage/WO aggregation for one ops employee — CommonJS port of
// admin/src/lib/otAggregate.ts, built on the pure per-day computeDayLedger (otLedger.js).
// Divergence from the TS source: isSunday uses UTC-safe getUTCDay() (functions run on UTC).

const {
  computeDayLedger, netLedgerMins, WO_DEBIT_MINS, istMinuteOfDay,
  DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");

const OPS_IN_TYPES  = new Set(["site_in", "market_in"]);
const OPS_OUT_TYPES = new Set(["site_out", "market_out"]);

function tsSeconds(e) {
  return (e.timestamp && e.timestamp.seconds) || 0;
}
function hhmmToMin(s) {
  if (!s) return 0;
  const [h, m] = String(s).split(":").map(Number);
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
}
// UTC-safe weekday: functions run on UTC, so read getUTCDay() on a Z-anchored string.
function isSunday(date) {
  return new Date(date + "T00:00:00Z").getUTCDay() === 0;
}

// Aggregate one ops employee's ledger over already-fetched arrays for a month/range.
function computeRangeLedger(userId, events, planned, approvals, statuses, holidays) {
  // Only windows with end > start are valid; an inverted/zero window falls back to default.
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

  // Regularized-to-Present days carry an admin effective in/out — override raw events.
  const overrideByDate = new Map();
  statuses.filter((s) => s.userId === userId && s.status === "Present" && s.inTime && s.outTime).forEach((s) => {
    const inMin = hhmmToMin(s.inTime), outMin = hhmmToMin(s.outTime);
    if (outMin > inMin) overrideByDate.set(s.date, { inMin, outMin });
  });

  let autoOtMins = 0, restDayOtMins = 0, shortageMins = 0, pendingOtMins = 0;
  const pendingDates = [];
  const unauthorizedRestDates = [];

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
    shortageMins  += led.shortageMins;
    autoOtMins    += led.autoOtMins;
    restDayOtMins += led.restDayOtMins;
    if (led.pendingExtraMins > 0 && !apprByDate.has(date)) { pendingOtMins += led.pendingExtraMins; pendingDates.push(date); }
    if (led.unauthorizedRestDay) unauthorizedRestDates.push(date);
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return; // regularization in/out is authoritative
    const ins  = dayEvents.filter((e) => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter((e) => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return; // open/invalid day
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });

  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  const grantedOtMins = Array.from(apprByDate.values()).reduce((s, a) => s + (Number(a.approvedMins) || 0), 0);
  const woDates = statuses.filter((s) => s.userId === userId && s.status === "WO").map((s) => s.date).sort();
  const woDebitMins = woDates.length * WO_DEBIT_MINS;
  const netMins = netLedgerMins({ autoOtMins, restDayOtMins, approvedGrantedMins: grantedOtMins, shortageMins, woDebitMins });

  return {
    autoOtMins, restDayOtMins, grantedOtMins, shortageMins,
    woDates, woDebitMins, netMins,
    pendingDates: pendingDates.sort(), pendingOtMins,
    unauthorizedRestDates: unauthorizedRestDates.sort(),
  };
}

// Settlement cash: WO paid days + net OT/shortage at the straight per-minute rate (rate/480).
// netMins already includes −480 per WO day, so an unworked WO nets to 0.
function settlementCash(salaryRate, woDays, netMins) {
  const cash = woDays * salaryRate + (netMins / WO_DEBIT_MINS) * salaryRate;
  return Math.round(cash * 100) / 100;
}

module.exports = { computeRangeLedger, settlementCash };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd firebase/functions && node --check otAggregate.js && npm test`
Expected: PASS — all `otAggregate.test.js` and `otLedger.test.js` tests green.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/otAggregate.js firebase/functions/otAggregate.test.js
git commit -m "feat(functions): range OT aggregation + settlementCash module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Remove the duplicated inline `computeDayLedger` from `index.js`

`index.js` has its own `computeDayLedger` (line ~156) and `DEFAULT_SHIFT_*` constants (lines ~136–137). Replace them with imports from `otLedger.js`. The module returns a **superset** of the current shape (adds `shortageMins`), and the two existing consumers (OT Exception Report, Site Manpower) destructure only `{ autoOtMins, pendingExtraMins, restDayOtMins, unauthorizedRestDay }`, so they are unaffected.

**Files:**
- Modify: `firebase/functions/index.js` (remove lines ~136–137 and ~156–175; add a require)

**Interfaces:**
- Consumes (from Task 1): `computeDayLedger`, `DEFAULT_SHIFT_START_MIN`, `DEFAULT_SHIFT_END_MIN`.

- [ ] **Step 1: Add the import near the other requires**

After the existing `const { computeDeductions } = require("./payrollDeductions");` line, add:

```js
const {
  computeDayLedger, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");
```

- [ ] **Step 2: Delete the inline `DEFAULT_SHIFT_*` constants**

Remove these two lines (~136–137):

```js
const DEFAULT_SHIFT_START_MIN = 10 * 60; // 10:00
const DEFAULT_SHIFT_END_MIN   = 18 * 60; // 18:00
```

- [ ] **Step 3: Delete the inline `computeDayLedger` function**

Remove the entire inline `function computeDayLedger({ ... }) { ... }` block (~156–175 — the version that returns `{ autoOtMins, pendingExtraMins, restDayOtMins, unauthorizedRestDay }` with no `shortageMins`).

- [ ] **Step 4: Verify the file still parses and all tests pass**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: PASS — no parse errors; existing suites still green. (There is no unit test exercising the Sheets sections directly; correctness of the two consumers is verified in Task 4's end-to-end check.)

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/index.js
git commit -m "refactor(functions): use shared otLedger, drop duplicated inline computeDayLedger

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the live OT/WO amount into the Employee Dashboard (§9)

Build `otWoAmountByUserId` from the ledger, rename the column, and replace the locked-settlement read. TOTAL DUE now moves live with authorized OT (intended).

**Files:**
- Modify: `firebase/functions/index.js` (requires; capture two snapshots; new pre-step; §9 header + settlement source; delete `settlementCashMap`)

**Interfaces:**
- Consumes (from Task 2): `computeRangeLedger`, `settlementCash`.
- Consumes (existing in `index.js`): `statusSnap` (all `attendance_status`), `uidOf`, `usesOtShortageLedger`, `allUsersData` (each `{ id, role, salaryRate }`), `monthStart`, `today`, `holidaySet` (this month), `db`.

- [ ] **Step 1: Add the aggregate import**

Below the `otLedger` require from Task 3, add:

```js
const { computeRangeLedger, settlementCash } = require("./otAggregate");
```

- [ ] **Step 2: Capture the planned/approvals snapshots into variables**

The planned_hours and ot_approvals collection groups are already fetched inline. Store their snapshots so the new pre-step can reuse them (no extra queries).

Change (~line 474):
```js
    (await db.collectionGroup("planned_hours").get()).docs.forEach((doc) => {
```
to:
```js
    const plannedSnap = await db.collectionGroup("planned_hours").get();
    plannedSnap.docs.forEach((doc) => {
```

Change (~line 487):
```js
    (await db.collectionGroup("ot_approvals").get()).docs.forEach((doc) => {
```
to:
```js
    const approvalSnap = await db.collectionGroup("ot_approvals").get();
    approvalSnap.docs.forEach((doc) => {
```

- [ ] **Step 3: Add the `otWoAmountByUserId` pre-step immediately before the §9 block**

Directly above the `// ── 9. Employee Dashboard` comment, insert:

```js
    // ── 8b. Live OT/WO amount per ops employee (for the Employee Dashboard) ──
    // Authorized OT − shortage − WO, netted for the current month, converted to
    // rupees via settlementCash — the SAME math the OT Settlements page locks, but
    // computed live each night instead of waiting for Settle & Lock. Pending and
    // unauthorized-rest-day OT are excluded (not yet authorized). Non-ledger roles
    // (office/admin/sales) are skipped → 0.
    const monthStatuses = statusSnap.docs
      .map((doc) => ({ ...doc.data(), userId: doc.data().userId }))
      .filter((s) => s.date >= monthStart && s.date <= today);
    const monthPlanned = plannedSnap.docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) }))
      .filter((p) => p.date >= monthStart && p.date <= today);
    const monthApprovals = approvalSnap.docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) }))
      .filter((a) => a.date >= monthStart && a.date <= today);
    const monthAttSnap = await db.collectionGroup("attendance")
      .where("date", ">=", monthStart).where("date", "<=", today).get();
    const monthEvents = monthAttSnap.docs.map((doc) => ({ ...doc.data(), userId: uidOf(doc) }));

    const otWoAmountByUserId = new Map();
    allUsersData.forEach((u) => {
      if (!usesOtShortageLedger(u.role)) return;
      const led = computeRangeLedger(u.id, monthEvents, monthPlanned, monthApprovals, monthStatuses, holidaySet);
      otWoAmountByUserId.set(u.id, settlementCash(u.salaryRate || 0, led.woDates.length, led.netMins));
    });
```

- [ ] **Step 4: Delete the `settlementCashMap` block inside §9**

Remove the whole block (~1139–1149) that reads locked settlements:

```js
    // Current-month settlement (OT/shortage/WO) — the client settles month-to-month,
    // NOT in arrears. Read each user's LOCKED settlement for THIS month and add its cash
    // to TOTAL DUE. Shows 0 all month until Settle & Lock, then the month's own cash.
    const settlementCashMap = new Map(); // userId → settlement cash (locked only)
    await Promise.all(allUsersData.map(async (u) => {
      try {
        const sdoc = await db.collection("users").doc(u.id).collection("settlements").doc(currentKey).get();
        const s = sdoc.data();
        if (s && s.locked) settlementCashMap.set(u.id, Number(s.settlementCash) || 0);
      } catch (_) { /* no settlement for this user — skip */ }
    }));
```

- [ ] **Step 5: Rename the column header**

In the `header` array (~1156), change:
```js
      "Covy Due (approx avg)", "Imprest Due MTD", `Settlement ${currentKey} (₹)`,
```
to:
```js
      "Covy Due (approx avg)", "Imprest Due MTD", "OT/WO amount (₹)",
```

- [ ] **Step 6: Source the settlement value from the live map**

Change (~1185):
```js
        const settlement = parseFloat((settlementCashMap.get(user.id) || 0).toFixed(2));
```
to:
```js
        const settlement = parseFloat((otWoAmountByUserId.get(user.id) || 0).toFixed(2));
```

(The `computeDeductions` call and the `empRows.push([... settlement ...])` remain unchanged — `settlement` still flows into TOTAL DUE.)

- [ ] **Step 7: Verify parse + tests**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: PASS — no parse errors; all module suites green.

- [ ] **Step 8: End-to-end sanity check against a settled month**

Confirm the live figure equals a real locked settlement. In the Firebase console (or via the emulator/a scratch node script using the same inputs), pick one ops employee who has a locked `settlements/{YYYY-MM}` for the current month and verify:

```
otWoAmountByUserId.get(uid)  ===  settlements/{YYYY-MM}.settlementCash
```

They must match by construction (same math, same inputs). If they differ, STOP — the port has a bug; do not deploy. (This is the real proof the two existing consumers in Task 3 are also fine, since they share `computeDayLedger`.)

- [ ] **Step 9: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): live OT/WO amount column on Employee Dashboard

Rename Settlement column to 'OT/WO amount (₹)' and compute authorized OT
net of shortage/WO from the ledger each nightly run, instead of reading the
locked monthly settlement. Matches the settlement figure by construction;
TOTAL DUE now reflects authorized OT live through the month.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Deploy and verify in the live Sheet

**Files:** none (deploy only)

- [ ] **Step 1: Deploy functions from repo root**

Run: `firebase deploy --only functions`
(If the CLI token is expired, run `firebase login --reauth` in a real terminal first — it does not work through a non-interactive shell. See the release-rollout notes.)
Expected: `exportToSheets` updates without error.

- [ ] **Step 2: Force one export run and inspect the tab**

Trigger `exportToSheets` (scheduled 22:00 IST; force-run via the console/Pub/Sub if you don't want to wait). In the Employee Dashboard tab of the Sheet, confirm:
- The column header reads **`OT/WO amount (₹)`**.
- Ops employees show signed ₹ figures matching their current authorized OT net of shortage/WO.
- Office/admin/sales still show `0`.
- TOTAL DUE reflects the OT/WO amount.

- [ ] **Step 3: Update project docs**

Update the "Google Sheets Export → Employee Dashboard tab" bullet in `admin/CLAUDE.md` to describe the renamed live `OT/WO amount (₹)` column (authorized OT − shortage − WO, computed each run from `otAggregate.js`, no longer gated on Settle & Lock). Commit.

```bash
git add admin/CLAUDE.md
git commit -m "docs(admin): describe live OT/WO amount column on Employee Dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Rename column → Task 4 Step 5. ✅
- Live authorized-OT net (auto+restday+granted − shortage − WO) → Tasks 1–2 (`netLedgerMins`/`computeRangeLedger`), wired Task 4. ✅
- Excludes pending/unauthorized → covered by `netLedgerMins` (pending not summed) + tests (Task 2 unauthorized-Sunday, pending-not-credited). ✅
- Matches settlement by construction → Task 4 Step 8 end-to-end check. ✅
- Non-ledger roles → 0 → Task 4 Step 3 (`usesOtShortageLedger` guard). ✅
- Pure tested modules mirroring TS → Tasks 1–2. ✅
- Remove duplicated inline `computeDayLedger` from `index.js` → Task 3. ✅
- TOTAL DUE goes live → Task 4 Step 6 (settlement still feeds `computeDeductions`), noted in commit + docs. ✅
- Nightly cadence / deploy → Task 5. ✅
- Frozen past-month blocks unchanged → no task touches the freeze/merge logic (only the current-month value source changes). ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✅

**Type consistency:** `computeDayLedger` return shape identical across Tasks 1/2/3; `computeRangeLedger` return fields (`netMins`, `woDates`) match Task 4 usage; `settlementCash(salaryRate, woDays, netMins)` signature consistent Tasks 2 & 4. ✅
