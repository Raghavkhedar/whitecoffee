import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';

// The rule itself lives in attendance/attendanceRules.ts (the mobile mirror of
// firebase/functions/attendanceRules.js); re-exported so existing callers keep working.
import { classify, istMinutesOfDay } from '../attendance/attendanceRules';
export { classify };

/**
 * Today's live-derived status from the same event stream Attendance already subscribes
 * to — first office_in, last office_out (events arrive pre-sorted ascending by timestamp
 * from subscribeTodayOfficeEvents). Returns null when there's nothing to flag: no
 * office_in yet, or the day classifies as Present — this is a deliberate subset of
 * classify()'s output, matching Android's own live-preview semantics exactly.
 */
export function deriveTodayLiveStatus(events: OfficeAttendanceEvent[]): 'HalfDay' | 'SL' | null {
  const checkIns = events.filter((e) => e.type === 'office_in');
  const checkOuts = events.filter((e) => e.type === 'office_out');
  if (checkIns.length === 0) return null;
  const inMinutes = istMinutesOfDay(checkIns[0].timestamp);
  const outMinutes = checkOuts.length > 0 ? istMinutesOfDay(checkOuts[checkOuts.length - 1].timestamp) : null;
  const status = classify(inMinutes, outMinutes);
  return status === 'Present' ? null : status;
}

// Mirrors firestore.rules's isSundayDate — UTC day-of-week on a "yyyy-mm-ddT00:00:00Z"
// string, never a bare `new Date(dateStr)`/`getDay()` (that reads the LOCAL day, which
// drifts from IST near midnight on a device in a different timezone).
export function isSunday(dateStr: string): boolean {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 0;
}

// Mirrors firestore.rules's isRestDate (Sunday OR a holidays/{date} doc). This module has
// no Firestore access, so the holiday flag is passed in by the caller — same split as
// attendanceRules.js's own resolveRestDayType.
export function isRestDay(dateStr: string, isHoliday: boolean): boolean {
  return isSunday(dateStr) || isHoliday;
}
