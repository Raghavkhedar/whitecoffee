# Sheets Date Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every date the Cloud Functions write into Google Sheets reads `DD/MM/YYYY`, every affected tab stays correctly sorted, and Work Progress loses two columns.

**Architecture:** Two pure formatters and one comparator live in a new `firebase/functions/dateFormat.js`, unit-tested under `node --test`. `index.js` calls them at the row-build sites. Sorting is fixed **before** any formatting lands, so formatting cannot regress a sort. Three places that look like dates but are read back by other code — the Conveyance row array, the Employee Dashboard month label, and the forecast tabs' real date values — are deliberately untouched.

**Tech Stack:** Node 24, `firebase-functions` v7, `googleapis` v173, `node --test` (no test deps).

**Spec:** `docs/superpowers/specs/2026-08-11-sheets-date-format-design.md`

## Global Constraints

- All work is in `firebase/functions/`. No Android change, no Firestore rules change.
- The eslint config is stale and parse-errors on modern JS. Validate with `node --check index.js` and `npm test` — **never** `npm run lint`.
- Cloud Functions run on a **UTC** clock. Derive IST civil fields by shifting `+05:30` and reading `getUTC*`. Never `new Date().getDate()` / `.getDay()` for an IST date.
- `valueInputOption` stays `RAW` for every `exportToSheets` tab. Do not switch any of them to `USER_ENTERED`.
- Date format is `DD/MM/YYYY`. Timestamp format is `DD/MM/YYYY HH:MM` — 24-hour, zero-padded, no seconds.
- Never format the Conveyance row array in place (`index.js:1412`). It is destructured at `index.js:1427` into a Firestore document ID.
- Never reformat the Employee Dashboard `Date` column or the `── MONTH: … ──` banner. Both are parsed back by `dashboardHistory.js` on the next run.
- Run `npm test` from `firebase/functions/`. Baseline before any change: **280 passing**.

---

### Task 1: Pure date helpers

**Files:**
- Create: `firebase/functions/dateFormat.js`
- Test: `firebase/functions/dateFormat.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `dmy(iso: string|null) => string` — `"2026-08-10"` → `"10/08/2026"`; falsy → `""`; non-ISO passes through unchanged.
  - `tsIST(timestamp: {toDate(): Date}|null) => string` — → `"10/08/2026 09:13"`; falsy → `""`.
  - `millisOf(timestamp: {toDate(): Date}|null) => number|null`.
  - `byKeys(a: {sortKey: Array}, b: {sortKey: Array}) => number` — ascending comparator, missing keys last.

- [ ] **Step 1: Write the failing test**

Create `firebase/functions/dateFormat.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && npx node --test dateFormat.test.js`
Expected: FAIL — `Cannot find module './dateFormat'`

- [ ] **Step 3: Write minimal implementation**

Create `firebase/functions/dateFormat.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && npx node --test dateFormat.test.js`
Expected: PASS — 13 tests.

- [ ] **Step 5: Run the full suite for no collateral breakage**

Run: `cd firebase/functions && npm test`
Expected: PASS — 293 tests (280 baseline + 13 new).

- [ ] **Step 6: Commit**

```bash
git add firebase/functions/dateFormat.js firebase/functions/dateFormat.test.js
git commit -m "feat(sheets): one date formatter, built without toLocaleString"
```

---

### Task 2: Fix the five broken sorts (no formatting yet)

Sorting is fixed **before** formatting so that each change is independently verifiable: this task must not alter any cell's *content*, only row order.

**Files:**
- Modify: `firebase/functions/index.js` — MT Requests (`:1217-1237`), MT Purchases (`:1239-1260`), Material Transfers (`:1262-1283`), Tool Transfers (`:1285-1305`), Leave Requests (`:1321-1339`)

**Interfaces:**
- Consumes: `millisOf`, `byKeys` from Task 1.
- Produces: five blocks whose `rows` array holds `{ sortKey, row }` objects rather than bare arrays. Task 3 formats cells inside `row`.

- [ ] **Step 1: Import the helpers**

At the top of `index.js`, beside the other local requires (near `index.js:62`, the `auditLog` require):

```js
// One date format across every exported tab, plus a comparator that sorts on
// the underlying value instead of the formatted cell (dateFormat.js).
const { dmy, tsIST, millisOf, byKeys } = require("./dateFormat");
```

- [ ] **Step 2: Convert MT Requests**

Replace the body of the `── 2. MT Requests` block's `forEach` and sort (`index.js:1224-1235`):

```js
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const sortKey = [millisOf(d.submittedAt)];
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || ""];
        if (items.length === 0) rows.push({ sortKey, row: [...base, "", "", "", "", d.notes || "", photos] });
        else items.forEach((item) => rows.push({ sortKey, row: [...base, item.itemName || "", item.quantity || "", item.unit || "", item.notes || "", d.notes || "", photos] }));
      });
      rows.sort(byKeys);
      await writeTab(sheets, SHEET_ID_3, TABS.REQUESTS, [header, ...rows.map((r) => r.row)]);
