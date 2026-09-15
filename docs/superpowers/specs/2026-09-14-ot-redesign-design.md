# OT Calculation System — Redesign

> **Status:** in progress, built protocol by protocol. Protocol 1 specified below and
> approved 2026-09-14. Later protocols are appended to this document as they are decided —
> do not implement anything here that is not written down and marked approved.

## Why

The OT/shortage/WO ledger built in 2026-06 (`admin/docs/ot-shortage-design.md`) works, but
its rules were derived piecemeal and several of them produce numbers the business does not
agree with. Rather than patch individual rules, the calculation model is being restated as a
sequence of explicit **protocols**, each one approved and built before the next is designed.

This document is the authority. Where it contradicts `admin/docs/ot-shortage-design.md`, this
document wins and that one is historical.

## Protocol 1 — rest days are immutable; rest-day work is OT-by-approval only

**Approved 2026-09-14.**

### The rule

1. **Sundays and company holidays are immutable rest days.** Their attendance status is
   system-owned and final. No admin, manager, regularization, or backfill may write, change,
   or override an `attendance_status` doc on those dates.
2. **WO is illegal on a rest day.** A work-off day exists to be worked off against a debit; a
   rest day already carries no obligation, so a WO there is meaningless and is now rejected.
3. **Work performed on a rest day has exactly one destination: an OT request.** The full
   worked window (first ops in-punch to last ops out-punch) is raised as a **pending** OT
   request. Nothing is credited until an admin decides it.
4. **The admin decides how many of those minutes to approve** — all, some, or none — with a
   mandatory reason, exactly as for beyond-declared weekday OT.
5. **A rest day never produces shortage.** It has no shift window to fall short of.

### What this supersedes

The prior model gated rest-day OT behind a pre-authorization flag (`otAuthorized` on
`planned_hours/{date}`): authorized meant every worked minute auto-credited without review,
unauthorized meant the employee earned nothing at all. Both halves are wrong under Protocol 1 —
credit must follow an explicit decision, and work must never silently vanish.

Consequently these concepts are **retired**:

| Concept | Fate |
|---|---|
| `PlannedHours.otAuthorized` | No longer read or written. Field kept `@deprecated` for historical docs. |
| `setOtAuthorization()` | Deleted. |
| "Authorize OT" toggle (Attendance page) | Removed. |
| `DayLedger.restDayOtMins` | Removed from the ledger type. Rest-day minutes now arrive as `grantedOtMins` via `ot_approvals`. |
| `DayLedger.unauthorizedRestDay` | Removed. The state it described cannot occur any more. |
| `Settlement.restDayOtMins` | Kept `@deprecated` — historical settlement docs carry real values. New settlements write `0`. |

### Interaction with the Sunday/Holiday status feature

`main` already writes a payroll-neutral `Sunday` / `Holiday` status for every employee on
rest days (`docs/superpowers/specs/2026-09-12-sunday-holiday-status-design.md`), skipping its
auto-write whenever a doc already exists for that user and date, regardless of `markedBy`.

That non-clobber rule is what makes a hand-marked WO on a Sunday permanent today. Under
Protocol 1 the hole closes from the other side: no doc other than the system's own
`Sunday`/`Holiday` may exist on those dates, so there is nothing for the non-clobber rule to
defer to. The nightly write itself is unchanged.

`resolveRestDayType(dateStr, isHoliday)` in `firebase/functions/attendanceRules.js` is the
canonical definition of "is this date a rest day, and which kind". Every new rest-day check
uses it rather than re-deriving `getUTCDay() === 0`.

### The math

`computeDayLedger` in `admin/src/lib/otLedger.ts` and `firebase/functions/otLedger.js` — the
rest-day branch collapses from three outcomes to one:

```
if (isRestDay) return { ...ZERO, pendingExtraMins: worked };
```

`otAuthorized` leaves `DayLedgerInput`. `netLedgerMins` loses its `restDayOtMins` term:

```
net = (autoOtMins + approvedGrantedMins) - shortageMins - woDebitMins
```

