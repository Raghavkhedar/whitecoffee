# Standard DD/MM/YYYY dates across the Sheets exports

**Date:** 2026-08-11
**Status:** Approved, not yet implemented
**Scope:** `firebase/functions/` only. No Android release, no Firestore rules change.

## Problem

Three unrelated complaints turned out to share one file and, in two cases, one root cause.

### 1. Dates are written in three different formats

`exportToSheets` writes date cells in whatever shape the source happened to have:

| Shape | Example | Where |
|---|---|---|
| ISO `yyyy-mm-dd` | `2026-08-10` | Attendance, OT Exception, Manpower, Conveyance, Work Progress, Transfer Date, leave From/To |
| `toLocaleString("en-IN")` | `10/8/2026, 9:13:46 am` | every `Submitted At` / `Reviewed At` |
| joined ISO list | `2026-08-03, 2026-08-04` | Leave Requests → Granted Dates |

The middle one is the worst of the three: `index.js:144` calls `toLocaleString("en-IN", …)`, which
zero-pads nothing, appends seconds nobody reads, and depends on the runtime's ICU data rather than
on anything in this repo.

### 2. Five tabs are sorted by comparing a formatted date string

MT Requests, MT Purchases, Material Transfers, Tool Transfers and Leave Requests all end with:

```js
rows.sort((a, b) => a[0].localeCompare(b[0]));
```

Column 0 is `ts(d.submittedAt)`. Comparing those as text orders the sheet by the *first character*
of the day-of-month:

```
1/8/2026, ...
10/8/2026, ...
2/8/2026, ...     ← August 2nd sorts after August 10th
```

Attendance (`:984`), OT Exception (`:1113`), Manpower (`:1212`) and Work Progress (`:1316`) escape
this only by accident — they sort `a[0]` too, but `a[0]` is an ISO date, and ISO text happens to be
chronological.

**That accident is load-bearing, and change 1 destroys it.** Reformatting the Date column to
`10/08/2026` turns those four working sorts into the same day-of-month sort as the broken five. So
the sort fix is not optional cleanup that happens to ride along — it is required to avoid
regressing four tabs.

Nine sorts in total must move off the formatted cell. Conveyance (`:1417`) is the exception: it
sorts `allRows`, which keeps ISO because of the Firestore trap below, so it stays correct as-is.

### 3. Work Progress carries columns that are not wanted

`Hours Worked` and `Work Description` are to be removed from the report.

## Decisions

| Question | Decision |
|---|---|
| Timestamp format | `10/08/2026 09:13` — DD/MM/YYYY, 24h, zero-padded, no seconds |
| Date format | `10/08/2026` |
| Cell type (`exportToSheets` tabs) | **Text**, `valueInputOption` stays `RAW` |
| Cell type (forecast tabs) | Real date values kept; display changed via `numberFormat` |
| Work Progress Site ID | Keep `Site ID` and `Site Name` as two separate columns, unchanged |
| Work Progress columns | Drop both `Hours Worked` and `Work Description` |
| Sort key | Transfers by `transferDate`; Requests/Purchases/Leaves by `submittedAt`; all five fixed |

### Why text and not real Sheets dates

A real date value would sort and filter correctly inside the sheet, which `DD/MM/YYYY` text does
not — sorting a Date column in the UI would order by day-of-month. That was weighed and rejected as
not worth the cost: it needs a `numberFormat` batchUpdate per date column per tab, and writing date
serials, because switching these tabs to `USER_ENTERED` would reinterpret every *other* cell too — a
note beginning with `=` becomes a formula, an item named `1/2 inch` becomes a date.

The exporter writes rows pre-sorted, so the default view is correct without in-sheet sorting. If
sorting a Date column in the UI ever becomes a real need, that is a separate change.

## What changes

### New file: `firebase/functions/dateFormat.js`

Two pure functions, Firestore-free so they unit-test under `node --test`:

- `dmy(iso)` — `"2026-08-10"` → `"10/08/2026"`. `""` for null/empty. Anything not matching
  `^\d{4}-\d{2}-\d{2}$` passes through unchanged rather than producing `NaN/NaN/NaN`.
- `tsIST(timestamp)` — Firestore Timestamp → `"10/08/2026 09:13"` in IST. `""` for null.

Both build the string from `getUTC*` on the IST-shifted milliseconds — the same technique
`getHourIST` (`index.js:155`) already uses — **not** `toLocaleString`. Per the root `CLAUDE.md`,
Cloud Functions run on a UTC clock; a bare `new Date().getDate()` reads the wrong civil date for
five and a half hours a day.

