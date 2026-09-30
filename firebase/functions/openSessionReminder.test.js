"use strict";

// The reminder writes a push AND an in-app row. What matters: the two say the same thing,
// the row lands unread, and both IDs are deterministic so a retry cannot duplicate either.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildOpenSessionReminder } = require("./openSessionReminder");

test("push targets exactly the one user", () => {
  const { push } = buildOpenSessionReminder("u1", "2026-09-30");
  assert.equal(push.recipientType, "specific");
  assert.equal(push.recipientId, "u1");
  assert.equal(push.sentBy, "openSessionReminder");
});

test("in-app row carries the same message as the push, unread", () => {
  const { push, inApp } = buildOpenSessionReminder("u1", "2026-09-30");
  assert.equal(inApp.title, push.title);
  assert.equal(inApp.body, push.body);
  assert.equal(inApp.type, push.type);
  assert.equal(inApp.isRead, false);
});

test("IDs are deterministic per user per day — a retry overwrites, never duplicates", () => {
  const a = buildOpenSessionReminder("u1", "2026-09-30");
  const b = buildOpenSessionReminder("u1", "2026-09-30");
  assert.equal(a.pushId, b.pushId);
  assert.equal(a.inAppId, b.inAppId);
  assert.equal(a.pushId, "open-session-u1-2026-09-30");
  assert.equal(a.inAppId, "open-session-2026-09-30");
});

test("a different day or user gets a different push ID", () => {
  const base = buildOpenSessionReminder("u1", "2026-09-30").pushId;
  assert.notEqual(buildOpenSessionReminder("u1", "2026-10-01").pushId, base);
  assert.notEqual(buildOpenSessionReminder("u2", "2026-09-30").pushId, base);
});

test("in-app row has exactly the fields the bell list reads (createdAt added by caller)", () => {
  const { inApp } = buildOpenSessionReminder("u1", "2026-09-30");
  assert.deepEqual(Object.keys(inApp).sort(), ["body", "isRead", "title", "type"]);
});
