// Pure decision logic for `cancelLeave` (src/lib/firestore.ts): given a leave, the dates an
// admin asked to cancel, the day-status docs already read for those dates and the holiday
// set, decide which dates are cancelled, which status docs must be reverted to Absent, which
// dates are reported as skipped, and how many `plBalance` days to refund.
//
// No firebase imports, no clock, no I/O. `cancelLeave` does the reads and the writes and
// calls this in between, exactly as `scoreRetroactiveLeave` wraps `planRetroLeaveScoring`.
// Extracted with ZERO behaviour change; every rule below was argued out in `cancelLeave`'s
// doc comment and in docs/superpowers/specs/2026-08-05-leave-cancellation-design.md.
//
// ── Shapes ────────────────────────────────────────────────────────────────────────────────
//
// Input  (`LeaveCancellationInput`)
//   leave        the leave doc as read from the server (structural: `LeaveLike`). Only
//                fromDate / toDate / approvedDates / cancelledDates are read here. Its
//                `status` is NOT checked — "only an approved leave can be cancelled" is the
//                caller's guard, kept where it is so its error text and ordering are unchanged.
//   datesToCancel  the caller's (possibly stale) list. Deduped, then intersected with what the
//                leave STILL grants (`effectiveGrantedDates`), then sorted → `cancelling`.
//   statusByDate the `users/{uid}/attendance_status/{date}` docs that exist, keyed by date. A
//                date with NO entry means "no doc" (never scored). Only dates in `cancelling`
//                are looked at; extra keys are ignored.
//   holidaySet   "yyyy-mm-dd" company holidays covering the cancelling range.
//
// Output (`LeaveCancellationPlan`)
//   cancelling            deduped, sorted dates this call cancels (may be empty — the caller
//                         throws on that BEFORE reading anything, via `resolveCancellingDates`).
//   reverts               subset of `cancelling` (ascending) whose status doc must be set to
//                         `{status:'Absent', markedBy:'admin', salaryCredit: deleteField()}`.
//   skippedDates          dates reported to the admin as "something else already claimed this
//                         day" — a leave-scored-or-not doc that is admin-marked, or a
//                         non-leave status. Ascending. NOT rest days, NOT no-doc dates.
//   refundedDays          how many reverted days drew from `plBalance` (paid SCHL, or legacy PL).
//   mergedCancelledDates  union of the leave's existing `cancelledDates` and `cancelling`,
//                         deduped and sorted — a second cancellation never un-cancels the first.

import { effectiveGrantedDates, isSunday, type LeaveLike } from './leaveDates';

/** The fields of an `attendance_status` doc this module reads. `status` is a plain string: legacy docs carry `PL`/`LWP`. */
export interface StatusDocLike {
  status: string;
  markedBy?: string;
  salaryCredit?: number;
}

export interface LeaveCancellationInput {
  leave: LeaveLike;
  datesToCancel: readonly string[];
  statusByDate: ReadonlyMap<string, StatusDocLike>;
  holidaySet: ReadonlySet<string>;
}

export interface LeaveCancellationPlan {
  cancelling: string[];
  reverts: string[];
  skippedDates: string[];
  refundedDays: number;
  mergedCancelledDates: string[];
}

/**
 * Re-derive what is still granted from the SERVER copy rather than trusting the caller's list:
 * a stale tab could otherwise "cancel" a day another admin already cancelled and double-refund it.
 * Exposed separately because `cancelLeave` needs this list BEFORE it can read the status docs.
 */
export function resolveCancellingDates(leave: LeaveLike, datesToCancel: readonly string[]): string[] {
  const stillGranted = new Set(effectiveGrantedDates(leave));
  return Array.from(new Set(datesToCancel)).filter(d => stillGranted.has(d)).sort();
}

export function planLeaveCancellation(input: LeaveCancellationInput): LeaveCancellationPlan {
  const { leave, datesToCancel, statusByDate, holidaySet } = input;
  const cancelling = resolveCancellingDates(leave, datesToCancel);

  const reverts: string[] = [];
  const skippedDates: string[] = [];
  let refundedDays = 0;

  for (const date of cancelling) {
    // Rest days (Protocol 1) are immutable at the attendance_status layer regardless of what a
    // (legacy) doc there says — a silent skip by DATE (holiday OR Sunday; mirrors `isRestDay` in
    // firestore.ts, which this module cannot import because it pulls in the firebase SDK), not a
    // thrown error and not a reported skippedDate. `isSunday` differs from `isRestDay` only on a
    // malformed date string, which cannot reach here: `cancelling` ⊆ `effectiveGrantedDates`,
    // which are all produced by `expandDateRange` (validated yyyy-mm-dd).
    if (holidaySet.has(date) || isSunday(date)) continue;
    // No doc = never scored (a future date, or a Sunday/holiday before Protocol 1). Not a skip.
    const data = statusByDate.get(date);
    if (!data) continue;
    // A Sunday/Holiday doc is never a leave day either — same "nothing to undo" case as no doc,
    // just backed by a real record. (Catches a doc scored on a date that WAS a rest day but no
    // longer resolves as one above — e.g. the holiday was later unmarked — which the date-based
    // check cannot see.)
    if (data.status === 'Sunday' || data.status === 'Holiday') continue;
    // SCHL is the current leave status; PL/LWP are LEGACY docs scored before the SCHL change.
    const scoredAsLeave = data.status === 'SCHL' || data.status === 'PL' || data.status === 'LWP';
    if (!scoredAsLeave || data.markedBy !== 'auto') { skippedDates.push(date); continue; }

    reverts.push(date);
    // Refund only a day that actually drew from plBalance: paid SCHL (salaryCredit 1) or legacy
    // PL. Unpaid SCHL (salaryCredit 0/missing) and legacy LWP never decremented anything.
    if ((data.status === 'SCHL' && data.salaryCredit === 1) || data.status === 'PL') refundedDays += 1;
  }

  // Union, never overwrite — a second cancellation must not un-cancel the first.
  const mergedCancelledDates = Array.from(new Set([...(leave.cancelledDates ?? []), ...cancelling])).sort();

  return { cancelling, reverts, skippedDates, refundedDays, mergedCancelledDates };
}