```

- [ ] **Step 3: Convert MT Purchases**

Same shape in the `── 3. MT Purchases` block (`index.js:1246-1258`):

```js
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const sortKey = [millisOf(d.submittedAt)];
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || ""];
        if (items.length === 0) rows.push({ sortKey, row: [...base, "", "", "", "", "", d.grandTotal || "", d.notes || "", photos] });
        else items.forEach((item) => rows.push({ sortKey, row: [...base, item.itemName || "", item.quantity || "", item.unit || "", item.pricePerUnit || "", item.totalPrice || "", d.grandTotal || "", d.notes || "", photos] }));
      });
      rows.sort(byKeys);
      await writeTab(sheets, SHEET_ID_4, TABS.PURCHASES, [header, ...rows.map((r) => r.row)]);
```

- [ ] **Step 4: Convert Material Transfers**

In the `── 4. Material Transfers` block (`index.js:1269-1281`). Note the two-part key — the business `transferDate` leads, `submittedAt` breaks ties:

```js
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const sortKey = [d.transferDate || "", millisOf(d.submittedAt)];
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.transferDate || "", d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
        if (items.length === 0) rows.push({ sortKey, row: [...base, "", "", "", "", d.notes || "", photos] });
        else items.forEach((item) => rows.push({ sortKey, row: [...base, item.itemName || "", item.quantity || "", item.unit || "", item.condition || "", d.notes || "", photos] }));
      });
      rows.sort(byKeys);
      await writeTab(sheets, SHEET_ID_5, TABS.MATERIAL_TRANSFERS, [header, ...rows.map((r) => r.row)]);
```

- [ ] **Step 5: Convert Tool Transfers**

In the `── 5. Tool Transfers` block (`index.js:1292-1303`):

```js
      const rows = [];
      snap.docs.forEach((doc) => {
        const d    = doc.data();
        const items = Array.isArray(d.items) ? d.items : [];
        const uid   = uidOf(doc);
        const sortKey = [d.transferDate || "", millisOf(d.submittedAt)];
        const base  = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.transferDate || "", d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
        if (items.length === 0) rows.push({ sortKey, row: [...base, "", "", "", "", d.notes || ""] });
        else items.forEach((item) => rows.push({ sortKey, row: [...base, item.itemName || "", item.quantity || "", item.unit || "", item.condition || "", d.notes || ""] }));
      });
      rows.sort(byKeys);
      await writeTab(sheets, SHEET_ID_6, TABS.TOOL_TRANSFERS, [header, ...rows.map((r) => r.row)]);
```

- [ ] **Step 6: Convert Leave Requests**

The `── 7. Leave Requests` block uses `.map`, not `.push` (`index.js:1329-1337`):

```js
      const rows   = snap.docs.map((doc) => {
        const d   = doc.data();
        const uid = uidOf(doc);
        const granted     = explicitGrantedDates(d);
        const grantedDays = grantedDayCount(d) ?? (d.totalDays || "");
        return {
          sortKey: [millisOf(d.submittedAt)],
          row: [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.leaveType || "", d.fromDate || "", d.toDate || "", grantedDays, granted.join(", "), d.reason || "", d.approvedBy || "", d.approverComment || "", ts(d.reviewedAt)],
        };
      });
      rows.sort(byKeys);
      await writeTab(sheets, SHEET_ID_1, TABS.LEAVE_REQUESTS, [header, ...rows.map((r) => r.row)]);
```

- [ ] **Step 7: Verify the file parses and the suite still passes**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` silent (success), 293 tests PASS.

