# OT Protocol 3 — WO Explicit Settlement Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit, same-calendar-month WO/OT netting in the OT ledger with a persistent, per-WO debt record that only an explicit admin action (or a 2-month expiry write-off) can resolve, and close a pre-existing gap where a WO day's raw punches could double-penalize via shortage.

**Architecture:** `computeDayLedger` gains an `isWoDay` input that suppresses shift math for that date exactly like a rest day (worked minutes become pending OT instead of shortage/auto-OT). `netLedgerMins` drops its WO-debit term entirely — WO debt moves into a new `wo_ledger/{date}` subcollection with its own `remainingMins` balance, decremented only by an explicit `settleWoDebit` action that spends a specific `ot_approvals` doc's unspent minutes (tracked via a new `settledMins` field), or written off for free by a new scheduled Cloud Function after 2 months.

**Tech Stack:** TypeScript (admin, Next.js/Firebase client SDK), CommonJS JavaScript (Cloud Functions, `firebase-admin`), Firestore Security Rules, `npx tsx` / `node --test` for unit tests, `firebase/rules-tests` (Firebase emulator + `node --test`) for rules tests.

**Spec:** `docs/superpowers/specs/2026-09-14-ot-redesign-design.md`, section "## Protocol 3 — WO becomes an explicit, expiring debt settled by admin action, not implicit same-month netting" (approved 2026-09-15). Executors should read that section in full before starting; this plan argues from it.

## Global Constraints

- **Money-computing code.** Every task in this plan touches OT/WO payroll math or its inputs. Per this repo's established convention (see `docs/superpowers/specs/2026-09-14-ot-redesign-design.md`'s Protocol 1/2 history), the **final whole-branch review must run on the most capable available model (Opus)**, never a cheaper model, regardless of what model individual task implementers used.
- **Mirror discipline.** `admin/src/lib/otLedger.ts` ↔ `firebase/functions/otLedger.js` and `admin/src/lib/otAggregate.ts` ↔ `firebase/functions/otAggregate.js` (including `firebase/functions/otAggregate.js`'s JS-only `dailyOtWoCash`, which has no TS sibling) must change together with matching test cases in the same task, or the task review fails it — this has happened before in this exact codebase.
- **Scope: operations only**, matching `usesOtShortageLedger(role)` — unchanged from today's WO/OT ledger, which already excludes sales/office/admin. No task in this plan should add any WO/OT concept to another role.
- **WO is still illegal on a rest day** (Protocol 1, untouched) — `assertNotRestDay`/`isRestDate` continue to block any WO write on a Sunday or holiday before this plan's code ever runs. A `wo_ledger` doc can therefore never exist for a rest date either.
- **No pro-rating.** A WO's debit is always the flat 480 minutes (`WO_DEBIT_MINS`) regardless of partial punches that day — per the spec, credit for hours actually worked on a WO day flows through the ordinary pending-OT → approval → settlement path, never an automatic adjustment at WO-creation time.
- **Trust boundary matches existing precedent.** Firestore rules gate *who* can write `wo_ledger`/its `settlements` subcollection (tab access, `notSelf`, target month not locked) but do not attempt to verify the exact arithmetic relationship between a settlement's `minsApplied` and the corresponding decrements on the `wo_ledger` and `ot_approvals` docs in the same batch — this matches how `ot_approvals.approvedMins` and `settlements.settlementCash` are already trusted from the client today. Client-side validation (in `firestore.ts`) is still required before every write.

---

### Task 1: `otLedger.ts` / `otLedger.js` — WO days suppress shift math; WO debt leaves `netLedgerMins`

**Files:**
- Modify: `admin/src/lib/otLedger.ts`
- Modify: `admin/src/lib/otLedger.test.ts`
- Modify: `firebase/functions/otLedger.js`
- Modify: `firebase/functions/otLedger.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (this is the foundation).
- Produces: `DayLedgerInput.isWoDay: boolean` (new required field — every caller of `computeDayLedger` in the whole repo must now pass it), `NetLedgerParts` **loses** `woDebitMins` (every caller of `netLedgerMins` must now omit it). `WO_DEBIT_MINS` keeps its value (480) and export — Task 3 uses it to initialize a new `wo_ledger` doc's `remainingMins`.

- [ ] **Step 1: Update `computeDayLedger`'s input type and branch in `admin/src/lib/otLedger.ts`**

Replace the `DayLedgerInput` interface and the top of `computeDayLedger` (currently lines 19-26 and 62-65):

```typescript
export interface DayLedgerInput {
  shiftStartMin: number;  // shift window start, IST minute-of-day (use start==end for "no shift")
  shiftEndMin: number;    // shift window end, IST minute-of-day
  inMin: number;          // actual first-in, IST minute-of-day
  outMin: number;         // actual last-out, IST minute-of-day
  declaredOtMins: number; // admin pre-declared OT for the day (auto-approval ceiling)
  isRestDay: boolean;     // Sunday or company holiday
  isWoDay: boolean;       // Protocol 3: an admin-marked WO date. Treated exactly like a rest
                          // day for THIS date's shift math (no shortage, no auto-OT credit,
                          // the whole worked window becomes pending). A date is never both
                          // isRestDay and isWoDay — WO is illegal on a rest day (Protocol 1).
                          // The WO's own 480-minute debit is tracked entirely outside this
                          // function, in the wo_ledger collection (Protocol 3).
}
```

And update the doc comment + first line of `computeDayLedger` (the function body signature line changes too since it destructures `i`):

```typescript
// Rest days (Sunday / company holiday) AND WO days (admin-marked paid day off, Protocol 3)
// are both immutable for shift-math purposes: nothing is pre-authorized. Any worked window on
// either kind of day raises a PENDING overtime request for the WHOLE window — never
// auto-credited, never shortage, and the declared-OT ceiling does not apply. It is credited
// only when an admin later approves some or all of it via the separate approval flow.
export function computeDayLedger(i: DayLedgerInput): DayLedger {
  const worked = Math.max(0, i.outMin - i.inMin);

  if (i.isRestDay || i.isWoDay) return { ...ZERO, pendingExtraMins: worked };

  if (i.shiftEndMin > i.shiftStartMin) {
    const lateIn   = Math.max(0, i.inMin - i.shiftStartMin);
    const earlyOut = Math.max(0, i.shiftEndMin - i.outMin);
    const lateOut  = Math.max(0, i.outMin - i.shiftEndMin);
    const otEarned  = Math.max(0, lateOut - lateIn);
    const netLateIn = Math.max(0, lateIn - lateOut);
    const declared = Math.max(0, i.declaredOtMins);
    return {
      ...ZERO,
      shortageMins: netLateIn + earlyOut,
      autoOtMins: Math.min(otEarned, declared),
      pendingExtraMins: Math.max(0, otEarned - declared),
    };
  }

  return { ...ZERO };
}
```

(The rest of the function body — the `shiftEndMin > shiftStartMin` branch and the final `return { ...ZERO }` — is unchanged; only the `isRestDay` check on the guard line gains `|| i.isWoDay`.)

- [ ] **Step 2: Update `NetLedgerParts` and `netLedgerMins`**

Replace (currently lines 87-98):

```typescript
export interface NetLedgerParts {
  autoOtMins: number;          // declared, auto-approved
  approvedGrantedMins: number; // admin-granted OT (beyond-declared, or rest/WO-day), net of
                                // any minutes already spent settling a WO debt (Protocol 3)
  shortageMins: number;
}

// Monthly/range net: approved OT (auto + granted) minus shortage. WO debt no longer
// participates here at all (Protocol 3) — it now lives entirely in the wo_ledger collection,
// cleared only by an explicit admin settlement or a 2-month expiry write-off. A WO day's own
// pay is unconditional (see otAggregate.ts's settlementCash) and no longer entangled with
// whether OT ever offsets it. Pending (un-approved) OT is intentionally excluded — it isn't
// credited until approved.
export function netLedgerMins(p: NetLedgerParts): number {
  return (p.autoOtMins + p.approvedGrantedMins) - p.shortageMins;
}
```

- [ ] **Step 3: Update `admin/src/lib/otLedger.test.ts`**

Edit the shared `day()` helper (currently lines 27-28) to pass `isWoDay: false`:

```typescript
const day = (inMin: number, outMin: number, declaredOtMins = 0) =>
  computeDayLedger({ shiftStartMin: START, shiftEndMin: END, inMin, outMin, declaredOtMins, isRestDay: false, isWoDay: false });
```

Every explicit `computeDayLedger({ ... isRestDay: true ... })` call in the "Rest day" section (currently lines 88, 92, 96, 100) and the "No shift, not a rest day" call (currently line 105) each need `isWoDay: false` added to their argument object — e.g. line 88 becomes:

```typescript
check('rest day, 10:00–15:00 → +300 pending, 0 elsewhere',
  computeDayLedger({ shiftStartMin: 0, shiftEndMin: 0, inMin: START, outMin: 15 * 60, declaredOtMins: 0, isRestDay: true, isWoDay: false }),
  { pendingExtraMins: 300, shortageMins: 0, autoOtMins: 0 });
```

(Do the same mechanical addition — `isWoDay: false` — to the other three rest-day calls and the no-shift call, changing nothing else about them.)

Immediately after the "No shift, not a rest day" section (after the existing block ending at old line 106), insert a new section:

```typescript
console.log('\nWO day (Protocol 3) — mirrors rest-day treatment for shift math, on an ordinary weekday shift:');
// Told to leave at 2pm on a 10:00–18:00 shift, day marked WO: no shortage from the early
// leave, the 4h actually worked becomes pending OT instead (the exact "asked to leave at 2"
// scenario the design conversation raised).
check('WO day, shift 10–18, worked 10:00–14:00 → 240 pending, 0 shortage, 0 auto-OT',
  computeDayLedger({ shiftStartMin: START, shiftEndMin: END, inMin: START, outMin: 14 * 60, declaredOtMins: 30, isRestDay: false, isWoDay: true }),
  { pendingExtraMins: 240, shortageMins: 0, autoOtMins: 0 });
// A WO day with no punches at all (the ordinary case) accrues nothing.
check('WO day, no punches → 0 pending, 0 elsewhere',
  computeDayLedger({ shiftStartMin: START, shiftEndMin: END, inMin: START, outMin: START, declaredOtMins: 0, isRestDay: false, isWoDay: true }),
  { pendingExtraMins: 0, shortageMins: 0, autoOtMins: 0 });
// The declared-OT ceiling does not apply on a WO day either — staying past shift end on a WO
// day (unusual, but not impossible) is still all-pending, same as a rest day.
check('WO day, worked 10:00–19:00, declared 30 → all 540 pending (ceiling ignored)',
  computeDayLedger({ shiftStartMin: START, shiftEndMin: END, inMin: START, outMin: END + 60, declaredOtMins: 30, isRestDay: false, isWoDay: true }),
  { pendingExtraMins: 540, shortageMins: 0, autoOtMins: 0 });
```

Replace the "Net ledger" section (currently lines 112-117):

```typescript
console.log('\nNet ledger (pending minutes are excluded entirely; WO debt no longer participates — Protocol 3):');
eq('prior shortage 30, +15 OT → net -15', netLedgerMins({ autoOtMins: 15, approvedGrantedMins: 0, shortageMins: 30 }), -15);
eq('60 auto + 600 granted − 90 shortage → net 570 (no WO term at all, Protocol 3)', netLedgerMins({ autoOtMins: 60, approvedGrantedMins: 600, shortageMins: 90 }), 570);
// A WO's 480-minute debit is no longer a NetLedgerParts input at all — it is tracked and
// settled entirely through the wo_ledger collection (see otAggregate.test.ts / Task 2).
```

- [ ] **Step 4: Run the admin test file to verify it passes**

Run: `cd admin && npx tsx src/lib/otLedger.test.ts`
Expected: `✅ N passed, 0 failed` (N grows by 3 from the new WO-day checks; no failures).

- [ ] **Step 5: Update `firebase/functions/otLedger.js`**

Mirror Steps 1-2 exactly in CommonJS form. Replace the `computeDayLedger` guard line:

```javascript
function computeDayLedger({ shiftStartMin, shiftEndMin, inMin, outMin, declaredOtMins, isRestDay, isWoDay }) {
  const worked = Math.max(0, outMin - inMin);

  if (isRestDay || isWoDay) return { ...ZERO, pendingExtraMins: worked };

  if (shiftEndMin > shiftStartMin) {
    const lateIn   = Math.max(0, inMin - shiftStartMin);
    const earlyOut = Math.max(0, shiftEndMin - outMin);
    const lateOut  = Math.max(0, outMin - shiftEndMin);
    const otEarned  = Math.max(0, lateOut - lateIn);
    const netLateIn = Math.max(0, lateIn - lateOut);
    const declared = Math.max(0, declaredOtMins || 0);
    return {
      ...ZERO,
      shortageMins: netLateIn + earlyOut,
      autoOtMins: Math.min(otEarned, declared),
      pendingExtraMins: Math.max(0, otEarned - declared),
    };
  }

  return { ...ZERO };
}
```

And `netLedgerMins`:

```javascript
// Monthly/range net: approved OT (auto + granted) minus shortage. WO debt no longer
// participates (Protocol 3) — see wo_ledger. Pending OT is excluded — not credited until approved.
function netLedgerMins(p) {
  return (p.autoOtMins + p.approvedGrantedMins) - p.shortageMins;
}
```

`WO_DEBIT_MINS`, `DEFAULT_SHIFT_START_MIN`, `DEFAULT_SHIFT_END_MIN`, `istMinuteOfDay`, and the `module.exports` line are all unchanged.

- [ ] **Step 6: Update `firebase/functions/otLedger.test.js`**

Add `isWoDay: false` to the shared `shift` object (currently line 13):

```javascript
const shift = { shiftStartMin: 600, shiftEndMin: 1080, declaredOtMins: 0, isRestDay: false, isWoDay: false };
```

(Every test that spreads `...shift` now automatically passes `isWoDay: false` with no further edits needed — the four explicit rest-day tests already spread `...shift` too, so they get `isWoDay: false` for free and need no per-test edit here, unlike the TS file's explicit-object-literal tests.)

Insert a new test block after `"rest day ignores shift window, even when out extends past what would be late-out"` (currently ending at line 111):

```javascript
test("WO day mirrors rest-day treatment: worked window becomes pending, not shortage", () => {
  // Told to leave at 2pm on a 10:00–18:00 shift, day marked WO: the 4h worked (in 600, out
  // 840) becomes pending OT, not an early-out shortage.
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 840, isWoDay: true, declaredOtMins: 30 });
  assert.equal(led.pendingExtraMins, 240);
  assert.equal(led.shortageMins, 0);
  assert.equal(led.autoOtMins, 0);
});

