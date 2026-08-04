"use strict";

// Boundary suite for password-reset link delivery routing.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveResetDelivery, isDeliverable, LOGIN_EMAIL_DOMAIN } = require("./passwordReset");

test("the login domain matches the Android app and the portal", () => {
  assert.equal(LOGIN_EMAIL_DOMAIN, "whitecoffee.internal");
});

test("isDeliverable accepts a real mailbox", () => {
  assert.equal(isDeliverable("rinki66228@gmail.com"), true);
  assert.equal(isDeliverable("nishu.s@senkenindia.in"), true);
});

test("isDeliverable rejects a synthetic login key — nothing can arrive there", () => {
  // What admins actually stored on S463/S464 as contactEmail on 2026-07-31.
  assert.equal(isDeliverable("s464@whitecoffee.internal"), false);
  assert.equal(isDeliverable("S463@WhiteCoffee.Internal"), false);
});

test("isDeliverable rejects malformed and empty values", () => {
  assert.equal(isDeliverable(""), false);
  assert.equal(isDeliverable("   "), false);
  assert.equal(isDeliverable("ravi@senken"), false);
  assert.equal(isDeliverable("S464"), false);
  assert.equal(isDeliverable(undefined), false);
  assert.equal(isDeliverable(null), false);
});

test("a user with a real contact address routes to email", () => {
  assert.deepEqual(
    resolveResetDelivery({ contactEmail: "Rinki66228@Gmail.com " }),
    { channel: "email", to: "rinki66228@gmail.com" },
  );
});

test("a user with no contact address falls back to manual handover", () => {
  assert.deepEqual(
    resolveResetDelivery({ contactEmail: "" }),
    { channel: "manual", reason: "no-contact-email" },
  );
  assert.deepEqual(
    resolveResetDelivery({}),
    { channel: "manual", reason: "no-contact-email" },
  );
});

test("a contact address that is really a login key falls back to manual", () => {
  // The important case: it LOOKS like we can email them, and we cannot. Routing to
  // email here would drop the link into a mailbox that does not exist, silently.
  assert.deepEqual(
    resolveResetDelivery({ contactEmail: "s464@whitecoffee.internal" }),
    { channel: "manual", reason: "contact-is-not-a-mailbox" },
  );
});

test("a malformed contact address falls back to manual, not email", () => {
  assert.deepEqual(
    resolveResetDelivery({ contactEmail: "s450@whitecoffee.in " }),
    { channel: "email", to: "s450@whitecoffee.in" },
  );
  // Structurally valid but obviously wrong domains cannot be detected here — only
  // syntactically broken ones.
  assert.deepEqual(
    resolveResetDelivery({ contactEmail: "not-an-address" }),
    { channel: "manual", reason: "contact-invalid" },
  );
});
