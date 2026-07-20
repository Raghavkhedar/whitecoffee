"use strict";

// Unit suite for the compensation split. The migration hazard these tests guard is
// specific: a resolver that fails open reads salaryRate as 0, and an employee is paid
// NOTHING for the month. Every source combination must therefore resolve identically.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PAY_FIELDS, resolvePay, withPay } = require("./compensation");

const legacyUser = { name: "A", salaryRate: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 };
const compDoc = { salaryRate: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 };

test("pre-migration: inline fields only → legacy values used", () => {
  assert.deepEqual(resolvePay(legacyUser, null), compDoc);
});

test("post-migration: compensation doc only → compensation values used", () => {
  const migrated = { name: "A" }; // inline fields removed
  assert.deepEqual(resolvePay(migrated, compDoc), compDoc);
});

test("mid-migration: BOTH present → compensation wins", () => {
  const stale = { ...legacyUser, salaryRate: 1 }; // stale inline value
  assert.equal(resolvePay(stale, compDoc).salaryRate, 1000);
});

test("partially-written compensation doc falls back PER FIELD, not wholesale", () => {
  // The dangerous case: a compensation doc carrying only salaryRate must NOT blank the
  // other three to 0 — PF/ESI would silently stop being deducted.
  const partial = { salaryRate: 2000 };
  assert.deepEqual(resolvePay(legacyUser, partial), {
    salaryRate: 2000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5,
  });
});

test("neither source → all zeros, never undefined", () => {
  assert.deepEqual(resolvePay(null, null), {
    salaryRate: 0, pfPercent: 0, esiPercent: 0, imprestPercent: 0,
  });
  assert.deepEqual(resolvePay({}, {}), {
    salaryRate: 0, pfPercent: 0, esiPercent: 0, imprestPercent: 0,
  });
});

test("non-numeric values never win — they fall through", () => {
  // A string "1000" from a hand-edited console entry must not reach the pay maths.
  assert.equal(resolvePay(legacyUser, { salaryRate: "9999" }).salaryRate, 1000);
  assert.equal(resolvePay(legacyUser, { salaryRate: null }).salaryRate, 1000);
  assert.equal(resolvePay(legacyUser, { salaryRate: NaN }).salaryRate, 1000);
  assert.equal(resolvePay({ salaryRate: "x" }, null).salaryRate, 0);
});

test("zero is a REAL value and must not fall through to the legacy field", () => {
  // An admin deliberately setting salaryRate 0 (or imprestPercent 0) must stick —
  // treating 0 as absent would resurrect the old inline number.
  assert.equal(resolvePay(legacyUser, { ...compDoc, salaryRate: 0 }).salaryRate, 0);
  assert.equal(resolvePay(legacyUser, { ...compDoc, imprestPercent: 0 }).imprestPercent, 0);
});

test("withPay merges onto the user without mutating it", () => {
  const user = { id: "u1", name: "A" };
  const merged = withPay(user, compDoc);
  assert.equal(merged.salaryRate, 1000);
  assert.equal(merged.name, "A");
  assert.equal(user.salaryRate, undefined, "input must not be mutated");
});

test("withPay preserves legacy inline pay when no compensation doc exists", () => {
  assert.equal(withPay(legacyUser, null).salaryRate, 1000);
});

test("PAY_FIELDS covers exactly the four pay fields", () => {
  assert.deepEqual(PAY_FIELDS, ["salaryRate", "pfPercent", "esiPercent", "imprestPercent"]);
});
