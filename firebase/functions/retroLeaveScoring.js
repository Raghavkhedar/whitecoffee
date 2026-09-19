"use strict";

/**
 * Score leave that is approved AFTER its days have already passed.
 *
 * The nightly scorer only ever writes TODAY, so a day that had no punches and no approved
 * leave when its night ran was written Absent (−2). Approving the leave afterwards used to
 * leave that Absent standing. This turns those days into SCHL — paid or unpaid by the running
 * plBalance, exactly as the nightly run would have decided — and reports how many paid days
 * were drawn so the caller can decrement plBalance in the same transaction.
 *
 * Only an Absent day written by the auto scorer is rewritten. Days with punches, admin-marked
 * days (a regularization or a cancelLeave revert is a decision), Sunday/Holiday docs, days
 * with no doc, and cancelled/ungranted dates are all left alone. Idempotent by construction:
 * once a day is SCHL it is no longer Absent.
 *
 * Order caveat: when two late leaves are approved out of date order, WHICH days carry
 * salaryCredit 1 may differ from the chronological order the nightly would have produced, but
 * the total paid days (and therefore Days NP and the plBalance drawn) are identical.
 *
 * Pure (no Firestore) so it is unit-tested via `npm test`; the trigger in index.js is a thin
 * wrapper that reads the docs, calls this, and writes the result in one transaction.
 */

const { leaveCoversDate } = require("./leaveCoverage");
const { resolveLeaveStatus } = require("./attendanceRules");

// firestore.rules bounds a leave's `totalDays` (1-366) but never cross-checks it against
// fromDate…toDate, and its date regex accepts month/day 00-99. So a stored range can be
// arbitrarily long or not a calendar date at all. A real leave is at most 366 days, so a span
// over MAX_DAYS is malformed: it is REFUSED (never truncated — truncating would score the
// oldest days of a bogus range and drain plBalance).
// MAX_DAYS is also what keeps the scoring transaction under Firestore's 500-write cap (<= 400 status writes + 1 user update).
const MAX_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A REAL calendar "yyyy-MM-dd" (rejects 2025-13-01, 2025-02-99 and V8's silent 2026-02-31 -> Mar 3) -> Date, else null. */
function parseDate(dateStr) {
  if (typeof dateStr !== "string" || !DATE_RE.test(dateStr)) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateStr) return null;
  return d;
}

/** dateStr + n days as "yyyy-MM-dd", or null when dateStr is not a real calendar date. Never throws. */
function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of days fromDate…toDate, or null when either is not a real date or from > to. */
function spanDays(leave) {
  if (!leave) return null;
  const from = parseDate(leave.fromDate);
  const to = parseDate(leave.toDate);
  if (!from || !to || from > to) return null;
  return Math.round((to - from) / DAY_MS) + 1;
}

/** True when a leave's fromDate…toDate is a valid range longer than MAX_DAYS — malformed, so it is not auto-scored. */
function leaveSpanTooLong(leave) {
  const n = spanDays(leave);
  return n !== null && n > MAX_DAYS;
}

/**
 * Dates an approved leave grants that are strictly before todayIST ("yyyy-MM-dd"), ascending.
 * [] (never a throw) for a non-approved leave, an invalid or inverted range, or a span over MAX_DAYS.
 */
function pastGrantedDates(leave, todayIST) {
  if (!leave || leave.status !== "approved" || !todayIST) return [];
  const span = spanDays(leave);
  if (span === null || span > MAX_DAYS) return [];
  const out = [];
  let d = leave.fromDate;
  for (let i = 0; i < span && d !== null && d < todayIST; i += 1) {
    if (leaveCoversDate(leave, d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/**
 * @param {{ leave: object, todayIST: string, statusByDate: Map<string, {status: string, markedBy: string}>, plBalance: number }} args
 * @returns {{ updates: Array<{date: string, status: "SCHL", salaryCredit: 0|1}>, paidDays: number }}
 */
function planRetroLeaveScoring({ leave, todayIST, statusByDate, plBalance } = {}) {
  const updates = [];
  let balance = Number(plBalance) || 0;
  let paidDays = 0;
  for (const date of pastGrantedDates(leave, todayIST)) {
    const existing = statusByDate && statusByDate.get(date);
    if (!existing || existing.status !== "Absent" || existing.markedBy !== "auto") continue;
    const resolved = resolveLeaveStatus(balance);
    updates.push({ date, status: resolved.status, salaryCredit: resolved.salaryCredit });
    if (resolved.salaryCredit === 1) {
      balance -= 1;
      paidDays += 1;
    }
  }
  return { updates, paidDays };
}

module.exports = { pastGrantedDates, planRetroLeaveScoring, leaveSpanTooLong, addDays };