test("WO day with no punches accrues nothing", () => {
  const led = computeDayLedger({ ...shift, inMin: 600, outMin: 600, isWoDay: true });
  assert.equal(led.pendingExtraMins, 0);
  assert.equal(led.shortageMins, 0);
  assert.equal(led.autoOtMins, 0);
});
```

Replace the `netLedgerMins` test (currently lines 120-126):

```javascript
test("netLedgerMins nets approved OT minus shortage; WO debt no longer participates (Protocol 3)", () => {
  assert.equal(netLedgerMins({ autoOtMins: 30, approvedGrantedMins: 30, shortageMins: 0 }), 60);
  assert.equal(netLedgerMins({ autoOtMins: 0, approvedGrantedMins: 300, shortageMins: 0 }), 300);
});
```

- [ ] **Step 7: Run the functions test suite to verify it passes**

Run: `cd firebase/functions && npm test`
Expected: all tests pass, including the two new `otLedger.test.js` cases (`node --test` reports per-file and total pass counts).

- [ ] **Step 8: Commit**

```bash
git add admin/src/lib/otLedger.ts admin/src/lib/otLedger.test.ts firebase/functions/otLedger.js firebase/functions/otLedger.test.js
git commit -m "feat(protocol-3): WO days suppress shift math like rest days; WO debt leaves netLedgerMins"
```

---

### Task 2: `otAggregate.ts` / `otAggregate.js` — WO-aware accrual, settled-away OT excluded from cash

**Files:**
- Modify: `admin/src/lib/otAggregate.ts`
- Modify: `admin/src/lib/otAggregate.test.ts`
- Modify: `admin/src/types/index.ts` (add `settledMins?: number` to `OtApproval`)
- Modify: `firebase/functions/otAggregate.js`
- Modify: `firebase/functions/otAggregate.test.js`

**Interfaces:**
- Consumes: `computeDayLedger`'s new `isWoDay` input and `netLedgerMins`'s new (WO-debit-free) signature from Task 1.
- Produces: `RangeLedger` **loses** `woDebitMins` (Task 6's UI and any other reader must not reference it); `grantedOtMins` now means "granted OT net of anything already spent settling a WO" — this is the number that feeds `netMins` and should be what any UI displays as "granted". `OtApproval.settledMins?: number` — read by Task 2, written only by Task 3's settlement function (never by `writeOtDecision`).

- [ ] **Step 1: Add `settledMins` to the `OtApproval` type**

In `admin/src/types/index.ts`, add one field to the `OtApproval` interface (currently lines 62-76), after `approvedAt`:

```typescript
export interface OtApproval {
  id: string;
  date: string;
  userId: string;
  userName: string;
  employeeId: string;
  role: string;
  requestedMins: number;
  approvedMins: number;
  status?: 'approved' | 'rejected';
  manual?: boolean;
  reason: string;
  approvedBy: string;
  approvedAt?: Timestamp;
  settledMins?: number; // Protocol 3: minutes of approvedMins already spent settling a WO debt
                         // via settleWoDebit — never written by writeOtDecision/approveOt/
                         // rejectOt/setManualOt. available = approvedMins - settledMins.
}
```

- [ ] **Step 2: Reorder `computeRangeLedger` in `admin/src/lib/otAggregate.ts` — WO dates before the accrual loop, `isWoDay` passed per date, settled-aware granted sum**

Replace the whole function body (currently lines 38-116):

```typescript
export function computeRangeLedger(
  userId: string,
  events: AttendanceRecord[],
  planned: PlannedHours[],
  approvals: OtApproval[],
  statuses: AttendanceStatus[],
  holidays: Set<string>,
): RangeLedger {
  const plannedByDate = new Map<string, { startMin: number; endMin: number; declared: number }>();
  planned.filter(p => p.userId === userId).forEach(p => {
    const startMin = hhmmToMinutes(p.startTime), endMin = hhmmToMinutes(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins ?? 0) });
  });

  const eventsByDate = new Map<string, AttendanceRecord[]>();
  events.filter(e => e.userId === userId).forEach(e => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date)!.push(e);
  });

  const apprByDate = new Map<string, OtApproval>();
  approvals.filter(a => a.userId === userId).forEach(a => apprByDate.set(a.date, a));

  // Regularized-to-Present days carry an effective in/out captured by the admin (missed-punch
  // fix). These override raw events for the date so the corrected day can carry shortage/OT.
  const overrideByDate = new Map<string, { inMin: number; outMin: number }>();
  statuses.filter(s => s.userId === userId && s.status === 'Present' && s.inTime && s.outTime).forEach(s => {
    const inMin = hhmmToMinutes(s.inTime), outMin = hhmmToMinutes(s.outTime);
    if (outMin > inMin) overrideByDate.set(s.date, { inMin, outMin });
  });

  // Protocol 3: WO dates are computed BEFORE the accrual loop (previously derived after it)
  // so each date's accrueDay call can suppress that date's shift math exactly like a rest day.
  const woDates = statuses.filter(s => s.userId === userId && s.status === 'WO').map(s => s.date).sort();
  const woDateSet = new Set(woDates);

  let autoOtMins = 0, shortageMins = 0, pendingOtMins = 0;
  const pendingDates: string[] = [];

  const accrueDay = (date: string, inMin: number, outMin: number) => {
    const info = plannedByDate.get(date);
    const led = computeDayLedger({
      shiftStartMin: info?.startMin ?? DEFAULT_SHIFT_START_MIN,
      shiftEndMin:   info?.endMin   ?? DEFAULT_SHIFT_END_MIN,
      inMin, outMin,
      declaredOtMins: info?.declared ?? 0,
      isRestDay: isSunday(date) || holidays.has(date),
      isWoDay: woDateSet.has(date),
    });
    shortageMins   += led.shortageMins;
    autoOtMins     += led.autoOtMins;
    const remaining = Math.max(0, led.pendingExtraMins - (apprByDate.get(date)?.requestedMins ?? 0));
    if (remaining > 0) { pendingOtMins += remaining; pendingDates.push(date); }
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return; // regularization in/out is authoritative for this date
    const ins  = dayEvents.filter(e => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter(e => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return; // open/invalid day
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });

  // A WO day's own status doc always wins over a stale Present-regularization override for the
  // same date (WO is the later, authoritative admin decision) — accrueDay already treats it as
  // a WO day via woDateSet regardless of which branch called it.
  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  // Protocol 3: granted OT is net of whatever has already been spent settling a WO debt —
  // settled-away minutes must not ALSO count as payable cash (that would double-pay them).
  const grantedOtMins = Array.from(apprByDate.values())
    .reduce((s, a) => s + Math.max(0, (Number(a.approvedMins) || 0) - (Number(a.settledMins) || 0)), 0);
  const netMins = netLedgerMins({ autoOtMins, approvedGrantedMins: grantedOtMins, shortageMins });

  return {
    autoOtMins, grantedOtMins, shortageMins,
    woDates, netMins,
    pendingDates: pendingDates.sort(), pendingOtMins,
  };
}
```

- [ ] **Step 3: Update the `RangeLedger` interface**

Replace (currently lines 26-35):

```typescript
export interface RangeLedger {
  autoOtMins: number;
  grantedOtMins: number;   // sum of (approvedMins − settledMins) across ot_approvals decisions (Protocol 3)
  shortageMins: number;
  woDates: string[];
  netMins: number;         // (auto + granted) − shortage; WO debt no longer participates (Protocol 3) — see wo_ledger
  pendingDates: string[];  // un-decided pending OT days (block settlement) — includes rest and WO days
  pendingOtMins: number;
}
```

- [ ] **Step 4: Update `settlementCash`'s doc comment (function body is unchanged)**

Replace the comment above `settlementCash` (currently lines 118-120):

```typescript
// Settlement cash added to payroll TOTAL DUE: WO paid days — unconditional as of Protocol 3,
// no longer entangled with whether OT ever offsets them (that offsetting now happens entirely
// through the separate wo_ledger settlement flow, outside this function) — plus net OT/
// shortage at the straight per-minute rate (salaryRate/480).
```

(The function body itself — `const cash = woDays * salaryRate + (netMins / WO_DEBIT_MINS) * salaryRate; return Math.round(cash * 100) / 100;` — does not change.)

- [ ] **Step 5: Update `admin/src/lib/otAggregate.test.ts`**

Replace the "WO day status counted" test (currently lines 88-93):

```typescript
console.log('\nWO day alone (Protocol 3): woDates counted, but WO debt no longer touches netMins:');
const woStatus = [{ id: '2026-06-02', userId: U, date: '2026-06-02', status: 'WO' } as never];
r = computeRangeLedger(U, [], [], [], woStatus, noHol);
eq('woDates = 1', r.woDates.length, 1);
eq('net = 0 (no other activity; WO debt tracked entirely in wo_ledger now, not here)', r.netMins, 0);
```

Add a new test after it (this is the exact "leave at 2pm" scenario, now exercised through the full range aggregation rather than just `computeDayLedger` in isolation):

```typescript
console.log('\nWO day with partial punches (Protocol 3): no shortage, worked window becomes pending, not swallowed by the WO-dates-derived-after-the-loop bug:');
const planWo = [{ id: '2026-06-16', userId: U, date: '2026-06-16', startTime: '10:00', endTime: '18:00', declaredOtMins: 30 } as never];
const evWo = [ev(U, '2026-06-16', 'site_in', '10:00'), ev(U, '2026-06-16', 'site_out', '14:00')]; // told to leave at 2pm
const woStatusPartial = [{ id: '2026-06-16', userId: U, date: '2026-06-16', status: 'WO' } as never];
r = computeRangeLedger(U, evWo, planWo, [], woStatusPartial, noHol);
eq('shortage = 0 (WO suppresses the early-out shortage)', r.shortageMins, 0);
eq('pending = 240 (the 4h worked becomes pending OT, not lost)', r.pendingOtMins, 240);
eq('pending dates includes 2026-06-16', r.pendingDates[0], '2026-06-16');
eq('net = 0 (nothing auto-credited; the WO debt itself is tracked in wo_ledger, not here)', r.netMins, 0);
```

Add a new test for the settled-aware granted sum:

```typescript
console.log('\nsettledMins excludes already-spent OT from payable cash (Protocol 3):');
const apprSettled = [{ id: '2026-06-17', userId: U, date: '2026-06-17', requestedMins: 120, approvedMins: 120, settledMins: 50, status: 'approved' } as never];
r = computeRangeLedger(U, [], [], apprSettled, [], noHol);
eq('granted = 70 (120 approved − 50 already settled against a WO)', r.grantedOtMins, 70);
eq('net = 70', r.netMins, 70);
```

Replace the `settlementCash` test block (currently lines 140-145) — the two WO-flavored comments described a same-range-netting scenario that no longer arises naturally under Protocol 3 (a WO's debit no longer feeds `netMins`), so they're replaced with the realistic post-Protocol-3 shape:

```typescript
console.log('\nsettlementCash (rate ₹800/day) — pure function, unchanged formula:');
eq('1 WO day, no other activity → net 0 feeds in, WO pays unconditionally → 800', settlementCash(800, 1, 0), 800);
eq('1 WO day + 300 min of its own separately-tracked OT elsewhere this range → 800 + 500', settlementCash(800, 1, 480), 1600);
eq('no WO, net +480 OT → +800', settlementCash(800, 0, 480), 800);
eq('no WO, net -240 shortage → -400', settlementCash(800, 0, -240), -400);
```

- [ ] **Step 6: Run the admin test file to verify it passes**

Run: `cd admin && npx tsx src/lib/otAggregate.test.ts`
Expected: `✅ N passed, 0 failed`.

- [ ] **Step 7: Update `firebase/functions/otAggregate.js`**

Mirror Step 2 in `computeRangeLedger` (same reordering + `isWoDay` + settled-aware `grantedOtMins`), and update `dailyOtWoCash` (currently lines 107-181) — this function has no TS sibling, so it must be updated directly against the spec:

Replace `computeRangeLedger` body:

```javascript
function computeRangeLedger(userId, events, planned, approvals, statuses, holidays) {
  const plannedByDate = new Map();
  planned.filter((p) => p.userId === userId).forEach((p) => {
    const startMin = hhmmToMin(p.startTime), endMin = hhmmToMin(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins || 0) });
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

  const woDates = statuses.filter((s) => s.userId === userId && s.status === "WO").map((s) => s.date).sort();
  const woDateSet = new Set(woDates);

  let autoOtMins = 0, shortageMins = 0, pendingOtMins = 0;
  const pendingDates = [];

  const accrueDay = (date, inMin, outMin) => {
    const info = plannedByDate.get(date);
    const led = computeDayLedger({
      shiftStartMin: info ? info.startMin : DEFAULT_SHIFT_START_MIN,
      shiftEndMin:   info ? info.endMin   : DEFAULT_SHIFT_END_MIN,
      inMin, outMin,
      declaredOtMins: info ? info.declared : 0,
      isRestDay: isSunday(date) || holidays.has(date),
      isWoDay: woDateSet.has(date),
    });
    shortageMins += led.shortageMins;
    autoOtMins   += led.autoOtMins;
    const remaining = Math.max(0, led.pendingExtraMins - ((apprByDate.get(date) || {}).requestedMins || 0));
    if (remaining > 0) { pendingOtMins += remaining; pendingDates.push(date); }
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return;
    const ins  = dayEvents.filter((e) => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter((e) => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return;
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });

  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  const grantedOtMins = Array.from(apprByDate.values())
    .reduce((s, a) => s + Math.max(0, (Number(a.approvedMins) || 0) - (Number(a.settledMins) || 0)), 0);
  const netMins = netLedgerMins({ autoOtMins, approvedGrantedMins: grantedOtMins, shortageMins });

  return {
    autoOtMins, grantedOtMins, shortageMins,
    woDates, netMins,
    pendingDates: pendingDates.sort(), pendingOtMins,
  };
}
```

Replace `dailyOtWoCash` (currently lines 110-181) — the per-date cash split must also stop subtracting a WO debit and instead pay the WO date unconditionally, use `isWoDay` in its own `accrueDay`, and net settled-away minutes out of `granted`:

```javascript
function dailyOtWoCash(userId, salaryRate, events, planned, approvals, statuses, holidays) {
  const rate = Number(salaryRate) || 0;

  const plannedByDate = new Map();
  planned.filter((p) => p.userId === userId).forEach((p) => {
    const startMin = hhmmToMin(p.startTime), endMin = hhmmToMin(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins || 0) });
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

  const perDate = new Map(); // date → { autoOtMins, shortageMins }
  const ensure = (d) => {
    if (!perDate.has(d)) perDate.set(d, { autoOtMins: 0, shortageMins: 0 });
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
      isWoDay: woByDate.has(date),
    });
    const acc = ensure(date);
    acc.shortageMins += led.shortageMins;
    acc.autoOtMins   += led.autoOtMins;
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return;
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
    const p = perDate.get(date) || { autoOtMins: 0, shortageMins: 0 };
    const appr = apprByDate.get(date) || {};
    const granted = Math.max(0, (Number(appr.approvedMins) || 0) - (Number(appr.settledMins) || 0));
    const isWO = woByDate.has(date);
    // Protocol 3: a WO date pays unconditionally (no debit term); OT/shortage on any date
    // (WO or not) nets independently at the straight per-minute rate.
    const netMinsForDate = p.autoOtMins + granted - p.shortageMins;
    cash.set(date, (isWO ? rate : 0) + (netMinsForDate / WO_DEBIT_MINS) * rate);
  });
  return cash;
}
```

- [ ] **Step 8: Update `firebase/functions/otAggregate.test.js`**

Replace the "WO status counted" test (currently lines 100-106):

```javascript
test("WO day alone: woDates counted, but WO debt no longer touches netMins (Protocol 3)", () => {
  const woStatus = [{ id: "2026-06-02", userId: U, date: "2026-06-02", status: "WO" }];
  const r = computeRangeLedger(U, [], [], [], woStatus, noHol);
  assert.equal(r.woDates.length, 1);
  assert.equal(r.netMins, 0);
});
```

Add a new test immediately after it:

```javascript
test("WO day with partial punches: no shortage, worked window becomes pending (Protocol 3)", () => {
  const planWo = [{ id: "2026-06-16", userId: U, date: "2026-06-16", startTime: "10:00", endTime: "18:00", declaredOtMins: 30 }];
  const evWo = [ev(U, "2026-06-16", "site_in", "10:00"), ev(U, "2026-06-16", "site_out", "14:00")];
  const woStatusPartial = [{ id: "2026-06-16", userId: U, date: "2026-06-16", status: "WO" }];
  const r = computeRangeLedger(U, evWo, planWo, [], woStatusPartial, noHol);
  assert.equal(r.shortageMins, 0);
  assert.equal(r.pendingOtMins, 240);
  assert.equal(r.pendingDates[0], "2026-06-16");
  assert.equal(r.netMins, 0);
});

