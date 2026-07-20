"use strict";

// Unit suite for partial leave approval coverage (spec:
// docs/superpowers/specs/2026-07-20-partial-leave-approval-design.md).
// Pure logic, no Firestore. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { leaveCoversDate, explicitGrantedDates, grantedDayCount } = require("./leaveCoverage");

// A five-day request: Tue 21 Jul → Sat 25 Jul 2026.
const base = { userId: "u1", status: "approved", fromDate: "2026-07-21", toDate: "2026-07-25", totalDays: 5 };
const leave = (o = {}) => ({ ...base, ...o });

// ── Spec testing table ──────────────────────────────────────────────────────

test("approved, no approvedDates (legacy), date in range → covered", () => {
  const l = leave();
  assert.equal(leaveCoversDate(l, "2026-07-21"), true);
  assert.equal(leaveCoversDate(l, "2026-07-23"), true);
  assert.equal(leaveCoversDate(l, "2026-07-25"), true); // both bounds inclusive
});

test("approved, approvedDates: [], date in range → covered (compatibility rule)", () => {
  const l = leave({ approvedDates: [] });
  assert.equal(leaveCoversDate(l, "2026-07-23"), true);
});

test("approved, date in approvedDates → covered", () => {
  const l = leave({ approvedDates: ["2026-07-21", "2026-07-22", "2026-07-24"] });
  assert.equal(leaveCoversDate(l, "2026-07-21"), true);
  assert.equal(leaveCoversDate(l, "2026-07-22"), true);
  assert.equal(leaveCoversDate(l, "2026-07-24"), true);
});

test("approved, date in range but NOT in approvedDates → not covered", () => {
  const l = leave({ approvedDates: ["2026-07-21", "2026-07-22", "2026-07-24"] });
  assert.equal(leaveCoversDate(l, "2026-07-23"), false);
  assert.equal(leaveCoversDate(l, "2026-07-25"), false);
});

test("date outside fromDate…toDate → not covered", () => {
  const l = leave();
  assert.equal(leaveCoversDate(l, "2026-07-20"), false); // day before
  assert.equal(leaveCoversDate(l, "2026-07-26"), false); // day after
  assert.equal(leaveCoversDate(l, "2026-06-23"), false); // earlier month
  assert.equal(leaveCoversDate(l, "2027-07-23"), false); // later year
});

test("granted date outside the requested range → not covered (range still bounds it)", () => {
  const l = leave({ approvedDates: ["2026-07-22", "2026-07-30"] });
  assert.equal(leaveCoversDate(l, "2026-07-30"), false);
  assert.equal(leaveCoversDate(l, "2026-07-22"), true);
});

// Regression: a restriction whose every entry falls outside fromDate…toDate must still
// read as "restricted, grants nothing" — NOT as an unrestricted full-range approval. The
// range-filtered list is empty here, so the compatibility rule must be decided from the
// raw field instead. Getting this backwards would silently grant the whole range.
test("approvedDates entirely outside the range → grants nothing, NOT the full range", () => {
  const l = leave({ approvedDates: ["2026-08-01", "2026-08-02"] });
  assert.equal(leaveCoversDate(l, "2026-07-23"), false);
  assert.equal(leaveCoversDate(l, "2026-07-21"), false);
  assert.equal(leaveCoversDate(l, "2026-08-01"), false); // outside the request too
  assert.deepEqual(explicitGrantedDates(l), []);
  assert.equal(grantedDayCount(l), null);
});

// The count the Sheets "Days Granted" column exports must match what the scorer pays.
test("out-of-range entries are excluded from the granted count", () => {
  const l = leave({ approvedDates: ["2026-07-22", "2026-07-24", "2026-07-30"] });
  assert.deepEqual(explicitGrantedDates(l), ["2026-07-22", "2026-07-24"]);
  assert.equal(grantedDayCount(l), 2);
  assert.equal(leaveCoversDate(l, "2026-07-30"), false);
});

test("status pending / rejected → not covered, with or without approvedDates", () => {
  assert.equal(leaveCoversDate(leave({ status: "pending" }), "2026-07-23"), false);
  assert.equal(leaveCoversDate(leave({ status: "rejected" }), "2026-07-23"), false);
  assert.equal(
    leaveCoversDate(leave({ status: "pending", approvedDates: ["2026-07-23"] }), "2026-07-23"),
    false
  );
  assert.equal(leaveCoversDate(leave({ status: undefined }), "2026-07-23"), false);
});

// ── Defensive / malformed input ─────────────────────────────────────────────

test("missing leave, missing date or missing range bounds → not covered", () => {
  assert.equal(leaveCoversDate(null, "2026-07-23"), false);
  assert.equal(leaveCoversDate(undefined, "2026-07-23"), false);
  assert.equal(leaveCoversDate(leave(), ""), false);
  assert.equal(leaveCoversDate(leave(), undefined), false);
  assert.equal(leaveCoversDate({ status: "approved", toDate: "2026-07-25" }, "2026-07-23"), false);
  assert.equal(leaveCoversDate({ status: "approved", fromDate: "2026-07-21" }, "2026-07-23"), false);
});

test("non-array approvedDates is ignored → falls back to the full range", () => {
  assert.equal(leaveCoversDate(leave({ approvedDates: "2026-07-21" }), "2026-07-23"), true);
  assert.equal(leaveCoversDate(leave({ approvedDates: null }), "2026-07-23"), true);
});

test("single-day leave covers exactly its one date", () => {
  const l = { status: "approved", fromDate: "2026-07-21", toDate: "2026-07-21", totalDays: 1 };
  assert.equal(leaveCoversDate(l, "2026-07-21"), true);
  assert.equal(leaveCoversDate(l, "2026-07-22"), false);
});

// ── explicitGrantedDates / grantedDayCount (Sheets export helpers) ──────────

test("explicitGrantedDates returns [] for legacy/empty/unapproved, the subset otherwise", () => {
  assert.deepEqual(explicitGrantedDates(leave()), []);
  assert.deepEqual(explicitGrantedDates(leave({ approvedDates: [] })), []);
  assert.deepEqual(explicitGrantedDates(leave({ status: "pending", approvedDates: ["2026-07-21"] })), []);
  assert.deepEqual(explicitGrantedDates(leave({ approvedDates: ["2026-07-21", "2026-07-24"] })), [
    "2026-07-21",
    "2026-07-24",
  ]);
});

test("explicitGrantedDates returns a copy — callers cannot mutate the document", () => {
  const dates = ["2026-07-21", "2026-07-24"];
  const out = explicitGrantedDates(leave({ approvedDates: dates }));
  out.push("2026-07-25");
  assert.deepEqual(dates, ["2026-07-21", "2026-07-24"]);
});

test("grantedDayCount: null when the whole range is granted, else the subset size", () => {
  assert.equal(grantedDayCount(leave()), null);
  assert.equal(grantedDayCount(leave({ approvedDates: [] })), null);
  assert.equal(grantedDayCount(leave({ status: "rejected" })), null);
  assert.equal(grantedDayCount(leave({ approvedDates: ["2026-07-21", "2026-07-22", "2026-07-24"] })), 3);
});
