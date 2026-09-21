"use strict";

// resolveNightlyClock — which IST date does a nightly run score? Run: `npm test`.
//
// The bug this pins: computeDailyAttendanceStatus used to derive `today` from the wall clock, so a
// scheduler retry (>= 60 s later, i.e. after IST midnight) scored D+1 and never repaired D. It must
// now come from the SCHEDULED time, which is the same across retries of one fire.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveNightlyClock } = require("./nightlyClock");

const HOUR = 60 * 60 * 1000;
const at = (iso) => Date.parse(iso);

// What the OLD wall-clock logic returned, kept here so the fix is asserted against it explicitly.
const oldWallClockToday = (nowMs) => new Date(nowMs + 5.5 * HOUR).toISOString().slice(0, 10);

// 23:59 IST on 2026-09-21 == 18:29 UTC.
const SCHEDULED = "2026-09-21T18:29:00Z";

test("scheduleTime 23:59 IST scores that IST date", () => {
  const r = resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: at("2026-09-21T18:29:05Z") });
  assert.equal(r.today, "2026-09-21");
  assert.equal(r.source, "schedule");
  assert.equal(r.refuse, undefined);
});

test("a retry after IST midnight STILL scores the scheduled date (the fix)", () => {
  const retryNow = at("2026-09-21T18:31:00Z"); // 00:01 IST on 2026-09-22
  assert.equal(oldWallClockToday(retryNow), "2026-09-22", "sanity: the old logic would score D+1");
  const r = resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: retryNow });
  assert.equal(r.today, "2026-09-21");
  assert.notEqual(r.today, oldWallClockToday(retryNow));
  assert.equal(r.source, "schedule");
});

test("a retry hours later still scores the scheduled date", () => {
  const r = resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: at("2026-09-22T06:00:00Z") });
  assert.equal(r.today, "2026-09-21");
});

test("boundary: 00:00 IST is the NEXT IST date", () => {
  const r = resolveNightlyClock({ scheduleTime: "2026-09-21T18:30:00Z", nowMs: at("2026-09-21T18:30:01Z") });
  assert.equal(r.today, "2026-09-22");
  const before = resolveNightlyClock({ scheduleTime: "2026-09-21T18:29:59Z", nowMs: at("2026-09-21T18:30:01Z") });
  assert.equal(before.today, "2026-09-21");
});

test("scheduleTime with an explicit offset is read as the same instant", () => {
  const r = resolveNightlyClock({ scheduleTime: "2026-09-21T23:59:00+05:30", nowMs: at("2026-09-21T18:29:30Z") });
  assert.equal(r.today, "2026-09-21");
  assert.equal(r.source, "schedule");
});

for (const [label, scheduleTime] of [
  ["missing", undefined],
  ["null", null],
  ["empty string", ""],
  ["garbage string", "garbage"],
  ["number", 1790000000000],
  ["object", {}],
  ["date-only-looking junk that V8 would still parse", "1"],
]) {
  test(`scheduleTime ${label} falls back to the wall clock`, () => {
    const nowMs = at("2026-09-21T18:29:30Z");
    const r = resolveNightlyClock({ scheduleTime, nowMs });
    assert.equal(r.source, "wall-clock");
    assert.equal(r.today, oldWallClockToday(nowMs));
    assert.equal(r.today, "2026-09-21");
    assert.equal(r.driftMs, 0);
    assert.equal(r.refuse, undefined);
  });
}

test("wall-clock fallback uses IST, not UTC (17:00 UTC is already the next IST day)", () => {
  const r = resolveNightlyClock({ scheduleTime: "", nowMs: at("2026-09-21T19:00:00Z") });
  assert.equal(r.today, "2026-09-22");
});

test("refuses a scheduleTime more than 48 h in the past", () => {
  const nowMs = at("2026-09-24T00:00:00Z");
  const r = resolveNightlyClock({ scheduleTime: new Date(nowMs - 48 * HOUR - 1).toISOString(), nowMs });
  assert.equal(r.refuse, true);
  assert.equal(typeof r.reason, "string");
  assert.match(r.reason, /past/i);
  assert.equal(r.today, undefined);
});

test("a scheduleTime more than 1 h in the FUTURE does NOT refuse — it falls back to the wall-clock date", () => {
  const nowMs = at("2026-09-21T00:00:00Z");
  const r = resolveNightlyClock({ scheduleTime: new Date(nowMs + 1 * HOUR + 1).toISOString(), nowMs });
  assert.equal(r.refuse, undefined, "a future header must never kill the nightly");
  assert.equal(r.source, "future-drift-fallback");
  assert.equal(r.today, oldWallClockToday(nowMs));
  assert.equal(r.driftMs, -(1 * HOUR + 1), "the (negative) drift is still reported");
});

test("a header carrying IST local time misread as UTC (5.5 h ahead) still scores the wall-clock date every night", () => {
  // 23:59 IST on 09-21 is 18:29 UTC. A header with the IST clock reading but read as UTC would say
  // 2026-09-21T23:59Z, i.e. 5.5 h in the future. It used to refuse (killing the nightly every night).
  const nowMs = at("2026-09-21T18:29:00Z");
  const r = resolveNightlyClock({ scheduleTime: "2026-09-21T23:59:00Z", nowMs });
  assert.equal(r.refuse, undefined);
  assert.equal(r.source, "future-drift-fallback");
  assert.equal(r.today, "2026-09-21");
  assert.equal(r.driftMs, -5.5 * HOUR);
});

test("exactly 48 h in the past is accepted", () => {
  const nowMs = at("2026-09-24T00:00:00Z");
  const r = resolveNightlyClock({ scheduleTime: new Date(nowMs - 48 * HOUR).toISOString(), nowMs });
  assert.equal(r.refuse, undefined);
  assert.equal(r.source, "schedule");
  assert.equal(r.driftMs, 48 * HOUR);
});

test("exactly 1 h in the future is accepted", () => {
  const nowMs = at("2026-09-21T00:00:00Z");
  const r = resolveNightlyClock({ scheduleTime: new Date(nowMs + 1 * HOUR).toISOString(), nowMs });
  assert.equal(r.refuse, undefined);
  assert.equal(r.source, "schedule");
  assert.equal(r.driftMs, -1 * HOUR);
});

test("driftMs is now minus scheduled: positive when late, negative when early, 0 on time", () => {
  assert.equal(resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: at("2026-09-21T18:29:00Z") }).driftMs, 0);
  assert.equal(resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: at("2026-09-21T18:31:00Z") }).driftMs, 2 * 60 * 1000);
  assert.equal(resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: at("2026-09-21T18:28:30Z") }).driftMs, -30 * 1000);
  assert.equal(resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs: at("2026-09-23T18:29:00Z") }).driftMs, 48 * HOUR);
});

test("a refusal still reports how far off the schedule was", () => {
  const nowMs = at("2026-09-30T00:00:00Z");
  const r = resolveNightlyClock({ scheduleTime: SCHEDULED, nowMs });
  assert.equal(r.refuse, true);
  assert.equal(r.driftMs, nowMs - at(SCHEDULED));
});
