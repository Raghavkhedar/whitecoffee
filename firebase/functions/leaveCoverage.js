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
 * ⚠️ CANCELLATION — a SECOND overlay, layered on top of the first:
 *
 *     `cancelledDates: string[]` revokes days that were previously granted. A
 *     MISSING or EMPTY array means nothing was cancelled.
 *
 * Note the asymmetry with `approvedDates`, and do not "unify" them: empty
 * `approvedDates` means grant EVERYTHING, empty `cancelledDates` means cancel
 * NOTHING. Both defaults are the permissive-to-the-employee reading, which is why
 * a legacy document with neither field behaves exactly as it always has.
 *
 * A cancelled date is subtracted LAST, so it wins over any grant: the admin
 * cancelling a day is always the most recent decision about that day. `fromDate` /
 * `toDate` / `totalDays` / `approvedDates` are still never rewritten — cancellation
 * only ever ADDS an overlay, so the document keeps the full history of what was
 * asked for, what was granted, and what was later revoked.
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
 * The dates a cancellation revoked, as a lookup set. Empty when nothing was
 * cancelled — which is every legacy document and every leave never cancelled.
 *
 * Unlike `approvedDates`, an empty array here is NOT a special "means everything"
 * case: it means exactly what it says, nothing cancelled. Kept private because no
 * caller outside this module needs the raw set — they want the two functions below.
 *
 * @param {{cancelledDates?: string[]}} leave
 * @returns {Set<string>}
 */
function cancelledDateSet(leave) {
  const dates = leave && leave.cancelledDates;
  if (!Array.isArray(dates) || dates.length === 0) return new Set();
  return new Set(dates.filter((d) => typeof d === "string" && d));
}

/**
 * Explicitly granted dates, or [] when the leave grants its whole range.
 *
 * NOTE the asymmetry that follows from the compatibility rule: an empty array is
 * NOT "nothing granted", it is "no restriction recorded" ⇒ the full range. A
 * genuine zero-date grant is a DECLINE and is never written as an approval.
 *
 * Cancelled dates are excluded, so this is what is STILL granted today — the
 * number the Sheets "Days Granted" column exports must match what the scorer
 * actually pays, and a cancelled day is not paid.
 *
 * ⚠️ A fully-cancelled restricted approval returns [] here, which the caller
 * (`grantedDayCount`) then reports as null ⇒ "fall back to totalDays". That is why
 * `grantedDayCount` re-checks cancellation itself rather than trusting the length.
 *
 * @param {{status?: string, approvedDates?: string[], cancelledDates?: string[]}} leave
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
  const cancelled = cancelledDateSet(leave);
  return dates.filter(
    (d) => typeof d === "string" && d >= fromDate && d <= toDate && !cancelled.has(d)
  );
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
 * Absent / working-day path. No new status, no new branch — which is exactly why
 * CANCELLING a future date needs no scorer change at all: it just stops being
 * covered, and the day scores as the ordinary working day it now is.
 *
 * @param {{status?: string, fromDate?: string, toDate?: string, approvedDates?: string[], cancelledDates?: string[]}} leave
 * @param {string} date "yyyy-MM-dd"
 * @returns {boolean}
 */
function leaveCoversDate(leave, date) {
  if (!leave || !date) return false;
  if (leave.status !== "approved") return false;
  if (!leave.fromDate || !leave.toDate) return false;
  if (!(leave.fromDate <= date && leave.toDate >= date)) return false;

  // Cancellation is subtracted FIRST and wins over any grant: it is by definition the
  // most recent decision about the day. Checked before the compatibility rule so it
  // applies equally to a full-range approval and a restricted one.
  if (cancelledDateSet(leave).has(date)) return false;

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
 * ⚠️ Cancellation breaks the old "empty ⇒ null ⇒ use totalDays" shortcut, in the
 * expensive direction: a leave whose every granted day was cancelled would report
 * `totalDays` and bill the Sheets export for days nobody is taking. So once any
 * cancellation exists this counts explicitly, and a real 0 stays 0. Still Date-free
 * — subtracting cancelled days from `totalDays` needs only lexicographic compares.
 *
 * @param {{status?: string, fromDate?: string, toDate?: string, totalDays?: number, approvedDates?: string[], cancelledDates?: string[]}} leave
 * @returns {number|null}
 */
function grantedDayCount(leave) {
  const cancelled = cancelledDateSet(leave);

  // Nothing cancelled — the original path, bit-for-bit. Every legacy document and
  // every never-cancelled leave lands here, so their exported counts cannot move.
  if (cancelled.size === 0) {
    const granted = explicitGrantedDates(leave);
    return granted.length === 0 ? null : granted.length;
  }

  if (!leave || leave.status !== "approved") return null;

  // Restricted grant: countable exactly, and 0 is a REAL zero (everything that was
  // granted has since been cancelled) — never "fall back to totalDays".
  const recorded = leave.approvedDates;
  if (Array.isArray(recorded) && recorded.length > 0) {
    return explicitGrantedDates(leave).length;
  }

  // Unrestricted grant (compatibility rule: the whole range). The span is `totalDays`
  // and a cancellation only ever removes dates from inside it, so the count is a plain
  // subtraction — no range expansion, no Date.
  const { fromDate, toDate, totalDays } = leave;
  if (!fromDate || !toDate || typeof totalDays !== "number") return null;
  let cancelledInRange = 0;
  cancelled.forEach((d) => {
    if (d >= fromDate && d <= toDate) cancelledInRange += 1;
  });
  return Math.max(0, totalDays - cancelledInRange);
}

module.exports = {
  leaveCoversDate,
  explicitGrantedDates,
  grantedDayCount,
};
