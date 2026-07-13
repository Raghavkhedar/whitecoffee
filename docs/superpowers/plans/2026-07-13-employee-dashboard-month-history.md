# Employee Dashboard Month-History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Employee Dashboard" export tab accumulate one **frozen block per month** (current month on top, past months kept verbatim) instead of overwriting a single current-month snapshot each night.

**Architecture:** A pure, dependency-free module (`dashboardHistory.js`) parses the existing tab into month-blocks, carries manual Imprest forward, and assembles the tab (current block on top, frozen blocks below). `index.js` section 9 keeps all Firestore reads + builds the current block's rows, then delegates parse/merge/order to the helpers. The pure module is unit-tested with `node --test`.

**Tech Stack:** Node.js (CommonJS) Firebase Cloud Functions v2, `googleapis` Sheets v4, `node:test`.

## Global Constraints

- Cloud functions run on a **UTC** clock — derive the current month key/label from the existing IST-derived `istYear`/`istMonth`/`monthLabel`/`pad2`; never use bare `new Date()`/`getDay()` for an IST date.
- No new dependencies. Validate with `node --check index.js` + `npm test` in `firebase/functions/` — not eslint (stale config).
- Banner cell format is EXACTLY `── MONTH: <YYYY-MM> — <Month Year> ──` (e.g. `── MONTH: 2026-07 — July 2026 ──`); the machine key is the `YYYY-MM`, extracted with `/MONTH:\s*(\d{4}-\d{2})/`.
- **Frozen = never recomputed:** past-month blocks are kept byte-for-byte; only the current month's block is rebuilt each run.
- Ordering: current month block first, then frozen blocks sorted by key **descending** (newest first).
- Imprest is manually entered and must survive: carried into the rebuilt current block from the current month's previous version, by `EMP ID`, header-aware (same behavior as today, scoped to the current block).
- Deploy later with `firebase deploy --only functions:exportToSheets` (run by the user; not part of this plan).

## File Structure

- **Create** `firebase/functions/dashboardHistory.js` — pure parse/merge/order/imprest helpers. No Firestore, no Sheets.
- **Create** `firebase/functions/dashboardHistory.test.js` — `node --test` suite.
- **Modify** `firebase/functions/index.js` — require the helpers; rewire section 9 (read existing tab → parse → carry imprest → build current block → assemble → writeTab).
- **Modify** `admin/CLAUDE.md` — update the Employee Dashboard tab bullet.

---

### Task 1: Pure month-history helpers + tests

**Files:**
- Create: `firebase/functions/dashboardHistory.js`
- Test: `firebase/functions/dashboardHistory.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `bannerFor(key, label)` → banner cell string.
  - `keyOfBanner(cell)` → `"YYYY-MM"` or `null`.
  - `parseBlocks(rows)` → `{ blocks: [{ key, rows }], legacy: rows[] }` (block `rows` INCLUDES the banner row; pre-banner rows go to `legacy`).
  - `imprestFromBlock(blockRows)` → `Map(empId → number)` (header-aware; skips `CF BAL`/`TOTAL`).
  - `monthLabelToKey(label)` → `"YYYY-MM"` or `null` (reverse of `toLocaleString` long-month + year).
  - `assembleTab(currentBlockRows, currentKey, frozenBlocks)` → flat rows array (current first; frozen filtered of `currentKey` and sorted key-descending).

- [ ] **Step 1: Write the failing test file**

Create `firebase/functions/dashboardHistory.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd firebase/functions && npm test`
Expected: FAIL — `Cannot find module './dashboardHistory'`.

- [ ] **Step 3: Write the module**

Create `firebase/functions/dashboardHistory.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd firebase/functions && npm test`
Expected: PASS — all `dashboardHistory.test.js` tests green, and the existing `attendanceRules.test.js` + `manpowerVisits.test.js` suites still green.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/dashboardHistory.js firebase/functions/dashboardHistory.test.js
git commit -m "feat(functions): pure month-history helpers for Employee Dashboard + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rewire Employee Dashboard section to accumulate frozen month-blocks

**Files:**
- Modify: `firebase/functions/index.js`

**Interfaces:**
- Consumes: Task 1's `bannerFor`, `parseBlocks`, `imprestFromBlock`, `monthLabelToKey`, `assembleTab`; existing in-scope names `istYear`, `istMonth`, `pad2`, `monthLabel`, `SHEET_ID_1`, `TABS.EMPLOYEE_DASHBOARD`, `writeTab`, `sheets`, `allUsersData`, `userAttendanceMTD`, `conveyanceByUserId`, `daysPassed`, and the existing per-employee computation (settlement, salary, covy, daysNP).
- Produces: no code consumed by later tasks.

- [ ] **Step 1: Require the helpers**

In `firebase/functions/index.js`, immediately after the existing `const { buildManpowerVisits } = require("./manpowerVisits");` line (near the top requires), add:

```js
// Month-history helpers for the Employee Dashboard tab (see dashboardHistory.js).
const { bannerFor, parseBlocks, imprestFromBlock, monthLabelToKey, assembleTab } = require("./dashboardHistory");
```

- [ ] **Step 2: Replace the imprest-preservation block with parse + imprest-carry**

In section 9 (`// ── 9. Employee Dashboard`), REPLACE this existing block:

```js
      // Read existing sheet to preserve manually-entered Imprest (salary rate now comes from Firestore).
      // Locate columns by header name so this survives layout changes (e.g. added NP-breakdown columns).
      const imprestMap = new Map(); // employeeId → imprest
      try {
        const existing = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID_1,
          range: `${TAB}!A:Z`,
        });
        const existingRows = existing.data.values || [];
        const hdr        = existingRows[0] || [];
        const empIdCol   = hdr.indexOf("EMP ID");
        const imprestCol = hdr.findIndex((h) => String(h).toLowerCase().startsWith("imprest"));
        if (empIdCol !== -1 && imprestCol !== -1) {
          for (let i = 1; i < existingRows.length; i++) {
            const r = existingRows[i];
            if (!r || !r[empIdCol] || r[0] === "CF BAL" || r[0] === "TOTAL") continue;
            const empId = String(r[empIdCol]).trim();
            if (empId) imprestMap.set(empId, parseFloat(r[imprestCol]) || 0);
          }
        }
      } catch (_) {
        // Tab doesn't exist yet — start fresh
      }
```

with:

```js
      // Read the existing tab and parse it into month-blocks (see dashboardHistory.js).
      // Past months are frozen (kept verbatim); only the current month is rebuilt.
      const currentKey = `${istYear}-${pad2(istMonth + 1)}`;
      let existingRows = [];
      try {
        const existing = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID_1,
          range: `${TAB}!A:Z`,
        });
        existingRows = existing.data.values || [];
      } catch (_) {
        // Tab doesn't exist yet — start fresh
      }
      const { blocks, legacy } = parseBlocks(existingRows);

      // Legacy = old single-block content from before month-history (no banner).
      // Resolve which month it belongs to from an employee row's Date cell (= monthLabel).
      let legacyKey = null, legacyLabel = null;
      for (const r of legacy) {
        const k = monthLabelToKey(r && r[0]);
        if (k) { legacyKey = k; legacyLabel = String(r[0]).trim(); break; }
      }

      // Carry manually-entered Imprest into the rebuilt current block: from the
      // current month's previous block if present, else legacy when it IS the
      // current month. (Frozen past blocks keep their own imprest verbatim.)
      const oldCurrentBlock  = blocks.find((b) => b.key === currentKey) || null;
      const imprestSourceRows = oldCurrentBlock ? oldCurrentBlock.rows
        : (legacyKey === currentKey ? legacy : []);
      const imprestMap = imprestFromBlock(imprestSourceRows); // employeeId → imprest
```

- [ ] **Step 3: Replace the final writeTab with block-assembly**

In section 9, REPLACE this existing tail:

```js
      // CF BAL row — carry-forward leave balance per employee (total in last col)
      const cfBalRow  = summaryRow("CF BAL", grandCfBal);

      // TOTAL row — grand total of all dues
      const totalRow  = summaryRow("TOTAL", grandTotal);

      await writeTab(sheets, SHEET_ID_1, TAB, [header, ...empRows, cfBalRow, totalRow]);
      console.log(`Employee Dashboard: ${empRows.length} employees, total due ₹${grandTotal}`);
```

with:

```js
      // CF BAL row — carry-forward leave balance per employee (total in last col)
      const cfBalRow  = summaryRow("CF BAL", grandCfBal);

      // TOTAL row — grand total of all dues
      const totalRow  = summaryRow("TOTAL", grandTotal);

      // Current-month block: banner + header + rows + summaries + a blank spacer.
      const currentBlockRows = [
        [bannerFor(currentKey, monthLabel)],
        header,
        ...empRows,
        cfBalRow,
        totalRow,
        [""],
      ];

      // Freeze every other parsed block; migrate legacy (no-banner) content that
      // belongs to a PAST month into its own frozen block so no snapshot is lost.
      const frozenBlocks = blocks.filter((b) => b.key !== currentKey);
      if (legacyKey && legacyKey !== currentKey) {
        frozenBlocks.push({ key: legacyKey, rows: [[bannerFor(legacyKey, legacyLabel)], ...legacy] });
      }

      // Assemble: current month on top, frozen months newest→oldest below.
      const outRows = assembleTab(currentBlockRows, currentKey, frozenBlocks);
      await writeTab(sheets, SHEET_ID_1, TAB, outRows);
      console.log(`Employee Dashboard: ${empRows.length} employees (current ${currentKey}), ${frozenBlocks.length} frozen month(s), total due ₹${grandTotal}`);
```

- [ ] **Step 4: Syntax-check and run tests**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` exits 0 with no output; `npm test` passes ALL suites (dashboardHistory + manpowerVisits + attendanceRules). Report the exact output. (The section needs Firestore to run end-to-end — that happens on deploy; `node --check` confirms the edits are syntactically valid and reference only in-scope names.)

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): Employee Dashboard accumulates frozen month-blocks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Document the month-history behavior

**Files:**
- Modify: `admin/CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (docs only).

- [ ] **Step 1: Update the Employee Dashboard tab bullet**

In `admin/CLAUDE.md`, in the "## Google Sheets Export" section, find the bullet that begins `- **Employee Dashboard tab** — MTD summary, one row per employee:`. Append the following sentences to the END of that same bullet (do not create a new bullet, do not change the column list):

```markdown
 **The tab now keeps month history**: instead of overwriting a single snapshot, each nightly run preserves every past month's block **verbatim (frozen)** and rebuilds only the **current** month's block, stacked **current-on-top** in the same tab. Blocks are delimited by a banner row `── MONTH: YYYY-MM — Month Year ──` (parsed via `/MONTH:\s*(\d{4}-\d{2})/`); each block carries its own header + CF BAL + TOTAL. A month freezes automatically once the IST calendar rolls over. Manual **Imprest** is carried into the rebuilt current block only (past blocks keep theirs). Frozen = never recomputed — a later fix to a past month does not change that month's block. Parse/freeze/merge/order logic is the pure, unit-tested `functions/dashboardHistory.js` (`npm test`); first-run migration wraps the old single-block tab into the correct month.
```

- [ ] **Step 2: Commit**

```bash
git add admin/CLAUDE.md
git commit -m "docs: document Employee Dashboard month-history behavior

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Layout (banner + per-block header + CF BAL/TOTAL + spacer, current-on-top) → Task 2 Step 3 (`currentBlockRows`) + `assembleTab` (Task 1). ✓
- Per-run rebuild (read → parse → carry imprest → build current → freeze rest → assemble → writeTab) → Task 2 Steps 2-3. ✓
- Banner format + `YYYY-MM` regex → Task 1 `bannerFor`/`keyOfBanner` + Global Constraints. ✓
- Imprest carried into current block only, header-aware → Task 1 `imprestFromBlock` + Task 2 Step 2 `imprestSourceRows`. ✓
- Frozen = verbatim, current-on-top, frozen desc → Task 1 `assembleTab` + Task 2 Step 3. ✓
- Migration (legacy current-month → rebuilt; legacy prior-month → wrapped frozen; unresolvable → absent) → Task 2 Step 2 (`legacyKey`) + Step 3 (`if (legacyKey && legacyKey !== currentKey)`); `imprestSourceRows` falls back to `legacy` when `legacyKey === currentKey`. ✓
- Testing: pure helpers + `node --test` cases 1-7 from spec → Task 1 tests (round-trip, null, parse two-block, legacy, imprest, monthLabelToKey, assemble ordering, assemble drop-current, end-to-end freeze). ✓

**Placeholder scan:** No TBD/TODO/vague steps — every code step shows full code; every run step shows the command + expected result. ✓

**Type consistency:** `parseBlocks` returns `{blocks:[{key,rows}], legacy}` — consumed in Task 2 as `blocks.find(b=>b.key===…)`, `blocks.filter(b=>b.key!==…)`, and `legacy` iteration. `assembleTab(currentBlockRows, currentKey, frozenBlocks)` frozenBlocks are `{key, rows}` — matches both `blocks.filter(...)` output and the pushed `{key: legacyKey, rows: [...]}`. `imprestFromBlock(rows)` → `Map(empId→number)`, consumed as `imprestMap.get(empId)`. `bannerFor(key,label)` → string used as a one-cell row. ✓
