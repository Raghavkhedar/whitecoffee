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
  shortageMins: 0, autoOtMins: 0, pendingExtraMins: 0,
};

// Per-day ledger for one operations worked day (both check-in and check-out present).
// Each shift edge is scored against the plain window:
//   • in before shift start → nothing (early-in NEVER earns OT); after → late-in
//   • out after shift end   → late-out; before → shortage (early-out)
//
// ⚠️ Late-out PAYS OFF late-in before any OT is credited. Staying past shift end first
// makes up the minutes missed by arriving late; only the SURPLUS beyond break-even is OT,
// and only the REMAINDER of the lateness is shortage — a day is never both at once.
// in 11:00 / out 18:30 on a 10–18 shift is 30 shortage and 0 OT, not "30 OT + 60 shortage".
// Early-out is NOT netted and can never be cancelled (a day cannot end both early and late).
// Declared OT is a pre-approval CEILING on the NET OT (auto up to declared, beyond is pending).
//
// Rest days (Sunday / company holiday) are immutable: nothing is pre-authorized. Any worked
// window on a rest day raises a PENDING overtime request for the WHOLE window — never
// auto-credited, never shortage, and the declared-OT ceiling does not apply. It is credited
// only when an admin later approves some or all of it via the separate approval flow.
function computeDayLedger({ shiftStartMin, shiftEndMin, inMin, outMin, declaredOtMins, isRestDay }) {
  const worked = Math.max(0, outMin - inMin);

  if (isRestDay) return { ...ZERO, pendingExtraMins: worked };

  if (shiftEndMin > shiftStartMin) {
    const lateIn   = Math.max(0, inMin - shiftStartMin);   // came late
    const earlyOut = Math.max(0, shiftEndMin - outMin);    // left early → shortage (never offset)
    const lateOut  = Math.max(0, outMin - shiftEndMin);    // left late (early-in earns nothing)
    // Net the two late edges against each other: whichever is larger survives, the other is 0.
    const otEarned  = Math.max(0, lateOut - lateIn);       // surplus past break-even → OT
    const netLateIn = Math.max(0, lateIn - lateOut);       // lateness not yet made up → shortage
    const declared = Math.max(0, declaredOtMins || 0);
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

// Monthly/range net: approved OT (auto + granted) minus shortage minus WO debit.
// Pending (un-approved) OT is intentionally excluded — not credited until approved.
function netLedgerMins(p) {
  return (p.autoOtMins + p.approvedGrantedMins) - p.shortageMins - p.woDebitMins;
}

module.exports = {
  WO_DEBIT_MINS, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
  istMinuteOfDay, computeDayLedger, netLedgerMins,
};
