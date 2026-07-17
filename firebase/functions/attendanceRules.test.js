"use strict";

// Boundary suite for the shared attendance rule.
//
// The `classify` cases are NOT written here — they are loaded from the shared case file
// attendance-rule-cases.txt, which AttendanceStatusRulesTest.kt in the Android app reads and
// asserts against too. Add a case there and both suites pick it up; change the rule on one side
// only and the other goes red. See that file's header for why the copies can't just be merged.
//
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  toMinutes,
  classify,
  resolveOpsWindow,
  shouldEvaluateDay,
} = require("./attendanceRules");

const m = (h, min = 0) => h * 60 + min;

// ── Shared cases (mirrored with the Android suite) ───────────────────────────
const CASE_FILE = path.join(__dirname, "attendance-rule-cases.txt");
const sharedCases = fs.readFileSync(CASE_FILE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((line) => {
    const [name, inMin, outMin, startMin, endMin, expected] = line.split("|").map((s) => s.trim());
    return {
      name,
      inMin: Number(inMin),
      outMin: outMin === "-" ? null : Number(outMin),
      startMin: Number(startMin),
      endMin: Number(endMin),
      expected,
    };
  });

test("shared case file is present and non-empty", () => {
  // Guards the silent-pass failure mode: a moved/emptied file must fail loudly, not
  // quietly register zero cases and look green.
  assert.ok(sharedCases.length >= 10, `expected the shared cases, got ${sharedCases.length}`);
});

for (const c of sharedCases) {
  test(`[shared] ${c.name}`, () => {
    assert.equal(classify(c.inMin, c.outMin, c.startMin, c.endMin), c.expected);
  });
}

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
