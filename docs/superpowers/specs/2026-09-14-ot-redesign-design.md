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