`rows.length` in each block's `console.log` still reads correctly — the array length is unchanged, only its element type.

- [ ] **Step 8: Commit**

```bash
git add firebase/functions/index.js
git commit -m "fix(sheets): sort five tabs by date instead of by date-shaped text"
```

---

### Task 3: Apply DD/MM/YYYY across exportToSheets

**Files:**
- Modify: `firebase/functions/index.js` — `ts()` at `:142-145`, Attendance (`:984-987`), OT Exception (`:1113-1114`), Manpower (`:1212-1213`), Work Progress (`:1311-1316`), the five Group B blocks, Conveyance write at `:1446`

**Interfaces:**
- Consumes: `dmy`, `tsIST` from Task 1; the `{ sortKey, row }` shape from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Point `ts()` at the new formatter**

Replace `index.js:142-145` entirely:

```js
// Kept as a name because ~7 call sites use it. The implementation now lives in
// dateFormat.js — see that file for why this is not toLocaleString.
const ts = tsIST;
```

Delete the old function body. Leave `timeIST`, `getHourIST` and `getMinuteIST` alone.

- [ ] **Step 2: Format the Group A tabs AFTER their sort**

These four sort on the ISO date, so the format must be applied downstream of `rows.sort(...)`. Do not move the sort.

Attendance — replace `index.js:986` (the `filledRows` line):

```js
      // Format the Date cell only AFTER the sort above: that comparator relies
      // on ISO being chronological as text, which "10/08/2026" is not.
      const filledRows = rows.map((r) => [dmy(r[0]), ...r.slice(1)]
        .map((cell) => (cell === "" || cell == null) ? "θ" : cell));
```

OT Exception — replace the `writeTab` call at `index.js:1114`:

```js
      await writeTab(sheets, SHEET_ID_OT, TABS.OT_EXCEPTION,
        [header, ...rows.map((r) => [dmy(r[0]), ...r.slice(1)])]);
```

Manpower — replace the `writeTab` call at `index.js:1213`:

```js
      await writeTab(sheets, SHEET_ID_MANPOWER, TABS.MANPOWER,
        [header, ...rows.map((r) => [dmy(r[0]), ...r.slice(1)])]);
```

- [ ] **Step 3: Format Transfer Date on both transfer tabs**

In Material Transfers and Tool Transfers, the `base` array's 4th element is `d.transferDate`. Change it in both blocks — `sortKey` keeps the raw ISO value:

```js
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", dmy(d.transferDate), d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
```

`dmy` already returns `""` for a missing value, so the `|| ""` is no longer needed there.

- [ ] **Step 4: Format the Leave Requests date columns**

In the Leave Requests block, change the `row` array's From Date, To Date and Granted Dates:

```js
          row: [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.leaveType || "", dmy(d.fromDate), dmy(d.toDate), grantedDays, granted.map(dmy).join(", "), d.reason || "", d.approvedBy || "", d.approverComment || "", ts(d.reviewedAt)],
```

`ts(d.submittedAt)` and `ts(d.reviewedAt)` now render `DD/MM/YYYY HH:MM` automatically via Step 1.

- [ ] **Step 5: Format the Conveyance Date at the write boundary only**

Replace the `writeTab` call at `index.js:1446`. The row array itself must keep ISO — it is destructured at `index.js:1427` into the Firestore doc ID `${odUserId}__${date}`:

```js
      const header = ["Date", "Employee Name", "Employee ID", "Route", "Total KM", "Conveyance (₹)", "Rate"];
      // dmy() is applied HERE and nowhere else: allRows is destructured above
      // into the conveyance doc ID and its stored `date` field, so formatting
      // it in place would fork every record onto a new document.
      await writeTab(sheets, SHEET_ID_1, TABS.CONVEYANCE,
        [header, ...allRows.map((r) => [dmy(r[0]), ...r.slice(1, 7)])]);
```

- [ ] **Step 6: Verify**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` silent, 293 tests PASS.

- [ ] **Step 7: Confirm nothing reformatted the Dashboard label**

```bash
cd firebase/functions && awk '/── 9. Employee Dashboard/,0' index.js | grep -n "dmy"
```

Expected: **no output.** The Employee Dashboard block must contain no `dmy` call — its `Date`
column holds a month label (`August 2026`) that `dashboardHistory.js:52` parses back on the next
run to locate legacy blocks. Reformatting it silently breaks past-month freezing.

- [ ] **Step 8: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(sheets): write every exported date as DD/MM/YYYY"
```

