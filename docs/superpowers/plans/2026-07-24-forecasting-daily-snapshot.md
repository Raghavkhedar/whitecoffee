# Forecasting Daily-Spend Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloud Function that reads Firestore `dailySpend` + the MDD ledger, buckets all spend into 22 categories, and writes a flat `SpendData` tab plus a reactive `Daily Snapshot` view into the Forecasting sheet.

**Architecture:** Pure, no-deps bucketing/date/category module (`forecastSpend.js`, unit-tested via `node --test`) + a thin integration function in `index.js` that does the Firestore/Sheets I/O and calls the pure module, mirroring the existing `exportToSheets`.

**Tech Stack:** Firebase Functions v2 `onSchedule`, Firestore Admin SDK, `googleapis` Sheets v4, CommonJS, `node --test`.

## Global Constraints

- CommonJS (`require`), Node 24 runtime. No new npm deps.
- Validate with `node --check` + `npm test` (eslint config is stale). Run from `firebase/functions/`.
- Cloud functions run on **UTC**; Firestore `dailySpend.date` is already a clean `"yyyy-mm-dd"` IST string — use it as-is, do NOT re-derive from `new Date()`.
- Service account: `attendance-sheets-expor@white-coffee-92c27.iam.gserviceaccount.com`. Secret: `ATTENDANCE_SHEETS_KEY`. Scope: `https://www.googleapis.com/auth/spreadsheets`.
- Forecasting sheet id: `1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo`. MDD sheet id: `1rsmpHOeOeVBG8XzIFZlnEAa2pzyxr4S0UYOYGyulFyQ`.
- **Never write to MDD.** Read-only.
- PF & ESI are **positive** (company cost), added to the Manpower total.
- Flat row shape everywhere: `[date, category, component, employeeId, employeeName, amount]` (date = `"yyyy-mm-dd"`).

## File Structure

- Create `firebase/functions/forecastSpend.js` — pure module: category catalog, tag normalization, header-based column finder, amount + date parsers, MDD-tab bucketer, Firestore→Manpower mapper, Communication-tab detector/bucketer.
- Create `firebase/functions/forecastSpend.test.js` — `node --test` suite.
- Modify `firebase/functions/index.js` — add `exports.exportForecastSpend` (integration: I/O + view formulas).

---

### Task 1: Category catalog + tag normalization + column finder

**Files:**
- Create: `firebase/functions/forecastSpend.js`
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Produces: `normTag(s) -> string`; `findCol(header, patterns) -> number`; constants `VENDOR_CATEGORIES`, `OFFICE_CATEGORIES` (objects: normalized-tag → category name), `MANPOWER_COMPONENTS` (array of `[firestoreField, label]`).

- [ ] **Step 1: Write the failing test**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normTag, findCol, VENDOR_CATEGORIES, OFFICE_CATEGORIES, MANPOWER_COMPONENTS,
} = require("./forecastSpend");

test("normTag trims, lowercases, collapses whitespace", () => {
  assert.equal(normTag("  Core   Asset "), "core asset");
  assert.equal(normTag("Subscription - CLOUD"), "subscription - cloud");
  assert.equal(normTag(null), "");
});

test("catalog maps known tags to category names", () => {
  assert.equal(VENDOR_CATEGORIES[normTag("Tool")], "Tool Purchase");
  assert.equal(VENDOR_CATEGORIES[normTag("Transporter Purchase")], "Transporter Purchases");
  assert.equal(OFFICE_CATEGORIES[normTag("Celebration")], "Welfare (Celebrations)");
  assert.equal(OFFICE_CATEGORIES[normTag("Stationary")], "Stationery");
  // welfare + special allowance are NOT standalone categories (they route into Manpower)
  assert.equal(OFFICE_CATEGORIES[normTag("Employee Welfare & Retention")], undefined);
});

test("MANPOWER_COMPONENTS covers the six firestore fields", () => {
  const fields = MANPOWER_COMPONENTS.map((c) => c[0]);
  assert.deepEqual(fields, ["salary", "conveyance", "imprest", "otWo", "pf", "esi"]);
});

