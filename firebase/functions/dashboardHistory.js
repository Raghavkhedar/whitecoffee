"use strict";

// Pure helpers for the month-history Employee Dashboard tab (spec:
// docs/superpowers/specs/2026-07-13-employee-dashboard-month-history-design.md).
// Firestore-free so it can be unit-tested with node --test. index.js does the
// Firestore reads and builds the current-month block's rows; these helpers parse
// the existing tab into month-blocks, carry manual Imprest forward, and assemble
// the tab with the current month on top and frozen months (verbatim) below.

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

// Build empId → imprest from one block's rows. Header-aware: finds the row that
// contains an "EMP ID" cell, then reads the "EMP ID" column and the column whose
// header starts with "imprest". Skips CF BAL / TOTAL summary rows. Empty map when
// the block has no header or no imprest column.
function imprestFromBlock(blockRows) {
  const map = new Map();
  const rows = blockRows || [];
  const hdrIdx = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => String(c).trim() === "EMP ID"));
  if (hdrIdx === -1) return map;
  const hdr = rows[hdrIdx];
  const empIdCol   = hdr.findIndex((c) => String(c).trim() === "EMP ID");
  const imprestCol = hdr.findIndex((c) => String(c).toLowerCase().startsWith("imprest"));
  if (empIdCol === -1 || imprestCol === -1) return map;
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[empIdCol]) continue;
    if (r[0] === "CF BAL" || r[0] === "TOTAL") continue;
    const empId = String(r[empIdCol]).trim();
    if (empId) map.set(empId, parseFloat(r[imprestCol]) || 0);
  }
  return map;
}

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

module.exports = { bannerFor, keyOfBanner, parseBlocks, imprestFromBlock, monthLabelToKey, assembleTab };