No new collection is needed. "Pending" is already derived as *this date has pending minutes
and carries no `ot_approvals/{date}` doc*, and rest days now fall out of that same derivation.
Once approved, rest-day minutes are indistinguishable from any other granted OT.

### Enforcement

The rule is enforced at three layers, because `attendance_status` is writable by any manager
holding the Attendance or Regularization tab — not only by admins — and the portal uses the
client SDK, so the UI is not a boundary.

1. **UI:** rest-day cells render non-interactive on the Attendance page; `WO` is absent from
   the regularization outcome options for a rest-day date.
2. **Write helpers** (`admin/src/lib/firestore.ts`): `setAttendanceStatus` and `markWo` throw
   on a rest-day date before issuing any write.
3. **`firestore.rules`:** `allow write` on `users/{userId}/attendance_status/{date}` requires
   `!isRestDate(date)`. Costs one extra document read per status write, on writes only.

```
function isSundayDate(date) {
  let days = timestamp.date(int(date[0:4]), int(date[5:7]), int(date[8:10])).toMillis() / 86400000;
  return (days + 4) % 7 == 0;   // 1970-01-01 was a Thursday
}
function isRestDate(date) {
  return isSundayDate(date) || exists(/databases/$(database)/documents/holidays/$(date));
}
```

The Cloud Function writes with the Admin SDK and bypasses rules, so its own `Sunday`/`Holiday`
write is unaffected.

### Migration

None. Locked settlements keep the numbers they were locked with. In **unlocked** months,
rest days that were auto-credited under `otAuthorized` drop to zero until an admin approves
them — and they become visible in the pending queue, which is the intended remedy. Historical
`otAuthorized` and `restDayOtMins` values remain readable but are no longer consulted.

### Out of scope for Protocol 1

Weekday OT, shortage, WO on a weekday, the declared-OT ceiling, rates, and the settlement
lock are all untouched. They are the subject of later protocols.

## Protocol 2 — regularization can correct conveyance for a missed-punch day, not just OT/status

**Approved 2026-09-15.**

### The problem

Regularization already lets an admin set an effective in/out override for a missed-punch
day, and that override is authoritative for attendance status and (for operations) the
OT/shortage ledger. But conveyance (`conveyance/{userId}__{date}`) is computed **exclusively**
from raw GPS-bearing attendance events (`site_in`/`site_out`/`market_in`/`market_out`/
`home_in`/`home_out`) by the nightly `exportToSheets` function, and never reads
`attendance_status` at all. A missed punch that breaks the raw event chain leaves that day's
conveyance silently wrong — regularizing the day fixes salary and (for ops) OT, but has never
touched conveyance. This applies identically to **operations and sales**: both are selected
into conveyance by the same `usesConveyance(role)` flag, with no role-specific branch anywhere
in the conveyance calculation, so there is no basis to fix it for one and not the other.

### The rule

1. **The employee may claim a KM figure for a missed-punch day when filing a regularization
   request** — an optional field alongside the existing reason. Meaningful only where
   conveyance applies (operations, sales); harmless if filed by office/admin.
2. **The admin may edit that KM figure before approving** — same spirit as the existing
   editable `effIn`/`effOut` fields: the employee's claim is a starting point, not binding.
3. **On approval, if a KM value is present, conveyance for that date is set directly:**
   `conveyance = km × ratePerKm`, using that employee's own existing rate
   (`conveyanceRateType` → `rate1`/`rate2`, exactly as the nightly job resolves it). This is a
   full overwrite of the day's conveyance doc, consistent with how the OT/status override
   already replaces (not supplements) raw-event-derived numbers for a regularized date.
4. **The written doc is stamped `markedBy: 'admin'`.** The nightly conveyance loop must skip
   any date already stamped this way — mirroring the existing `attendance_status` `markedBy`
   skip — otherwise the fix is silently overwritten the same night it's approved.
5. **Scope: operations and sales**, matching `usesConveyance(role)`. Office/admin may still
   file/be regularized exactly as today, simply with no conveyance effect (they never had one).
