# OT, Shortage & WO — System Redesign (WORKING DRAFT)

> **Status:** design in progress. Captures the discussion before any code is written.
> Resume point is at the bottom (**"Open questions — answer to continue"**).
> Today's date when drafted: 2026-06-29.

## Why we're redesigning

The current system *measures* OT and shortage but they **connect to nothing**:
- `users.approvedOtMins` and `users.shortageMins` accumulate **lifetime**, never reset, and
  **never feed payroll**. Salary is `daysNP × salaryRate` from attendance-status counts only
  (`functions/index.js:727-753`). OT/shortage are dead-end counters.
- **Two sources of truth:** the nightly function writes `daily_hours/{date}`, but the
  OT & Shortage page recomputes live from raw events and ignores it → drift risk.
- CLAUDE.md currently says "OT and shortage are tracked separately, never netted."
  **The new model overturns that** — they become one nettable time ledger.

## The new model (CONFIRMED rules)

Everything is **minutes**, held in a **per-employee, per-month signed balance** that
**resets every month (no carry-forward)**. Standard day = **480 min** when undefined.

| Source | Effect on balance |
|---|---|
| Worked < planned, on a **Present** day | − shortage |
| Worked > planned, **pre-declared** by admin (`declaredOtMins`) | + OT (auto-approved, capped at declared) |
| Worked > planned, **beyond** declared | new **pending** OT request → counts only once admin approves |
| **Sunday/holiday** work (authorized) | + all worked minutes as OT |
| **WO** given (no-work weekday) | − 480 debit, payable by OT across the month |
| **Month end** | net > 0 → pay cash · net < 0 → deduct from salary |

Additional confirmed points:
- **Shortage only applies after admin regularizes a day to Present** (via the
  regularization flow, *to be built*). It never stacks on SL / Half-Day status —
  those already encode their own pay penalty. No double-counting.
- **Pre-declared OT is a separate `declaredOtMins` field, NOT a widened shift window** —
  it must stay visible as OT so it can offset shortage.
- **Partial fulfillment** of declared OT leaves a shortage for the gap (see formula).
- **Sunday/holiday work needs an authorization flag** (admin called him in) — not auto on any
  punch, or employees self-grant OT by showing up.
- **WO is not auto-cancelled** by Sunday work and the employee need not show on Sunday —
  a WO debit can be cleared by **small OTs throughout the month**.
- **Working 5h to clear an 8h WO** → WO cleared, **3h shortage remains** (WO = 480 debit).
- **No lunch/break deduction** — `actual = lastOut − firstIn` (gross) is accepted.
- **Manual OT entry must be possible** for anomalies (e.g. missed punch but OT really happened —
  admin calls/confirms and sets that day's OT manually).
- Missed-punch (SLNF) days are fixed via the **regularization flow (to be built)**. If OT was
  offsetting a shortage and the punch is missing, the shortage stays unaffected (OT didn't happen).

## The core formula (CONFIRM exact)

Pre-declared OT widens the *expected-out* for shortage purposes, but the over-plan portion is
still credited as OT:

```
expected   = planned + declaredOT
shortage   = max(0, expected − actual)
OT(auto)   = min(declaredOT, max(0, actual − planned))
OT(pending → needs admin approval) = max(0, actual − expected)
```

Worked example — planned 10:00–18:00 (480), declared +30 → expected 510:
- out 18:30 (510): OT +30, shortage 0 ✓
- out 18:15 (495): OT +15, shortage 15 ✓ ("15 min shortage left")
- out 19:00 (540): OT +30 auto, **+30 new pending request** ✓

## Open questions — answer to continue (RESUME POINT)

1. **WO semantics (fairness landmine — decide first).** A WO is given *because the company had
   no work*. Two readings:
   - **(a) Real debit:** unmade-up WO at month end is deducted from salary. (What the answers literally said.)
   - **(b) Free-unless-used:** WO never deducts pay on its own; it only exists so that *if* he works
     a rest day, that OT applies against the WO instead of being paid cash. Unused WO at month end disappears.
   → **Which one?**
2. **OT cash rate & premiums.** Net-positive minutes pay straight **1× (minutes/480 × salaryRate)**?
   Or do **Sunday/holiday** OT pay a premium (e.g. 2×, the India legal norm)? If Sunday OT is 2× but
   offsets shortage at 1×, netting gets ambiguous — need the rule.
3. **Net-negative deduction rate.** Symmetric — shortage deducted at the same `minutes/480 × salaryRate`? (assumed yes, confirm)
4. **Grace window.** Recommend a configurable **±10 min** grace where nothing accrues (kills 2-min-OT noise). Want it? threshold?
5. **Scope.** Ops only (today's behavior), or extend the whole ledger to **office/admin** too?

## Robustness pieces to add regardless of the answers

- **Month-end lock + snapshot:** freeze a `settlements/{YYYY-MM}` record (every line item + net + who
  settled), make the period immutable; reopening is an audited action.
- **Manual entries survive recompute:** `declaredOtMins`, manual OT adjustments, WO links, and
  regularizations all need a `markedBy:'admin'` guard so the nightly job never clobbers them.
- **Distinguish "free Sunday weekly-off" from "owed WO"** in the data — opposite behaviors, must be
  different markers (not both "WO").
- **Every ledger line carries who/when/why** (extend the existing mandatory-reason rule on OT to WO links and manual adjustments).
- **Single source of truth:** make `daily_hours/{date}` canonical; the portal reads it for closed
  past days and only live-recomputes *today*.

## Likely architecture changes (not yet decided/built)

- `daily_hours/{date}` becomes canonical (portal reads, doesn't recompute past days).
- New `users/{uid}/ot_authorizations/{date}` (or a `declaredOtMins` field on `planned_hours`) for pre-declared OT.
- New `users/{uid}/settlements/{YYYY-MM}` for the monthly lock/snapshot + payroll feed.
- Payroll (`exportToSheets` / employee dashboard) must add the net OT pay / shortage deduction line.
- Regularization flow (separate, to be built) is a dependency for the "shortage only on Present" rule.

## Relevant code (current)

- Nightly engine: `functions/index.js:287-308` (shortage/OT per day → `daily_hours`, lifetime increment)
- Payroll math: `functions/index.js:710-753` (`daysNP × salaryRate`, no OT/shortage input)
- `approveOt` / `ot_approvals`: `src/lib/firestore.ts:329-360`
- OT & Shortage page (live recompute): `src/app/(admin)/ot-shortage/page.tsx`
- Types: `src/types/index.ts` (`User.approvedOtMins`, `User.shortageMins`, `OtApproval`, `PlannedHours`)
