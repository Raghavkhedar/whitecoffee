// Pure OT / shortage / WO ledger math — the single source of truth shared by the
// OT/Shortage page, the Employee Dashboard, and (later) the payroll settlement.
//
// All values are MINUTES. Functions are pure (no Firestore/React) so they can be
// unit-tested in isolation. See docs/ot-shortage-design.md for the model.

export const WO_DEBIT_MINS = 8 * 60; // a WO (paid no-work day off) owes a standard 8h

// Default operations shift (10:00–18:00) used when no valid plan exists for a worked day.
export const DEFAULT_SHIFT_START_MIN = 10 * 60; // 10:00
export const DEFAULT_SHIFT_END_MIN   = 18 * 60; // 18:00

// Epoch seconds → IST (UTC+5:30, no DST) minute-of-day in [0, 1439].
export function istMinuteOfDay(epochSecs: number): number {
  const IST_OFFSET = 5.5 * 3600;
  return Math.floor(((((epochSecs + IST_OFFSET) % 86400) + 86400) % 86400) / 60);
}

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

export interface DayLedger {
  shortageMins: number;       // late-in + early-out (each edge scored on its own); never on a rest day
  autoOtMins: number;         // declared OT actually worked (auto-approved) = min(otEarned, declared)
  pendingExtraMins: number;   // OT beyond declared (or, on a rest day, the whole worked window) → needs admin review
}

const ZERO: DayLedger = {
  shortageMins: 0, autoOtMins: 0, pendingExtraMins: 0,
};

// Rest days (Sunday / company holiday) AND WO days (admin-marked paid day off, Protocol 3)
// are both immutable for shift-math purposes: nothing is pre-authorized. Any worked window on
// either kind of day raises a PENDING overtime request for the WHOLE window — never
// auto-credited, never shortage, and the declared-OT ceiling does not apply. It is credited
// only when an admin later approves some or all of it via the separate approval flow.
export function computeDayLedger(i: DayLedgerInput): DayLedger {
  const worked = Math.max(0, i.outMin - i.inMin);

  if (i.isRestDay || i.isWoDay) return { ...ZERO, pendingExtraMins: worked };

  if (i.shiftEndMin > i.shiftStartMin) {
    const lateIn   = Math.max(0, i.inMin - i.shiftStartMin);   // came late
    const earlyOut = Math.max(0, i.shiftEndMin - i.outMin);    // left early → shortage (never offset)
    const lateOut  = Math.max(0, i.outMin - i.shiftEndMin);    // left late (early-in earns nothing)
    // Net the two late edges against each other: whichever is larger survives, the other is 0.
    const otEarned  = Math.max(0, lateOut - lateIn);           // surplus past break-even → OT
    const netLateIn = Math.max(0, lateIn - lateOut);           // lateness not yet made up → shortage
    const declared = Math.max(0, i.declaredOtMins);
    return {
      ...ZERO,
      shortageMins: netLateIn + earlyOut,
      autoOtMins: Math.min(otEarned, declared),
      pendingExtraMins: Math.max(0, otEarned - declared),
    };
  }

  // No shift and not a rest day → nothing accrues.
  return { ...ZERO };
}

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