6. **Scope: worked-day outcomes only.** A km value is claimable/creditable only when the
   approval outcome is `Present` or `HalfDay` — never `Absent`/`LWP`/`WO`/`PL`. Those outcomes
   either dock salary (`Absent`) or formally assert the day was not worked at all; crediting
   travel reimbursement on the same day would be internally contradictory and an audit risk.
   Decided 2026-09-15 after the final whole-branch review flagged it as an unexamined gap — the
   hours override was already `Present`-only (`page.tsx`'s `carry` check) but the money override
   had no equivalent restriction until this decision. Enforced in the UI (the km field is hidden
   for any other outcome) and re-checked server-side in `approveRegularization` (never trust the
   submitted form — same principle already applied there to the rest-day check).

### Schema changes

- `regularization_requests/{id}` (Android-created): new optional `claimedKm: number`.
- The `attendance_status` approval path is unchanged.
- `conveyance/{userId}__{date}` gains a `markedBy: 'admin'` field on an admin-approved write —
  this field does not exist on this collection today; every doc so far is nightly-computed
  with no marker at all.

### Enforcement

`firestore.rules:677-683` already permits a client `create`/`update` on `conveyance/{docId}`
for `isAdmin()` **or** a Conveyance-tab manager (with `notSelfDoc()` — a Conveyance manager may
not write their own record) — built for the `/conveyance` page but never actually called from
client code (`admin/src/lib/firestore.ts` only ever reads this collection today). No rules
change is needed; this protocol is the rule's first real caller.

This does mean the acting approver needs **both** Regularization and Conveyance access to
include a km adjustment: `approveRegularization`'s batch would write `attendance_status` *and*
`conveyance` together, and a Firestore batch fails atomically if any single document write
fails its rule. A Regularization-only manager who lacks Conveyance access must never be
offered the km field — the portal gates it on `isAdmin || tabAccess.includes('/conveyance')`,
same check the `/conveyance` page itself uses, so this isn't a new access concept.

### Out of scope for Protocol 2

Per-visit reconstruction (patching one missed punch out of several site visits in a day while
preserving the others) is not part of this protocol — the existing whole-day single
`effIn`/`effOut` override stays as-is. Automatic GPS/route-based reconstruction of conveyance
is also out of scope; the fix is a manual figure, by design, not an automated recomputation.

### Protocol 1 fix — pending must be tracked by remaining amount, not by date

**Approved 2026-09-15**, found by the final whole-branch review.

`computeRangeLedger` (and the OT Exception tab's inline equivalent) decided whether a date was
"pending" with `!apprByDate.has(date)` — *any* `ot_approvals/{date}` doc for that date, whatever
amount it covers, marked the whole date decided. That is a pre-existing sharp edge in weekday
OT (a `requestedMins` that happens to under-cover `pendingExtraMins` was already possible), but
Protocol 1 makes it far more likely to bite: a rest day's *entire* worked window is now
`pendingExtraMins`, not just an excess sliver.

Concrete failure: a Sunday worked 09:00–19:00 (600 min pending). An admin separately adds a
60-minute manual OT grant on that same date for an unrelated reason (`setManualOt`, which sets
`requestedMins = approvedMins = 60`, not the ledger's 600). The date now has a decision doc, so
the other 540 minutes vanish — not credited, not in the pending queue, not flagged anywhere.

**Fix:** a date is only "decided" up to what its `ot_approvals/{date}.requestedMins` actually
covers. The remainder is still pending:

```
remainingPendingMins = max(0, pendingExtraMins - (decision?.requestedMins ?? 0))
```

In the normal flow this changes nothing: the OT & Shortage approve/reject dialog always passes
`day.pendingExtraMins` as `requestedMins` (`ot-shortage/page.tsx` `approveOt`/`rejectOt` calls),
so `remainingPendingMins` is 0 the moment a decision is made on the full amount, exactly as
before. It only surfaces a gap when a decision's `requestedMins` under-covers the date's actual
`pendingExtraMins` — precisely the case that was silently swallowed.

Applies to `admin/src/lib/otAggregate.ts`, `firebase/functions/otAggregate.js`, and
`firebase/functions/index.js`'s inline OT Exception tab derivation (all three currently gate on
doc presence, not covered amount).

## Protocol 3 — WO becomes an explicit, expiring debt settled by admin action, not implicit same-month netting

**Approved 2026-09-15.**

### The problem

A WO (paid no-work day off) owes a flat 480-minute debit. Today that debit is never tracked on
its own — `computeRangeLedger` just counts `attendance_status` docs with `status: 'WO'` in
whatever date range it's given and folds `-480/WO` straight into that range's `netLedgerMins`
alongside auto/granted OT and shortage. The OT Settlements page calls this **per calendar
month** and freezes the result. Consequently a WO only ever nets to zero against OT that
happens to fall in the **same calendar month** — a WO on 28 Aug worked off by OT on 3 Sep nets
to ₹0 in August (documented today as intentional: "advance credit... employee expected to make
it up") and the September OT pays out as ordinary unrelated cash, with no code path connecting
the two. There is no record of which WO is outstanding, no way for an admin to explicitly pay
one off with OT from a different month, and no expiry — a WO's debt is just silently absorbed
(free to the employee) the moment its month locks, however long ago it was issued.

Additionally, marking a day WO does not currently suppress that date's raw attendance events
for ledger purposes — only a Present-regularization override does that. A WO day with partial
punches (e.g. told to leave at 2pm on a 10–6 shift) would independently accrue an early-out
**shortage** from the raw punches *in addition to* the flat WO debit — a double penalty with no
connection to the WO mechanism at all, since leaving early can never produce OT to net against
anything.

### The rule

1. **Every WO becomes a standalone, persistent debt record** (`wo_ledger/{date}`, detailed
   below), created in the same write as the existing `attendance_status: WO` doc. It starts at
   480 minutes outstanding and is cleared only by explicit admin action or expiry — never by
   incidental same-month OT.
2. **The WO day's pay is unconditional.** It is no longer entangled with whether OT ever offsets
   it — `settlementCash`'s `woDays × rate` term keeps paying every WO day regardless of
   settlement progress. Only the OT side of the formula changes (below).
3. **Admin may apply any OT source to reduce an outstanding WO's balance, in any amount, at any
   time.** "Any OT source" means any date with an existing `ot_approvals/{date}` doc — rest-day
   OT, beyond-declared OT, or auto-approved-within-ceiling OT that an admin has logged via the
   existing manual-OT tool (`setManualOt`) precisely so it has a record to point at. Routine
   auto-credited OT that was never logged has no record and is not settlement-eligible; it's
   simply paid as ordinary OT cash, same as today.
4. **Partial settlement is allowed and accumulates.** A WO's `remainingMins` decreases by
   whatever amount is applied per action; it may take several settlement actions across several
   months to fully clear one WO. Each application is logged (`wo_ledger/{date}/settlements`).
5. **An OT source becomes ineligible once its home month is Settled & Locked** — that cash has
   already been paid out and cannot be redirected retroactively.
6. **A WO not fully settled within 2 months of being issued is written off automatically, with
   zero pay impact.** A scheduled Cloud Function flips it from `outstanding` to `forgiven`; it
   simply drops off the outstanding list. This is a hard stop on staleness, not a penalty — the
   cost of never settling a WO is that the employee's OT from that period was never redirected
   to offset it (so it was paid in full as ordinary cash instead), not a deduction.
7. **Marking a day WO overrides that date's raw attendance for ledger purposes, mirroring the
   existing Present-regularization override.** No shortage, no auto-OT is computed from that
   day's punches. If the day has punches, the whole worked window is instead raised as
   **pending OT** — identical treatment to rest-day work under Protocol 1 — so it enters the
   normal admin approve/reject-with-reason queue rather than being silently discarded or
   silently double-penalizing the employee. Once approved, it's an ordinary `ot_approvals`
   record like any other and can be applied to settle this WO (or any other) through the normal
   settlement flow — no special-casing beyond routing it into the same pending queue.
8. **Clearing a WO deletes its ledger entry outright**, regardless of settlement progress. Any
   OT minutes already consumed settling it are **not** refunded — this is a deliberate
   simplification, not an oversight.
9. **Scope: operations only**, matching `usesOtShortageLedger(role)` — unchanged from today's
   WO/OT ledger, which already excludes sales/office/admin.

### Schema changes

- **New:** `users/{uid}/wo_ledger/{date}` — one doc per WO, created in the same batch as
  `markWo`'s `attendance_status` write:
  - `debitMins: 480` (mirrors `WO_DEBIT_MINS`, stored for clarity/audit)
  - `remainingMins`: starts at 480, decremented by settlement applications, floored at 0
  - `status: 'outstanding' | 'settled' | 'forgiven'`
  - `issuedAt` (Timestamp, = WO creation time), `expiresAt` (Timestamp, `issuedAt` + 2 months —
    computed once at creation so the expiry job is a single range query, not a recompute)
  - `settledAt` / `forgivenAt` (Timestamp, set on resolution), `markedBy: 'admin'`
  - `userId`/`userName`/`employeeId` (denormalized, matching every other collection's pattern)
- **New subcollection:** `users/{uid}/wo_ledger/{date}/settlements/{autoId}` — one doc per
  settlement application: `otDate`, `minsApplied`, `appliedBy`, `appliedAt`.
- **`users/{uid}/ot_approvals/{date}` gains `settledMins`** (number, default 0) — running total
  of that day's `approvedMins` already consumed settling some WO. `available = approvedMins -
  settledMins` is what the settlement picker offers and what still counts as payable cash.

### The math

`computeDayLedger` (`otLedger.ts`/`.js`) gains a WO-day branch identical in shape to the
existing rest-day branch — a WO date is not a rest day, but is treated the same way for this
one date's computation:

```
if (isRestDay || isWoDay) return { ...ZERO, pendingExtraMins: worked };
```

`netLedgerMins` **drops the `woDebitMins` term entirely** — WO debt no longer participates in
monthly netting at all:

```
netMins = autoOtMins + Σ(approvedMins − settledMins, per ot_approvals doc in range) − shortageMins
```

`settlementCash = woDays × rate + netMins/480 × rate` keeps its existing shape (`otAggregate.ts`
`settlementCash`) — only what feeds `netMins` changes.

### Enforcement

- `computeRangeLedger` (`otAggregate.ts`/`.js`) needs the WO-dates set computed **before** the
  per-day accrual loop (currently derived after), so each date's `accrueDay` call can pass
  `isWoDay` — and needs to sum `approvedMins − settledMins` per `ot_approvals` doc instead of
  raw `approvedMins`.
- The Settle & Lock flow (`settleMonth`) reads the updated `netMins`/`settlementCash`; no rules
  change needed there — it already writes admin-only.
- **New scheduled Cloud Function** (same cron pattern as the existing nightly attendance job):
  queries `collectionGroup('wo_ledger')` where `status == 'outstanding' && expiresAt <= now`,
  batch-updates to `status: 'forgiven', forgivenAt: now`.
- **New admin UI** (extends `/ot-settlements`): an "Outstanding WOs" view per employee —
  remaining balance and days-until-expiry, sorted most-urgent-first — with a "Settle" action
  that opens a picker over that employee's eligible `ot_approvals` docs (`available > 0`, home
  month not yet locked) and an amount input capped to
  `min(wo.remainingMins, source.available)`.
- **`firestore.rules`**: `wo_ledger` and its `settlements` subcollection need write rules
  matching the existing OT/Shortage tab access pattern (`canWriteOtApprovals`-equivalent) —
  no new access concept, just a new collection under an existing tab's permission.
- Existing rule `WO is illegal on a rest day` (Protocol 1) is untouched — `markWo` still throws
  before any write on a rest date, so `wo_ledger` docs can never exist for rest dates either.

### Out of scope for Protocol 3

Pro-rating a WO's starting debt by hours actually worked that day is explicitly rejected — the
debit is always the flat 480 regardless of partial punches; any credit for hours worked flows
through the ordinary pending-OT → approval → settlement path, not an automatic adjustment at
WO-creation time. Automatic/suggested settlement (the system proposing which OT should pay off
which WO) is also out of scope — every settlement is an explicit admin action.