test("settledMins excludes already-spent OT from payable cash (Protocol 3)", () => {
  const apprSettled = [{ id: "2026-06-17", userId: U, date: "2026-06-17", requestedMins: 120, approvedMins: 120, settledMins: 50, status: "approved" }];
  const r = computeRangeLedger(U, [], [], apprSettled, [], noHol);
  assert.equal(r.grantedOtMins, 70);
  assert.equal(r.netMins, 70);
});
```

Update the `settlementCash` test comments (currently lines 156-162) the same way as Step 5's TS edit:

```javascript
test("settlementCash (rate 800) — pure function, unchanged formula", () => {
  assert.equal(settlementCash(800, 1, 0), 800);    // 1 WO day, no other activity: pays unconditionally
  assert.equal(settlementCash(800, 1, 480), 1600);  // 1 WO day + 480 min of separately-tracked OT elsewhere
  assert.equal(settlementCash(800, 0, 480), 800);
  assert.equal(settlementCash(800, 0, -240), -400);
});
```

Leave the `dailyOtWoCash` invariant tests (`"dailyOtWoCash: per-date values sum to the monthly settlementCash exactly"`, the `[BUG FIX]` one, `"a shortage-only day is negative"`, and `"rest-day date is..."`) **unedited** — they are self-consistency checks that compute both sides from the same (now-updated) functions and do not hardcode a WO-specific expected number, so they continue to pass once Step 7's `dailyOtWoCash` and `computeRangeLedger` changes land together. Confirm this by running them (next step) rather than assuming it.

- [ ] **Step 9: Run the functions test suite to verify it passes**

Run: `cd firebase/functions && npm test`
Expected: all tests pass, including the untouched `dailyOtWoCash` invariant tests and the new WO-partial-punch/settledMins cases.

- [ ] **Step 10: Commit**

```bash
git add admin/src/lib/otAggregate.ts admin/src/lib/otAggregate.test.ts admin/src/types/index.ts firebase/functions/otAggregate.js firebase/functions/otAggregate.test.js
git commit -m "feat(protocol-3): computeRangeLedger/dailyOtWoCash go WO-aware; settled OT excluded from cash"
```

---

### Task 3: `firestore.ts` — `wo_ledger` schema, creation on every WO path, settlement writer

**Files:**
- Modify: `admin/src/types/index.ts` (add `WoLedgerEntry`, `WoSettlementEntry`)
- Modify: `admin/src/lib/firestore.ts`
- Modify: `admin/src/app/(admin)/attendance/page.tsx` (its local `markWo`/`clearWo` must route through the updated shared functions)
- Modify: `admin/src/lib/firestore.ts`'s `approveRegularization` (WO outcome branch)

**Interfaces:**
- Consumes: `WO_DEBIT_MINS` from `otLedger.ts` (Task 1).
- Produces: `markWo(user, date, holidays)` — now writes `attendance_status` **and** `wo_ledger/{date}` atomically. `clearWo(userId, date)` — new export, deletes both docs atomically. `settleWoDebit(userId, woDate, otDate, minsApplied, appliedBy)` — new export, Task 6's UI calls this. `getOutstandingWoDebits(): Promise<WoLedgerEntry[]>`, `getOtApprovalsForUser(userId): Promise<OtApproval[]>`, `getSettlementsForUser(userId): Promise<Settlement[]>` — new exports, Task 6's UI calls these to build the settlement picker.

- [ ] **Step 1: Add the new types to `admin/src/types/index.ts`**

Add after the `ConveyanceRecord` interface:

```typescript
export interface WoLedgerEntry {
  id: string;             // = date (YYYY-MM-DD), the WO's own date
  date: string;
  userId: string;
  userName: string;
  employeeId: string;
  debitMins: number;      // always 480 (WO_DEBIT_MINS) at creation
  remainingMins: number;  // decremented by settlement applications; floored at 0
  status: 'outstanding' | 'settled' | 'forgiven';
  issuedAt: Timestamp;    // when the WO was marked (not the WO's own date)
  expiresAt: Timestamp;   // issuedAt + 2 calendar months
  settledAt?: Timestamp;
  forgivenAt?: Timestamp;
  markedBy: string;       // 'admin'
}

