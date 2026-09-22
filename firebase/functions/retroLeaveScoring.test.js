"use strict";

// Boundary suite for late-approved leave scoring. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pastGrantedDates, planRetroLeaveScoring, leaveSpanTooLong, leaveDatesInvalid, addDays } = require("./retroLeaveScoring");

const TODAY = "2026-09-21";
const leave = (over = {}) => ({ status: "approved", fromDate: "2026-09-14", toDate: "2026-09-17", ...over });
const absentAuto = { status: "Absent", markedBy: "auto" };
const statuses = (dates, s = absentAuto) => new Map(dates.map((d) => [d, s]));
const D4 = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];

test("the 4-day / balance-2 example: first two days paid, last two unpaid, balance used = 2", () => {
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: statuses(D4), plBalance: 2 });
  assert.deepEqual(r.updates.map((u) => [u.date, u.status, u.salaryCredit]), [
    ["2026-09-14", "SCHL", 1], ["2026-09-15", "SCHL", 1], ["2026-09-16", "SCHL", 0], ["2026-09-17", "SCHL", 0],
  ]);
  assert.equal(r.paidDays, 2);
});

test("zero, missing or negative balance: every day is unpaid SCHL, nothing decremented", () => {
  for (const bal of [0, undefined, -3]) {
    const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: statuses(D4), plBalance: bal });
    assert.equal(r.updates.length, 4);
    assert.ok(r.updates.every((u) => u.salaryCredit === 0));
    assert.equal(r.paidDays, 0);
  }
});

test("only dates strictly before today are scored — today and the future are the nightly run's job", () => {
  const l = leave({ fromDate: "2026-09-19", toDate: "2026-09-23" });
  const r = planRetroLeaveScoring({ leave: l, todayIST: TODAY, statusByDate: statuses(["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"]), plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-19", "2026-09-20"]);
});

test("days with punches are never overwritten (only Absent by the auto scorer)", () => {
  const map = statuses(D4);
  map.set("2026-09-15", { status: "Present", markedBy: "auto" });
  map.set("2026-09-16", { status: "HalfDay", markedBy: "auto" });
  map.set("2026-09-17", { status: "LNF", markedBy: "auto" });
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-14"]);
});

test("an admin-marked Absent is a decision and is never rewritten", () => {
  const map = statuses(D4);
  map.set("2026-09-14", { status: "Absent", markedBy: "admin" });
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-15", "2026-09-16", "2026-09-17"]);
});

test("Sunday / Holiday / paid SCHL / USCHL / WO docs are left alone, and a date with no doc is skipped", () => {
  const map = new Map([
    ["2026-09-14", { status: "Sunday", markedBy: "auto" }],
    ["2026-09-15", { status: "Holiday", markedBy: "auto" }],
    ["2026-09-16", { status: "SCHL", salaryCredit: 1, markedBy: "auto" }],
    // 2026-09-17 has no doc at all
  ]);
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.equal(r.updates.length, 0);
});

test("cancelled and ungranted dates are not scored (partial approval + cancellation respected)", () => {
  const l = leave({ approvedDates: ["2026-09-14", "2026-09-15", "2026-09-16"], cancelledDates: ["2026-09-15"] });
  const r = planRetroLeaveScoring({ leave: l, todayIST: TODAY, statusByDate: statuses(D4), plBalance: 9 });
  assert.deepEqual(r.updates.map((u) => u.date), ["2026-09-14", "2026-09-16"]);
});

test("a leave that is not approved scores nothing", () => {
  for (const status of ["pending", "rejected", undefined]) {
    const r = planRetroLeaveScoring({ leave: leave({ status }), todayIST: TODAY, statusByDate: statuses(D4), plBalance: 9 });
    assert.equal(r.updates.length, 0);
  }
});

test("idempotent: once the days are PAID SCHL, planning again changes nothing even with balance available", () => {
  const scored = new Map(D4.map((d) => [d, { status: "SCHL", salaryCredit: 1, markedBy: "auto" }]));
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: scored, plBalance: 9 });
  assert.equal(r.updates.length, 0);
  assert.equal(r.paidDays, 0);
});

test("an UNPAID SCHL day with the balance still exhausted re-plans to the same UNPAID SCHL (no-op, not decremented)", () => {
  const unpaid = new Map(D4.map((d) => [d, { status: "SCHL", salaryCredit: 0, markedBy: "auto" }]));
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: unpaid, plBalance: 0 });
  assert.deepEqual(r.updates.map((u) => [u.date, u.status, u.salaryCredit]), D4.map((d) => [d, "SCHL", 0]));
  assert.equal(r.paidDays, 0);
});

test("an UNPAID SCHL day is upgraded to paid once the balance frees up (matches the nightly job's willingness to re-decide from live balance)", () => {
  const unpaid = new Map(D4.map((d) => [d, { status: "SCHL", salaryCredit: 0, markedBy: "auto" }]));
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: unpaid, plBalance: 2 });
  assert.deepEqual(r.updates.map((u) => [u.date, u.status, u.salaryCredit]), [
    ["2026-09-14", "SCHL", 1], ["2026-09-15", "SCHL", 1], ["2026-09-16", "SCHL", 0], ["2026-09-17", "SCHL", 0],
  ]);
  assert.equal(r.paidDays, 2);
});