test("findCol locates a column by regex, case-insensitive, trimmed", () => {
  const header = ["Voucher No.", " Payment Date ", "tags", "Amount (₹)"];
  assert.equal(findCol(header, [/payment date/i, /^date$/i]), 1);
  assert.equal(findCol(header, [/^tags?$/i]), 2);
  assert.equal(findCol(header, [/amount|₹/i]), 3);
  assert.equal(findCol(header, [/nope/i]), -1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: FAIL — cannot find module `./forecastSpend`.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";

// Pure spend-categorisation helpers for the Forecasting export. No Firestore/Sheets here.

function normTag(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
}

// Vendor Payment tab tags → standalone category names.
const VENDOR_CATEGORIES = {
  [normTag("Tool")]: "Tool Purchase",
  [normTag("Core Asset")]: "Core Asset",
  [normTag("Asset")]: "Asset Purchase",
  [normTag("Material Repair")]: "Material Repair",
  [normTag("Transporter Purchase")]: "Transporter Purchases",
  [normTag("Stock")]: "Purchase Stock",
};

// Office Expense tab tags → standalone category names.
// NOTE: "Employee Welfare & Retention" is intentionally absent — it routes into Manpower.
const OFFICE_CATEGORIES = {
  [normTag("Electricity")]: "Electricity",
  [normTag("Asset Repair")]: "Asset Repair",
  [normTag("Tool Repair")]: "Tool Repair",
  [normTag("Celebration")]: "Welfare (Celebrations)",
  [normTag("Client/Vendor Entertainment Expenses")]: "Client/Vendor Ent Expense",
  [normTag("Stationary")]: "Stationery",
  [normTag("Office Cleaning Eqp. and Exp.")]: "Office Cleaning Eqp. & Exp.",
  [normTag("Training Exp.")]: "Training Expense",
  [normTag("Subscription - CLOUD")]: "Subscription – Cloud",
  [normTag("Subscription - HR Related")]: "Subscription – Job Portal",
  [normTag("Building/General Maintenance (Electrical / Plumbing / Painting / Deep Cleaning)")]: "Maint. of Building",
  [normTag("Chai / Biscuit / Tissue / Disposable")]: "Pantry / House Keeping",
  [normTag("Mis. Overhead")]: "OH (Overhead)",
  [normTag("Expense Related to Sales and Advertisement")]: "Sales & Adv Expenses",
};

// Firestore dailySpend fields that feed Manpower, in display order. All stored positive.
const MANPOWER_COMPONENTS = [
  ["salary", "Salary"], ["conveyance", "Conveyance"], ["imprest", "Imprest"],
  ["otWo", "OT amount"], ["pf", "PF"], ["esi", "ESI"],
];

// First header column index whose trimmed text matches any of the patterns; -1 if none.
function findCol(header, patterns) {
  for (let i = 0; i < header.length; i++) {
    const cell = String(header[i] == null ? "" : header[i]).trim();
    if (patterns.some((p) => p.test(cell))) return i;
  }
  return -1;
}

module.exports = {
  normTag, findCol, VENDOR_CATEGORIES, OFFICE_CATEGORIES, MANPOWER_COMPONENTS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(functions): forecast spend category catalog + tag/column helpers"
```

---

### Task 2: Amount + date parsers

**Files:**
- Modify: `firebase/functions/forecastSpend.js`
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Produces: `parseAmount(v) -> number` (0 on junk); `parseDate(v) -> "yyyy-mm-dd" | null`.

- [ ] **Step 1: Write the failing test** (append to test file)

```js
const { parseAmount, parseDate } = require("./forecastSpend");

test("parseAmount strips ₹/commas, keeps sign, junk→0", () => {
  assert.equal(parseAmount("1,586"), 1586);
  assert.equal(parseAmount("₹ 2,750.50"), 2750.5);
  assert.equal(parseAmount("-160"), -160);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount("NA"), 0);
  assert.equal(parseAmount(400), 400);
});

test("parseDate handles dd/mm/yyyy, dd-mm-yyyy, ISO, and Date", () => {
  assert.equal(parseDate("09/07/2026"), "2026-07-09"); // dd/mm
  assert.equal(parseDate("13/07/2026"), "2026-07-13"); // 13 can't be month → dd/mm
  assert.equal(parseDate("20-07-2026"), "2026-07-20"); // dd-mm dashes
  assert.equal(parseDate("2026-07-09"), "2026-07-09"); // ISO passthrough
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("garbage"), null);
});

test("parseDate disambiguates mm-dd when day>12 in first field is impossible", () => {
  assert.equal(parseDate("07-13-2026"), "2026-07-13"); // 13>12 in 2nd → mm-dd
  assert.equal(parseDate("14-07-2026"), "2026-07-14"); // 14>12 in 1st → dd-mm
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: FAIL — `parseAmount`/`parseDate` undefined.

- [ ] **Step 3: Write minimal implementation** (add to module + exports)

```js
function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const pad2 = (n) => String(n).padStart(2, "0");

// Returns "yyyy-mm-dd" or null. Accepts a JS Date, ISO string, or dd/mm/yyyy | mm-dd-yyyy
// (Google-Form ledgers are inconsistent). Disambiguation: whichever of the first two
// parts is >12 is the day/month accordingly; when ambiguous (both ≤12) assume dd/mm (Indian).
function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (!m) return null;
  let a = Number(m[1]), b = Number(m[2]);
  const y = m[3];
  let day, mon;
  if (a > 12) { day = a; mon = b; }        // dd-mm
  else if (b > 12) { mon = a; day = b; }   // mm-dd
  else { day = a; mon = b; }               // ambiguous → dd/mm (Indian)
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${y}-${pad2(mon)}-${pad2(day)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(functions): tolerant amount + dd/mm-vs-mm/dd date parsers"
```

---

### Task 3: Generic MDD-tab bucketer

**Files:**
- Modify: `firebase/functions/forecastSpend.js`
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Consumes: `normTag`, `findCol`, `parseAmount`, `parseDate`.
- Produces: `bucketMddTab({ values, resolve }) -> { rows, seenTags }` where `values` is the raw 2-D array from Sheets (row 0..n, header somewhere in first few rows), `resolve(normalizedTag) -> { category, component, perEmployee } | null`, `rows` = flat `[date,category,component,empId,empName,amount]`, `seenTags` = Set of normalized tags encountered.

- [ ] **Step 1: Write the failing test**

```js
const { bucketMddTab } = require("./forecastSpend");

const VENDOR_HEADER = ["Voucher No.", "Payment Date", "Invoice No.", "tags", "Particulars", "Vendor Name", "Vendor ID", "Amount (₹)", "Mode", "remark"];
const vendorResolve = (t) => {
  const { VENDOR_CATEGORIES } = require("./forecastSpend");
  const c = VENDOR_CATEGORIES[t];
  return c ? { category: c, component: "", perEmployee: false } : null;
};

test("bucketMddTab: vendor rows filtered + parsed by tag", () => {
  const values = [
    ["title junk"], VENDOR_HEADER,
    ["V1", "09/07/2026", "I1", "Tool", "grinder", "Acme", "V9", "1,586", "TBP", ""],
    ["V2", "10/07/2026", "I2", "Asset", "rack", "Acme", "V9", "400", "TBP", ""],
    ["V3", "11/07/2026", "I3", "Unknownn", "misc", "Acme", "V9", "999", "TBP", ""],
  ];
  const { rows, seenTags } = bucketMddTab({ values, resolve: vendorResolve });
  assert.deepEqual(rows, [
    ["2026-07-09", "Tool Purchase", "", "", "", 1586],
    ["2026-07-10", "Asset Purchase", "", "", "", 400],
  ]);
  assert.ok(seenTags.has("unknownn")); // recorded even though unmatched
});

test("bucketMddTab: per-employee tag captures employee id/name, zero rows dropped", () => {
  const header = ["Voucher Number", "Date", "Employee Name", "Employee ID", "Tags", "Particular", "₹ Amount", "Mode", "remark"];
  const values = [header,
    ["010174", "02/04/2026", "devendra", "S271", "Special Allowance", "x", "3200", "TBP", "NA"],
    ["010175", "02/04/2026", "devender", "S271", "Special Allowance", "x", "0", "TBP", "NA"],
  ];
  const resolve = (t) => t === "special allowance"
    ? { category: "Manpower Expense", component: "Special Allowance", perEmployee: true } : null;
  const { rows } = bucketMddTab({ values, resolve });
  assert.deepEqual(rows, [["2026-04-02", "Manpower Expense", "Special Allowance", "S271", "devendra", 3200]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: FAIL — `bucketMddTab` undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// Find the header row: first row containing a "tag(s)" cell within the first 6 rows.
function findHeaderRow(values) {
  const limit = Math.min(values.length, 6);
  for (let i = 0; i < limit; i++) {
    const row = values[i] || [];
    if (row.some((c) => /^tags?$/i.test(String(c == null ? "" : c).trim()))) return i;
  }
  return 0;
}

// Bucket one MDD tab. `resolve(normTag) -> {category,component,perEmployee} | null`.
function bucketMddTab({ values, resolve }) {
  const rows = [];
  const seenTags = new Set();
  if (!Array.isArray(values) || values.length === 0) return { rows, seenTags };
  const h = findHeaderRow(values);
  const header = values[h] || [];
  const dateCol = findCol(header, [/payment date/i, /^\s*date\s*$/i, /date/i]);
  const amtCol = findCol(header, [/amount|₹|amt/i]);
  const tagCol = findCol(header, [/^\s*tags?\s*$/i]);
  const idCol = findCol(header, [/employee id/i, /emp\.? id/i]);
  const nameCol = findCol(header, [/employee name/i, /emp\.? name/i]);
  if (dateCol < 0 || amtCol < 0 || tagCol < 0) return { rows, seenTags };
  for (let i = h + 1; i < values.length; i++) {
    const r = values[i] || [];
    const tag = normTag(r[tagCol]);
    if (!tag) continue;
    seenTags.add(tag);
    const target = resolve(tag);
    if (!target) continue;
    const date = parseDate(r[dateCol]);
    const amount = parseAmount(r[amtCol]);
    if (!date || amount === 0) continue;
    const empId = target.perEmployee && idCol >= 0 ? String(r[idCol] || "").trim() : "";
    const empName = target.perEmployee && nameCol >= 0 ? String(r[nameCol] || "").trim() : "";
    rows.push([date, target.category, target.component, empId, empName, amount]);
  }
  return { rows, seenTags };
}
```
Add `bucketMddTab` (and keep `findHeaderRow` private) to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(functions): generic MDD tab bucketer (tag→category, per-employee)"
```

---

### Task 4: Firestore dailySpend → Manpower flat rows

**Files:**
- Modify: `firebase/functions/forecastSpend.js`
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Consumes: `MANPOWER_COMPONENTS`.
- Produces: `dailySpendToFlat(docs) -> rows` where `docs` = array of `dailySpend` doc data (`{date, employeeId, name, salary, conveyance, imprest, otWo, pf, esi, ...}`); emits one flat row per non-zero component, `category="Manpower Expense"`, PF/ESI positive.

- [ ] **Step 1: Write the failing test**

```js
const { dailySpendToFlat } = require("./forecastSpend");

test("dailySpendToFlat: one row per non-zero component, PF/ESI positive", () => {
  const docs = [{
    date: "2026-07-09", employeeId: "S271", name: "devendra",
    salary: 800, conveyance: 50, imprest: 0, otWo: 120, pf: 96, esi: 6,
  }];
  const rows = dailySpendToFlat(docs);
  assert.deepEqual(rows, [
    ["2026-07-09", "Manpower Expense", "Salary", "S271", "devendra", 800],
    ["2026-07-09", "Manpower Expense", "Conveyance", "S271", "devendra", 50],
    ["2026-07-09", "Manpower Expense", "OT amount", "S271", "devendra", 120],
    ["2026-07-09", "Manpower Expense", "PF", "S271", "devendra", 96],
    ["2026-07-09", "Manpower Expense", "ESI", "S271", "devendra", 6],
  ]);
});

test("dailySpendToFlat: skips docs with no date", () => {
  assert.deepEqual(dailySpendToFlat([{ salary: 100 }]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: FAIL — `dailySpendToFlat` undefined.

- [ ] **Step 3: Write minimal implementation**

```js
function dailySpendToFlat(docs) {
  const rows = [];
  (docs || []).forEach((d) => {
    if (!d || !d.date) return;
    const id = String(d.employeeId || "").trim();
    const name = String(d.name || "").trim();
    MANPOWER_COMPONENTS.forEach(([field, label]) => {
      const amt = Number(d[field]) || 0;
      if (amt === 0) return;
      rows.push([d.date, "Manpower Expense", label, id, name, amt]);
    });
  });
  return rows;
}
```
Add to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(functions): dailySpend → Manpower per-employee flat rows"
```

---

### Task 5: Communication-tab detector + all-rows bucketer

**Files:**
- Modify: `firebase/functions/forecastSpend.js`
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Consumes: `findCol`, `parseAmount`, `parseDate`.
- Produces: `pickTabName(titles, needle) -> string | null` (case-insensitive contains); `bucketCommunication(values) -> { rows, dateCol, amtCol }` — sums every row, no tag filter, `category="Comm Expenses"`.

- [ ] **Step 1: Write the failing test**

```js
const { pickTabName, bucketCommunication } = require("./forecastSpend");

test("pickTabName matches case-insensitive substring", () => {
  assert.equal(pickTabName(["Vendor Payment", "Communication ", "Office Expense"], "communication"), "Communication ");
  assert.equal(pickTabName(["A", "B"], "communication"), null);
});

test("bucketCommunication sums all dated rows, no tag filter", () => {
  const values = [
    ["Timestamp", "Email", "Date", "Particulars", "Amount", "Comment"],
    ["x", "y", "09/07/2026", "sim recharge", "220.8", ""],
    ["x", "y", "10/07/2026", "airtime", "100", ""],
    ["x", "y", "", "no date", "50", ""],
  ];
  const { rows, dateCol, amtCol } = bucketCommunication(values);
  assert.equal(dateCol, 2);
  assert.equal(amtCol, 4);
  assert.deepEqual(rows, [
    ["2026-07-09", "Comm Expenses", "", "", "", 220.8],
    ["2026-07-10", "Comm Expenses", "", "", "", 100],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: FAIL — `pickTabName`/`bucketCommunication` undefined.

- [ ] **Step 3: Write minimal implementation**

```js
function pickTabName(titles, needle) {
  const n = String(needle).toLowerCase();
  return (titles || []).find((t) => String(t).toLowerCase().includes(n)) || null;
}

function bucketCommunication(values) {
  const rows = [];
  if (!Array.isArray(values) || values.length === 0) return { rows, dateCol: -1, amtCol: -1 };
  const header = values[0] || [];
  const dateCol = findCol(header, [/^\s*date\s*$/i, /date/i]);
  const amtCol = findCol(header, [/amount|₹|amt/i]);
  if (dateCol < 0 || amtCol < 0) return { rows, dateCol, amtCol };
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const date = parseDate(r[dateCol]);
    const amount = parseAmount(r[amtCol]);
    if (!date || amount === 0) continue;
    rows.push([date, "Comm Expenses", "", "", "", amount]);
  }
  return { rows, dateCol, amtCol };
}
```
Add both to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd firebase/functions && node --test forecastSpend.test.js`
Expected: PASS. Then run full suite: `npm test` — expect all green (existing 136 + new).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(functions): communication-tab detector + all-rows bucketer"
```

---

### Task 6: Integration — `exportForecastSpend` Cloud Function + Daily Snapshot view

**Files:**
- Modify: `firebase/functions/index.js` (add near `exportToSheets`; reuse `writeTab`/`ensureTab`, `SHEETS_KEY`, `google`).

**Interfaces:**
- Consumes: everything exported from `forecastSpend.js`.
- Produces: `exports.exportForecastSpend` (scheduled). No unit test — integration, verified at deploy.

- [ ] **Step 1: Add the require + constants** (top of index.js, near other requires / SHEET_ID_* block)

```js
const forecast = require("./forecastSpend");
const FORECAST_SHEET_ID = "1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo";
const MDD_SHEET_ID = "1rsmpHOeOeVBG8XzIFZlnEAa2pzyxr4S0UYOYGyulFyQ";
```

- [ ] **Step 2: Add the function**

```js
// ── Forecasting export — flat SpendData + Daily Snapshot view ────────────────
// Reads Firestore dailySpend (Manpower) + the MDD ledger (Vendor Payment / Office
// Expense / Employee Payment / Communication), buckets into 22 categories, writes a
// flat SpendData tab + a reactive Daily Snapshot view into the Forecasting sheet.
// Runs after snapshotDailySpend (22:30 IST) so Manpower figures are fresh. Read-only on MDD.
exports.exportForecastSpend = onSchedule(
  { schedule: "15 23 * * *", timeZone: "Asia/Kolkata", secrets: ["ATTENDANCE_SHEETS_KEY"], timeoutSeconds: 300, memory: "512MiB" },
  async () => {
    const keyJson = JSON.parse(SHEETS_KEY.value());
    const auth = new google.auth.GoogleAuth({ credentials: keyJson, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth });
    const db = admin.firestore();

    // 1) Firestore Manpower (all snapshotted months → supports the overall running total).
    const dsSnap = await db.collection("dailySpend").get();
    const flat = forecast.dailySpendToFlat(dsSnap.docs.map((d) => d.data()));

    // 2) MDD tabs — resolve real tab names, read once each.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: MDD_SHEET_ID });
    const titles = meta.data.sheets.map((s) => s.properties.title);
    const nameOf = (needle, fallback) => forecast.pickTabName(titles, needle) || fallback;
    const vendorTab = nameOf("vendor payment", "Vendor Payment");
    const officeTab = nameOf("office expense", "Office Expense");
    const empPayTab = nameOf("employee payment", "Employee Payment");
    const commTab = forecast.pickTabName(titles, "communication");

    const readTab = async (name) => {
      if (!name) return [];
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: MDD_SHEET_ID, range: name });
      return res.data.values || [];
    };
    const [vendorVals, officeVals, empPayVals, commVals] = await Promise.all(
      [vendorTab, officeTab, empPayTab, commTab].map(readTab));

    // 3) Resolvers.
    const vendorResolve = (t) => {
      const c = forecast.VENDOR_CATEGORIES[t];
      return c ? { category: c, component: "", perEmployee: false } : null;
    };
    const officeResolve = (t) => {
      const c = forecast.OFFICE_CATEGORIES[t];
      if (c) return { category: c, component: "", perEmployee: false };
      if (t === forecast.normTag("Employee Welfare & Retention")) {
        return { category: "Manpower Expense", component: "Employee Welfare & Retention", perEmployee: false };
      }
      return null;
    };
    const empPayResolve = (t) => t === forecast.normTag("Special Allowance")
      ? { category: "Manpower Expense", component: "Special Allowance", perEmployee: true } : null;

    const vendor = forecast.bucketMddTab({ values: vendorVals, resolve: vendorResolve });
    const office = forecast.bucketMddTab({ values: officeVals, resolve: officeResolve });
    const empPay = forecast.bucketMddTab({ values: empPayVals, resolve: empPayResolve });
    const comm = forecast.bucketCommunication(commVals);
    flat.push(...vendor.rows, ...office.rows, ...empPay.rows, ...comm.rows);

    // 4) Warn on any catalog tag that never appeared (typo protection).
    const expectVendor = Object.keys(forecast.VENDOR_CATEGORIES);
    const expectOffice = Object.keys(forecast.OFFICE_CATEGORIES).concat([forecast.normTag("Employee Welfare & Retention")]);
    const missVendor = expectVendor.filter((t) => !vendor.seenTags.has(t));
    const missOffice = expectOffice.filter((t) => !office.seenTags.has(t));
    if (missVendor.length) console.warn(`forecast: Vendor Payment tags not found: ${missVendor.join(" | ")}`);
    if (missOffice.length) console.warn(`forecast: Office Expense tags not found: ${missOffice.join(" | ")}`);
    if (!empPay.seenTags.has(forecast.normTag("Special Allowance"))) console.warn("forecast: 'Special Allowance' not found in Employee Payment");
    console.log(`forecast: Communication tab='${commTab}' dateCol=${comm.dateCol} amtCol=${comm.amtCol} rows=${comm.rows.length}`);

    // 5) Write SpendData (sorted by date then category).
    flat.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].localeCompare(b[1])));
    const header = ["Date", "Category", "Component", "Employee ID", "Employee Name", "Amount"];
    await writeTab(sheets, FORECAST_SHEET_ID, "SpendData", [header, ...flat]);

    // 6) Write the Daily Snapshot view (formulas, USER_ENTERED). Date-range cells B1:B2.
    await ensureTab(sheets, FORECAST_SHEET_ID, "Daily Snapshot");
    await sheets.spreadsheets.values.clear({ spreadsheetId: FORECAST_SHEET_ID, range: "Daily Snapshot" });
    const q = (sel) => `=IFERROR(QUERY(SpendData!A2:F, "${sel}", 0), "no data")`;
    const rangeWhere = "where A >= date '\"&TEXT($B$1,\"yyyy-mm-dd\")&\"' and A <= date '\"&TEXT($B$2,\"yyyy-mm-dd\")&\"'";
    const view = [
      ["Start Date", "=MIN(SpendData!A2:A)"],
      ["End Date", "=MAX(SpendData!A2:A)"],
      [],
      ["Daily spend by category (dates across):"],
      [q(`select B, sum(F) ${rangeWhere} group by B pivot A`)],
      [],
      ["Category totals (in selected range | overall):"],
      ["Category", "In Range", "Overall"],
      [q(`select B, sum(F) ${rangeWhere} group by B label sum(F) ''`).replace("A2:F", "A2:F") ],
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: FORECAST_SHEET_ID, range: "Daily Snapshot!A1",
      valueInputOption: "USER_ENTERED", requestBody: { values: view },
    });
    console.log(`forecast: wrote ${flat.length} SpendData rows + Daily Snapshot view`);
  },
);
```

- [ ] **Step 3: Validate syntax**

Run: `cd firebase/functions && node --check index.js`
Expected: no output (valid).

- [ ] **Step 4: Full test suite still green**

Run: `cd firebase/functions && npm test`
Expected: all pass (existing + new forecast tests).

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): exportForecastSpend — SpendData + Daily Snapshot view"
```

---

### Task 7: Deploy + first-run verification

**Files:** none (operational).

- [ ] **Step 1: Deploy**

Run: `firebase deploy --only functions:exportForecastSpend`
Expected: successful create. (Reauth in a real terminal first if the token expired.)

- [ ] **Step 2: Trigger a manual run**

Force-run the scheduled function (Cloud Console → Cloud Scheduler → run `exportForecastSpend`, or `gcloud scheduler jobs run`), then read logs.

- [ ] **Step 3: Read logs — confirm access + tag reconciliation**

Run: `firebase functions:log --only exportForecastSpend` (or the MCP `functions_get_logs`).
Confirm: no write-403 (Forecasting share OK); note any "tags not found" warnings; confirm the Communication tab auto-detect line (tab name + columns). Feed warnings back to reconcile tag spellings.

- [ ] **Step 4: Eyeball the sheet**

Open the Forecasting sheet: `SpendData` populated, `Daily Snapshot` renders a category×date grid + range/overall totals. Adjust the view formulas per user review.

## Self-Review

**Spec coverage:** Firestore Manpower (T4) ✓; MDD standalone categories 2–21 (T1 catalog + T3 bucketer) ✓; Special Allowance per-employee (T3 + T6 resolver) ✓; Welfare lump into Manpower (T6 officeResolve) ✓; PF/ESI positive (T4) ✓; Category 22 Communication auto-detect (T5 + T6) ✓; tag-not-found warnings (T6) ✓; flat SpendData + Daily Snapshot view (T6) ✓; nightly after dailySpend (T6 schedule 23:15) ✓; deploy + first-run verification (T7) ✓.

**Placeholder scan:** none — every step has full code.

**Type consistency:** flat row `[date,category,component,empId,empName,amount]` identical across T3/T4/T5/T6; `resolve` returns `{category,component,perEmployee}` consistently; `bucketMddTab` returns `{rows,seenTags}` used in T6.

**Known follow-ups (not blockers):** the Daily Snapshot QUERY formulas are a *starter* view for the user to refine on the real sheet (per "I'll review the actual sheet"); the "monthly running total" is expressible as an additional QUERY once the user confirms the layout they want.
