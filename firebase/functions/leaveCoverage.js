"use strict";

/**
 * Partial leave approval — does an approved leave actually GRANT a given date?
 * (spec: docs/superpowers/specs/2026-07-20-partial-leave-approval-design.md)
 *
 * An approver can grant an arbitrary SUBSET of the requested fromDate…toDate
 * range by writing `approvedDates: string[]` ("yyyy-MM-dd", sorted) on the leave
 * request. `fromDate` / `toDate` / `totalDays` are never rewritten — they stay the
 * record of what the employee ASKED for. "Partial" is derived, never stored, and
 * there is no `partially_approved` status (every `status === "approved"` reader in
 * three languages would have to learn about it, and a missed one turns a granted
 * leave day into an Absent — a payroll bug in the dangerous direction).
 *
 * ⚠️ THE COMPATIBILITY RULE — the whole reason this file is a shared module:
 *
 *     On an approved leave, a MISSING **or EMPTY** `approvedDates` means the
 *     ENTIRE fromDate…toDate range is granted.
 *
 * Every leave already in Firestore lacks the field, so all of them keep their
 * current meaning — no backfill, no migration. Any writer that does not know about
 * partial approval (notably the Android approve action, read-only this round)
 * writes no `approvedDates` and therefore correctly grants the full range.
 *
 * Firestore-free and Date-free so it can be unit-tested with `node --test`.
 * Cloud functions run on a UTC clock (see root CLAUDE.md): every comparison here
 * is a plain LEXICOGRAPHIC string compare on "yyyy-MM-dd", which is exactly
 * chronological for that format. Do not introduce `new Date()` in this file — it
 * would reintroduce the UTC/IST off-by-one-day class of bug.
 *
 * Callers: index.js (nightly scorer `leavesToday`, Sheets export) and
 * backfill-attendance-tz.js — which must never drift from the scorer.
 */

/**
 * Explicitly granted dates, or [] when the leave grants its whole range.
 *
 * NOTE the asymmetry that follows from the compatibility rule: an empty array is
 * NOT "nothing granted", it is "no restriction recorded" ⇒ the full range. A
 * genuine zero-date grant is a DECLINE and is never written as an approval.
 *
 * @param {{status?: string, approvedDates?: string[]}} leave
 * @returns {string[]} copy of the granted-date subset ([] = full range / not approved)
 */
function explicitGrantedDates(leave) {
  if (!leave || leave.status !== "approved") return [];
  const dates = leave.approvedDates;
  if (!Array.isArray(dates) || dates.length === 0) return [];
  // Bounded by the requested range, matching leaveCoversDate: a stray entry outside
  // fromDate…toDate grants nothing, so it must not be counted either. Without this the
  // Sheets "Days Granted" column would over-report against what the scorer actually pays.
  // Plain lexicographic compares — no Date, per the UTC/IST rule in the header.
  const { fromDate, toDate } = leave;
  if (!fromDate || !toDate) return [];
  return dates.filter((d) => typeof d === "string" && d >= fromDate && d <= toDate);
}

/**
 * Does this leave grant `date`?
 *
 * True only when the leave is approved AND `date` lies inside fromDate…toDate
 * (inclusive) AND — when an explicit subset was recorded — `date` is a member of
 * it. The range check applies in BOTH cases, so a stray `approvedDates` entry
 * outside the requested range grants nothing.
 *
 * An ungranted date returns false and is thereby a normal working day: the nightly
 * scorer simply never sees a leave for it and falls through to its existing
 * Absent / working-day path. No new status, no new branch.
 *
 * @param {{status?: string, fromDate?: string, toDate?: string, approvedDates?: string[]}} leave
 * @param {string} date "yyyy-MM-dd"
 * @returns {boolean}
 */
function leaveCoversDate(leave, date) {
  if (!leave || !date) return false;
  if (leave.status !== "approved") return false;
  if (!leave.fromDate || !leave.toDate) return false;
  if (!(leave.fromDate <= date && leave.toDate >= date)) return false;

  // Whether a restriction was RECORDED must be read from the raw field, not from the
  // range-filtered list: a leave whose approvedDates are all outside fromDate…toDate is
  // still a restricted approval granting nothing — not an unrestricted full-range one.
  const recorded = leave.approvedDates;
  const restricted = Array.isArray(recorded) && recorded.length > 0;
  if (!restricted) return true; // compatibility rule: whole range
  return recorded.indexOf(date) !== -1;
}

/**
 * Number of days actually granted, or null when that is "the whole requested
 * range" and the caller should fall back to the stored `totalDays`.
 *
 * Returning null rather than recomputing the span keeps this module Date-free:
 * spanning fromDate…toDate would require date arithmetic, and `totalDays` already
 * holds that number on every existing document.
 *
 * @param {{status?: string, approvedDates?: string[]}} leave
 * @returns {number|null}
 */
function grantedDayCount(leave) {
  const granted = explicitGrantedDates(leave);
  return granted.length === 0 ? null : granted.length;
}

module.exports = {
  leaveCoversDate,
  explicitGrantedDates,
  grantedDayCount,
};
