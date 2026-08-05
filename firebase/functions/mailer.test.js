"use strict";

// Boundary suite for the reset email body.
// Run: `npm test` (node --test, no extra deps).
// Only the pure rendering is covered — postToProvider is a single fetch and is not
// worth a mock; what can actually go wrong here is escaping and a missing link.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderResetEmail, escapeHtml, LINK_VALID_HOURS } = require("./mailer");

const LINK = "https://white-coffee-92c27.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC123";

test("the link appears verbatim in the plain-text part", () => {
  // Many of the workforce read mail in clients that render no HTML at all. A link that
  // exists only inside an <a href> is a link those people cannot use.
  const { text } = renderResetEmail({ name: "Shivam Kumar", link: LINK });
  assert.ok(text.includes(LINK));
});

test("the link appears in the HTML part both as a link and as copyable text", () => {
  const { html } = renderResetEmail({ name: "Shivam Kumar", link: LINK });
  assert.ok(html.includes(`href="${escapeHtml(LINK)}"`));
  // Some clients strip anchors; the bare address has to be readable too.
  assert.ok(html.includes(`<span>${escapeHtml(LINK)}</span>`));
});

test("the employee's name is greeted when present", () => {
  const { text } = renderResetEmail({ name: "Shivam Kumar", link: LINK });
  assert.ok(text.startsWith("Hello Shivam Kumar,"));
});

test("a missing or blank name degrades to a plain greeting", () => {
  // Not every user doc has a name, and "Hello undefined," is how that leaks out.
  assert.ok(renderResetEmail({ name: "", link: LINK }).text.startsWith("Hello,"));
  assert.ok(renderResetEmail({ name: "   ", link: LINK }).text.startsWith("Hello,"));
  assert.ok(renderResetEmail({ link: LINK }).text.startsWith("Hello,"));
  assert.ok(!renderResetEmail({ link: LINK }).text.includes("undefined"));
});

test("a name containing markup cannot break the HTML around the link", () => {
  // Names are typed by admins into Firestore; they are not trusted markup.
  const { html } = renderResetEmail({ name: '<img src=x onerror="alert(1)">', link: LINK });
  // "onerror=" still appears — as inert text inside &lt;img ...&gt;. What matters is
  // that no angle bracket or quote survives to actually close a tag or open an attribute.
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('onerror="alert(1)"'));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&quot;alert(1)&quot;"));
});

test("the ampersands in the reset link survive escaping intact", () => {
  // The oobCode arrives after an "&" in the query string. Escape it wrongly and the
  // employee follows a link that drops the code and silently fails to reset anything.
  const { html } = renderResetEmail({ name: "A", link: LINK });
  assert.ok(html.includes("mode=resetPassword&amp;oobCode=ABC123"));
  assert.ok(!html.includes("mode=resetPassword&oobCode"));
});

test("the stated expiry matches the constant", () => {
  const { text } = renderResetEmail({ name: "A", link: LINK });
  assert.ok(text.includes(`${LINK_VALID_HOURS} hour`));
});

test("the subject says what the mail is, without naming the account", () => {
  const { subject } = renderResetEmail({ name: "Shivam Kumar", link: LINK });
  assert.equal(subject, "Reset your WhiteCoffee password");
  assert.ok(!subject.includes("Shivam"));
});

test("escapeHtml handles the whole set, and null/undefined", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});
