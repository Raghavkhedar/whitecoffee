import { attendanceInTypes, attendanceOutTypes, usesFixedWindow } from '../roles/roleCapabilities';

// Pure attendance-status scoring — the mobile mirror of firebase/functions/attendanceRules.js
// (payroll authority) and Android's AttendanceStatusRules.kt + ResolveTodayStatusUseCase.kt.
// The classify cases are asserted from the SHARED case file
// firebase/functions/attendance-rule-cases.txt, which the functions and Android suites read too:
// change the rule on one side only and the others go red. Keep them in lockstep.
//
// Rule: late-in and early-out graded independently, zero grace on both sides.
//   late-in > 0                → HalfDay
//   early-out > 0 (no late-in) → SL
//   neither                    → Present
// Window: fixed 10:00–18:00 for office/admin/sales; operations use the day's planned shift.

export const OFFICE_START_MIN = 10 * 60;
export const OFFICE_END_MIN = 18 * 60;

export type DayStatus = 'HalfDay' | 'SL' | 'Present';

/** "HH:MM" 24h → minutes-from-midnight; fallback if null/blank/malformed. */
export function toMinutes(hhmm: unknown, fallback: number): number {
  if (!hhmm || typeof hhmm !== 'string') return fallback;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return h * 60 + m;
}

/** outMin null = day still in progress: only late-in can be scored yet. */
export function classify(
  inMin: number,
  outMin: number | null,
  startMin: number = OFFICE_START_MIN,
  endMin: number = OFFICE_END_MIN,
): DayStatus {
  const late = Math.max(0, inMin - startMin);
  const earlyOut = outMin == null ? 0 : Math.max(0, endMin - outMin);
  if (late > 0) return 'HalfDay';
  if (earlyOut > 0) return 'SL';
  return 'Present';
}

export interface Window {
  startMin: number;
  endMin: number;
}

/** An ops planned shift → window; null when either time is missing; 10–18 for inverted/zero. */
export function resolveOpsWindow(startTime: unknown, endTime: unknown): Window | null {
  if (!startTime || !endTime) return null;
  let startMin = toMinutes(startTime, OFFICE_START_MIN);
  let endMin = toMinutes(endTime, OFFICE_END_MIN);
  if (endMin <= startMin) {
    startMin = OFFICE_START_MIN;
    endMin = OFFICE_END_MIN;
  }
  return { startMin, endMin };
}

/**
 * Auto rest-day status from the DATE and whether holidays/{date} exists — never from the
 * presence of a status doc (a recurring bug). Holiday wins over Sunday.
 */
export function resolveRestDayType(dateStr: string, isHoliday: boolean): 'Holiday' | 'Sunday' | null {
  if (isHoliday) return 'Holiday';
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 0 ? 'Sunday' : null;
}

/** Epoch ms → IST minutes-of-day (+05:30, UTC fields) — the clock the server scores on. */
export function istMinutesOfDay(epochMs: number): number {
  const d = new Date(epochMs + 5.5 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export interface TimedEvent {
  type: string;
  timestamp: number;
}

export interface ScoredPunches {
  hasCheckIn: boolean;
  inMin: number | null;
  outMin: number | null;
}

/**
 * First check-in and the closing check-out, by the ROLE's in/out types (so a sales site day
 * scores, not just an office day). The out only counts when it comes after the last in — an
 * open session has no check-out yet. Events must be sorted ascending by timestamp.
 */
export function scorablePunches(events: TimedEvent[], role: string): ScoredPunches {
  const inTypes = new Set<string>(attendanceInTypes(role));
  const outTypes = new Set<string>(attendanceOutTypes(role));
  const firstIn = events.find((e) => inTypes.has(e.type));
  if (!firstIn) return { hasCheckIn: false, inMin: null, outMin: null };
  let lastInIdx = -1;
  let lastOutIdx = -1;
  events.forEach((e, i) => {
    if (inTypes.has(e.type)) lastInIdx = i;
    if (outTypes.has(e.type)) lastOutIdx = i;
  });
  const lastOut = lastOutIdx > lastInIdx ? events[lastOutIdx] : null;
  return {
    hasCheckIn: true,
    inMin: Number.isFinite(firstIn.timestamp) ? istMinutesOfDay(firstIn.timestamp) : null,
    outMin: lastOut && Number.isFinite(lastOut.timestamp) ? istMinutesOfDay(lastOut.timestamp) : null,
  };
}

export type DayStatusPreview = 'Present' | 'SL' | 'HalfDay' | 'Pending' | 'NotCheckedIn';

/**
 * Port of Android's ResolveTodayStatusUseCase: the live preview of what the nightly
 * computeDailyAttendanceStatus will assign. An operations day is scheduled, so no arrival yet
 * is Pending (not an absence); fixed-window roles are NotCheckedIn. `plannedWindow` is ignored
 * for fixed-window roles; a no-plan ops day scores against 10:00–18:00.
 */
export function resolveTodayStatus(
  events: TimedEvent[],
  role: string,
  plannedWindow: Window | null,
): DayStatusPreview {
  const fixed = usesFixedWindow(role);
  const punches = scorablePunches(events, role);
  if (!punches.hasCheckIn) return fixed ? 'NotCheckedIn' : 'Pending';
  if (punches.inMin == null) return fixed ? 'HalfDay' : 'Pending';
  const window = fixed ? null : plannedWindow;
  return classify(
    punches.inMin,
    punches.outMin,
    window?.startMin ?? OFFICE_START_MIN,
    window?.endMin ?? OFFICE_END_MIN,
  );
}
