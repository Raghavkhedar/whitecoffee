"use strict";

// Boundary suite for the holiday credit rule. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveHolidayCredit } = require("./holidayCredit");

// Epoch seconds for an IST wall-clock time on 2026-09-21.
const at = (h, m, s = 0) => Date.UTC(2026, 8, 21, h, m, s) / 1000 - 19800;
const ev = (type, seconds) => ({ type, timestamp: { seconds } });

test("ops with a complete site in/out window that day: +1 withdrawn (paid through OT instead)", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0)), ev("site_out", at(14, 0))]), 0);
});

test("ops market visit counts, and site_in + market_out mixes", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("market_in", at(9, 0)), ev("market_out", at(11, 0))]), 0);
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(9, 0)), ev("market_out", at(11, 0))]), 0);
});

test("ops with only a check-in (forgot to check out): nothing to approve, keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0))]), 1);
});

test("ops with no punches, or events missing: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", []), 1);
  assert.equal(resolveHolidayCredit("operations", undefined), 1);
});

test("home_in / home_out are commute markers, never work: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("home_in", at(8, 0)), ev("home_out", at(20, 0))]), 1);
});

test("in and out inside the same minute is zero worked minutes: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0, 10)), ev("site_out", at(10, 0, 50))]), 1);
});

test("uses minute-of-day arithmetic exactly like the OT ledger (20s straddling a minute = 1 worked minute)", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(10, 0, 50)), ev("site_out", at(10, 1, 10))]), 0);
});

test("unsorted events are handled (first in / last out)", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_out", at(14, 0)), ev("site_in", at(10, 0))]), 0);
});

test("out before in (bad data) is not worked time: keeps the +1", () => {
  assert.equal(resolveHolidayCredit("operations", [ev("site_in", at(14, 0)), ev("site_out", at(10, 0))]), 1);
});

test("office, admin, sales and unknown roles always keep the +1", () => {
  const worked = [ev("office_in", at(10, 0)), ev("office_out", at(18, 0)), ev("site_in", at(10, 0)), ev("site_out", at(18, 0))];
  for (const role of ["office", "admin", "sales", "mystery", ""]) {
    assert.equal(resolveHolidayCredit(role, worked), 1, role);
  }
});
