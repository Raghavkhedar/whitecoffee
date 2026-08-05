// Pure date helpers for partial leave approval.
//
// A leave request records what the employee ASKED for (`fromDate`…`toDate`,
// `totalDays`); `approvedDates` records what the approver GRANTED. "Partial" is
// always derived from those two, never stored — see
// docs/superpowers/specs/2026-07-20-partial-leave-approval-design.md.
//
// Compatibility rule: on an approved leave, a missing or empty `approvedDates`
// means the entire fromDate…toDate range was granted. Every legacy document and
// every writer that predates partial approval (notably the Android approve
// action) therefore keeps its current meaning with no backfill.
//
// `cancelledDates` is a SECOND overlay on top of that, recording days an admin
// later revoked. Its empty case is the opposite of `approvedDates`: empty means
// nothing cancelled (empty `approvedDates` means everything granted). Both
// defaults read in the employee's favour, which is what keeps legacy documents
// behaving exactly as they always have.
//
// `grantedDates` therefore keeps meaning "what the approver ORIGINALLY granted"
// and never shrinks; `effectiveGrantedDates` is that minus cancellations, i.e.
// what the employee still has today. Everything user-facing wants the latter —
// the split exists so a cancellation never rewrites the record of the approval.
//
// All arithmetic is done on "yyyy-mm-ddT00:00:00Z" instants read back with the
// getUTC* accessors, so a browser in any timezone yields the same IST calendar
// dates (the same discipline the Cloud Functions use).

const MS_PER_DAY = 86_400_000;
const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shape this module needs from a LeaveRequest — kept structural so tests need no Firestore types. */
export interface LeaveLike {
  fromDate: string;
  toDate?: string;
  status?: string;
  approvedDates?: string[];
  cancelledDates?: string[];
}

/**
 * Every calendar date from `from` to `to` inclusive, sorted ascending.
 * A missing/blank `to` means a single-day range. Returns [] for malformed
 * input or an inverted range.
 */
export function expandDateRange(from: string, to?: string): string[] {
  if (!from || !DATE_RE.test(from)) return [];
  const end = to && DATE_RE.test(to) ? to : from;
  if (end < from) return [];
  const out: string[] = [];
  for (let t = toUtc(from).getTime(), stop = toUtc(end).getTime(); t <= stop; t += MS_PER_DAY) {
    out.push(fromUtc(new Date(t)));
  }
  return out;
}

/** The dates the employee requested off. */
export function requestedDates(leave: LeaveLike): string[] {
  return expandDateRange(leave.fromDate, leave.toDate);
}

/**
 * The dates actually granted. The requested range always bounds the result, so
 * a stray `approvedDates` entry outside fromDate…toDate is ignored.
 * Empty/absent `approvedDates` → the whole requested range (compatibility rule).
 */
export function grantedDates(leave: LeaveLike): string[] {
  const requested = requestedDates(leave);
  const approved  = leave.approvedDates;
  if (!approved || approved.length === 0) return requested;
  const inRange = new Set(requested);
  return approved.filter(d => inRange.has(d)).sort();
}

/**
 * The granted dates an admin later CANCELLED. Bounded by what was actually
 * granted, so a stray entry — a date never granted, or outside the request —
 * is ignored exactly as `grantedDates` ignores one outside the range.
 *
 * Empty/absent means nothing was cancelled. This is deliberately NOT the mirror
 * of the `approvedDates` compatibility rule: reading an empty array as "all
 * cancelled" would silently unpay every leave in the database.
 */
export function cancelledDates(leave: LeaveLike): string[] {
  const cancelled = leave.cancelledDates;
  if (!cancelled || cancelled.length === 0) return [];
  const granted = new Set(grantedDates(leave));
  return cancelled.filter(d => granted.has(d)).sort();
}

/**
 * The dates the employee STILL has off — granted minus cancelled. This is what
 * every user-facing surface should show, and what the backend scorer agrees
 * with (`leaveCoversDate` subtracts cancellations last, so a cancelled day is
 * an ordinary working day again).
 */
export function effectiveGrantedDates(leave: LeaveLike): string[] {
  const cancelled = new Set(cancelledDates(leave));
  if (cancelled.size === 0) return grantedDates(leave);
  return grantedDates(leave).filter(d => !cancelled.has(d));
}

/** How many days the employee still has off, after cancellations. */
export function effectiveGrantedDayCount(leave: LeaveLike): number {
  return effectiveGrantedDates(leave).length;
}

/** True once any granted day has been cancelled. */
export function isCancelled(leave: LeaveLike): boolean {
  return cancelledDates(leave).length > 0;
}

