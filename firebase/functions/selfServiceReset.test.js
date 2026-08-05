"use strict";

// Boundary suite for unauthenticated self-service password reset.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveLoginEmail, normalizeIdentifier, classifyAttempt,
  IDENTIFIER_LIMIT, SELF_SERVICE_MESSAGE, PER_IDENTIFIER, PER_IP,
} = require("./selfServiceReset");

// ── Identifier resolution ────────────────────────────────────────────────────
// Employees type what they type on the app's login screen. Whatever the phone
// accepts, this must accept, or "forgot password" fails for people who can log in.

test("an employee ID becomes the synthetic login address", () => {
  assert.equal(resolveLoginEmail("S450"), "s450@whitecoffee.internal");
});

test("case and surrounding whitespace do not matter", () => {
  assert.equal(resolveLoginEmail(" s450 "), "s450@whitecoffee.internal");
  assert.equal(resolveLoginEmail("S450"), resolveLoginEmail("s450"));
});

test("a real address is used as-is — legacy staff sign in with one", () => {
  assert.equal(resolveLoginEmail("Rinki66228@Gmail.com"), "rinki66228@gmail.com");
});

test("normalizeIdentifier rejects nothing-at-all", () => {
  assert.equal(normalizeIdentifier(""), null);
  assert.equal(normalizeIdentifier("   "), null);
  assert.equal(normalizeIdentifier(undefined), null);
  assert.equal(normalizeIdentifier(null), null);
  assert.equal(normalizeIdentifier(12345), null);
});

test("normalizeIdentifier rejects an absurdly long value", () => {
  // Unbounded input becomes an unbounded Firestore document key downstream.
  assert.equal(normalizeIdentifier("a".repeat(IDENTIFIER_LIMIT)), "a".repeat(IDENTIFIER_LIMIT));
  assert.equal(normalizeIdentifier("a".repeat(IDENTIFIER_LIMIT + 1)), null);
});

test("normalizeIdentifier trims and lowercases what it keeps", () => {
  assert.equal(normalizeIdentifier("  S450 "), "s450");
});

// ── Rate limiting ────────────────────────────────────────────────────────────
// Without this, one HTTP endpoint mails an employee a password-reset link as fast
// as it can be called — free harassment, and a way to bury a real reset in noise.

const T0 = 1_800_000_000_000; // arbitrary fixed clock; nothing here uses the real one

test("a first-ever request is allowed", () => {
  const got = classifyAttempt([], T0, PER_IDENTIFIER);
  assert.equal(got.allowed, true);
  assert.deepEqual(got.history, [T0]);
});

test("an immediate repeat is refused by the cooldown", () => {
  const got = classifyAttempt([T0], T0 + 1_000, PER_IDENTIFIER);
  assert.equal(got.allowed, false);
  assert.equal(got.reason, "cooldown");
  assert.equal(got.retryAfterMs, PER_IDENTIFIER.cooldownMs - 1_000);
});

test("once the cooldown expires, a repeat is allowed again", () => {
  const got = classifyAttempt([T0], T0 + PER_IDENTIFIER.cooldownMs, PER_IDENTIFIER);
  assert.equal(got.allowed, true);
  assert.deepEqual(got.history, [T0, T0 + PER_IDENTIFIER.cooldownMs]);
});

test("the window cap refuses the request after maxPerWindow attempts", () => {
  // Spaced past the cooldown so it is the CAP being tested, not the cooldown.
  const spacing = PER_IDENTIFIER.cooldownMs;
  const history = [];
  for (let i = 0; i < PER_IDENTIFIER.maxPerWindow; i++) history.push(T0 + i * spacing);
  const now = T0 + PER_IDENTIFIER.maxPerWindow * spacing;

  const got = classifyAttempt(history, now, PER_IDENTIFIER);
  assert.equal(got.allowed, false);
  assert.equal(got.reason, "too-many");
  // Retry when the OLDEST attempt falls out of the window, not a fixed delay.
  assert.equal(got.retryAfterMs, history[0] + PER_IDENTIFIER.windowMs - now);
});

test("attempts older than the window are forgotten", () => {
  const history = [T0 - 2_000, T0 - 1_000, T0];
  const now = T0 + PER_IDENTIFIER.windowMs + 1;
  const got = classifyAttempt(history, now, PER_IDENTIFIER);
  assert.equal(got.allowed, true);
  // Pruned history keeps only what is still inside the window, plus this attempt.
  assert.deepEqual(got.history, [now]);
});

test("the stored history never grows without bound", () => {
  const history = Array.from({ length: 500 }, (_, i) => T0 - i);
  const got = classifyAttempt(history, T0 + PER_IDENTIFIER.windowMs + 1, PER_IDENTIFIER);
  assert.equal(got.history.length, 1);
});

test("garbage in a stored history is ignored rather than throwing", () => {
  // The doc is written by us, but a partial write or a hand-edit must not take the
  // endpoint down — and must not accidentally read as "no recent attempts".
  const got = classifyAttempt([null, "x", NaN, undefined, T0], T0 + 1_000, PER_IDENTIFIER);
  assert.equal(got.allowed, false);
  assert.equal(got.reason, "cooldown");
});

test("the IP budget is looser than the per-identifier one", () => {
  // A whole site office behind one connection must not lock itself out, while a
  // single account still cannot be hammered.
  assert.ok(PER_IP.maxPerWindow > PER_IDENTIFIER.maxPerWindow);
});

// ── Enumeration safety ───────────────────────────────────────────────────────

test("the public message is a single constant", () => {
  // The endpoint is unauthenticated and employee IDs are sequential. If the reply
  // differed for "no such account" vs "sent", anyone could sweep S001..S999 and learn
  // exactly which IDs are real. Every outcome returns this same string.
  assert.equal(typeof SELF_SERVICE_MESSAGE, "string");
  assert.ok(SELF_SERVICE_MESSAGE.length > 0);
  // It must not promise delivery, because we may have no address on file.
  assert.ok(/administrator/i.test(SELF_SERVICE_MESSAGE));
});