test("an admin-marked UNPAID SCHL is a decision and is never reconsidered even when balance frees up", () => {
  const map = statuses(D4, { status: "SCHL", salaryCredit: 0, markedBy: "admin" });
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: map, plBalance: 9 });
  assert.equal(r.updates.length, 0);
});

test("malformed input never throws", () => {
  assert.deepEqual(planRetroLeaveScoring({}), { updates: [], paidDays: 0 });
  assert.deepEqual(pastGrantedDates(null, TODAY), []);
  assert.deepEqual(pastGrantedDates(leave({ fromDate: "garbage" }), TODAY), []);
  assert.deepEqual(pastGrantedDates(leave(), undefined), []);
});

test("rules-legal but non-calendar dates return [] and never throw (as fromDate, as toDate, and inverted)", () => {
  // firestore.rules accepts month/day 00-99, so these all reach the module.
  for (const bad of ["2025-13-01", "2025-00-05", "2025-02-99", "2026-02-31"]) {
    assert.deepEqual(pastGrantedDates(leave({ fromDate: bad }), TODAY), [], `fromDate ${bad}`);
    assert.deepEqual(pastGrantedDates(leave({ toDate: bad }), TODAY), [], `toDate ${bad}`);
    assert.equal(leaveSpanTooLong(leave({ fromDate: bad })), false);
    assert.equal(leaveSpanTooLong(leave({ toDate: bad })), false);
    const r = planRetroLeaveScoring({ leave: leave({ fromDate: bad }), todayIST: TODAY, statusByDate: statuses(D4), plBalance: 9 });
    assert.deepEqual(r, { updates: [], paidDays: 0 });
  }
  assert.deepEqual(pastGrantedDates(leave({ fromDate: "2026-09-17", toDate: "2026-09-14" }), TODAY), []);
  assert.equal(leaveSpanTooLong(leave({ fromDate: "2026-09-17", toDate: "2026-09-14" })), false);
  assert.doesNotThrow(() => addDays("2025-13-01", 1));
  assert.equal(addDays("2025-13-01", 1), null);
});

test("pastGrantedDates is ascending; a real 366-day span is still scored normally", () => {
  assert.deepEqual(pastGrantedDates(leave(), TODAY), D4);
  // 2025-01-01 .. 2026-01-01 is 366 inclusive days, all before TODAY.
  const year = leave({ fromDate: "2025-01-01", toDate: "2026-01-01" });
  const dates = pastGrantedDates(year, TODAY);
  assert.equal(dates.length, 366);
  assert.equal(dates[0], "2025-01-01");
  assert.equal(dates[365], "2026-01-01");
  assert.equal(leaveSpanTooLong(year), false);
});

test("an oversize span (> 400 days) is REFUSED, never truncated to its oldest days", () => {
  const huge = leave({ fromDate: "2020-01-01", toDate: "2030-01-01" });
  assert.deepEqual(pastGrantedDates(huge, TODAY), []);
  assert.equal(leaveSpanTooLong(huge), true);
  assert.deepEqual(planRetroLeaveScoring({ leave: huge, todayIST: TODAY, statusByDate: statuses(D4), plBalance: 9 }), { updates: [], paidDays: 0 });
  // Boundary: exactly 400 inclusive days is allowed, 401 is refused.
  assert.equal(leaveSpanTooLong(leave({ fromDate: "2025-01-01", toDate: "2026-02-04" })), false); // 400 days
  assert.equal(leaveSpanTooLong(leave({ fromDate: "2025-01-01", toDate: "2026-02-05" })), true);  // 401 days
  assert.equal(leaveSpanTooLong(null), false);
});

test("leaveDatesInvalid: true for a leave with both fields whose dates are not a real, ordered range", () => {
  for (const bad of ["2025-13-01", "2025-00-05", "2026-02-31"]) {
    assert.equal(leaveDatesInvalid(leave({ fromDate: bad })), true, `fromDate ${bad}`);
    assert.equal(leaveDatesInvalid(leave({ toDate: bad })), true, `toDate ${bad}`);
  }
  assert.equal(leaveDatesInvalid(leave({ fromDate: 20260914 })), true);
  assert.equal(leaveDatesInvalid(leave({ toDate: {} })), true);
  assert.equal(leaveDatesInvalid(leave({ fromDate: "2026-09-17", toDate: "2026-09-14" })), true);
});

test("leaveDatesInvalid: false for valid ranges (an over-long span is leaveSpanTooLong's case) and for absent fields", () => {
  assert.equal(leaveDatesInvalid(leave()), false);
  assert.equal(leaveDatesInvalid(leave({ fromDate: "2026-09-14", toDate: "2026-09-14" })), false);
  assert.equal(leaveDatesInvalid(leave({ fromDate: "2025-01-01", toDate: "2026-01-01" })), false); // 366 days
  assert.equal(leaveDatesInvalid(leave({ fromDate: "2020-01-01", toDate: "2030-01-01" })), false); // oversize, handled elsewhere
  assert.equal(leaveDatesInvalid(undefined), false);
  assert.equal(leaveDatesInvalid(null), false);
  assert.equal(leaveDatesInvalid({}), false);
  assert.equal(leaveDatesInvalid({ status: "approved", fromDate: "2026-09-14" }), false);
  assert.equal(leaveDatesInvalid({ status: "approved", toDate: "2026-09-14" }), false);
});
