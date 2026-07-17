// Attendance-status scoring for the portal — the TypeScript side of the mirror.
//
// ⚠️ MIRRORED in:
//   firebase/functions/attendanceRules.js          — payroll authority (what actually pays people)
//   android/…/data/model/AttendanceStatusRules.kt  — the app's offline preview
//
// The three copies cannot be merged: Kotlin can't import JS, the monorepo deliberately has no
// shared JS build graph, and the app's preview must work offline so it can't ask the server.
// Parity is therefore enforced by TEST, not by hope: attendanceRules.test.ts asserts this file
// against firebase/functions/attendance-rule-cases.txt — the same case file the other two suites
// read. Add a case there and all three pick it up; change the rule here alone and this suite
// goes red.
//
// This file exists because the portal used to inline the formula inside the Attendance page's
// deriveStatus, which is exactly how it drifted: it kept the old "no plan → unmarked" skip after
// the function and app moved on, and left the tab blank for days people had actually worked.
//
// Rule: offMinutes = late-in + early-out (each clamped at 0), scored against a working window.
//   off === 0            → Present
//   off <= SL_THRESHOLD  → SL (Short Leave)
//   else                 → HalfDay
// Window: office/admin/sales use the fixed 10:00–18:00; operations use the day's planned shift,
// falling back to 10:00–18:00 when it is missing or unusable.

export const OFFICE_START_MIN = 10 * 60; // 10:00
export const OFFICE_END_MIN = 18 * 60; // 18:00
export const SL_THRESHOLD_MIN = 120; // off-minutes at or below this are SL, above is Half Day

export type DayStatus = 'Present' | 'SL' | 'HalfDay';

/** Parse a "HH:MM" 24h string into minutes-from-midnight; fallback if null/blank/malformed. */
export function toMinutes(hhmm: string | undefined | null, fallback: number): number {
  if (!hhmm) return fallback;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return h * 60 + m;
}

/** off-minutes (late-in + early-out) → status. */
export function classifyOffMinutes(offMinutes: number): DayStatus {
  if (offMinutes === 0) return 'Present';
  if (offMinutes <= SL_THRESHOLD_MIN) return 'SL';
  return 'HalfDay';
}

/**
 * Score a day against a working window.
 *
 * @param inMin  check-in minutes-of-day.
 * @param outMin check-out minutes-of-day, or null when the day is still in progress (no completed
 *               check-out yet) — then only late-in is scored, because early-out can't be known.
 */
export function classify(
  inMin: number,
  outMin: number | null,
  startMin: number = OFFICE_START_MIN,
  endMin: number = OFFICE_END_MIN,
): DayStatus {
  const late = Math.max(0, inMin - startMin);
  const off = outMin == null ? late : late + Math.max(0, endMin - outMin);
  return classifyOffMinutes(off);
}

/**
 * Resolve an operations user's planned shift into a scoring window.
 *   null                → no usable plan (both times must be set). Callers score a worked day
 *                         against the default window; this stays honest about the plan's absence.
 *   {startMin, endMin}  → otherwise, falling back to 10:00–18:00 for an inverted/zero window
 *                         (e.g. a mis-entered end before start — an end of "06:00" meaning 6pm is
 *                         a real, observed data-entry mistake).
 *
 * The inverted fallback is load-bearing. Without it the portal scored an inverted plan literally:
 * start 20:00, end 06:00 makes both late-in and early-out clamp to 0, so every such day came out
 * **Present** regardless of when the person actually turned up.
 */
export function resolveOpsWindow(
  startTime: string | undefined | null,
  endTime: string | undefined | null,
): { startMin: number; endMin: number } | null {
  if (!startTime || !endTime) return null;
  let startMin = toMinutes(startTime, OFFICE_START_MIN);
  let endMin = toMinutes(endTime, OFFICE_END_MIN);
  if (endMin <= startMin) {
    startMin = OFFICE_START_MIN;
    endMin = OFFICE_END_MIN;
  }
  return { startMin, endMin };
}
