"use strict";

/**
 * Pure attendance-status scoring used by computeDailyAttendanceStatus.
 *
 * ⚠️ MIRRORED in the Android app at
 *   android/app/src/main/java/com/raghav/whitecoffee/data/model/AttendanceStatusRules.kt
 * The app shows employees a client-side preview of the status THIS function will assign
 * nightly. Any change to the thresholds, the off-minutes formula, or the planned-window
 * fallback MUST be made in both files (and both test suites: attendanceRules.test.js here
 * and AttendanceStatusRulesTest.kt there) or the preview will drift from payroll — which is
 * exactly the class of bug this shared module exists to prevent.
 *
 * Rule: offMinutes = late-in + early-out (both clamped at 0), scored against a working window.
 *   off === 0            → Present
 *   off <= SL_THRESHOLD  → SL (Short Leave)
 *   else                 → HalfDay
 * Window: office/admin is fixed 10:00–18:00; operations use the day's planned shift.
 */

const OFFICE_START_MIN = 10 * 60; // 10:00
const OFFICE_END_MIN = 18 * 60;   // 18:00
const SL_THRESHOLD_MIN = 120;     // off-minutes at or below this are SL, above is Half Day

/** Parse a "HH:MM" 24h string into minutes-from-midnight; fallback if null/blank/malformed. */
function toMinutes(hhmm, fallback) {
  if (!hhmm || typeof hhmm !== "string") return fallback;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return h * 60 + m;
}

/** off-minutes (late-in + early-out) → status string. */
function classifyOffMinutes(offMinutes) {
  if (offMinutes === 0) return "Present";
  if (offMinutes <= SL_THRESHOLD_MIN) return "SL";
  return "HalfDay";
}

/**
 * Score a day against a working window: off-minutes (late-in + early-out) → status.
 *
 * This is the whole rule, and it lives here rather than inline in the caller for a reason.
 * The off-minutes formula used to sit in computeDailyAttendanceStatus while this module
 * exported only the thresholds — so the arithmetic that decides everybody's pay had NO test
 * covering it, because attendanceRules.test.js defined its own local copy of the formula and
 * graded that instead. A wrong edit to the real one kept `npm test` green.
 *
 * MIRRORS AttendanceStatusRules.classify in the Android app — same signature, same defaults,
 * same null-outMin semantics. Keep them in lockstep.
 *
 * @param inMin    check-in minutes-of-day.
 * @param outMin   check-out minutes-of-day, or null/undefined when the day is still in progress
 *                 (no completed check-out yet) — then only late-in is scored, because early-out
 *                 cannot be known yet. The nightly run never passes null (one-sided days are
 *                 LNF before they reach here); the app's live preview does.
 * @param startMin window start (default 10:00).
 * @param endMin   window end (default 18:00).
 */
function classify(inMin, outMin, startMin = OFFICE_START_MIN, endMin = OFFICE_END_MIN) {
  const late = Math.max(0, inMin - startMin);
  const off = outMin == null ? late : late + Math.max(0, endMin - outMin);
  return classifyOffMinutes(off);
}

/**
 * Whether computeDailyAttendanceStatus should score a day at all.
 *
 * Fixed-window roles (office/admin/sales) are always evaluated — they never need a plan.
 * Operations are evaluated when ANY of these hold:
 *   - a planned shift exists (the normal case), or
 *   - approved leave exists (produces PL/LWP), or
 *   - they actually worked — a worked day is scored against the default 10:00–18:00 shift
 *     rather than left unmarked just because an admin forgot to enter the plan.
 *
 * With none of the three the day is *unscheduled*: leave it alone. This is the load-bearing
 * part — without the `worked` guard, dropping the no-plan skip would mark every unscheduled
 * ops day Absent (-2 days), penalising people for days they were never rostered.
 *
 * Backend-only orchestration, deliberately NOT mirrored in AttendanceStatusRules.kt: the app
 * expresses the same "not scored" idea as its neutral "pending" chip, not as a skip. The
 * mirror contract in this file's header covers the thresholds / off-minutes formula / window
 * fallback — none of which this touches.
 */
function shouldEvaluateDay({ fixedWindow, hasPlan, hasLeave, worked }) {
  if (fixedWindow) return true;
  return Boolean(hasPlan || hasLeave || worked);
}

/**
 * Resolve an operations user's planned shift into a scoring window.
 *   null                 → no usable plan (both times must be set); the caller leaves the day
 *                          unmarked (and the app preview shows "pending").
 *   { startMin, endMin } → otherwise, falling back to 10:00–18:00 for an inverted/zero window.
 */
function resolveOpsWindow(startTime, endTime) {
  if (!startTime || !endTime) return null;
  let startMin = toMinutes(startTime, OFFICE_START_MIN);
  let endMin = toMinutes(endTime, OFFICE_END_MIN);
  if (endMin <= startMin) {
    startMin = OFFICE_START_MIN;
    endMin = OFFICE_END_MIN;
  }
  return { startMin, endMin };
}

module.exports = {
  OFFICE_START_MIN,
  OFFICE_END_MIN,
  SL_THRESHOLD_MIN,
  toMinutes,
  classifyOffMinutes,
  classify,
  resolveOpsWindow,
  shouldEvaluateDay,
};
