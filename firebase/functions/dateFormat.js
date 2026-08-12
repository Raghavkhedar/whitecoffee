"use strict";

// One date format for every Sheets export: DD/MM/YYYY.
// Spec: docs/superpowers/specs/2026-08-11-sheets-date-format-design.md
//
// Cloud Functions run on a UTC clock (see the root CLAUDE.md), so both
// formatters derive their civil fields from getUTC* on an IST-shifted instant.
// Deliberately NOT toLocaleString: it depends on the runtime's ICU data, pads
// nothing, and is what produced the old "10/8/2026, 9:13:46 am".
//
// Firestore-free so it unit-tests under `node --test`.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * ISO "yyyy-mm-dd" → "dd/mm/yyyy".
 *
 * Anything that is not an ISO date passes through UNCHANGED rather than
 * becoming "NaN/NaN/NaN". That keeps the function safe against a month label
 * ("August 2026") and makes it idempotent, so a double-format is harmless.
 *
 * @param {string|null|undefined} iso
 * @return {string}
 */
function dmy(iso) {
  if (!iso) return "";
  const s = String(iso);
  if (!ISO_DATE.test(s)) return s;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/**
 * Firestore Timestamp → "dd/mm/yyyy HH:MM" in IST, 24-hour, zero-padded.
 *
 * @param {{toDate: function(): Date}|null|undefined} timestamp
 * @return {string}
 */
function tsIST(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp.toDate().getTime() + IST_OFFSET_MS);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Epoch millis for sorting, or null when there is no timestamp.
 *
 * @param {{toDate: function(): Date}|null|undefined} timestamp
 * @return {number|null}
 */
function millisOf(timestamp) {
  if (!timestamp) return null;
  return timestamp.toDate().getTime();
}

/**
 * Ascending comparator over `{ sortKey: [...] }` rows, missing keys LAST.
 *
 * Keys compare with < / >, so the same comparator handles ISO date strings and
 * epoch numbers. Sorting must never run on a formatted cell: "10/08/2026" as
 * text orders by day-of-month, which is the bug this replaces.
 *
 * @param {{sortKey: Array}} a
 * @param {{sortKey: Array}} b
 * @return {number}
 */
function byKeys(a, b) {
  const ka = a.sortKey, kb = b.sortKey;
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const x = ka[i], y = kb[i];
    const xMissing = x == null || x === "";
    const yMissing = y == null || y === "";
    if (xMissing && yMissing) continue;
    if (xMissing) return 1;
    if (yMissing) return -1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

module.exports = { dmy, tsIST, millisOf, byKeys };
