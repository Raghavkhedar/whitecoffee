"use strict";

// Boundary suite for the shared attendance rule. Mirrors AttendanceStatusRulesTest.kt in the
// Android app — keep the two in sync so the employee preview never drifts from payroll.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  toMinutes,
  classify,
  resolveOpsWindow,
  shouldEvaluateDay,
} = require("./attendanceRules");

const m = (h, min = 0) => h * 60 + min;

// NOTE: `classify` is imported, NOT redefined here. This file used to declare its own local copy
// of the off-minutes formula and assert against that — which meant the arithmetic actually used
// by computeDailyAttendanceStatus had zero coverage, and a wrong edit to it left `npm test`
// green. The cases below now exercise the real production function.

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

// The three cases below existed only in AttendanceStatusRulesTest.kt — the two suites are
// supposed to mirror each other, and had already drifted. Added to close the gap.

test("check-in at 10:45 is SL", () => {
  assert.equal(classify(m(10, 45), m(18, 0)), "SL");
});

test("early out by 3 hours is HalfDay", () => {
  assert.equal(classify(m(10, 0), m(15, 0)), "HalfDay");
});

test("ops late against a 12:00–20:00 planned shift grades to SL", () => {
  assert.equal(classify(m(12, 30), m(20, 0), m(12, 0), m(20, 0)), "SL");
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

// --- shouldEvaluateDay: which days computeDailyAttendanceStatus scores at all ---

test("shouldEvaluateDay: fixed-window roles are always evaluated, plan or not", () => {
  const fixed = { fixedWindow: true, hasPlan: false, hasLeave: false, worked: false };
  assert.equal(shouldEvaluateDay(fixed), true);
  assert.equal(shouldEvaluateDay({ ...fixed, worked: true }), true);
});

test("shouldEvaluateDay: ops with a plan is evaluated", () => {
  assert.equal(
    shouldEvaluateDay({ fixedWindow: false, hasPlan: true, hasLeave: false, worked: false }),
    true
  );
});

test("shouldEvaluateDay: ops with approved leave is evaluated (PL/LWP)", () => {
  assert.equal(
    shouldEvaluateDay({ fixedWindow: false, hasPlan: false, hasLeave: true, worked: false }),
    true
  );
});

test("shouldEvaluateDay: ops who worked with NO plan is evaluated (scored vs default 10–18)", () => {
  // The Pending/unmarked bug: a full day of site work used to be skipped outright
  // because the admin never entered a shift.
  assert.equal(
    shouldEvaluateDay({ fixedWindow: false, hasPlan: false, hasLeave: false, worked: true }),
    true
  );
});

test("shouldEvaluateDay: ops unscheduled day (no plan, no leave, no work) is skipped", () => {
  // Load-bearing: without this, an unscheduled ops day falls through to Absent (-2 days).
  assert.equal(
    shouldEvaluateDay({ fixedWindow: false, hasPlan: false, hasLeave: false, worked: false }),
    false
  );
});
