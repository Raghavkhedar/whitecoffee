"use strict";

// Boundary suite for conveyance manual-approval decisions. Run: `npm test` (node --test).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { effectiveConveyanceAmount, isFrozenConveyance } = require("./conveyanceApproval");

test("effectiveConveyanceAmount: pending contributes 0 (excluded from payroll until reviewed)", () => {
  assert.equal(effectiveConveyanceAmount({ status: "pending", conveyance: 250 }), 0);
});

test("effectiveConveyanceAmount: rejected contributes 0", () => {
  assert.equal(effectiveConveyanceAmount({ status: "rejected", conveyance: 250, approvedAmount: 0 }), 0);
});

test("effectiveConveyanceAmount: approved uses approvedAmount when the admin edited it", () => {
  assert.equal(effectiveConveyanceAmount({ status: "approved", conveyance: 250, approvedAmount: 180 }), 180);
});

test("effectiveConveyanceAmount: approved with no edit falls back to the computed conveyance", () => {
  assert.equal(effectiveConveyanceAmount({ status: "approved", conveyance: 250, approvedAmount: undefined }), 250);
});

test("effectiveConveyanceAmount: legacy doc with no status field is grandfathered approved", () => {
  assert.equal(effectiveConveyanceAmount({ conveyance: 250 }), 250);
});

test("effectiveConveyanceAmount: missing/undefined record is 0", () => {
  assert.equal(effectiveConveyanceAmount(undefined), 0);
});

test("isFrozenConveyance: pending is NOT frozen — nightly recompute may still overwrite it", () => {
  assert.equal(isFrozenConveyance({ status: "pending" }), false);
});

test("isFrozenConveyance: approved and rejected are frozen", () => {
  assert.equal(isFrozenConveyance({ status: "approved" }), true);
  assert.equal(isFrozenConveyance({ status: "rejected" }), true);
});

test("isFrozenConveyance: legacy admin-marked override (no status) stays frozen", () => {
  assert.equal(isFrozenConveyance({ markedBy: "admin" }), true);
});

test("isFrozenConveyance: legacy auto-computed doc (no status, no markedBy) is not frozen", () => {
  assert.equal(isFrozenConveyance({ conveyance: 250 }), false);
});

test("isFrozenConveyance: no record at all is not frozen", () => {
  assert.equal(isFrozenConveyance(undefined), false);
});
