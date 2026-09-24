// Faithful port of the READ side of admin/src/lib/leaveDates.ts (mirrored there,
// firebase/functions/leaveCoverage.js, and Android's LeaveRequest.kt — change all four
// together). The write-side notification-message helpers are portal-only and not ported
// here; this app never approves or cancels leave.

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface LeaveLike {
  fromDate: string;
  toDate?: string;
  status?: string;
  approvedDates?: string[];
  cancelledDates?: string[];
}

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

export function requestedDates(leave: LeaveLike): string[] {
  return expandDateRange(leave.fromDate, leave.toDate);
}

export function grantedDates(leave: LeaveLike): string[] {
  const requested = requestedDates(leave);
  const approved = leave.approvedDates;
  if (!approved || approved.length === 0) return requested;
  const inRange = new Set(requested);
  return approved.filter((d) => inRange.has(d)).sort();
}

export function cancelledDates(leave: LeaveLike): string[] {
  const cancelled = leave.cancelledDates;
  if (!cancelled || cancelled.length === 0) return [];
  const granted = new Set(grantedDates(leave));
  return cancelled.filter((d) => granted.has(d)).sort();
}

export function effectiveGrantedDates(leave: LeaveLike): string[] {
  const cancelled = new Set(cancelledDates(leave));
  if (cancelled.size === 0) return grantedDates(leave);
  return grantedDates(leave).filter((d) => !cancelled.has(d));
}

export function effectiveGrantedDayCount(leave: LeaveLike): number {
  return effectiveGrantedDates(leave).length;
}

export function isCancelled(leave: LeaveLike): boolean {
  return cancelledDates(leave).length > 0;
}

export function isPartiallyCancelled(leave: LeaveLike): boolean {
  return isCancelled(leave) && effectiveGrantedDates(leave).length > 0;
}

export function requestedDayCount(leave: LeaveLike): number {
  return requestedDates(leave).length;
}

export function isPartialApproval(leave: LeaveLike): boolean {
  if (leave.status !== 'approved') return false;
  const approved = leave.approvedDates;
  if (!approved || approved.length === 0) return false;
  return grantedDates(leave).length < requestedDayCount(leave);
}

export type LeaveDisplayStatus = 'pending' | 'approved' | 'partial' | 'rejected';

// A fully-cancelled approval displays identically to "rejected" per the admin
// portal's own convention (android/CLAUDE.md: "a full cancellation renders in the
// REJECTED colours despite status == 'approved'").
export function leaveDisplayStatus(leave: LeaveLike): LeaveDisplayStatus {
  if (leave.status !== 'approved') {
    return leave.status === 'rejected' ? 'rejected' : 'pending';
  }
  if (isCancelled(leave)) {
    return effectiveGrantedDates(leave).length > 0 ? 'partial' : 'rejected';
  }
  return isPartialApproval(leave) ? 'partial' : 'approved';
}
