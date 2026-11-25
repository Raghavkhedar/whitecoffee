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
  senderName: "Asha", receiverName: "Ravi",
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

test("names come from the user records, never from what the sender typed", () => {
  const forged = { ...base, userName: "HR", receivedBy: "The Director" };
  assert.match(build(null, forged)[0].push.body, /^Asha sent you/);
  assert.match(build(base, { ...forged, receiptStatus: "received", lastModifiedBy: "r1" })[0].push.body, /^Ravi/);
  const problem = build(base, { ...forged, receiptStatus: "problem", receiptNote: "x" })[0];
  assert.match(problem.push.body, /^Ravi/);
});

test("sender-written item text cannot grow a message without bound", () => {
  const items = [{ itemName: "A".repeat(9000), quantity: "B".repeat(9000) }];
  const body = build(null, { ...base, items })[0].push.body;
  assert.ok(body.length < 200, String(body.length));
  const note = build(base, { ...base, items, receiptStatus: "problem", receiptNote: "n".repeat(500) })[0];
  assert.ok(note.push.body.length <= 400);
});

test("a receiver who is not a real user gets nothing written", () => {
  const args = { before: null, after: base, collection: "tool_transfers", docId: "t1", senderId: "s1" };
  assert.deepEqual(buildReceiptNotices({ ...args, senderName: "Asha", receiverName: null }), []);
});

test("directoryEntry carries names only and skips unrelated user writes", () => {
  const user = { name: "Ravi", employeeId: "E1", salaryRate: 900, fcmToken: "a" };
  assert.deepEqual(directoryEntry(null, user), { name: "Ravi", employeeId: "E1", active: true });
  assert.equal(directoryEntry(user, { ...user, fcmToken: "b" }), undefined);
  assert.equal(directoryEntry(user, { ...user, active: false }).active, false);
  assert.equal(directoryEntry(user, null), null);
});
