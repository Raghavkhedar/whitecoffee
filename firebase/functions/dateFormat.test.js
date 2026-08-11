"use strict";

// Boundary suite for the shared Sheets date formatting.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dmy, tsIST, millisOf, byKeys } = require("./dateFormat");

// A stand-in for a Firestore Timestamp — only toDate() is used.
const stamp = (iso) => ({ toDate: () => new Date(iso) });

test("dmy: ISO date becomes DD/MM/YYYY", () => {
  assert.equal(dmy("2026-08-10"), "10/08/2026");
  assert.equal(dmy("2026-12-31"), "31/12/2026");
});

test("dmy: single-digit day and month keep their zero padding", () => {
  assert.equal(dmy("2026-01-02"), "02/01/2026");
});

test("dmy: empty input yields empty string, never NaN", () => {
  assert.equal(dmy(""), "");
  assert.equal(dmy(null), "");
  assert.equal(dmy(undefined), "");
});

test("dmy: non-ISO input passes through untouched", () => {
  // The Employee Dashboard's month label must survive if ever passed here.
  assert.equal(dmy("August 2026"), "August 2026");
  // Idempotent: formatting an already-formatted value must not re-mangle it.
  assert.equal(dmy("10/08/2026"), "10/08/2026");
});

test("tsIST: renders IST date and 24-hour time, zero-padded", () => {
  // 2026-08-10T03:43:46Z + 5:30 = 09:13 IST on the 10th
  assert.equal(tsIST(stamp("2026-08-10T03:43:46Z")), "10/08/2026 09:13");
});

test("tsIST: midnight IST renders 00:00, not 24:00 or blank", () => {
  // 2026-08-09T18:30:00Z + 5:30 = 2026-08-10T00:00 IST
  assert.equal(tsIST(stamp("2026-08-09T18:30:00Z")), "10/08/2026 00:00");
});

test("tsIST: a UTC evening is already the NEXT day in IST", () => {
  // The case a naive getDate() gets wrong: 19:30Z on the 10th is 01:00 IST
  // on the 11th. Getting this wrong misdates every late-evening submission.
  assert.equal(tsIST(stamp("2026-08-10T19:30:00Z")), "11/08/2026 01:00");
});

test("tsIST: missing timestamp yields empty string", () => {
  assert.equal(tsIST(null), "");
  assert.equal(tsIST(undefined), "");
});

test("millisOf: returns epoch millis, or null when absent", () => {
  assert.equal(millisOf(stamp("2026-08-10T03:43:46Z")), Date.parse("2026-08-10T03:43:46Z"));
  assert.equal(millisOf(null), null);
});

test("byKeys: sorts ascending on the first key", () => {
  const rows = [
    { sortKey: ["2026-08-10"], row: ["c"] },
    { sortKey: ["2026-08-02"], row: ["a"] },
    { sortKey: ["2026-08-09"], row: ["b"] },
  ];
  rows.sort(byKeys);
  assert.deepEqual(rows.map((r) => r.row[0]), ["a", "b", "c"]);
});

test("byKeys: sorts numeric keys numerically, not as text", () => {
  // The exact failure the old string sort had: 2 must come before 10.
  const rows = [{ sortKey: [10] }, { sortKey: [2] }];
  rows.sort(byKeys);
  assert.deepEqual(rows.map((r) => r.sortKey[0]), [2, 10]);
});

test("byKeys: falls through to the second key on a tie", () => {
  const rows = [
    { sortKey: ["2026-08-10", 200], row: ["b"] },
    { sortKey: ["2026-08-10", 100], row: ["a"] },
  ];
  rows.sort(byKeys);
  assert.deepEqual(rows.map((r) => r.row[0]), ["a", "b"]);
});

test("byKeys: missing keys sort last, whether null or empty string", () => {
  const rows = [
    { sortKey: [""], row: ["blank"] },
    { sortKey: ["2026-08-10"], row: ["dated"] },
    { sortKey: [null], row: ["null"] },
  ];
  rows.sort(byKeys);
  assert.equal(rows[0].row[0], "dated");
});