export interface WoSettlementEntry {
  id: string;         // auto-id
  otDate: string;
  minsApplied: number;
  appliedBy: string;
  appliedAt: Timestamp;
}
```

- [ ] **Step 2: Add a calendar-safe month-adding helper to `admin/src/lib/firestore.ts`**

Add near the top of the file, after the `stamped()` helper (currently ending at line 36):

```typescript
// Add `months` calendar months to a "YYYY-MM-DD" date string, clamping to the target month's
// last day if it doesn't have enough days (2026-01-31 + 1 month → 2026-02-28, never the raw
// JS Date behavior of overflowing into March). Used only for wo_ledger's expiresAt (Protocol 3).
function addCalendarMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetIndex = (m - 1) + months;
  const targetYear = y + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12; // 0-11
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}
```

- [ ] **Step 3: Rewrite `markWo` to also create the `wo_ledger` doc**

Replace the current `markWo` (lines 727-737):

```typescript
// Mark a paid WO (no-work day off) for an employee. Writes a markedBy:'admin' status doc the
// nightly function won't overwrite, AND a matching wo_ledger doc (Protocol 3) that tracks the
// 480-minute debt as an outstanding, explicitly-settleable record with a 2-month hard expiry.
// WO is illegal on a rest day (Protocol 1) — a rest day already carries no obligation, so a WO
// there is meaningless; setAttendanceStatus's guard throws before any such write reaches
// Firestore, and this whole batch never gets built in that case.
export async function markWo(user: User, date: string, holidays: Set<string> = new Set()): Promise<void> {
  assertNotRestDay(date, holidays);
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'users', user.id, 'attendance_status', date),
    stamped({
      date, userId: user.id, userName: user.name || '', employeeId: user.employeeId || '',
      role: user.role || '', status: 'WO', markedBy: 'admin', updatedAt: Timestamp.now(),
    }),
    { merge: true },
  );
  const issuedAt = Timestamp.now();
  const expiresAtDate = addCalendarMonths(istTodayStr(), 2);
  batch.set(
    doc(db, 'users', user.id, 'wo_ledger', date),
    stamped({
      date, userId: user.id, userName: user.name || '', employeeId: user.employeeId || '',
      debitMins: WO_DEBIT_MINS, remainingMins: WO_DEBIT_MINS, status: 'outstanding',
      issuedAt, expiresAt: Timestamp.fromDate(new Date(`${expiresAtDate}T23:59:59+05:30`)),
      markedBy: 'admin',
    }),
  );
  await batch.commit();
}
```

Add `WO_DEBIT_MINS` to the existing `from './otLedger'`-style import if `otLedger.ts` values aren't already imported into `firestore.ts` — check the current top-of-file imports first; if `otLedger.ts` is not yet imported here, add:

```typescript
import { WO_DEBIT_MINS } from './otLedger';
```

- [ ] **Step 4: Add `clearWo`, replacing bare `deleteAttendanceStatus` as the WO-clearing entry point**

Add immediately after `deleteAttendanceStatus` (currently lines 739-742) — keep `deleteAttendanceStatus` itself unchanged (it may still be useful generically), and add:

```typescript
// Clear a WO: deletes both the attendance_status doc and its wo_ledger entry, regardless of
// settlement progress. Any OT minutes already consumed settling this WO are NOT refunded —
// a deliberate simplification (Protocol 3), not an oversight.
export async function clearWo(userId: string, date: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', userId, 'attendance_status', date));
  batch.delete(doc(db, 'users', userId, 'wo_ledger', date));
  await batch.commit();
}
```

- [ ] **Step 5: Update `admin/src/app/(admin)/attendance/page.tsx`'s local `markWo`/`clearWo`**

The page currently defines its OWN local `markWo`/`clearWo` functions (approximately lines 328-369 — confirm against the actual file, Protocol 2's work may have shifted them slightly) that call `setAttendanceStatus`/`deleteAttendanceStatus` from `firestore.ts` directly — NOT the `firestore.ts`-exported `markWo`. First, add `markWo as fsMarkWo, clearWo as fsClearWo` to this page's existing `import { ... } from './firestore'` line (renamed on import so they don't collide with this page's own local function names below, which stay as-is for the JSX that calls them). Then replace the two functions' bodies:

```typescript
  async function markWo(user: User, date: string) {
    const key = `${user.id}__${date}`;
    setSaving(prev => ({ ...prev, [key]: true }));
    setSaveError('');
    try {
      await fsMarkWo(user, date, holidaySet);
      setStatusByDate(prev => {
        const next = new Map(prev);
        const dayMap = new Map(next.get(date) || new Map<string, AttendanceStatus>());
        dayMap.set(user.id, { id: date, date, userId: user.id, userName: user.name || '', employeeId: user.employeeId || '', role: user.role || '', status: 'WO', markedBy: 'admin' });
        next.set(date, dayMap);
        return next;
      });
    } catch (err) {
      setSaveError('Failed to mark WO. Please try again.');
      console.error(err);
    }
    setSaving(prev => ({ ...prev, [key]: false }));
  }

  async function clearWo(userId: string, date: string) {
    const key = `${userId}__${date}`;
    setSaving(prev => ({ ...prev, [key]: true }));
    setSaveError('');
    try {
      await fsClearWo(userId, date);
      setStatusByDate(prev => {
        const next = new Map(prev);
        const dayMap = new Map(next.get(date) || new Map<string, AttendanceStatus>());
        dayMap.delete(userId);
        next.set(date, dayMap);
        return next;
      });
    } catch (err) {
      setSaveError('Failed to clear WO. Please try again.');
      console.error(err);
    }
    setSaving(prev => ({ ...prev, [key]: false }));
  }
