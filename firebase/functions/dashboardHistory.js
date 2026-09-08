"use strict";

// Pure helpers for month-history Sheet tabs — tabs that keep every month instead
// of being rebuilt from scratch each night (spec:
// docs/superpowers/specs/2026-07-13-employee-dashboard-month-history-design.md).
// Two consumers, both in index.js: the Employee Dashboard tab and the Overtime
// Exception Report tab. Firestore-free so it can be unit-tested with node --test.
// index.js does the Firestore reads and builds the current-month block's rows;
// these helpers parse the existing tab into month-blocks, decide which months to
// recompute vs freeze, and assemble the tab with the current month on top and
// frozen months (verbatim) below.

// Banner cell that heads each month-block. key = "YYYY-MM", label = "July 2026".
function bannerFor(key, label) {
  return `── MONTH: ${key} — ${label} ──`;
}

// Extract the "YYYY-MM" key from a banner cell, or null if it isn't a banner.
function keyOfBanner(cell) {
  if (cell == null) return null;
  const m = String(cell).match(/MONTH:\s*(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

// Split a tab's rows into month-blocks by banner rows. Rows before the first
// banner are returned as `legacy` (old single-block format). Each block's `rows`
// INCLUDES its banner row.
function parseBlocks(rows) {
  const blocks = [];
  const legacy = [];
  let current = null;
  for (const row of rows || []) {
    const key = keyOfBanner(row && row[0]);
    if (key != null) {
      current = { key, rows: [row] };
      blocks.push(current);
    } else if (current) {
      current.rows.push(row);
    } else {
      legacy.push(row);
    }
  }
  return { blocks, legacy };
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Reverse of toLocaleString("en-US",{month:"long",year:"numeric"}): "July 2026" → "2026-07".
// Returns null for anything it can't parse.
function monthLabelToKey(label) {
  if (label == null) return null;
  const m = String(label).trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTH_NAMES.indexOf(m[1].toLowerCase());
  if (idx === -1) return null;
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}

// NOTE: `imprestFromBlock` was deleted on 2026-07-17. It carried the manually-typed Imprest
// column from the Sheet into each rebuilt current block. Imprest is now COMPUTED from
// user.imprestPercent (see payrollDeductions.js) and the computed value replaces the manual
// column outright, so nothing reads the old value any more. Frozen past blocks still keep
// their manual imprest — they are never recomputed, and this file never touches their cells.

// Assemble the full tab: current block first, then frozen blocks sorted by key
// descending (newest first). Any frozen block whose key equals currentKey is
// dropped (defensive — the rebuilt current block replaces it).
function assembleTab(currentBlockRows, currentKey, frozenBlocks) {
  const frozen = (frozenBlocks || [])
    .filter((b) => b.key !== currentKey)
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const out = [...currentBlockRows];
  for (const b of frozen) out.push(...b.rows);
  return out;
}

// Which months a run must COMPUTE from Firestore, newest first. The current
// month always (it is rebuilt nightly); a past month only when the tab holds no
// block for it — a first-ever run, or a month the export never got to write.
// Every other past month already in the tab is frozen and re-emitted verbatim.
// Data months after `currentKey` are ignored: a future-dated record must not
// open a block for a month that has not happened.
function selectRebuildKeys(existingBlocks, currentKey, dataMonthKeys) {
  const have = new Set((existingBlocks || []).map((b) => b.key));
  const keys = new Set([currentKey]);
  for (const k of dataMonthKeys || []) {
    if (k > currentKey) continue;
    if (!have.has(k)) keys.add(k);
  }
  return [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

module.exports = { bannerFor, keyOfBanner, parseBlocks, monthLabelToKey, assembleTab, selectRebuildKeys };