---

### Task 4: Trim Work Progress to seven columns

**Files:**
- Modify: `firebase/functions/index.js:1307-1319` (the `── 6. Work Progress` block)

**Interfaces:**
- Consumes: `dmy`, `ts` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Replace the block's header and row**

`Hours Worked` and `Work Description` come out; the Date cell is formatted after the sort, as in Task 3 Step 2:

```js
    // ── 6. Work Progress ──────────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("work_progress").get();
      // Hours Worked and Work Description were dropped on 2026-08-11 by request.
      // Site ID and Site Name are BOTH kept: employees type the site into
      // whichever free-text box they notice, so each column is populated on a
      // different subset of rows. See the spec's "Known consequences".
      const header = ["Date", "Employee Name", "Employee ID", "Site ID", "Site Name", "Submitted At", "Photo URLs"];
      const rows   = snap.docs.map((doc) => {
        const d   = doc.data();
        const uid = uidOf(doc);
        return [d.date || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || "", ts(d.submittedAt), Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : ""];
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      // Date formatted after the sort — see the Attendance block for why.
      await writeTab(sheets, SHEET_ID_7, TABS.WORK_PROGRESS,
        [header, ...rows.map((r) => [dmy(r[0]), ...r.slice(1)])]);
      console.log(`Work Progress: ${rows.length} rows`);
    }
```

- [ ] **Step 2: Verify header and row lengths match**

Both are 7. Count them in the code above before moving on — a mismatch here silently shifts every cell one column left, which is exactly the failure PR #34 was careful to avoid.

`writeTab` calls `values.clear()` across the whole tab first, so the two removed columns leave no stale trailing data.

- [ ] **Step 3: Verify**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` silent, 293 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(sheets): drop Hours Worked and Work Description from Work Progress"
```

---

### Task 5: DD/MM/YYYY display on the forecast tabs

The forecast tabs hold **real date values**, written `USER_ENTERED`. The Charts tab compares them numerically (`forecastDashboard.js:111`), so their values must not become text. Only the cell's display format changes.

**Files:**
- Modify: `firebase/functions/index.js` — `exportForecastSpend`, after the SpendData write (`:664-669`) and the Daily Snapshot write (`:676-681`)

**Interfaces:**
- Consumes: the `sheets` client already in scope.
- Produces: `setDateColumnFormat(sheets, spreadsheetId, tabName)` — a module-level helper in `index.js`, beside `writeTab`.

- [ ] **Step 1: Add the helper beside `writeTab`**

```js
// Set column A of a tab to display dd/mm/yyyy. Used ONLY by exportForecastSpend:
// its tabs are written USER_ENTERED, so column A holds real date VALUES that the
// Charts tab compares numerically. Rewriting them as DD/MM/YYYY text would make
// every one of those comparisons compare text to a number and silently blank the
// dashboard — so the values stay, and only the display format changes.
async function setDateColumnFormat(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === tabName);
  if (!tab) {
    console.warn(`forecast: tab '${tabName}' not found — date format not applied`);
    return;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: tab.properties.sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      }],
    },
  });
}
```

`startRowIndex: 1` skips the header row so the `"Date"` / `"Snapshot Date"` label is untouched.

- [ ] **Step 2: Call it after each of the two writes**

After the SpendData `values.update` (`index.js:669`):

```js
    await setDateColumnFormat(sheets, FORECAST_SHEET_ID, "SpendData");
```

After the Daily Snapshot `values.update` (`index.js:681`):

```js
    await setDateColumnFormat(sheets, FORECAST_SHEET_ID, "Daily Snapshot");
```

Do **not** add one for the `Forecast {FY}` entry tab — it is manager-owned and write-once.

- [ ] **Step 3: Verify**