```

(Only the single inner Firestore call in each function changes — `setAttendanceStatus(...)` → `fsMarkWo(user, date, holidaySet)`, and `deleteAttendanceStatus(userId, date)` → `fsClearWo(userId, date)`. Every other line, including the doc comment above them, is unchanged.)

- [ ] **Step 6: Add the `wo_ledger` write to `approveRegularization`'s WO-outcome branch**

In `approveRegularization` (currently lines 457-527), after the existing `carryHours`/`attendance_status` `batch.set` (currently lines 477-489) and before the Protocol 2 conveyance block (currently starting at line 491), insert:

```typescript
  // Protocol 3 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): approving a
  // regularization TO a WO outcome creates the same wo_ledger debt record as marking WO
  // directly from the Attendance page — this is the second of the two real WO-creation paths
  // in the app (the other is attendance/page.tsx's markWo).
  if (approvedStatus === 'WO') {
    const issuedAt = Timestamp.now();
    const expiresAtDate = addCalendarMonths(istTodayStr(), 2);
    batch.set(
      doc(db, 'users', userId, 'wo_ledger', date),
      stamped({
        date, userId, userName, employeeId,
        debitMins: WO_DEBIT_MINS, remainingMins: WO_DEBIT_MINS, status: 'outstanding',
        issuedAt, expiresAt: Timestamp.fromDate(new Date(`${expiresAtDate}T23:59:59+05:30`)),
        markedBy: 'admin',
      }),
    );
  }
```

- [ ] **Step 7: Add read helpers for the Outstanding WOs UI (Task 6)**

Add after `clearWo` (Step 4's addition):

```typescript
// All outstanding wo_ledger docs across every employee, for the Outstanding WOs admin view.
// collectionGroup — see firestore.rules for the matching READ-ONLY collection-group rule.
export async function getOutstandingWoDebits(): Promise<WoLedgerEntry[]> {
  const q = query(collectionGroup(db, 'wo_ledger'), where('status', '==', 'outstanding'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WoLedgerEntry));
}

// One employee's OT decisions (any date, any month) — the settlement picker needs to offer
// sources beyond just the current settlement range, since a WO can be settled with OT from
// any earlier unlocked month.
export async function getOtApprovalsForUser(userId: string): Promise<OtApproval[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'ot_approvals'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OtApproval));
}

// One employee's settlement docs (any month) — used to determine which of their ot_approvals
// dates fall in an already-locked (unavailable) month.
export async function getSettlementsForUser(userId: string): Promise<Settlement[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'settlements'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Settlement));
}
```

- [ ] **Step 8: Add `settleWoDebit`, the settlement-application writer**

Add after Step 7's read helpers:

```typescript
// Apply `minsApplied` minutes of OT from `otDate` to reduce the outstanding balance of the WO
// on `woDate`. Validates both sides' remaining capacity client-side before writing (rules
// independently enforce access + the "OT source's month isn't locked" check — see
// firestore.rules). Throws with a clear message rather than letting a batch fail opaquely.
export async function settleWoDebit(
  userId: string, woDate: string, otDate: string, minsApplied: number, appliedBy: string,
): Promise<void> {
  if (minsApplied <= 0) throw new Error('minsApplied must be positive.');

  const [woSnap, otSnap, settlementSnap] = await Promise.all([
    getDoc(doc(db, 'users', userId, 'wo_ledger', woDate)),
    getDoc(doc(db, 'users', userId, 'ot_approvals', otDate)),
    getDoc(doc(db, 'users', userId, 'settlements', otDate.slice(0, 7))),
  ]);
  if (!woSnap.exists()) throw new Error(`No wo_ledger entry for ${woDate}.`);
  if (!otSnap.exists()) throw new Error(`No ot_approvals entry for ${otDate}.`);
  if (settlementSnap.exists() && settlementSnap.data().locked) {
    throw new Error(`${otDate}'s month is already Settled & Locked — its OT can no longer be redirected.`);
  }

  const wo = woSnap.data();
  const ot = otSnap.data();
  const woRemaining = Number(wo.remainingMins) || 0;
  const otAvailable = Math.max(0, (Number(ot.approvedMins) || 0) - (Number(ot.settledMins) || 0));
  if (minsApplied > woRemaining) throw new Error(`Cannot apply ${minsApplied} min — only ${woRemaining} min remain outstanding on ${woDate}.`);
  if (minsApplied > otAvailable) throw new Error(`Cannot apply ${minsApplied} min — only ${otAvailable} min available on ${otDate}.`);

  const newRemaining = woRemaining - minsApplied;
  const batch = writeBatch(db);
  const settlementRef = doc(collection(db, 'users', userId, 'wo_ledger', woDate, 'settlements'));
  batch.set(settlementRef, stamped({ otDate, minsApplied, appliedBy, appliedAt: Timestamp.now() }));
  batch.update(
    doc(db, 'users', userId, 'wo_ledger', woDate),
    stamped({
      remainingMins: newRemaining,
      status: newRemaining <= 0 ? 'settled' : 'outstanding',
      ...(newRemaining <= 0 ? { settledAt: Timestamp.now() } : {}),
    }),
  );
  batch.update(
    doc(db, 'users', userId, 'ot_approvals', otDate),
    stamped({ settledMins: (Number(ot.settledMins) || 0) + minsApplied }),
  );
  await batch.commit();
}
```

- [ ] **Step 9: Manual smoke test**

Run: `cd admin && npm run build`
Expected: TypeScript compiles clean (no type errors from the new `WoLedgerEntry`/`WoSettlementEntry` types, the `settledMins` addition, or the new/changed `firestore.ts` exports).

- [ ] **Step 10: Commit**

```bash
git add admin/src/types/index.ts admin/src/lib/firestore.ts "admin/src/app/(admin)/attendance/page.tsx"
git commit -m "feat(protocol-3): wo_ledger schema, creation on both WO paths, explicit settlement writer"
```

---

### Task 4: `firestore.rules` — `wo_ledger` access rules + rules-tests

**Files:**
- Modify: `firebase/firestore.rules`
- Create: `firebase/rules-tests/wo-ledger-settlement.test.js`

**Interfaces:**
- Consumes: `isSettledMonth(userId, date)`, `canWriteOtApprovals()`, `canReadOtApprovals()`, `notSelf(userId)` — all pre-existing helpers in `firestore.rules`.
- Produces: `wo_ledger`/`wo_ledger/{date}/settlements` collections become writable/readable per this task's rules — Task 6's UI and Task 3's `firestore.ts` functions depend on these rules existing before they can succeed against a real project (they already work against the rules emulator once this task lands).

- [ ] **Step 1: Add the per-user `wo_ledger` match block to `firebase/firestore.rules`**

Insert after the `/ot_approvals/{date}` match block (currently lines 467-475) and before `/settlements/{month}`:

```
      // ── /wo_ledger/{date} ──────────────────────────────────────────────
      // Protocol 3 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): an outstanding
      // WO debt record, created alongside the WO's attendance_status doc. Read/write mirrors
      // ot_approvals exactly — the same Attendance/OT & Shortage tabs that grant OT are the
      // ones that create, clear, or (via the settlements subcollection below) pay down a WO.
      match /wo_ledger/{date} {
        allow read:  if isLoggedIn() && (isOwner(userId) || isAdmin() || canReadOtApprovals());
        // notSelf: marking your own WO settled/forgiven is adjusting your own debt record.
        allow write: if isLoggedIn() && (isAdmin() || (canWriteOtApprovals() && notSelf(userId)));

        // ── /wo_ledger/{date}/settlements/{autoId} ─────────────────────
        // One immutable log entry per settlement application (an admin spending some OT's
        // minutes to pay down this WO). The OT source's own home month must not already be
        // Settled & Locked — that cash is already paid and cannot be redirected retroactively.
        match /settlements/{autoId} {
          allow read:   if isLoggedIn() && (isOwner(userId) || isAdmin() || canReadOtApprovals());
          allow create: if isLoggedIn() && (isAdmin() || (canWriteOtApprovals() && notSelf(userId)))
                        && !isSettledMonth(userId, request.resource.data.otDate);
          allow update: if false; // immutable log — settle again with a new entry, never edit one
          allow delete: if false;
        }
      }
```

- [ ] **Step 2: Add the collection-group read rule**

Insert after the `/{path=**}/ot_approvals/{date}` collection-group rule (currently lines 584-587):

```
    // Required for the Outstanding WOs admin view, which does collectionGroup("wo_ledger")
    // across every employee. READ-ONLY on purpose, same reasoning as attendance_status/
    // specialAllowance above: a collectionGroup match cannot bind {userId}, so it cannot
    // enforce notSelf. Writes must go through /users/{userId}/wo_ledger/{date}, which knows
    // whose record it is.
    match /{path=**}/wo_ledger/{date} {
      allow read: if isLoggedIn() && (isAdmin() || canReadOtApprovals());
    }
```

- [ ] **Step 3: Write `firebase/rules-tests/wo-ledger-settlement.test.js`**

```javascript
"use strict";

