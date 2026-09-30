"use strict";

// The backfill's job is to add MISSING rows only. Every test is about what it must not
// duplicate: a row the function already wrote, a copy the old client managed to save, or a
// user who no longer exists.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planBackfill } = require("./backfillOpenSessionBellRows");

const TITLE = "You are still checked in";
const at = (iso) => Date.parse(iso);
const push = (uid, date, sentIso = `${date}T13:00:10Z`) =>
  ({ id: `open-session-${uid}-${date}`, recipientId: uid, sentAtMillis: at(sentIso) });

test("a reminder with no row gets one, at the deterministic id", () => {
  const { writes } = planBackfill([push("u1", "2026-09-26")], new Map([["u1", []]]));
  assert.deepEqual(writes, [
    { userId: "u1", rowId: "open-session-2026-09-26", date: "2026-09-26", sentAtMillis: at("2026-09-26T13:00:10Z") },
  ]);
});

test("a row the function already wrote is left alone", () => {
  const rows = [{ id: "open-session-2026-09-30", title: TITLE, createdAtMillis: at("2026-09-30T13:00:00Z") }];
  const { writes, skipped } = planBackfill([push("u1", "2026-09-30")], new Map([["u1", rows]]));
  assert.equal(writes.length, 0);
  assert.equal(skipped[0].reason, "row exists");
});

test("a client-saved copy (auto id) counts, even when it arrived the next morning", () => {
  // S351 in production: pushed 09-17 18:30 IST, saved 09-18 10:01 IST.
  const rows = [{ id: "jb7il6", title: TITLE, createdAtMillis: at("2026-09-18T04:31:13Z") }];
  const { writes } = planBackfill(
    [push("u1", "2026-09-15"), push("u1", "2026-09-17")],
    new Map([["u1", rows]])
  );
  assert.deepEqual(writes.map((w) => w.date), ["2026-09-15"]);
});

test("one client copy accounts for one reminder, not every day in its window", () => {
  const rows = [{ id: "c1", title: TITLE, createdAtMillis: at("2026-09-02T13:05:00Z") }];
  const { writes } = planBackfill(
    [push("u1", "2026-09-01"), push("u1", "2026-09-02")],
    new Map([["u1", rows]])
  );
  assert.equal(writes.length, 1);
});

test("an unrelated notification does not suppress the backfill", () => {
  const rows = [{ id: "x", title: "Leave partially approved", createdAtMillis: at("2026-08-08T14:00:00Z") }];
  const { writes } = planBackfill([push("u1", "2026-08-08")], new Map([["u1", rows]]));
  assert.equal(writes.length, 1);
});

test("a deleted user and a malformed push id are skipped, not written", () => {
  const { writes, skipped } = planBackfill(
    [push("gone", "2026-08-08"), { id: "weird", recipientId: "u1", sentAtMillis: 0 }],
    new Map([["u1", []]])
  );
  assert.equal(writes.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["unrecognised id", "user missing"]);
});