/** True when SOME but not all granted days were cancelled — the leave is partly alive. */
export function isPartiallyCancelled(leave: LeaveLike): boolean {
  return isCancelled(leave) && effectiveGrantedDates(leave).length > 0;
}

/** Requested dates that were NOT granted — normal working days, the employee is expected in. */
export function ungrantedDates(leave: LeaveLike): string[] {
  const granted = new Set(grantedDates(leave));
  return requestedDates(leave).filter(d => !granted.has(d));
}

/** How many days the approval actually grants. */
export function grantedDayCount(leave: LeaveLike): number {
  return grantedDates(leave).length;
}

/** How many days were requested (spanned by fromDate…toDate, not the stored `totalDays`). */
export function requestedDayCount(leave: LeaveLike): number {
  return requestedDates(leave).length;
}

/**
 * Partial = approved, with a non-empty `approvedDates` covering fewer days than
 * the requested range. Pending/rejected leaves are never partial; neither is a
 * legacy approval with no `approvedDates`.
 */
export function isPartialApproval(leave: LeaveLike): boolean {
  if (leave.status !== 'approved') return false;
  const approved = leave.approvedDates;
  if (!approved || approved.length === 0) return false;
  return grantedDates(leave).length < requestedDayCount(leave);
}

/** True for a Sunday — a rest day, never a leave day (the scorer skips it). */
export function isSunday(date: string): boolean {
  return DATE_RE.test(date) && toUtc(date).getUTCDay() === 0;
}

/** "Tue 21 Jul" — the checkbox label in the approve modal. */
export function formatDayLabel(date: string): string {
  if (!DATE_RE.test(date)) return date;
  const d = toUtc(date);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/**
 * "21, 22, 24 Jul" — a compact day list for the notification and the list rows.
 * Dates spanning a month boundary keep one month name per run: "30, 31 Jul, 1 Aug".
 */
export function formatDatesShort(dates: string[]): string {
  const valid = dates.filter(d => DATE_RE.test(d));
  if (valid.length === 0) return '';
  const groups: { month: string; days: number[] }[] = [];
  for (const date of valid) {
    const d     = toUtc(date);
    const month = MONTH_NAMES[d.getUTCMonth()];
    const last  = groups[groups.length - 1];
    if (last && last.month === month) last.days.push(d.getUTCDate());
    else groups.push({ month, days: [d.getUTCDate()] });
  }
  return groups.map(g => `${g.days.join(', ')} ${g.month}`).join(', ');
}

/**
 * The employee-facing message for a PARTIAL approval. Naming the days they are
 * expected at work is the point of the notification — that is the sentence that
 * prevents an unexpected absence.
 */
export function partialApprovalMessage(leave: LeaveLike): { title: string; body: string } {
  const granted   = grantedDates(leave);
  const ungranted = ungrantedDates(leave);
  const total     = requestedDayCount(leave);
  let body = `${granted.length} of your ${total} requested days were approved: ${formatDatesShort(granted)}.`;
  if (ungranted.length > 0) body += ` You are expected at work on ${formatDatesShort(ungranted)}.`;
  return { title: 'Leave partially approved', body };
}

/**
 * The employee-facing message for a CANCELLED approval. Same priority as the
 * partial-approval message and for the same reason: the load-bearing sentence is
 * the one naming days they must now turn up for. Someone who was told they had
 * leave will not check the portal again — this notification is the only thing
 * standing between a cancellation and an unexplained Absent on their record.
 *
 * `cancelledNow` is the dates revoked by THIS action, not the cumulative set, so
 * a second cancellation on the same leave reports only what just changed. Pass
 * the leave in whatever state you hold it — the message never reads
 * `leave.cancelledDates`, only the requested range and the surviving days.
 */
export function leaveCancelledMessage(
  leave: LeaveLike, cancelledNow: string[],
): { title: string; body: string } {
  const revoked   = [...cancelledNow].filter(d => DATE_RE.test(d)).sort();
  const cancelledSet = new Set(revoked);
  // Computed from the ORIGINAL grant minus what this action revoked, so the count is
  // right whether or not the caller's `leave` has been refreshed from Firestore yet.
  const remaining = grantedDates(leave).filter(d => !cancelledSet.has(d));

  const dayWord = revoked.length === 1 ? 'day' : 'days';
  let body = `${revoked.length} approved leave ${dayWord} ${revoked.length === 1 ? 'has' : 'have'} been cancelled: ${formatDatesShort(revoked)}. You are expected at work on ${revoked.length === 1 ? 'that day' : 'those days'}.`;
  body += remaining.length > 0
    ? ` Your remaining approved leave: ${formatDatesShort(remaining)}.`
    : ' You have no approved leave days left on this request.';

  return {
    title: remaining.length > 0 ? 'Leave partially cancelled' : 'Leave cancelled',
    body,
  };
}