/**
 * Protocol 3 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): wo_ledger and its
 * settlements subcollection mirror ot_approvals' access pattern exactly. These tests lock in
 * the settlements-subcollection's extra "OT source's month must not be locked" guard, since
 * that is the one rule new to this collection (ot_approvals itself has no such guard on its
 * own writes).
 *
 * Dates: 2026-09-15/16 (Tuesday/Wednesday) — ordinary weekdays, not Sundays, so Protocol 1's
 * rest-day immutability never interferes with these tests.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const {
  TABS, setup, teardown, seedUsers, seedDocs, asUser, assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:  { role: "admin", name: "Admin" },
    otMgr:  { role: "office", tabAccess: [TABS.OT_SHORTAGE] },
    emp:    { role: "operations", name: "Employee" },
    other:  { role: "operations", name: "Other" },
  });
});

after(async () => { await teardown(); });

beforeEach(async () => {
  await seedDocs(env, {
    "users/emp/wo_ledger/2026-09-15": {
      date: "2026-09-15", userId: "emp", debitMins: 480, remainingMins: 480, status: "outstanding",
    },
    "users/emp/ot_approvals/2026-09-16": {
      date: "2026-09-16", userId: "emp", approvedMins: 120, settledMins: 0, status: "approved",
    },
    "users/emp/settlements/2026-09": { locked: false },
  });
});

test("an OT & Shortage manager can create a wo_ledger doc", async () => {
  const db = asUser(env, "otMgr");
  await assertSucceeds(
    db.doc("users/other/wo_ledger/2026-09-15").set({
      date: "2026-09-15", userId: "other", debitMins: 480, remainingMins: 480, status: "outstanding",
    }),
  );
});

test("a manager without Attendance or OT & Shortage cannot create a wo_ledger doc", async () => {
  const db = asUser(env, "emp"); // no tabAccess at all
  await assertFails(
    db.doc("users/other/wo_ledger/2026-09-15").set({
      date: "2026-09-15", userId: "other", debitMins: 480, remainingMins: 480, status: "outstanding",
    }),
  );
});

test("an OT & Shortage manager can create a settlement entry against an unlocked month", async () => {
  const db = asUser(env, "otMgr");
  await assertSucceeds(
    db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "OT Manager",
    }),
  );
});

test("a settlement entry against an already-LOCKED month is denied", async () => {
  await seedDocs(env, { "users/emp/settlements/2026-09": { locked: true } });
  const db = asUser(env, "otMgr");
  await assertFails(
    db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "OT Manager",
    }),
  );
});

test("a settlement entry is denied for a manager settling their own WO (notSelf)", async () => {
  await seedUsers(env, { otMgrSelf: { role: "office", tabAccess: [TABS.OT_SHORTAGE] } });
  await seedDocs(env, {
    "users/otMgrSelf/wo_ledger/2026-09-15": {
      date: "2026-09-15", userId: "otMgrSelf", debitMins: 480, remainingMins: 480, status: "outstanding",
    },
    "users/otMgrSelf/ot_approvals/2026-09-16": {
      date: "2026-09-16", userId: "otMgrSelf", approvedMins: 120, settledMins: 0, status: "approved",
    },
  });
  const db = asUser(env, "otMgrSelf");
  await assertFails(
    db.collection("users/otMgrSelf/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "OT Manager",
    }),
  );
});

test("full admin can create a wo_ledger doc and a settlement entry with no tabAccess at all", async () => {
  const db = asUser(env, "admin");
  await assertSucceeds(
    db.doc("users/other/wo_ledger/2026-09-16").set({
      date: "2026-09-16", userId: "other", debitMins: 480, remainingMins: 480, status: "outstanding",
    }),
  );
  await assertSucceeds(
    db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
      otDate: "2026-09-16", minsApplied: 120, appliedBy: "Admin",
    }),
  );
});

test("a settlement entry is immutable — update and delete are both denied", async () => {
  const db = asUser(env, "admin");
  const ref = await db.collection("users/emp/wo_ledger/2026-09-15/settlements").add({
    otDate: "2026-09-16", minsApplied: 50, appliedBy: "Admin",
  });
  await assertFails(ref.update({ minsApplied: 100 }));
  await assertFails(ref.delete());
});

test("an employee can read their own wo_ledger doc but not another employee's", async () => {
  const db = asUser(env, "emp");
  await assertSucceeds(db.doc("users/emp/wo_ledger/2026-09-15").get());
  await assertFails(db.doc("users/other/wo_ledger/2026-09-15").get());
});
```

- [ ] **Step 4: Run the rules-tests suite before AND after (the suite must already pass on the unmodified rules, confirming the baseline)**

Run: `cd firebase/rules-tests && npm test`
Expected: all 72+ existing tests plus this task's new file's tests pass (0 failures). If any pre-existing test fails, stop — that failure predates this task and must be understood before continuing (do not attribute it to this change without checking `git diff` first).

- [ ] **Step 5: Commit**

```bash
git add firebase/firestore.rules firebase/rules-tests/wo-ledger-settlement.test.js
git commit -m "feat(protocol-3): wo_ledger firestore rules + rules-tests"
```

---

### Task 5: `functions/index.js` — WO-aware Sheets export call sites + 2-month expiry job

**Files:**
- Modify: `firebase/functions/index.js`

**Interfaces:**
- Consumes: `computeDayLedger`'s `isWoDay` (Task 1), `otAggregate.js`'s updated `computeRangeLedger`/`dailyOtWoCash` (Task 2), the `wo_ledger` collection (Task 3/4).
- Produces: a new exported scheduled Cloud Function (name it `expireWoDebits`) — no other task depends on this function directly, but it must be deployed alongside the others.

- [ ] **Step 1: Make the Attendance tab's OT column WO-aware (around line 1018)**

The `statusMap` (built at line 841, `${d.userId}__${d.date}` → status string) already carries `'WO'` for a WO date — no new query is needed. Change the `computeDayLedger` call at (approximately) line 1018 from:

```javascript
            const led = computeDayLedger({
              shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
              shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
              inMin, outMin,
              declaredOtMins: plan ? plan.declared : 0,
              isRestDay: restDay,
            });
```

to:

```javascript
            const led = computeDayLedger({
              shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
              shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
              inMin, outMin,
              declaredOtMins: plan ? plan.declared : 0,
              isRestDay: restDay,
              isWoDay: statusMap.get(key) === 'WO',
            });
```

- [ ] **Step 2: Same change for the Overtime Exception Report tab (around line 1134)**

```javascript
        led = computeDayLedger({
          shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
          shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
          inMin, outMin,
          declaredOtMins: plan ? plan.declared : 0,
          isRestDay: restDay,
          isWoDay: statusMap.get(key) === 'WO',
        });
```

Also update the `rawOtMins`/`approvedOtMins` split immediately below (currently lines 1148-1157) so a WO day is treated like a rest day for that split too:

```javascript
        let rawOtMins = 0, approvedOtMins = 0;
        if (inMin != null && outMin != null) {
          const isWoDay = statusMap.get(key) === 'WO';
          if (restDay || isWoDay) {
            rawOtMins = Math.max(0, outMin - inMin);
            approvedOtMins = 0; // never auto-credited on a rest/WO day; approvalMap adds any grant below
          } else {
            rawOtMins = led.autoOtMins + led.pendingExtraMins;
            approvedOtMins = led.autoOtMins;
          }
        }
```

- [ ] **Step 3: Same change for the Manpower Utilisation "Remarks" credited-OT (around line 1339)**

```javascript
          const led = computeDayLedger({
            shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
            shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
            inMin, outMin,
            declaredOtMins: plan ? plan.declared : 0,
            isRestDay: restDay,
            isWoDay: statusMap.get(key) === 'WO',
          });
```

- [ ] **Step 4: Make `approvalMap`'s stored value settled-aware (around line 874-880)**

Change the single line that populates `approvalMap` so all three call sites above (which all read `approvalMap.get(key) || 0`) automatically get the settled-adjusted figure with no further edits:

```javascript
    const approvalMap = new Map(); // `${uid}__${date}` → granted OT mins available for cash (approvedMins − settledMins; rejected → 0)
    const otDecisionMap = new Map();
    const approvalSnap = await db.collectionGroup("ot_approvals").get();
    approvalSnap.docs.forEach((doc) => {
      const d = doc.data();
      const key = `${uidOf(doc)}__${d.date || ""}`;
      approvalMap.set(key, Math.max(0, (Number(d.approvedMins) || 0) - (Number(d.settledMins) || 0)));
```

(The rest of that `forEach` body, including `otDecisionMap.set(...)`, is unchanged.)

- [ ] **Step 5: Add the 2-month expiry scheduled function**

Add near the other scheduled functions in `firebase/functions/index.js` (this file already imports `onSchedule` from `firebase-functions/v2/scheduler` at the top — do not add a new import). Follow `computeDailyAttendanceStatus`'s exact declaration shape (schedule options object, then an `async () => { ... }` body that opens its own `admin.firestore()` handle):

```javascript
// Protocol 3 (docs/superpowers/specs/2026-09-14-ot-redesign-design.md): a WO debt not fully
// settled within 2 months of being issued is written off automatically, with zero pay impact
// — it simply stops being offered as settleable. Runs daily; Admin SDK bypasses rules.
exports.expireWoDebits = onSchedule(
  {
    schedule: "30 23 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300,
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collectionGroup("wo_ledger")
      .where("status", "==", "outstanding")
      .where("expiresAt", "<=", now)
      .get();
    if (snap.empty) return null;

    let batch = db.batch();
    let ops = 0;
    for (const docSnap of snap.docs) {
      batch.update(docSnap.ref, { status: "forgiven", forgivenAt: now });
      ops++;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
    return null;
  },
);
```

A collection-group query needs a matching composite index for `status == 'outstanding' && expiresAt <= now`. If `firebase deploy --only functions` reports a missing-index error on first deploy, follow the Firebase Console link it prints (the same workflow this repo already uses for its other collection-group queries, per the root `CLAUDE.md`'s indexing note).

- [ ] **Step 6: Run the functions test suite**

Run: `cd firebase/functions && npm test`
Expected: all tests pass (this task changes call sites, not pure functions, so no new unit tests are required here — Task 2's `otAggregate.test.js` already covers the underlying math this task wires in).

- [ ] **Step 7: Validate syntax**

Run: `cd firebase/functions && node --check index.js`
Expected: no output (valid syntax) — this repo's eslint config is stale on modern JS syntax, so `node --check` is the validation step, not `npm run lint` (per root `CLAUDE.md`).

- [ ] **Step 8: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(protocol-3): Sheets export call sites go WO-aware; add 2-month WO expiry job"
```

---

### Task 6: `ot-shortage/page.tsx` and `working-hours-shortage-excess/page.tsx` — remaining duplicated aggregation call sites go WO-aware

Both pages have their own independent inline `aggregateForEmployee` functions — neither calls `computeRangeLedger` from `otAggregate.ts`, so neither was caught by the earlier grep-based research pass that only searched `firebase/functions/index.js`. Both call `computeDayLedger` directly with the pre-Protocol-3 signature (missing `isWoDay`), and `ot-shortage/page.tsx` also calls `netLedgerMins` with the pre-Protocol-3 4-argument signature, so it will fail to compile the moment Task 1 lands unless fixed. Confirmed via `grep -rln "computeDayLedger(\|netLedgerMins(" admin/src firebase/functions` that these two files plus `otAggregate.ts`/`.js`, `otLedger.ts`/`.js`, and `firebase/functions/index.js` (Task 5) are the complete set of call sites in the repo — no others remain.

**Files:**
- Modify: `admin/src/app/(admin)/ot-shortage/page.tsx`
- Modify: `admin/src/app/(admin)/working-hours-shortage-excess/page.tsx`

**Interfaces:**
- Consumes: `computeDayLedger`'s `isWoDay` and `netLedgerMins`'s WO-debit-free signature (Task 1).
- Produces: nothing new — `EmpRow`'s `woDebitMins`/`netLedgerMins` fields keep their existing names and types; only what feeds them changes.

- [ ] **Step 1: Replace `aggregateForEmployee` in full**

Replace the entire function (currently lines 161-319):

```typescript
function aggregateForEmployee(
  user: User,
  allEvents: AttendanceRecord[],
  plannedItems: PlannedHours[],
  approvals: OtApproval[],
  statuses: AttendanceStatus[],
  start: string,
  end: string,
  holidays: Set<string>,
): EmpRow {
  const isOps = user.role === 'operations';
  const userEvents = allEvents.filter(e => e.userId === user.id);

  const plannedByDate = new Map<string, { planned: number; declared: number; startTime: string; endTime: string }>();
  plannedItems.filter(p => p.userId === user.id).forEach(p => {
    const dur = hhmmToMinutes(p.endTime) - hhmmToMinutes(p.startTime);
    if (dur > 0) plannedByDate.set(p.date, { planned: dur, declared: Math.max(0, p.declaredOtMins ?? 0), startTime: p.startTime, endTime: p.endTime });
  });

  let workingMins: number | null;
  if (isOps) {
    let total = 0;
    plannedByDate.forEach(d => { total += d.planned; });
    workingMins = total > 0 ? total : null;
  } else {
    workingMins = countWorkingDays(start, end, holidays) * OFFICE_DAY_MINS;
  }

  // Protocol 3: WO dates are needed BEFORE commitDay is defined (moved up from after the
  // event loop) so each date's computeDayLedger call can suppress that date's shift math
  // exactly like a rest day.
  const woDates = isOps
    ? statuses.filter(s => s.userId === user.id && s.status === 'WO').map(s => s.date).sort()
    : [];
  const woDateSet = new Set(woDates);

  const eventsByDate = new Map<string, AttendanceRecord[]>();
  userEvents.forEach(e => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date)!.push(e);
  });

  let totalActualMins = 0;
  let hasAnyActual = false;
  let shortageRangeMins = 0;
  let autoOtRangeMins = 0;
  const otDays: DayDetail[] = [];
  const shortageDays: DayDetail[] = [];
  const workedDays: DayDetail[] = [];
  let globalFirstIn: number | null = null;
  let globalLastOut: number | null = null;

  const commitDay = (date: string, firstIn: number, lastOut: number, regularized: boolean) => {
    const dayMins = Math.round((lastOut - firstIn) / 60);
    totalActualMins += dayMins;
    hasAnyActual = true;
    if (globalFirstIn === null || firstIn < globalFirstIn) globalFirstIn = firstIn;
    if (globalLastOut === null || lastOut > globalLastOut) globalLastOut = lastOut;

    const restDay     = isSunday(date) || holidays.has(date);
    const planInfo    = isOps ? plannedByDate.get(date) : { planned: OFFICE_DAY_MINS, declared: 0, startTime: '10:00', endTime: '18:00' };
    const shiftStartMin = planInfo ? hhmmToMinutes(planInfo.startTime) : DEFAULT_SHIFT_START_MIN;
    const shiftEndMin   = planInfo ? hhmmToMinutes(planInfo.endTime)   : DEFAULT_SHIFT_END_MIN;
    const plannedDay  = shiftEndMin - shiftStartMin;
    const declaredDay = planInfo?.declared ?? 0;
    const detail: DayDetail = {
      date, plannedMins: plannedDay, plannedStart: planInfo?.startTime ?? '10:00', plannedEnd: planInfo?.endTime ?? '18:00',
      declaredOtMins: declaredDay, actualMins: dayMins,
      autoOtMins: 0, pendingExtraMins: 0, shortageMins: 0, isRestDay: restDay,
      firstInSecs: firstIn, lastOutSecs: lastOut, regularized,
    };

    if (isOps) {
      const led = computeDayLedger({
        shiftStartMin, shiftEndMin,
        inMin: istMinuteOfDay(firstIn), outMin: istMinuteOfDay(lastOut),
        declaredOtMins: declaredDay,
        isRestDay: restDay,
        isWoDay: woDateSet.has(date),
      });
      detail.shortageMins     = led.shortageMins;
      detail.autoOtMins       = led.autoOtMins;
      detail.pendingExtraMins = led.pendingExtraMins;

      if (led.shortageMins > 0)     { shortageRangeMins += led.shortageMins; shortageDays.push(detail); }
      if (led.autoOtMins > 0)       autoOtRangeMins += led.autoOtMins;
      // A rest OR WO day's full worked window arrives here as pendingExtraMins — it joins the
      // ordinary pending-OT queue, labelled Sunday/Holiday in the UI below (a WO day gets no
      // special label here, it just has 0 shortage/autoOt like a rest day would).
      if (led.pendingExtraMins > 0) otDays.push(detail);
    }
    workedDays.push(detail);
  };

  const overrideByDate = new Map<string, { inSecs: number; outSecs: number }>();
  if (isOps) {
    statuses.filter(s => s.userId === user.id && s.status === 'Present' && s.inTime && s.outTime).forEach(s => {
      const inSecs = istHHMMToSecs(s.date, s.inTime!), outSecs = istHHMMToSecs(s.date, s.outTime!);
      if (outSecs > inSecs) overrideByDate.set(s.date, { inSecs, outSecs });
    });
  }

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return;
    const inEvents  = dayEvents.filter(e => isOps ? OPS_IN_TYPES.has(e.type)  : e.type === 'office_in');
    const outEvents = dayEvents.filter(e => isOps ? OPS_OUT_TYPES.has(e.type) : e.type === 'office_out');
    if (inEvents.length === 0) return;

    const firstIn = Math.min(...inEvents.map(tsSeconds));
    const lastOut = outEvents.length ? Math.max(...outEvents.map(tsSeconds)) : null;
    if (globalFirstIn === null || firstIn < globalFirstIn) globalFirstIn = firstIn;

    if (lastOut === null || lastOut <= firstIn) return;

    commitDay(date, firstIn, lastOut, false);
  });

  overrideByDate.forEach((o, date) => commitDay(date, o.inSecs, o.outSecs, true));

  const approvedByDate = new Map<string, OtApproval>();
  approvals.filter(a => a.userId === user.id).forEach(a => approvedByDate.set(a.date, a));

  const pendingOt = otDays.filter(d => !approvedByDate.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const pendingOtMins = pendingOt.reduce((s, d) => s + d.pendingExtraMins, 0);
  const approvedInRange = Array.from(approvedByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  // Protocol 3: net of whatever has already been spent settling a WO debt — settled-away
  // minutes must not ALSO display as payable/approved OT here.
  const approvedOtRangeMins = approvedInRange.reduce((s, a) => s + Math.max(0, (a.approvedMins || 0) - (a.settledMins || 0)), 0);

  // WO debit (ops only, DISPLAY ONLY as of Protocol 3): each WO-marked day owes a standard 8h,
  // now tracked and settled entirely through the separate wo_ledger collection — no longer
  // subtracted from netLedgerMins below. Kept here purely as an informational figure.
  const woDebitMins = woDates.length * WO_DEBIT_MINS;

  // Net ledger for the range: approved OT minus shortage. WO debt no longer participates
  // (Protocol 3) — see the Outstanding WOs section on the OT Settlements page (Task 7) for
  // that. Informational only — no payroll effect yet.
  const rangeNetMins = isOps
    ? netLedgerMins({ autoOtMins: autoOtRangeMins, approvedGrantedMins: approvedOtRangeMins, shortageMins: shortageRangeMins })
    : 0;

  return {
    user,
    isOps,
    workingMins,
    actualMins: hasAnyActual ? totalActualMins : null,
    firstInSecs: globalFirstIn,
    lastOutSecs: globalLastOut,
    workedDays: workedDays.sort((a, b) => a.date.localeCompare(b.date)),
    shortageRangeMins,
    pendingOt,
    pendingOtMins,
    autoOtRangeMins,
    approvedInRange,
    approvedOtRangeMins,
    shortageDays: shortageDays.sort((a, b) => a.date.localeCompare(b.date)),
    woDates,
    woDebitMins,
    netLedgerMins: rangeNetMins,
  };
}
```

The `EmpRow` interface (currently lines 139-159) is **unchanged** — `woDebitMins`/`netLedgerMins` keep their existing names and types; only what feeds them changes. `DayDetail`, `TH`, `totals` (lines 710-718), and `exportXlsx` (lines 720-739) are all unchanged — they only read fields already on `EmpRow`/`DayDetail`, none of which changed shape.

- [ ] **Step 2: Fix the now-inaccurate "− WO" label in the detail modal**

Find the modal's net-ledger display line (approximately in the per-employee detail modal, alongside the `row.netLedgerMins` display seen during planning):

```typescript
<div className="text-sm text-text-secondary">Net ledger (range) · approved OT − shortage − WO</div>
```

Replace with:

```typescript
<div className="text-sm text-text-secondary">Net ledger (range) · approved OT − shortage</div>
```

- [ ] **Step 3: Fix `working-hours-shortage-excess/page.tsx`'s `aggregateForEmployee`**

This page does not call `netLedgerMins` at all (it only displays raw per-day shortage/excess/OT, no net figure), so only its `computeDayLedger` call needs `isWoDay`. `statuses: AttendanceStatus[]` is already a parameter of this function (currently line 139) and already loaded by the page (`getAttendanceStatusForDateRange`), so no new data fetch is needed.

Insert, immediately before the `commitDay` definition (currently line 188, right after the `eventsByDate` construction ending at line 177):

```typescript
  // Protocol 3: WO dates, needed so commitDay can suppress that date's shift math exactly
  // like a rest day (ops/usesLedger only — WO has no meaning for office/admin/sales here).
  const woDateSet = usesLedger
    ? new Set(statuses.filter(s => s.userId === user.id && s.status === 'WO').map(s => s.date))
    : new Set<string>();
```

Then inside `commitDay` (currently lines 189-227), change the `computeDayLedger` call (currently lines 208-211):

```typescript
      const led = computeDayLedger({
        shiftStartMin, shiftEndMin, inMin, outMin,
        declaredOtMins: declaredDay, isRestDay: restDay, isWoDay: woDateSet.has(date),
      });
```

And update the `rawExcessMins` line immediately below it (currently line 216) so a WO day's raw-excess display matches `computeDayLedger`'s own treatment (whole worked window, not "past shift end" — a WO day has no decided shift end to measure against, same reasoning as a rest day):

```typescript
      // Raw excess = actual time worked past the decided shift end, regardless of approval
      // status. On a rest OR WO day there's no decided shift, so any time worked at all counts.
      rawExcessMins += (restDay || woDateSet.has(date)) ? Math.max(0, outMin - inMin) : Math.max(0, outMin - shiftEndMin);
```

- [ ] **Step 4: Run the build to verify both files compile**

Run: `cd admin && npm run build`
Expected: TypeScript compiles clean — no leftover reference to the old 4-argument `netLedgerMins` signature or any `computeDayLedger` call missing `isWoDay` anywhere in either file.

- [ ] **Step 5: Commit**

```bash
git add "admin/src/app/(admin)/ot-shortage/page.tsx" "admin/src/app/(admin)/working-hours-shortage-excess/page.tsx"
git commit -m "fix(protocol-3): remaining inline aggregation call sites go WO-aware"
```

---

### Task 7: Admin UI — Outstanding WOs list + Settle action on `/ot-settlements`

**Files:**
- Modify: `admin/src/app/(admin)/ot-settlements/page.tsx`

**Interfaces:**
- Consumes: `getOutstandingWoDebits`, `getOtApprovalsForUser`, `getSettlementsForUser`, `settleWoDebit` (Task 3), `WoLedgerEntry` (Task 3's types addition).
- Produces: nothing further consumed elsewhere — this is the plan's last task.

- [ ] **Step 1: Read the current file before editing**

Read `admin/src/app/(admin)/ot-settlements/page.tsx` in full. Confirm: the `loadData()` `Promise.all` (approximately lines 88-111), the `rows` `useMemo` (approximately lines 122-131) using `computeRangeLedger`/`settlementCash`, the `handleSettle()` function (approximately lines 164-197) that calls `settleMonth`, the `TH` class constant (approximately line 249), the badge color classes (`bg-[#EAF7F0] text-[#0A7A50]` for locked/green, `bg-[#FDF3E4] text-[#B26B07]` for amber/blocked), and the "Special Allowance" section's table/mobile-card structure (approximately lines 408-499), which is this task's pattern to follow for a new "Outstanding WOs" section. Line numbers are approximate — confirm against the actual file before editing, since Protocol 1/2's work may have shifted them slightly.

- [ ] **Step 2: Fix both remaining `ledger.woDebitMins` references — the field no longer exists on `RangeLedger`**

`computeRangeLedger`'s return no longer has a `woDebitMins` field (Task 2), so both of this page's existing reads of it will fail to compile:

1. `handleSettle`'s row-mapping (approximately line 181), which builds the `Settlement` objects passed to `settleMonth`: change `woDebitMins: r.ledger.woDebitMins,` to `woDebitMins: r.ledger.woDates.length * WO_DEBIT_MINS,` — the frozen `Settlement` doc keeps this field, since it's still meaningful as a point-in-time "this many WO days existed," even though it no longer feeds `netMins`.
2. The table's WO column cell (approximately line 373): change

```typescript
<td className="px-[14px] py-3 text-xs font-mono text-[#1A5FAF]">{r.ledger.woDates.length ? `${r.ledger.woDates.length}d · -${minutesToDisplay(r.ledger.woDebitMins)}` : '—'}</td>
```

to:

```typescript
<td className="px-[14px] py-3 text-xs font-mono text-[#1A5FAF]">{r.ledger.woDates.length ? `${r.ledger.woDates.length}d · -${minutesToDisplay(r.ledger.woDates.length * WO_DEBIT_MINS)}` : '—'}</td>
```

Add `WO_DEBIT_MINS` to this file's existing import from `../../../lib/otLedger` (or wherever this page currently imports ledger constants/functions from — check the existing import line for `computeRangeLedger`/`settlementCash` and add `WO_DEBIT_MINS` alongside).

- [ ] **Step 3: Add state and data-loading for outstanding WOs**

Near the component's other `useState` declarations, add:

```typescript
const [outstandingWos, setOutstandingWos] = useState<WoLedgerEntry[]>([]);
const [settleTarget, setSettleTarget] = useState<WoLedgerEntry | null>(null);
```

In `loadData()`'s existing `Promise.all`, add `getOutstandingWoDebits()` as one more parallel fetch and assign its result to `setOutstandingWos`. Add the corresponding import from `../../../lib/firestore` (or this file's existing relative import path for firestore functions) alongside the other imports on this page: `getOutstandingWoDebits, getOtApprovalsForUser, getSettlementsForUser, settleWoDebit`, and `WoLedgerEntry` from the types import.

- [ ] **Step 4: Add the "Outstanding WOs" section**

Insert a new section following the same structural pattern as the existing "Special Allowance" section (table on desktop, cards on mobile — copy that section's exact wrapper markup/classes), sorted most-urgent-first:

```tsx
<div className="mt-8">
  <h2 className="text-lg font-bold text-text-primary mb-3">Outstanding WOs</h2>
  {outstandingWos.length === 0 ? (
    <p className="text-sm text-text-secondary">No outstanding WO debt.</p>
  ) : (
    <div className="space-y-2">
      {[...outstandingWos]
        .sort((a, b) => a.expiresAt.toMillis() - b.expiresAt.toMillis())
        .map(wo => {
          const daysLeft = Math.ceil((wo.expiresAt.toMillis() - Date.now()) / 86400000);
          return (
            <div key={`${wo.userId}__${wo.date}`} className="border border-border rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold text-text-primary text-sm">{wo.userName} · {wo.date}</div>
                <div className="text-xs text-text-secondary mt-0.5">
                  {wo.remainingMins} min outstanding ·{' '}
                  <span className={daysLeft <= 14 ? 'text-[#C42B2B] font-semibold' : ''}>
                    expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <button onClick={() => setSettleTarget(wo)} className="btn-outline !py-1.5 !px-4 text-[13px]">
                Settle
              </button>
            </div>
          );
        })}
    </div>
  )}
</div>
```

- [ ] **Step 5: Add the Settle modal**

Add a new component (in the same file, following `ot-shortage/page.tsx`'s `fixed inset-0` overlay pattern for its detail modal) rendered conditionally when `settleTarget` is set:

```tsx
function SettleWoModal({ wo, onClose, onSettled }: { wo: WoLedgerEntry; onClose: () => void; onSettled: () => void }) {
  const [sources, setSources] = useState<OtApproval[]>([]);
  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState('');
  const [mins, setMins] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [approvals, settlements] = await Promise.all([
        getOtApprovalsForUser(wo.userId),
        getSettlementsForUser(wo.userId),
      ]);
      setLockedMonths(new Set(settlements.filter(s => s.locked).map(s => s.month)));
      setSources(approvals);
    })();
  }, [wo.userId]);

  const eligible = sources.filter(a => {
    const available = (a.approvedMins || 0) - (a.settledMins || 0);
    return available > 0 && !lockedMonths.has(a.date.slice(0, 7));
  });
  const selected = eligible.find(a => a.date === selectedDate);
  const maxMins = selected ? Math.min(wo.remainingMins, (selected.approvedMins || 0) - (selected.settledMins || 0)) : 0;

  async function submit() {
    const value = Math.round(Number(mins) || 0);
    if (!selected || value <= 0 || value > maxMins) { setError(`Enter a value between 1 and ${maxMins}.`); return; }
    setSaving(true);
    setError('');
    try {
      await settleWoDebit(wo.userId, wo.date, selected.date, value, 'Admin');
      onSettled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to settle.');
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 md:px-4" onClick={onClose}>
      <div className="bg-white md:rounded-2xl shadow-xl w-full h-full md:h-auto md:max-w-lg md:max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-bold text-text-primary">Settle WO · {wo.userName} · {wo.date}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}
          <p className="text-sm text-text-secondary">{wo.remainingMins} min still outstanding.</p>
          <div>
            <label className="label">OT source</label>
            <select className="input" value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setMins(''); }}>
              <option value="">Select a date…</option>
              {eligible.map(a => (
                <option key={a.date} value={a.date}>
                  {a.date} · {(a.approvedMins || 0) - (a.settledMins || 0)} min available
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <div>
              <label className="label">Minutes to apply (max {maxMins})</label>
              <input type="number" min="1" max={maxMins} value={mins} onChange={e => setMins(e.target.value)} className="input" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-border flex-shrink-0">
          <button onClick={onClose} className="btn-outline !py-1.5 !px-4 text-[13px]">Cancel</button>
          <button onClick={submit} disabled={saving || !selected} className="btn-success !py-1.5 !px-4 text-[13px]">
            {saving ? 'Saving…' : 'Settle'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Render it at the end of the page's top-level JSX return, alongside any other conditionally-rendered modals already on this page:

```tsx
{settleTarget && (
  <SettleWoModal
    wo={settleTarget}
    onClose={() => setSettleTarget(null)}
    onSettled={() => { loadData(); }}
  />
)}
```

Add `useEffect` to this file's existing React import if not already imported.

- [ ] **Step 6: Manual browser smoke test**

Run: `cd admin && npm run dev`, then in a browser sign in as an admin and open `/ot-settlements`. Confirm: the page loads without console errors, the "Outstanding WOs" section renders (empty state is fine if no WOs exist yet in the dev database), and opening the Settle modal on any listed WO does not error even with zero eligible sources (the `<select>` should just show only its placeholder option).

- [ ] **Step 7: Commit**

```bash
git add "admin/src/app/(admin)/ot-settlements/page.tsx"
git commit -m "feat(protocol-3): Outstanding WOs list + Settle action on the OT Settlements page"
```

---

## Final Review

After all seven tasks are complete and each has passed its own task review, dispatch the **whole-branch final review on the most capable available model (Opus)** per this plan's Global Constraints — this branch changes the core OT/WO/shortage/payroll math shared across the admin portal, the nightly Sheets export, and the settlement lock, and warrants the same scrutiny Protocol 1 and Protocol 2 received. Pay particular attention to:
- Whether every `computeDayLedger` call site found during planning was actually given `isWoDay` — 8 across 5 files: `otAggregate.ts` (1), `otAggregate.js` (2, including `dailyOtWoCash`), `firebase/functions/index.js` (3, the Sheets Attendance/Overtime-Exception/Manpower-Utilisation tabs), `ot-shortage/page.tsx` (1), and `working-hours-shortage-excess/page.tsx` (1) — and whether both `netLedgerMins` callers (`otAggregate.ts`/`.js` and `ot-shortage/page.tsx`) dropped the `woDebitMins` argument. A missed site would silently keep double-penalizing a WO day's partial punches in one view while every other view is fixed. Grep for `computeDayLedger(` and `netLedgerMins(` across `admin/src` and `firebase/functions` as a final check — this plan found two of these five files (`ot-shortage/page.tsx` and `working-hours-shortage-excess/page.tsx`) only through a manual grep during self-review, after the initial research pass missed them, so a mechanical sweep before signing off is warranted, not optional.
- Whether `settleWoDebit`'s client-side validation and the rules' month-lock guard agree on which OT sources are eligible (no gap where the UI offers a source the rules would reject, or vice versa).
- Whether the `dailyOtWoCash`/`settlementCash` invariant (`Σ dailySpend == settlementCash`) genuinely still holds after Task 2's changes, not just in the two tests that assert it — trace the math by hand for at least one mixed WO+OT+shortage month.