`index.js:142`'s existing `ts()` becomes a thin re-export of `tsIST` so every call site keeps working.

### Applied at the row-build sites

| Tab | Cells reformatted |
|---|---|
| Attendance | Date → `dmy(date)` |
| Overtime Exception Report | Date → `dmy(date)` |
| Manpower Utilisation | Date → `dmy(date)` |
| Conveyance | Date — **see the trap below** |
| MT Requests | Submitted At |
| MT Purchases | Submitted At |
| Material Transfers | Submitted At, Transfer Date |
| Tool Transfers | Submitted At, Transfer Date |
| Work Progress | Date, Submitted At |
| Leave Requests | Submitted At, From Date, To Date, Granted Dates, Reviewed At |

Granted Dates becomes `granted.map(dmy).join(", ")`.

In Attendance, OT and Manpower the local `date` variable is a map key (`${uid}__${date}`) as well as
a cell value. Only the cell is formatted; the variable stays ISO.

### Trap: the Conveyance row array is also a Firestore write

`index.js:1412` builds the Conveyance row, and `index.js:1427` destructures that same array back
out:

```js
const [date, userName, employeeId, route, totalKmStr, conveyanceStr, , odUserId, ratePerKm] = row;
const docRef = db.collection("conveyance").doc(`${odUserId}__${date}`);
fbBatch.set(docRef, { userId: odUserId, /* … */ date, month: monthStr, /* … */ });
```

Formatting element 0 in place would fork every conveyance document onto a new ID
(`uid__10/08/2026` instead of `uid__2026-08-10`) and corrupt the stored `date` field, silently
duplicating a month of conveyance records.

**The row array keeps ISO.** Formatting happens only in the write call at `index.js:1446`, inside
the existing `.map(r => r.slice(0, 7))`.

### Trap: the Employee Dashboard "Date" column is not a date

That column holds a **month label** — `August 2026` — and the month banner above each block reads
`── MONTH: 2026-08 — August 2026 ──`. Both are **read back and parsed on the next run**:
`dashboardHistory.js:52 monthLabelToKey()` resolves legacy blocks from the label, and
`keyOfBanner()` regexes `\d{4}-\d{2}` out of the banner.

Reformatting either to `DD/MM/YYYY` makes both parsers return `null`, which breaks past-month
freezing and lets frozen history be overwritten. **Neither is touched.**

### Trap: the forecast tabs hold real date values, not text

`SpendData!Date` and `Daily Snapshot!Snapshot Date` are written `USER_ENTERED` with ISO strings, so
Sheets stores real date values — deliberately, per the comment at `index.js:663`. The Charts tab
built by `firebase/scripts/build-forecast-dashboard.js` compares them numerically
(`forecastDashboard.js:111`):

```js
`=IF(${gate},SUMIFS('Daily Snapshot'!$G:$G,'Daily Snapshot'!$B:$B,"${category}",'Daily Snapshot'!$A:$A,"<="&${dateCellRef}),"")`
```

Writing `DD/MM/YYYY` text into those columns would make every one of those comparisons compare text
to a number, and the Charts tab would silently go blank.

**The values stay as real dates.** After each of the two writes in `exportForecastSpend`, a
`spreadsheets.batchUpdate` `repeatCell` sets
`numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" }` on column A of that tab. Display becomes
DD/MM/YYYY; the stored values and every formula are untouched. This needs the tab's numeric
`sheetId`, resolved from the `spreadsheets.get` metadata the function already fetches.

### Sorting

Sort on the underlying value, never on the formatted string. Two strategies, because the two groups
have different problems.

**Group A — sort is correct today, formatting would break it.** These already sort a chronological
ISO string. The fix is ordering, not rewriting: **sort first, format the Date cell afterwards.**
The existing comparator is untouched, which makes the row order provably identical to today's.

| Tab | Line | Existing comparator | Formatting moves to |
|---|---|---|---|
| Attendance | `:984` | ISO `date`, then employee name | the existing `filledRows` map at `:986` |
| Overtime Exception Report | `:1113` | ISO `date`, then employee name | a new map at the `writeTab` call |
| Manpower Utilisation | `:1212` | ISO `date`, then **site name** | a new map at the `writeTab` call |
| Work Progress | `:1316` | ISO `date` | a new map at the `writeTab` call |

**Group B — sort is broken today.** These sort a `ts()` string, which is never chronological. They
build `{ sortKey, row }` pairs, sort on the key array, then map to rows:

