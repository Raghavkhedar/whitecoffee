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

### Schema changes

- `regularization_requests/{id}` (Android-created): new optional `claimedKm: number`.
- The `attendance_status` approval path is unchanged.
- `conveyance/{userId}__{date}` gains a `markedBy: 'admin'` field on an admin-approved write —
  this field does not exist on this collection today; every doc so far is nightly-computed
  with no marker at all.

### Enforcement

`firestore.rules` currently has **no rule permitting any client write to `conveyance/{docId}`
at all** — every existing doc is written by the Cloud Function's Admin SDK, which bypasses
rules entirely. This protocol requires a genuinely new rule, not a widened existing one:
admin-only write on `conveyance/{docId}`, matching the shape of other admin-gated top-level
collections in the file.

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
