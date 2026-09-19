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
 * Pure (no Firestore) so it is unit-tested via `npm test`; the trigger in index.js is a thin
 * wrapper that reads the docs, calls this, and writes the result in one transaction.
 */

const { leaveCoversDate } = require("./leaveCoverage");
const { resolveLeaveStatus } = require("./attendanceRules");

// A leave range is bounded by firestore.rules; this only stops a malformed doc from looping.
const MAX_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dates an approved leave grants that are strictly before todayIST ("yyyy-MM-dd"), ascending. */
function pastGrantedDates(leave, todayIST) {
  if (!leave || leave.status !== "approved" || !todayIST) return [];
  if (!DATE_RE.test(leave.fromDate || "") || !DATE_RE.test(leave.toDate || "")) return [];
  const out = [];
  let d = leave.fromDate;
  for (let i = 0; i < MAX_DAYS && d <= leave.toDate && d < todayIST; i += 1) {
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

module.exports = { pastGrantedDates, planRetroLeaveScoring, addDays };