| Tab | Line | Sort key |
|---|---|---|
| MT Requests | `:1234` | `[submittedAt millis]` |
| MT Purchases | `:1257` | `[submittedAt millis]` |
| Material Transfers | `:1280` | `[ISO transferDate, submittedAt millis]` |
| Tool Transfers | `:1302` | `[ISO transferDate, submittedAt millis]` |
| Leave Requests | `:1336` | `[submittedAt millis]` |

All ascending, missing keys last — `transferDate` is `""` on docs written before the field existed,
and `submittedAt` is null while a server timestamp is unresolved.

Conveyance (`:1417`) is left alone — it sorts `allRows`, which keeps ISO for the Firestore write.

Missing/null keys sort last rather than throwing — `transferDate` is `""` on any doc written before
the field existed, and `submittedAt` can be null on a doc whose server timestamp has not resolved.

The comparator is extracted as a pure `bySortKey` helper in `dateFormat.js` so it is unit-testable.

### Work Progress columns

Header and row drop `Hours Worked` and `Work Description`, 9 columns → 7:

```
Date | Employee Name | Employee ID | Site ID | Site Name | Submitted At | Photo URLs
```

`writeTab` calls `values.clear()` across the whole tab before writing, so the narrower grid leaves
no stale trailing columns — the same guarantee relied on by the Status-column removal in PR #34.

## Known consequences

- **Site ID stays roughly half-blank on Work Progress.** Live data shows employees type the site
  name into whichever free-text box they notice: Sachin Kumar fills `siteId` and leaves `siteName`
  empty; Manish does the reverse. The `sites` collection is empty and the daily-assignment lookup
  (`FirestoreSiteRepository.kt:35`) is commented out, so no real site IDs exist to enter. The field
  is labelled "Site ID (optional)" (`WorkProgressScreen.kt:55`) and nothing validates it. Fixing
  this means changing the Android form; it is deliberately **out of scope** here.
- **A few rows lose their only site reference.** Some `work_progress` docs have `siteId` and
  `siteName` both empty with the site recorded in `workDescription` (`palam vihar`,
  `381 sec-47ggn`). Dropping Work Description removes that. Raised and accepted.
- **In-sheet sorting of a Date column orders by day-of-month.** Accepted; see "Why text".

## Testing

Per the root `CLAUDE.md`, the functions eslint config is stale and parse-errors on modern JS, so the
validation path is `node --check` plus the `node --test` boundary suite — not `lint`.

New `firebase/functions/dateFormat.test.js`:

- `dmy`: ISO → DMY; single-digit day and month both zero-pad; `""`/`null`/`undefined` → `""`;
  non-ISO input (`"August 2026"`, `"10/08/2026"`) passes through unchanged.
- `tsIST`: known epoch → expected IST string; zero-padding of hour and minute; midnight →
  `00:00`; a UTC instant of `2026-08-10T19:30:00Z` renders as `11/08/2026 01:00` (the IST date is
  the *next* day) — this is the case a naive `getDate()` gets wrong.
- `bySortKey`: ascending order; empty and null keys sort last; stable tie-break.

Then `node --check index.js` and `npm test` in `firebase/functions` (currently 280 passing).

The suite does not cover `exportToSheets` itself, so a green run proves no collateral breakage
rather than proving the change. Real proof is the sheets after a run.

## Deploy

```
firebase deploy --only functions:exportToSheets,functions:exportForecastSpend
```

Both are scheduled (`exportToSheets` 22:00 IST, `exportForecastSpend` 23:15 IST), so the tabs change
on the next run rather than at deploy time. A force-run via Cloud Scheduler shows it immediately.

Two things to know before force-running:

- **It is expensive.** The Conveyance block calls the Google Maps Distance Matrix API once per
  consecutive event pair for every ops employee month-to-date, and rewrites every
  `conveyance/{uid}__{date}` document. Idempotent, but real API spend.
- **It is all-or-nothing.** `exportToSheets` is one monolithic function with no per-tab retry; a
  transient Maps or Firestore error aborts the whole run partway, leaving some tabs updated and
  others stale. A half-applied sheet is more likely a transient error than a code bug — check the
  logs before concluding otherwise.

The five submission tabs query `collectionGroup(...)` with no date filter, so one run reformats and
re-sorts their entire history. Attendance, OT, Manpower and Conveyance are month-to-date only.

No Android release. No Firestore rules change, so `firebase/rules-tests` is unaffected.
