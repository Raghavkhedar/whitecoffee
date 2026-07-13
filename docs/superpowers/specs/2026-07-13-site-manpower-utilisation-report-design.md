# Site Manpower Time Utilisation Report — Design

**Date:** 2026-07-13
**Status:** Approved (pending spec review)
**Area:** `firebase/functions/index.js` — new section in the nightly `exportToSheets` Cloud Function

## Purpose

Reproduce the client's manual **"SITE MANPOWER TIME UTILISATION REPORT"** (current "Aug 2024 → till date" format) automatically from the portal's operations attendance data. The report is a per-site, per-visit log of which ops technician worked on which WIP site each day and what fraction of an 8-hour day they spent there.

The classification fields it consumes already exist (added in commit `1119c69`):
- `users/{uid}.categories` — employee category codes (A1/A2/E1/E2/E3/M1/M2/M3/HHE/H/W)
- per-`site_in`/`site_out` event `visitType` (free text) and `workDoneCategories` (Helper/Mech/Elec/Civil/Welder/NA)
- per-event `siteId` (admin-filled customer id) and `siteName` (free text, from the app)

## Destination

- New spreadsheet constant `SHEET_ID_MANPOWER = "1U66-ldSNMm01f3rnJabJe0BxTUFvDglSX5rAFqXDJZ4"`.
- One tab, `TABS.MANPOWER = "Manpower Utilisation"`.
- **Current IST month only**, tab cleared and fully rebuilt each nightly run (same pattern as the Overtime Exception Report). Reuses the existing `writeTab(sheets, spreadsheetId, tabName, rows)` helper (clear + values.update).
- Runs inside the existing `exportToSheets` schedule (22:00 IST); no new schedule/trigger.

## Columns

Mirrors the reference "Aug 2024 → till date" sheet:

| # | Header | Source |
|---|--------|--------|
| 1 | DATE | event `date` (`YYYY-MM-DD`) |
| 2 | SITE | `siteName` of the visit |
| 3 | Cust ID | admin-filled `siteId` |
| 4 | Visit type | `visitType` |
| 5 | TecH name | resolved user name (`userNameMap`, keyed by `uidOf`) |
| 6 | Category (as per daily schedule) | user's `categories` joined by space, e.g. `E1 M2` |
| 7 | work done-Category | the visit's `workDoneCategories` joined by ` + `, e.g. `Elec + Mech` |
| 8 | work done-time | `(site_out_ts − site_in_ts)` minutes ÷ 480, rounded to 4 dp — **no cap; may exceed 1** |
| 9 | Remarks | that day's credited OT for the tech, `HH:MM`, on the last-visit row only (see below) |

## Data flow

1. **Fetch** this month's attendance events: collection-group `attendance`, `date` in `[monthStart, today]`. (Reuses `monthStart`/`today` already computed at the top of `exportToSheets`.) Keep only **operations** users (`userRoleMap.get(uid) === "operations"`) and only `site_in` / `site_out` event types (market visits excluded — they carry no visit fields).
2. **Group** events by `uid + date`; sort each group by timestamp.
3. **Pair** each `site_in` with the next unmatched `site_out` (FIFO queue). Each matched pair = one visit = one row. Classification fields (`siteId`, `visitType`, `workDoneCategories`) are read from the `site_in` event, falling back to the paired `site_out` when the `site_in`'s value is empty.
4. **work done-time** for a pair = `(outMinOfDay − inMinOfDay) / 480` using IST minutes-of-day (`getHourIST`/`getMinuteIST`), rounded to 4 dp.
5. **Remarks / OT:** compute the tech's **credited OT for the day** once, using the existing `computeDayLedger` port plus the shared `plannedMap` / `otAuthSet` / `approvalMap` / `otOverrideMap` maps (identical to the Attendance tab's `otMins`: declared auto-approved + authorized rest-day + admin-granted incl. manual; pending/unauthorized excluded). Place that value, formatted via `minToHHMM`, in the **Remarks of the row whose `site_out` is the latest that day** (the visit during which the tech stayed past shift end). All other rows for that tech/day have blank Remarks. If the day's credited OT is 0, Remarks stays blank on every row.
6. **Sort** final rows by DATE, then SITE.

## Edge cases

- **Missed logout** (`site_in` with no following `site_out`): still emit a row, with **blank** work-done-time — a visible data gap (the reference's documented "Pit fall"). If this last-in row is the chronologically latest event and the day has credited OT, the OT still attaches to it.
- **Orphan logout** (`site_out` with no preceding unmatched `site_in`): skipped.
- **No `categories` on the user / no `workDoneCategories` on the event / no `siteId`:** those cells are left blank.
- **Not θ-filled** — blanks stay blank (blank work-done-time is meaningful), matching the Overtime Exception Report rather than the θ-filled Attendance tab.

## Testing

Factor the pairing + fraction logic into a small pure helper (e.g. `buildManpowerVisits(events)` returning `[{ siteName, siteId, visitType, workDone, timeFraction, lastOutTs }]`) and cover it with `node --test` cases in `firebase/functions/`:

1. Clean single in/out pair → one row, correct fraction.
2. Same site visited twice in a day → two separate rows.
3. Two different sites in a day → two rows, correct per-site fractions.
4. Missed logout (in, no out) → row with blank time.
5. Orphan logout (out, no in) → skipped.
6. Over-8h visit → fraction > 1 (no cap).
7. OT attribution → credited OT lands on the latest-`site_out` row only, `HH:MM`.

Validate with `node --check firebase/functions/index.js` + `npm test` in `firebase/functions/` (the repo's function boundary suite; eslint is stale — do not use it). Deploy with `firebase deploy --only functions`.

## Open note for review

**Remarks OT = _credited_ OT** (the canonical portal number shown on the Employee Dashboard and Attendance tab: declared + authorized rest-day + granted), **not** raw minutes-past-shift-end. On a normal day with pre-declared/approved OT these coincide; on a day where surplus OT is still pending admin review, credited OT can be less than the raw overtime worked. Confirm this is the number wanted in Remarks.
