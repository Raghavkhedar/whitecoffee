"use strict";

// Boundary suite for the shared attendance rule. Mirrors AttendanceStatusRulesTest.kt in the
// Android app — keep the two in sync so the employee preview never drifts from payroll.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  toMinutes,
  classifyOffMinutes,
  resolveOpsWindow,
  OFFICE_START_MIN,
  OFFICE_END_MIN,
} = require("./attendanceRules");

const m = (h, min = 0) => h * 60 + min;
// Convenience: score in/out minutes against a window the way computeDailyAttendanceStatus does.
const classify = (inMin, outMin, startMin = OFFICE_START_MIN, endMin = OFFICE_END_MIN) => {
  const late = Math.max(0, inMin - startMin);
  const early = outMin == null ? 0 : Math.max(0, endMin - outMin);
  return classifyOffMinutes(late + early);
};

test("check-in at exactly 10:00 with a full day is Present", () => {
  assert.equal(classify(m(10, 0), m(18, 0)), "Present");
});

test("check-in before 10:00 is Present", () => {
  assert.equal(classify(m(9, 45), m(18, 0)), "Present");
});

test("one minute late is SL, not HalfDay", () => {
  assert.equal(classify(m(10, 1), m(18, 0)), "SL");
});

test("exactly 120 off-minutes is SL", () => {
  assert.equal(classify(m(12, 0), m(18, 0)), "SL");
});

test("121 off-minutes is HalfDay", () => {
  assert.equal(classify(m(12, 1), m(18, 0)), "HalfDay");
});

test("early out by 30 min is SL", () => {
  assert.equal(classify(m(10, 0), m(17, 30)), "SL");
});

test("late in plus early out combine past the threshold", () => {
  // 60 late + 61 early = 121 off → HalfDay
  assert.equal(classify(m(11, 0), m(16, 59)), "HalfDay");
});

test("in-progress day (no checkout) scores late-in only", () => {
  assert.equal(classify(m(10, 15), null), "SL");
  assert.equal(classify(m(10, 0), null), "Present");
});

test("ops planned 12:00–20:00 shift: on-time arrival/leave is Present", () => {
  // Would be HalfDay against a fixed 10–18 window; Present against the real shift.
  assert.equal(classify(m(12, 0), m(20, 0), m(12, 0), m(20, 0)), "Present");
});

test("toMinutes parses valid time and falls back otherwise", () => {
  assert.equal(toMinutes("14:30", 0), m(14, 30));
  assert.equal(toMinutes(null, 600), 600);
  assert.equal(toMinutes("", 600), 600);
  assert.equal(toMinutes("garbage", 600), 600);
});

test("resolveOpsWindow: null when either time missing", () => {
  assert.equal(resolveOpsWindow(null, "18:00"), null);
  assert.equal(resolveOpsWindow("10:00", ""), null);
});

test("resolveOpsWindow: parsed window, with 10–18 fallback for an inverted shift", () => {
  assert.deepEqual(resolveOpsWindow("12:00", "20:00"), { startMin: m(12, 0), endMin: m(20, 0) });
  assert.deepEqual(resolveOpsWindow("20:00", "12:00"), { startMin: m(10, 0), endMin: m(18, 0) });
});
