import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';

// Ported from firebase/functions/attendanceRules.js — office/admin's fixed-window branch
// only. Operations' planned-shift window is out of scope for this phase (mobile has no
// operations attendance flow yet); see the Phase 2b spec's "Scope decisions" section.
const OFFICE_START_MIN = 10 * 60; // 10:00
const OFFICE_END_MIN = 18 * 60; // 18:00

/**
 * Late-in and early-out are graded independently, zero grace on either side — HalfDay
 * wins when both apply. Mirrors attendanceRules.js's `classify` exactly (same signature,
 * same null-outMinutes semantics for a day still in progress).
 */
export function classify(
  inMinutes: number,
  outMinutes: number | null,
  startMin: number = OFFICE_START_MIN,
  endMin: number = OFFICE_END_MIN,
): 'HalfDay' | 'SL' | 'Present' {
  const late = Math.max(0, inMinutes - startMin);
  const earlyOut = outMinutes == null ? 0 : Math.max(0, endMin - outMinutes);
  if (late > 0) return 'HalfDay';
  if (earlyOut > 0) return 'SL';
  return 'Present';
}

// Epoch ms (UTC) → IST minutes-of-day, matching firebase/functions/nightlyScoring.js's
// getHourIST/getMinuteIST (shift by +5:30, read the UTC wall-clock components).
function istMinutesOfDay(epochMs: number): number {
  const istMs = epochMs + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

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
