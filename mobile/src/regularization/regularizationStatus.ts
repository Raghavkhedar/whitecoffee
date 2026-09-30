
// The rule itself lives in attendance/attendanceRules.ts (the mobile mirror of
// firebase/functions/attendanceRules.js); re-exported so existing callers keep working.
import {
  classify,
  OFFICE_END_MIN,
  OFFICE_START_MIN,
  scorablePunches,
  type TimedEvent,
  type Window,
} from '../attendance/attendanceRules';
import { usesFixedWindow } from '../roles/roleCapabilities';
export { classify };

/**
 * Today's status worth regularizing, or null when there's nothing to fix (Present, or no
 * scoreable arrival). Port of Android's RegularizationViewModel.deriveLiveStatus: in/out types
 * come from the role (so a sales SITE day is regularizable, not invisible) and the window is the
 * ops planned shift, falling back to 10:00–18:00 — never "unmarked", or Home would show Half Day
 * for a day this screen then offers nothing to dispute. Events sorted ascending.
 */
export function deriveTodayLiveStatus(
  events: TimedEvent[],
  role: string = 'office',
  plannedWindow: Window | null = null,
): 'HalfDay' | 'SL' | null {
  const punches = scorablePunches(events, role);
  if (!punches.hasCheckIn) return null;
  if (punches.inMin == null) return 'HalfDay';
  const window = usesFixedWindow(role) ? null : plannedWindow;
  const status = classify(
    punches.inMin,
    punches.outMin,
    window?.startMin ?? OFFICE_START_MIN,
    window?.endMin ?? OFFICE_END_MIN,
  );
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
