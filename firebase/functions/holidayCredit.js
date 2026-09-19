"use strict";

/**
 * Whether a Holiday status day still pays its +1 to an employee.
 *
 * All Sunday/holiday work is already raised as PENDING OT for an admin to approve
 * (computeDayLedger: on a rest day the whole worked window becomes pendingExtraMins), so an
 * operations employee who actually works a holiday is paid through that approval — the +1
 * holiday day would pay them twice. Withdraw it: salaryCredit 0. Everyone else keeps it: 1.
 *
 * "Actually worked" is deliberately the same test that makes the ledger raise pending OT:
 * a complete first-in / last-out pair with > 0 worked minutes, in IST minute-of-day
 * arithmetic. One-sided punches (no checkout) or a same-minute in/out raise nothing to
 * approve, so they keep the +1. Only roles that run the OT ledger (operations) are affected.
 *
 * Readers treat ONLY a strict 0 as "withdrawn"; a legacy Holiday doc with no salaryCredit is paid.
 */

const { attendanceInTypes, attendanceOutTypes, usesOtShortageLedger } = require("./roleCapabilities");

// Epoch seconds → IST minute-of-day. Same arithmetic as admin/src/lib/otLedger.ts's
// istMinuteOfDay, so this module and the ledger agree on what counts as worked minutes.
function istMinuteOfDay(epochSecs) {
  return Math.floor(((((epochSecs + 19800) % 86400) + 86400) % 86400) / 60);
}

/**
 * @param {string} role
 * @param {Array<{type: string, timestamp: {seconds: number}}>} events that user's punches for the date
 * @returns {0 | 1}
 */
function resolveHolidayCredit(role, events) {
  if (!usesOtShortageLedger(role)) return 1;
  const list = Array.isArray(events) ? events : [];
  const secs = (e) => (e && e.timestamp ? Number(e.timestamp.seconds) : NaN);
  const inTypes = attendanceInTypes(role);
  const outTypes = attendanceOutTypes(role);
  const byTime = (a, b) => secs(a) - secs(b);
  const ins = list.filter((e) => inTypes.includes(e.type) && Number.isFinite(secs(e))).sort(byTime);
  const outs = list.filter((e) => outTypes.includes(e.type) && Number.isFinite(secs(e))).sort(byTime);
  if (ins.length === 0 || outs.length === 0) return 1;
  const worked = istMinuteOfDay(secs(outs[outs.length - 1])) - istMinuteOfDay(secs(ins[0]));
  return worked > 0 ? 0 : 1;
}

module.exports = { resolveHolidayCredit, istMinuteOfDay };
