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
  otAuthorized: boolean;  // admin authorized rest-day work (only meaningful on a rest day)
}

export interface DayLedger {
  shortageMins: number;       // late-in + early-out (each edge scored on its own); never on a rest day
  autoOtMins: number;         // declared OT actually worked (auto-approved) = min(otEarned, declared)
  pendingExtraMins: number;   // OT beyond declared → needs admin review
  restDayOtMins: number;      // all worked minutes on an authorized rest day (auto-approved)
  unauthorizedRestDay: boolean; // worked a rest day with no authorization → 0 OT credited
}

const ZERO: DayLedger = {
  shortageMins: 0, autoOtMins: 0, pendingExtraMins: 0, restDayOtMins: 0, unauthorizedRestDay: false,
};

// Per-day ledger for one operations worked day (both check-in and check-out present).
//
// Each shift edge is scored against the plain window:
//   • checking in  before shift start → nothing (arriving early NEVER earns OT); after → late-in
//   • checking out after  shift end   → late-out;  before → shortage (early-out)
//
// ⚠️ Late-out PAYS OFF late-in before any OT is credited. Staying past shift end first
// makes up the minutes missed by arriving late; only the SURPLUS beyond break-even is OT,
// and only the REMAINDER of the lateness is shortage. So a day is never both at once:
// in 11:00 / out 18:30 on a 10–18 shift is 30 shortage and 0 OT, not "30 OT + 60 shortage".
// (This deliberately supersedes the earlier independent-edge rule, which credited OT to
// someone who had not yet worked their own shift — see docs/ot-shortage-design.md.)
//
// Early-out is NOT part of that netting and can never be cancelled: leaving before shift
// end and after it are mutually exclusive, so an early-out day has no late-out to offset it.
//
// Declared OT is a pre-approval CEILING applied to the NET OT (auto up to declared, beyond
// is pending) — it never changes shortage.
export function computeDayLedger(i: DayLedgerInput): DayLedger {
  const worked = Math.max(0, i.outMin - i.inMin);

  if (i.isRestDay) {
    // Sunday/holiday: every worked minute is OT, but only when admin-authorized.
    if (i.otAuthorized) return { ...ZERO, restDayOtMins: worked };
    return { ...ZERO, unauthorizedRestDay: true };
  }

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
  autoOtMins: number;        // declared, auto-approved
  restDayOtMins: number;     // authorized rest-day OT, auto-approved
  approvedGrantedMins: number; // admin-granted OT (beyond-declared) via ot_approvals
  shortageMins: number;
  woDebitMins: number;       // (number of WO days) × WO_DEBIT_MINS
}

// Monthly/range net: approved OT (auto + rest-day + granted) minus shortage minus WO debit.
// Pending (un-approved) OT is intentionally excluded — it isn't credited until approved.
export function netLedgerMins(p: NetLedgerParts): number {
  return (p.autoOtMins + p.restDayOtMins + p.approvedGrantedMins) - p.shortageMins - p.woDebitMins;
}