Run: `cd firebase/functions && node --check index.js && npm test`
Expected: `node --check` silent, 293 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(forecast): display SpendData and Daily Snapshot dates as dd/mm/yyyy"
```

---

### Task 6: Final verification and PR

**Files:** none modified.

- [ ] **Step 1: Full validation**

```bash
cd firebase/functions && node --check index.js && npm test
```

Expected: `node --check` silent, 293 tests PASS. Do not run `npm run lint` — the config is stale and parse-errors on modern JS.

- [ ] **Step 2: Confirm no tab switched away from RAW**

Run: `cd firebase/functions && grep -n "valueInputOption" index.js`
Expected: exactly 4 hits, unchanged from before this work — `:214` `RAW` (inside `writeTab`) and three `USER_ENTERED` inside `exportForecastSpend`.

- [ ] **Step 3: Confirm the untouchables are untouched**

```bash
cd firebase/functions && git diff main -- index.js | grep "^[+-]" | grep -v "^[+-][+-]" | grep "monthLabel\|bannerFor\|MONTH:"
```

Expected: **no output**. The inner greps strip diff context lines and the `+++`/`---` file headers,
so a hit means an *actually changed* line touched the Employee Dashboard month label or banner —
which breaks past-month freezing. Revert it.

- [ ] **Step 4: Confirm the Conveyance Firestore write still uses ISO**

```bash
cd firebase/functions && sed -n '1425,1432p' index.js
```

Expected: the destructure and `db.collection("conveyance").doc(\`${odUserId}__${date}\`)` are unchanged, with no `dmy(` anywhere in that range.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "One date format, working sorts, and a leaner Work Progress tab" --body "$(cat <<'EOF'
## What

Every date the nightly Sheets exports write is now `DD/MM/YYYY`, timestamps are
`DD/MM/YYYY HH:MM`, nine tabs sort correctly, and Work Progress loses two columns.

## Why the sort fix is not optional

Five tabs sorted with `a[0].localeCompare(b[0])` where column 0 was a formatted
date string, so August 2nd sorted after August 10th. Four more tabs sorted the
same expression but on an ISO date, which is chronological as text — reformatting
those to `DD/MM/YYYY` would have broken four sorts that work today. Sorting was
therefore fixed in its own commit, ahead of any formatting change.

## Deliberately unchanged

| | Why |
|---|---|
| Conveyance row array | Destructured into the Firestore doc ID `${uid}__${date}`; formatting it in place would fork every record onto a new document. Formatted at the write boundary only. |
| Employee Dashboard `Date` column and `── MONTH: ──` banner | Not dates — a month label, parsed back by `dashboardHistory.js` each run to freeze past months. |
| SpendData / Daily Snapshot values | Real date values compared numerically by the Charts formulas. Given a `dd/mm/yyyy` number format instead, so the display changes and the values do not. |
| Work Progress `Site ID` / `Site Name` | Kept as two columns by decision. The column is half-blank because the Android form offers two optional free-text boxes and employees fill whichever they notice — an app fix, not an export fix. |

## Verification

- `node --check index.js` — clean. (The functions eslint config is stale and
  parse-errors on modern JS, so `node --check` + the boundary suite is the
  validation path, not `lint`.)
- `npm test` in `firebase/functions` — 293/293 pass, including 13 new
  `dateFormat.test.js` cases covering zero-padding, midnight, and the
  UTC-evening/IST-next-day boundary a naive `getDate()` gets wrong.
- The suite does not cover `exportToSheets`, so this proves no collateral
  breakage rather than proving the change. Real proof is the sheets after a run.

## Deploy

After merge: `firebase deploy --only functions:exportToSheets,functions:exportForecastSpend`
from the repo root. Both are nightly, so the tabs change on the next scheduled run.
No Android release.

Design doc: `docs/superpowers/specs/2026-08-11-sheets-date-format-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge manual verification

Not part of the plan's automated gates — the suite cannot reach `exportToSheets`.

1. Deploy both functions.
2. Force-run `exportToSheets` (Cloud Console → Cloud Scheduler → the
   `firebase-schedule-exportToSheets-*` job → **Force run**). Be aware this
   re-runs every Google Maps Distance Matrix call in the Conveyance block and is
   the expensive part of the run.
3. Check in the sheets:
   - Tool Transfers is in ascending Transfer Date order, and no row reads `2/8/2026`.
   - Every Date and Submitted At cell reads `10/08/2026` / `10/08/2026 09:13`.
   - Work Progress has 7 columns and no stale 8th or 9th.
   - Employee Dashboard still shows its past-month blocks, headed `August 2026`.
4. Force-run `exportForecastSpend`, then confirm the Charts tab still renders
   numbers rather than blanks — that is the check that the forecast date values
   survived as values.
