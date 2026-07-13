# Employee Dashboard — Month History (frozen blocks) — Design

**Date:** 2026-07-13
**Status:** Approved (pending spec review)
**Area:** `firebase/functions/index.js` — the "Employee Dashboard" section of `exportToSheets` (currently section 9)

## Purpose

Today the **Employee Dashboard** tab (`SHEET_ID_1`) is a single current-month snapshot: every nightly `exportToSheets` run **clears the whole tab and rewrites** one MTD block. All month-over-month history is lost — last night's numbers are gone once tonight's run overwrites them.

Change it to **accumulate one frozen block per month in the same tab**, newest on top. Past months are preserved verbatim (frozen); only the current month's block is rebuilt each run. This lets the client scroll back through each month's payroll snapshot as a growing ledger.

## Layout

One tab, stacked month-blocks, **current month on top**, older months below in descending key order:

```
── MONTH: 2026-07 — July 2026 ──                          (banner row)
Date | EMP Name | EMP ID | … | Prior Settlement 2026-06 (₹) | TOTAL DUE   (header row)
<employee rows — live/updating for the current month>
CF BAL | … | <grandCfBal>
TOTAL  | … | <grandTotal>
                                                          (blank spacer row)
── MONTH: 2026-06 — June 2026 ──                          (frozen, verbatim)
Date | EMP Name | EMP ID | … | Prior Settlement 2026-05 (₹) | TOTAL DUE
<June employee rows, exactly as last written on the June 30 run>
CF BAL | … | <…>
TOTAL  | … | <…>
                                                          (blank spacer row)
── MONTH: 2026-05 — May 2026 ──                           (frozen)
…
```

- **Banner row:** first cell is the sentinel string `── MONTH: <YYYY-MM> — <Month Year> ──` (e.g. `── MONTH: 2026-07 — July 2026 ──`). The `YYYY-MM` key is the machine identifier; extracted with the regex `/MONTH:\s*(\d{4}-\d{2})/`. Remaining cells in the banner row are blank.
- **Header row per block:** the existing 19-column header, repeated inside each block, so a frozen block stays self-describing even if the column layout changes in a later release, and each block's `Prior Settlement <prevMonth>` label is correct for its own month.
- **CF BAL and TOTAL** summary rows are **per block** (each month gets its own totals), matching today's two summary rows but scoped to the block.
- **Blank spacer row** separates blocks visually.

## Per-run rebuild flow

1. `currentKey = ${istYear}-${pad2(istMonth+1)}` (IST, from the values already computed at the top of `exportToSheets`); `currentLabel = monthLabel` (already computed).
2. Read the whole existing tab (`${TAB}!A:Z`).
3. **Parse into blocks** by banner rows → `[{ key, rows }]`, where `rows` is the full block (banner + header + employee rows + CF BAL + TOTAL + spacer). Content appearing **before the first banner** is `legacy` (old single-block format from before this change).
4. **Carry Imprest into the current block:** locate the source of manually-entered Imprest for the current month — the parsed block whose `key === currentKey` if present, otherwise `legacy` when its month resolves to `currentKey`. From that block's rows, build `empId → imprest` (header-aware: find the block's header row, then the `EMP ID` column and the column whose header starts with `imprest`, skipping `CF BAL`/`TOTAL` rows). Empty map when no source exists.
5. **Build the current-month block** from fresh Firestore data using the exact same computation as today (attendance MTD, salary, conveyance, prior-month locked settlement, `daysNP`, `TOTAL DUE`), seeding Imprest per employee from the carried map. Prepend the banner and append CF BAL + TOTAL + spacer.
6. **Freeze the rest:** `frozenBlocks` = all parsed blocks with `key !== currentKey`, **plus** a migrated legacy block when `legacy` resolves to a month **other than** `currentKey` (wrap legacy verbatim under a banner for its month). Drop legacy when it resolves to `currentKey` (it is being rebuilt).
7. **Assemble output:** `[current block] ++ frozenBlocks sorted by key descending`, flattened to a rows array.
8. Write with `writeTab(sheets, SHEET_ID_1, TAB, rows)` (clear + write — the whole tab is authored from parsed history + the rebuilt current block, so a full rewrite is safe and idempotent).

