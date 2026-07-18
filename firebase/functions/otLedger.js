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
