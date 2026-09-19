"use strict";

// Boundary suite for late-approved leave scoring. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pastGrantedDates, planRetroLeaveScoring } = require("./retroLeaveScoring");

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

test("Sunday / Holiday / SCHL / USCHL / WO docs are left alone, and a date with no doc is skipped", () => {
  const map = new Map([
    ["2026-09-14", { status: "Sunday", markedBy: "auto" }],
    ["2026-09-15", { status: "Holiday", markedBy: "auto" }],
    ["2026-09-16", { status: "SCHL", markedBy: "auto" }],
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

test("idempotent: once the days are SCHL, planning again changes nothing", () => {
  const scored = new Map(D4.map((d) => [d, { status: "SCHL", markedBy: "auto" }]));
  const r = planRetroLeaveScoring({ leave: leave(), todayIST: TODAY, statusByDate: scored, plBalance: 0 });
  assert.equal(r.updates.length, 0);
  assert.equal(r.paidDays, 0);
});

test("malformed input never throws", () => {
  assert.deepEqual(planRetroLeaveScoring({}), { updates: [], paidDays: 0 });
  assert.deepEqual(pastGrantedDates(null, TODAY), []);
  assert.deepEqual(pastGrantedDates(leave({ fromDate: "garbage" }), TODAY), []);
  assert.deepEqual(pastGrantedDates(leave(), undefined), []);
});

test("pastGrantedDates is ascending and bounded", () => {
  assert.deepEqual(pastGrantedDates(leave(), TODAY), D4);
  const huge = leave({ fromDate: "2020-01-01", toDate: "2030-01-01" });
  assert.ok(pastGrantedDates(huge, TODAY).length <= 400);
});