Because a month stops matching `currentKey` the instant the IST calendar rolls over, that month's final block (its last nightly write) becomes its permanent frozen snapshot automatically — no separate freeze trigger.

## Migration (first run after deploy)

The existing tab is the **old single-block format** (one header at row 0, employee rows, then `CF BAL`/`TOTAL`; no banner). Parsing yields zero blocks and all rows as `legacy`. Resolve the legacy month from the first employee row's `Date` cell (which holds `monthLabel`, e.g. `"July 2026"`) via a month-name→number map, producing a `YYYY-MM` key:
- **Legacy month === currentKey** (normal — deployed mid-month): drop legacy, rebuild the current block (carrying its Imprest). Result: a single bannered current-month block.
- **Legacy month !== currentKey** (deployed right after a rollover): wrap legacy verbatim as a frozen block under `── MONTH: <legacyKey> … ──`, and build a fresh (empty-history) current block on top. No snapshot lost.

If the legacy month cannot be resolved (empty tab, or an unrecognizable `Date` cell), treat legacy as absent — just write the current block.

## Structure & files

- **New pure module** `firebase/functions/dashboardHistory.js` — dependency-free (no Firestore, no Sheets), holding the parse/freeze/merge/order/imprest logic:
  - `bannerFor(key, label)` → banner cell string.
  - `keyOfBanner(cell)` → `YYYY-MM` or `null`.
  - `parseBlocks(rows)` → `{ blocks: [{ key, rows }], legacy: rows[] }`.
  - `imprestFromBlock(blockRows)` → `Map(empId → number)` (header-aware).
  - `monthLabelToKey(label)` → `YYYY-MM` or `null` (reverse of `toLocaleString` month-long+year).
  - `assembleTab(currentBlockRows, currentKey, frozenBlocks)` → rows array (current on top, frozen sorted desc, `currentKey` excluded from frozen).
- **Modify** `firebase/functions/index.js` — section 9 reads the existing tab, calls the pure helpers, builds the current block (Firestore work stays here), assembles, and `writeTab`s. Constant `TABS.EMPLOYEE_DASHBOARD`, `SHEET_ID_1`, and the whole per-employee computation are reused unchanged.
- **New test** `firebase/functions/dashboardHistory.test.js` — `node --test`.
- **Modify** `admin/CLAUDE.md` — update the Employee Dashboard tab bullet to describe the month-history behavior.

## Testing (`node --test`, no new deps)

Cover the pure helper:
1. `parseBlocks` splits a two-block tab into `[{key:'2026-07',…},{key:'2026-06',…}]` with correct row spans; content before the first banner lands in `legacy`.
2. `keyOfBanner` extracts `2026-07` from a banner cell and returns `null` for a non-banner cell.
3. `imprestFromBlock` returns `empId→imprest` from a block, locating columns by header, skipping `CF BAL`/`TOTAL` rows.
4. `monthLabelToKey("July 2026") === "2026-07"`; unknown label → `null`.
5. `assembleTab` puts the current block first and sorts frozen blocks by key descending, excluding any frozen block whose key equals `currentKey`.
6. End-to-end merge (helpers composed): given an existing two-block tab and a freshly built current block, the output keeps the frozen older block verbatim, replaces the current block, and orders current-on-top.
7. Migration: legacy (no-banner) rows whose `Date` = current month → dropped (rebuilt); legacy whose `Date` = a prior month → wrapped as a frozen block.

Validate with `node --check firebase/functions/index.js` + `npm test` in `firebase/functions/`. Deploy needs `firebase deploy --only functions:exportToSheets`.

## Constraints / consequences

- **Frozen = never recomputed.** A later regularization of a *past* month does **not** update that month's block (kept verbatim). Only the current month reacts to data changes. This is the intended behavior.
- Cloud functions run on a UTC clock — the current-month key/label come from the existing IST-derived `istYear`/`istMonth`/`monthLabel`; no bare `new Date()`/`getDay()` for IST dates.
- No new dependencies. Sheet grows by ~(#employees + 5) rows per month — negligible for Google Sheets.
