"use strict";

// Unit suite for the month-history Employee Dashboard helpers. Pure logic, no
// Firestore. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  bannerFor, keyOfBanner, parseBlocks, imprestFromBlock, monthLabelToKey, assembleTab,
} = require("./dashboardHistory");

// A minimal block's rows for month `key`/`label` with one employee carrying an imprest.
const block = (key, label, empId, imprest) => [
  [bannerFor(key, label)],
  ["Date", "EMP Name", "EMP ID", "Imprest Due MTD", "TOTAL DUE"],
  [label, "Ramesh", empId, imprest, 100],
  ["CF BAL", "", "", "", 5],
  ["TOTAL", "", "", "", 100],
  [""],
];

test("bannerFor / keyOfBanner round-trip", () => {
  const cell = bannerFor("2026-07", "July 2026");
  assert.equal(cell, "── MONTH: 2026-07 — July 2026 ──");
  assert.equal(keyOfBanner(cell), "2026-07");
});

test("keyOfBanner returns null for a non-banner cell", () => {
  assert.equal(keyOfBanner("Ramesh"), null);
  assert.equal(keyOfBanner(""), null);
  assert.equal(keyOfBanner(undefined), null);
});

test("parseBlocks splits a two-block tab and captures spans", () => {
  const rows = [...block("2026-07", "July 2026", "E1", 50), ...block("2026-06", "June 2026", "E1", 40)];
  const { blocks, legacy } = parseBlocks(rows);
  assert.equal(legacy.length, 0);
  assert.deepEqual(blocks.map((b) => b.key), ["2026-07", "2026-06"]);
  assert.equal(blocks[0].rows.length, 6);
  assert.equal(blocks[1].rows.length, 6);
  assert.equal(blocks[0].rows[0][0], "── MONTH: 2026-07 — July 2026 ──");
});

test("parseBlocks puts pre-banner rows into legacy", () => {
  const legacyRows = [
    ["Date", "EMP Name", "EMP ID", "Imprest Due MTD", "TOTAL DUE"],
    ["July 2026", "Ramesh", "E1", 50, 100],
  ];
  const { blocks, legacy } = parseBlocks([...legacyRows, ...block("2026-07", "July 2026", "E2", 30)]);
  assert.equal(legacy.length, 2);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].key, "2026-07");
});

test("imprestFromBlock reads empId→imprest, header-aware, skipping summaries", () => {
  const m = imprestFromBlock(block("2026-07", "July 2026", "E9", 123));
  assert.equal(m.get("E9"), 123);
  assert.equal(m.has("CF BAL"), false);
  assert.equal(m.has("TOTAL"), false);
});

test("imprestFromBlock returns empty map when no header/imprest column", () => {
  assert.equal(imprestFromBlock([["random"], ["rows"]]).size, 0);
  assert.equal(imprestFromBlock([]).size, 0);
});

test("monthLabelToKey reverses the long-month label", () => {
  assert.equal(monthLabelToKey("July 2026"), "2026-07");
  assert.equal(monthLabelToKey("December 2025"), "2025-12");
  assert.equal(monthLabelToKey("Jul 2026"), null); // long month only
  assert.equal(monthLabelToKey("garbage"), null);
  assert.equal(monthLabelToKey(undefined), null);
});

test("assembleTab puts current block first and sorts frozen descending", () => {
  const current = block("2026-07", "July 2026", "E1", 50);
  const frozen = [
    { key: "2026-05", rows: block("2026-05", "May 2026", "E1", 10) },
    { key: "2026-06", rows: block("2026-06", "June 2026", "E1", 20) },
  ];
  const out = assembleTab(current, "2026-07", frozen);
  const keys = out.filter((r) => keyOfBanner(r[0])).map((r) => keyOfBanner(r[0]));
  assert.deepEqual(keys, ["2026-07", "2026-06", "2026-05"]);
});

test("assembleTab drops any frozen block whose key equals currentKey", () => {
  const current = block("2026-07", "July 2026", "E1", 50);
  const frozen = [{ key: "2026-07", rows: block("2026-07", "July 2026", "E1", 999) }];
  const out = assembleTab(current, "2026-07", frozen);
  const keys = out.filter((r) => keyOfBanner(r[0])).map((r) => keyOfBanner(r[0]));
  assert.deepEqual(keys, ["2026-07"]); // stale duplicate excluded
});

test("end-to-end: freeze past block verbatim, replace current, order current-on-top", () => {
  const existing = [...block("2026-07", "July 2026", "E1", 11), ...block("2026-06", "June 2026", "E1", 22)];
  const { blocks } = parseBlocks(existing);
  const frozenBlocks = blocks.filter((b) => b.key !== "2026-07");
  const newCurrent = block("2026-07", "July 2026", "E1", 77); // rebuilt with new imprest
  const out = assembleTab(newCurrent, "2026-07", frozenBlocks);
  // June block preserved byte-for-byte
  const juneBanner = out.findIndex((r) => keyOfBanner(r[0]) === "2026-06");
  assert.deepEqual(out.slice(juneBanner, juneBanner + 6), block("2026-06", "June 2026", "E1", 22));
  // current July imprest is the new value, on top
  assert.equal(keyOfBanner(out[0][0]), "2026-07");
  assert.equal(out[2][3], 77);
});
