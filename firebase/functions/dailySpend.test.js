"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dayWeight, dailySalary } = require("./dailySpend");

test("dayWeight: each status maps to its payroll multiplier", () => {
  assert.equal(dayWeight("Present"), 1);
  assert.equal(dayWeight("SL"), 0.75);
  assert.equal(dayWeight("HalfDay"), 0.5);
  assert.equal(dayWeight("LNF"), 0.5);
  assert.equal(dayWeight("SLNF"), 0.5);
  assert.equal(dayWeight("PL"), 1);
  assert.equal(dayWeight("LWP"), 0);
  assert.equal(dayWeight("Absent"), -2);
  assert.equal(dayWeight("Unknown"), 0); // unmapped → 0
});

test("dailySalary: rate × weight, negative on an Absent day", () => {
  assert.equal(dailySalary(1000, "Present"), 1000);
  assert.equal(dailySalary(1000, "SL"), 750);
  assert.equal(dailySalary(1000, "Absent"), -2000);
  assert.equal(dailySalary(0, "Present"), 0);
});
