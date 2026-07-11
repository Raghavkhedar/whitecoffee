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
  resolveOpsWindow,
};
