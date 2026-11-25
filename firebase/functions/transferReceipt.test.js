"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildReceiptNotices, directoryEntry } = require("./transferReceipt");

const base = {
  userName: "Asha", receivedBy: "Ravi", receiverId: "r1", receiptStatus: "pending",
  items: [{ itemName: "Drill", quantity: 2 }],
};
const build = (before, after) => buildReceiptNotices({
  before, after, collection: "tool_transfers", docId: "t1", senderId: "s1", adminIds: ["a1", "s1"],
});
const to = (notices) => notices.map((n) => n.push.recipientId);

test("a new addressed transfer notifies only the receiver", () => {
  const n = build(null, base);
  assert.deepEqual(to(n), ["r1"]);
  assert.match(n[0].push.body, /Asha.*Drill/);
  assert.equal(n[0].push.recipientType, "specific");
  assert.equal(n[0].inApp.isRead, false);
  assert.equal(n[0].inApp.body, n[0].push.body);
});

test("old transfers, unrelated edits and deletes notify nobody", () => {
  assert.deepEqual(build(null, { userName: "Asha" }), []);
  assert.deepEqual(build(base, { ...base, photoUrls: ["x"] }), []);
  assert.deepEqual(build(base, null), []);
});

test("received tells the sender who closed it", () => {
  const done = { ...base, receiptStatus: "received" };
  const n = build(base, { ...done, lastModifiedBy: "r1" });
  assert.deepEqual(to(n), ["s1"]);
  assert.match(n[0].push.body, /^Ravi/);
  assert.match(build(base, { ...done, lastModifiedBy: "a1" })[0].push.body, /^The office/);
});

test("a problem tells the sender and admins once each, with the note", () => {
  const n = build(base, { ...base, receiptStatus: "problem", receiptNote: "one missing" });
  assert.deepEqual(to(n), ["s1", "a1"]);
  assert.match(n[1].push.body, /one missing/);
});

test("IDs are deterministic, so a retried event cannot push twice", () => {
  assert.equal(build(null, base)[0].pushId, build(null, base)[0].pushId);
  const done = build(base, { ...base, receiptStatus: "received" })[0];
  assert.notEqual(done.pushId, build(null, base)[0].pushId);
});

test("directoryEntry carries names only and skips unrelated user writes", () => {
  const user = { name: "Ravi", employeeId: "E1", salaryRate: 900, fcmToken: "a" };
  assert.deepEqual(directoryEntry(null, user), { name: "Ravi", employeeId: "E1", active: true });
  assert.equal(directoryEntry(user, { ...user, fcmToken: "b" }), undefined);
  assert.equal(directoryEntry(user, { ...user, active: false }).active, false);
  assert.equal(directoryEntry(user, null), null);
});
