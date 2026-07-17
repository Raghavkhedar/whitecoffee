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

// NOTE: `shouldEvaluateDay` was deleted on 2026-07-17 when operations were flipped to
// "always evaluated" (Mon–Sat), matching office/admin/sales. It had encoded the ops-only
// three-way skip (plan OR leave OR punches); with ops scored every working day the predicate
// was always true and the unit disappeared with the decision it modelled.
//
// The remaining "is this day scored at all?" rules now live inline in
// computeDailyAttendanceStatus and are NOT covered here (this suite is pure functions only):
// the Sunday skip, the holidays/{date} skip, the `active !== false` filter, and the
// markedBy === "admin" override. All four are function-level guards, unchanged by the flip.
