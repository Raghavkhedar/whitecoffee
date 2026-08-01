# Forecast Entry Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty 22×12 `Forecast` grid with a `Forecast FY26-27` tab the operations manager types into — per-month blocks holding a per-employee Manpower grid and 20 line-item rows per category — and align the actuals-side category names to his wording so forecast and actual can be compared.

**Architecture:** All row-building, formula arithmetic, roster filtering and bank-ledger bucketing goes into the existing pure module `firebase/functions/forecastSpend.js` (no I/O, unit-tested with `node --test`). `index.js` keeps only the Sheets/Firestore I/O and calls the pure functions, mirroring how `exportForecastSpend` already works.

**Tech Stack:** Firebase Functions v2 `onSchedule`, Firestore Admin SDK, `googleapis` Sheets v4, CommonJS, `node --test`.

## Global Constraints

- CommonJS (`require`), Node 24 runtime. **No new npm deps.**
- Validate with `node --check` + `npm test` from `firebase/functions/`. **Do NOT run eslint** — the config is stale and parse-errors on modern JS like `?.`.
- Flat row shape everywhere: `[date, category, component, employeeId, employeeName, amount]`, date = `"yyyy-mm-dd"`.
- Forecasting sheet id: `1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo`
- MDD sheet id: `1rsmpHOeOeVBG8XzIFZlnEAa2pzyxr4S0UYOYGyulFyQ` — **never written to, read-only.**
- Bank ledger sheet id: `10-8a0KmY7BI21mG5d3LuTPXHL0L-WJ7Zkj6Dfp9kvrA` — **read-only.**
- **MDD tag KEYS in `VENDOR_CATEGORIES` / `OFFICE_CATEGORIES` are never edited.** They match live ledger data. Only the category VALUES change.
- **Employee Welfare & Retention stays folded into `Manpower Expense`.** The special case in `officeResolve` (`index.js:452-454`) is not touched, and `EMP Welfare & Retention` is NOT a category.
- The forecast catalog is **23 categories**: `"Manpower Expense"` plus the 22 in `STANDALONE_CATEGORIES`.
- Manpower component column headers are exactly: `Salary`, `Convy`, `Incentive`, `OT/WO`, `PF`, `ESI`, `Special Allow`. **`Incentive` is the renamed Imprest and appears only here** — no Firestore field, admin UI, or Android rename.
- Forecast tab is **pure input**: every Amount input cell is `""` (empty string), never `0`.
- The tab is written **once**. If `A1` has content, log and return without writing.

## File Structure

- Modify `firebase/functions/forecastSpend.js` — rename category values; add `bucketBankRental`, `forecastRoster`, `fiscalYearLabel`, `buildForecastTemplate` and their constants; export them all.
- Modify `firebase/functions/forecastSpend.test.js` — update existing assertions for renamed values; add suites for the new functions.
- Modify `firebase/functions/index.js` — read the bank ledger, feed rental rows into `flat`, replace step 7 with the FY tab generation.

---

### Task 1: Rename category values, add Rental of Space

**Files:**
- Modify: `firebase/functions/forecastSpend.js:11-41` (the two tag maps), `:165` (`bucketCommunication`), `:170-178` (`STANDALONE_CATEGORIES`)
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `STANDALONE_CATEGORIES` — a 22-element array of the new category names, in the order below. Tasks 3 and 4 depend on this exact array and order.

- [ ] **Step 1: Update the failing assertions in the test file first**

Search `forecastSpend.test.js` for every old category string and replace with the new one. The complete rename table — old on the left, new on the right:

| Old | New |
|---|---|
| `Tool Purchase` | `Tools Purchase` |
| `Transporter Purchases` | `Transporter Purchase` |
| `Welfare (Celebrations)` | `Celebration` |
| `Office Cleaning Eqp. & Exp.` | `Office Cleaning` |
| `Subscription – Cloud` | `Subscription CLOUD` |
| `Subscription – Job Portal` | `Subscription Job Portal` |
| `Pantry / House Keeping` | `Pantry/House Cleaning` |
| `OH (Overhead)` | `Overhead` |
| `Sales & Adv Expenses` | `Sale & Adv Expenses` |
| `Comm Expenses` | `Communication Expenses` |

These are unchanged, do not touch them: `Client/Vendor Ent Expense`, `Electricity`, `Asset Repair`, `Tool Repair`, `Material Repair`, `Core Asset`, `Asset Purchase`, `Purchase Stock`, `Stationery`, `Training Expense`, `Maint. of Building`, `Manpower Expense`.

Note `Subscription – Cloud` and `Subscription – Job Portal` contain an **EN-DASH (–)**, not a hyphen. The new names have no dash at all.

- [ ] **Step 2: Run the tests to verify they now fail**

```bash
cd firebase/functions && npm test
```

Expected: FAIL — assertions compare new expected names against old produced names.

- [ ] **Step 3: Rename the values in the two tag maps**

Replace the whole `VENDOR_CATEGORIES` block:

```js
// Vendor Payment tab tags → standalone category names.
const VENDOR_CATEGORIES = {
  [normTag("Tool")]: "Tools Purchase",
  [normTag("Core Asset")]: "Core Asset",
  [normTag("Asset")]: "Asset Purchase",
  [normTag("Material Repair")]: "Material Repair",
  [normTag("Transporter Purchase")]: "Transporter Purchase",
  [normTag("Stock")]: "Purchase Stock",
};
```

Replace the whole `OFFICE_CATEGORIES` block. **The keys are byte-for-byte unchanged** — only the values on the right differ:

```js
// Office Expense tab tags → standalone category names.
// NOTE: "Employee Welfare & Retention" is intentionally absent — it routes into Manpower
// (a lump line), handled by the integration's officeResolve, not here.
const OFFICE_CATEGORIES = {
  // Confirmed present in the Office Expense tab — exact tag strings from the live data.
  [normTag("asset repair")]: "Asset Repair",
  [normTag("overhead")]: "Overhead",
  [normTag("cleaning eq")]: "Office Cleaning",
  [normTag("subscription – hr related")]: "Subscription Job Portal", // NOTE: en-dash (–), not hyphen
  [normTag("customer entertainment expenses")]: "Client/Vendor Ent Expense",
  [normTag("stationery")]: "Stationery",
  [normTag("celebration")]: "Celebration",
  // Not yet present in the data — best-guess spellings; will match once such rows appear.
  [normTag("Electricity")]: "Electricity",
  [normTag("Tool Repair")]: "Tool Repair",
  [normTag("Training Exp.")]: "Training Expense",
  [normTag("Subscription - CLOUD")]: "Subscription CLOUD",
  [normTag("Building/General Maintenance (Electrical / Plumbing / Painting / Deep Cleaning)")]: "Maint. of Building",
  [normTag("Chai / Biscuit / Tissue / Disposable")]: "Pantry/House Cleaning",
  [normTag("Expense Related to Sales and Advertisement")]: "Sale & Adv Expenses",
};
```

- [ ] **Step 4: Rename the category emitted by `bucketCommunication`**

In `bucketCommunication`, change the pushed row's category:

```js
    rows.push([date, "Communication Expenses", "", "", "", amount]);
```

- [ ] **Step 5: Replace `STANDALONE_CATEGORIES` with the new 22-entry list**

The order matters — it is the display order of the forecast tab and of the dense `Daily Snapshot` rows:

```js
// The 22 standalone categories in display order (categories 2..23 of the forecast catalog).
// Manpower Expense (category 1) is NOT here — it is expanded per employee × component.
const STANDALONE_CATEGORIES = [
  "Purchase Stock", "Electricity", "Asset Repair", "Tool Repair", "Communication Expenses",
  "Material Repair", "Transporter Purchase", "Celebration", "Stationery", "Office Cleaning",
  "Core Asset", "Asset Purchase", "Training Expense", "Subscription CLOUD",
  "Subscription Job Portal", "Maint. of Building", "Pantry/House Cleaning", "Tools Purchase",
  "Overhead", "Rental of Space", "Sale & Adv Expenses", "Client/Vendor Ent Expense",
];
```

`Rental of Space` is new and has no tag mapping in either tag map — that is correct. Its rows come from the bank ledger in Task 2, so it stays at zero until that lands.

- [ ] **Step 6: Add a test pinning the catalog**

Add to `forecastSpend.test.js`:

```js
test("STANDALONE_CATEGORIES has 22 entries, no duplicates, and includes Rental of Space", () => {
  assert.equal(f.STANDALONE_CATEGORIES.length, 22);
  assert.equal(new Set(f.STANDALONE_CATEGORIES).size, 22);
  assert.ok(f.STANDALONE_CATEGORIES.includes("Rental of Space"));
});

test("every tag map value is a known standalone category", () => {
  const known = new Set(f.STANDALONE_CATEGORIES);
  for (const v of Object.values(f.VENDOR_CATEGORIES)) assert.ok(known.has(v), `unknown vendor category: ${v}`);
  for (const v of Object.values(f.OFFICE_CATEGORIES)) assert.ok(known.has(v), `unknown office category: ${v}`);
});
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd firebase/functions && node --check forecastSpend.js && npm test
```

Expected: PASS, all tests.

- [ ] **Step 8: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "refactor(forecast): rename categories to the manager's wording, add Rental of Space"
```

---

### Task 2: Bank-ledger rental bucketing

**Files:**
- Modify: `firebase/functions/forecastSpend.js` (add `bucketBankRental` after `bucketCommunication`, export it)
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Consumes: `normTag`, `findCol`, `parseDate`, `parseAmount` — all already in the module. `"Rental of Space"` from Task 1's `STANDALONE_CATEGORIES`.
- Produces: `bucketBankRental({ values }) -> { rows, dateCol, amtCol, tagCols, matched }` where `rows` is an array of flat rows and `matched` counts tag-matching rows before date/amount filtering. Task 4 calls this once per bank tab.

The bank ledger's header row is row 0 (unlike the MDD tabs, which use `findHeaderRow`). Its columns, as read from the live sheet on 2026-08-01:

`Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance | Payee | ID (EMP,VEN,OTH) | comments | Comments 2 | Payment Tag | Receipt Tag | CR triggred | bill done | INVOICE RECEIVED`

- [ ] **Step 1: Write the failing tests**

Add to `forecastSpend.test.js`:

```js
const BANK_HEADER = ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.",
  "Deposit Amt.", "Closing Balance", "Payee", "ID (EMP,VEN,OTH)", "comments", "Comments 2",
  "Payment Tag", "Receipt Tag", "CR triggred", "bill done", "INVOICE RECEIVED"];

const bankRow = ({ date = "01/04/2026", wd = "", dep = "", pay = "", rec = "" }) => {
  const r = new Array(16).fill("");
  r[0] = date; r[4] = wd; r[5] = dep; r[11] = pay; r[12] = rec;
  return r;
};

test("bucketBankRental matches on the Payment Tag column", () => {
  const out = f.bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "25000", pay: "Rental" })] });
  assert.deepEqual(out.rows, [["2026-04-01", "Rental of Space", "", "", "", 25000]]);
  assert.equal(out.matched, 1);
});

test("bucketBankRental matches on the Receipt Tag column too", () => {
  const out = f.bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "30000", rec: "Rental of Space" })] });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0][5], 30000);
});

test("bucketBankRental matches case-insensitively and as a substring", () => {
  const out = f.bucketBankRental({ values: [
    BANK_HEADER,
    bankRow({ wd: "1", pay: "  OFFICE RENTAL  " }),
    bankRow({ wd: "2", pay: "rental of space" }),
  ] });
  assert.equal(out.rows.length, 2);
});

test("bucketBankRental ignores rows whose tags do not mention rental", () => {
  const out = f.bucketBankRental({ values: [
    BANK_HEADER,
    bankRow({ wd: "500", pay: "Electricity" }),
    bankRow({ wd: "600", rec: "Salary" }),
  ] });
  assert.deepEqual(out.rows, []);
  assert.equal(out.matched, 0);
});

test("bucketBankRental takes Withdrawal Amt. and ignores Deposit Amt.", () => {
  const out = f.bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "9000", dep: "4000", pay: "Rental" })] });
  assert.equal(out.rows[0][5], 9000);
});

test("bucketBankRental skips a matched row with no withdrawal amount", () => {
  const out = f.bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "", dep: "5000", pay: "Rental" })] });
  assert.deepEqual(out.rows, []);
  assert.equal(out.matched, 1, "counted as matched even though it produced no row");
});

test("bucketBankRental returns zero rows when a required column is missing", () => {
  const header = BANK_HEADER.slice();
  header[4] = "Debit Amount";               // no /withdrawal/ header any more
  const out = f.bucketBankRental({ values: [header, bankRow({ wd: "25000", pay: "Rental" })] });
  assert.deepEqual(out.rows, []);
  assert.equal(out.amtCol, -1);
});

test("bucketBankRental tolerates empty input", () => {
  assert.deepEqual(f.bucketBankRental({ values: [] }).rows, []);
  assert.deepEqual(f.bucketBankRental({}).rows, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd firebase/functions && npm test
```

Expected: FAIL with `f.bucketBankRental is not a function`.

- [ ] **Step 3: Implement `bucketBankRental`**

Add after `bucketCommunication`:

```js
// Bank-ledger tabs (Bank, TBPR) → the "Rental of Space" category. A row counts as rent when
// EITHER tag column mentions "rental" (trimmed, case-insensitive substring), so "Rental",
// "Rental of Space" and "Office Rental" all match. Amount is the gross Withdrawal — deposits
// are NOT netted off. Columns are located by header name because this is a bank export whose
// column order can shift. `matched` counts tag hits before the date/amount filter, so the
// caller can tell "no rent rows" apart from "rent rows we could not parse".
function bucketBankRental({ values }) {
  const rows = [];
  if (!Array.isArray(values) || values.length === 0) {
    return { rows, dateCol: -1, amtCol: -1, tagCols: [], matched: 0 };
  }
  const header = values[0] || [];
  const dateCol = findCol(header, [/^\s*date\s*$/i]);
  const amtCol = findCol(header, [/withdrawal/i]);
  const tagCols = [findCol(header, [/payment tag/i]), findCol(header, [/receipt tag/i])]
    .filter((c) => c >= 0);
  if (dateCol < 0 || amtCol < 0 || tagCols.length === 0) {
    return { rows, dateCol, amtCol, tagCols, matched: 0 };
  }
  let matched = 0;
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    if (!tagCols.some((c) => normTag(r[c]).includes("rental"))) continue;
    matched++;
    const date = parseDate(r[dateCol]);
    const amount = parseAmount(r[amtCol]);
    if (!date || amount === 0) continue;
    rows.push([date, "Rental of Space", "", "", "", amount]);
  }
  return { rows, dateCol, amtCol, tagCols, matched };
}
```

- [ ] **Step 4: Export it**

Add `bucketBankRental` to the `module.exports` object.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd firebase/functions && node --check forecastSpend.js && npm test
```

Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(forecast): bucket Rental of Space from the bank ledger"
```

---

### Task 3: Roster filter, FY label, and the template builder

**Files:**
- Modify: `firebase/functions/forecastSpend.js` (add constants and three functions at the end, before `module.exports`)
- Test: `firebase/functions/forecastSpend.test.js`

**Interfaces:**
- Consumes: `STANDALONE_CATEGORIES` and `fiscalYearMonths` from the module.
- Produces, all called by Task 4:
  - `forecastRoster(users) -> { employees: [{id, name}], duplicates: [id] }`
  - `fiscalYearLabel(anchorISO) -> "FY26-27"`
  - `buildForecastTemplate({ employees, months, categories }) -> rows` (array of 12-cell arrays)

**Layout contract.** 12 columns, header row first, then one block per month:

| Col | A | B | C | D | E–K | L |
|---|---|---|---|---|---|---|
| | Category / Line Item | Month | Amount | Type | Salary · Convy · Incentive · OT/WO · PF · ESI · Special Allow | Emp ID |

Per month: `HEADER`, `GRID_HEAD`, N `EMP` rows, 8 blank `EMP` rows, Manpower `SUBTOTAL`, then for each of the 22 categories `HEADER` + 20 `ITEM` + `SUBTOTAL`, then one `TOTAL`. That is `N + 496` rows per month.

- [ ] **Step 1: Write the failing tests**

Add to `forecastSpend.test.js`:

```js
const USERS = [
  { employeeId: "S243", name: "Arvind" },
  { employeeId: "S369", name: "Vishnu" },
  { employeeId: "S369A", name: "Vishnu kumar" },
  { employeeId: "TEST001", name: "Test" },
  { employeeId: "EMP001", name: "Test" },
  { employeeId: "ADMIN-INFO", name: "Admin" },
  { employeeId: "S1", name: "Pinky" },
];

test("forecastRoster drops test and admin accounts", () => {
  const { employees } = f.forecastRoster(USERS);
  const ids = employees.map((e) => e.id);
  assert.ok(!ids.includes("TEST001"));
  assert.ok(!ids.includes("EMP001"));
  assert.ok(!ids.includes("ADMIN-INFO"));
});

test("forecastRoster keeps S369 and S369A as distinct people", () => {
  const ids = f.forecastRoster(USERS).employees.map((e) => e.id);
  assert.ok(ids.includes("S369"));
  assert.ok(ids.includes("S369A"));
});

test("forecastRoster sorts by name and reports duplicate ids", () => {
  const { employees, duplicates } = f.forecastRoster(
    USERS.concat([{ employeeId: "S243", name: "Arvind Duplicate" }]));
  assert.deepEqual(employees.map((e) => e.name), ["Arvind", "Pinky", "Vishnu", "Vishnu kumar"]);
  assert.deepEqual(duplicates, ["S243"]);
});

test("forecastRoster skips rows missing an id or a name", () => {
  const { employees } = f.forecastRoster([{ employeeId: "", name: "Nobody" }, { employeeId: "S9", name: "" }]);
  assert.deepEqual(employees, []);
});

test("fiscalYearLabel spans April to March", () => {
  assert.equal(f.fiscalYearLabel("2026-08-01"), "FY26-27");
  assert.equal(f.fiscalYearLabel("2026-04-01"), "FY26-27");
  assert.equal(f.fiscalYearLabel("2027-03-31"), "FY26-27");
  assert.equal(f.fiscalYearLabel("2026-03-31"), "FY25-26");
});

const EMPLOYEES = [{ id: "S243", name: "Arvind" }, { id: "S1", name: "Pinky" }];
const MONTHS = f.fiscalYearMonths("2026-08-01");
const build = () => f.buildForecastTemplate({ employees: EMPLOYEES, months: MONTHS });

test("buildForecastTemplate emits a header row plus N+496 rows per month", () => {
  const rows = build();
  assert.equal(rows.length, 1 + 12 * (EMPLOYEES.length + 496));
  assert.equal(rows[0][0], "Category / Line Item");
  assert.deepEqual(rows[0].slice(4, 12),
    ["Salary", "Convy", "Incentive", "OT/WO", "PF", "ESI", "Special Allow", "Emp ID"]);
});

test("buildForecastTemplate gives every row 12 cells and a valid Type", () => {
  const valid = new Set(["HEADER", "GRID_HEAD", "EMP", "ITEM", "SUBTOTAL", "TOTAL"]);
  const rows = build().slice(1);
  for (const r of rows) {
    assert.equal(r.length, 12);
    assert.ok(valid.has(r[3]), `bad Type: ${r[3]}`);
  }
});

test("buildForecastTemplate blocks the months in fiscal order", () => {
  const rows = build().slice(1);
  const seen = [];
  for (const r of rows) if (!seen.includes(r[1])) seen.push(r[1]);
  assert.deepEqual(seen, MONTHS);
  assert.equal(seen[0], "April 2026");
});

test("buildForecastTemplate leaves every input Amount cell empty, never zero", () => {
  for (const r of build().slice(1)) {
    if (r[3] === "ITEM") assert.equal(r[2], "");
    if (r[3] === "EMP") assert.ok(String(r[2]).startsWith("=SUM("));
    if (r[3] === "EMP" || r[3] === "ITEM") {
      for (let c = 4; c <= 10; c++) assert.equal(r[c], "");
    }
  }
});

test("buildForecastTemplate pads the employee grid with 8 blank rows", () => {
  const rows = build().slice(1);
  const april = rows.filter((r) => r[1] === "April 2026" && r[3] === "EMP");
  assert.equal(april.length, EMPLOYEES.length + 8);
  assert.deepEqual(april.slice(0, 2).map((r) => r[0]), ["Arvind", "Pinky"]);
  assert.deepEqual(april.slice(0, 2).map((r) => r[11]), ["S243", "S1"]);
  assert.equal(april[april.length - 1][0], "");
});

test("buildForecastTemplate gives each category a header, 20 items and a subtotal", () => {
  const rows = build().slice(1).filter((r) => r[1] === "April 2026");
  for (const cat of f.STANDALONE_CATEGORIES) {
    const start = rows.findIndex((r) => r[3] === "HEADER" && r[0] === cat);
    assert.ok(start >= 0, `no header for ${cat}`);
    const block = rows.slice(start + 1, start + 22);
    assert.equal(block.filter((r) => r[3] === "ITEM").length, 20, `wrong item count for ${cat}`);
    assert.equal(block[20][3], "SUBTOTAL");
    assert.equal(block[20][0], `${cat} —Total`);
  }
});

test("each SUBTOTAL sums exactly its own block and nothing else", () => {
  const rows = build();                               // includes the header row, so index+1 = sheet row
  const rowNumOf = (i) => i + 1;
  rows.forEach((r, i) => {
    if (r[3] !== "SUBTOTAL") return;
    const m = String(r[2]).match(/^=SUM\(C(\d+):C(\d+)\)$/);
    assert.ok(m, `subtotal formula not a C-range: ${r[2]}`);
    const [first, last] = [Number(m[1]), Number(m[2])];
    assert.ok(first < last, "range runs forwards");
    assert.equal(last, rowNumOf(i) - 1, "range ends on the row directly above the subtotal");
    const covered = rows.slice(first - 1, last);
    const kinds = new Set(covered.map((x) => x[3]));
    assert.ok(!kinds.has("HEADER") && !kinds.has("SUBTOTAL") && !kinds.has("TOTAL"),
      `range for ${r[0]} spills outside its block: ${[...kinds].join(",")}`);
    assert.equal(new Set(covered.map((x) => x[1])).size, 1, "range stays inside one month");
  });
});

test("the grand total lists every subtotal cell explicitly and uses no ranges", () => {
  const rows = build();
  const totals = rows.filter((r) => r[3] === "TOTAL");
  assert.equal(totals.length, 12);
  for (const t of totals) {
    assert.equal(t[0], "GRAND TOTAL");
    assert.ok(!String(t[2]).includes(":"), `grand total must not use a range: ${t[2]}`);
    const cells = String(t[2]).match(/C\d+/g) || [];
    assert.equal(cells.length, 23, "23 categories = 23 subtotal cells");
    for (const c of cells) {
      assert.equal(rows[Number(c.slice(1)) - 1][3], "SUBTOTAL", `${c} is not a subtotal row`);
    }
  }
});

test("the forecast catalog matches the actuals catalog exactly", () => {
  const rows = build().slice(1).filter((r) => r[1] === "April 2026" && r[3] === "HEADER");
  assert.deepEqual(rows.map((r) => r[0]), ["Manpower Expense", ...f.STANDALONE_CATEGORIES]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd firebase/functions && npm test
```

Expected: FAIL with `f.forecastRoster is not a function`.

- [ ] **Step 3: Add the constants**

```js
// Forecast entry tab layout. Column order: A Category/Line Item, B Month, C Amount, D Type,
// E..K the seven Manpower components, L Emp ID.
const FORECAST_COMPONENTS = ["Salary", "Convy", "Incentive", "OT/WO", "PF", "ESI", "Special Allow"];
const FORECAST_HEADER = ["Category / Line Item", "Month", "Amount", "Type", ...FORECAST_COMPONENTS, "Emp ID"];
const FORECAST_COLS = FORECAST_HEADER.length;   // 12
const BLANK_EMP_ROWS = 8;                       // spare rows so the manager can add joiners himself
const ITEM_ROWS = 20;                           // blank line-item rows under each standalone category
// Accounts that exist in `users` but are not real employees to forecast against.
const NON_EMPLOYEE_IDS = new Set(["EMP001", "TEST001", "TEST002", "TEST003", "ADMIN-INFO"]);
```

- [ ] **Step 4: Implement `forecastRoster` and `fiscalYearLabel`**

```js
// users → the employees worth forecasting: real accounts only, name-sorted, ids unique.
// Sorting happens BEFORE de-duplication so "first wins" is deterministic by name, not by
// whatever order Firestore returned. S369 and S369A are different people — de-duplication is
// on the exact id, never a prefix.
function forecastRoster(users) {
  const cleaned = (users || [])
    .map((u) => ({
      id: String(u && u.employeeId != null ? u.employeeId : "").trim(),
      name: String(u && u.name != null ? u.name : "").trim(),
    }))
    .filter((u) => u.id && u.name && !NON_EMPLOYEE_IDS.has(u.id.toUpperCase()));
  cleaned.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
  const seen = new Set();
  const employees = [];
  const duplicates = [];
  cleaned.forEach((u) => {
    if (seen.has(u.id)) { duplicates.push(u.id); return; }
    seen.add(u.id);
    employees.push(u);
  });
  return { employees, duplicates };
}

// "FY26-27" for the fiscal year (April–March) containing anchorISO.
function fiscalYearLabel(anchorISO) {
  const [y, m] = String(anchorISO).split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
```

- [ ] **Step 5: Implement `buildForecastTemplate`**

```js
// Build the whole Forecast entry tab: a header row, then one block per month. Every Amount the
// manager is meant to type is "" (empty), never 0 — an untouched row must read as "not forecast"
// rather than as a genuine forecast of zero. Only the totals carry formulas, with absolute row
// numbers resolved here; row 1 is the header, so a row at array index i is sheet row i + 1.
function buildForecastTemplate({ employees, months, categories }) {
  const cats = categories || STANDALONE_CATEGORIES;
  const emps = employees || [];
  const rows = [FORECAST_HEADER.slice()];
  const blank = () => new Array(FORECAST_COLS).fill("");
  const sheetRow = () => rows.length + 1;          // the row number the NEXT push will occupy

  (months || []).forEach((month) => {
    const subtotalCells = [];
    const push = (cells) => { rows.push(cells); };

    // ── Manpower: a per-employee grid, one column per component ──────────────
    const head = blank();
    head[0] = "Manpower Expense"; head[1] = month; head[3] = "HEADER";
    push(head);

    const grid = blank();
    grid[0] = "Emp Name"; grid[1] = month; grid[2] = "Row Total"; grid[3] = "GRID_HEAD";
    FORECAST_COMPONENTS.forEach((c, i) => { grid[4 + i] = c; });
    grid[11] = "Emp ID";
    push(grid);

    const firstEmp = sheetRow();
    const empRow = (name, id) => {
      const r = blank();
      const n = sheetRow();
      r[0] = name; r[1] = month; r[2] = `=SUM(E${n}:K${n})`; r[3] = "EMP"; r[11] = id;
      push(r);
    };
    emps.forEach((e) => empRow(e.name, e.id));
    for (let i = 0; i < BLANK_EMP_ROWS; i++) empRow("", "");
    const lastEmp = sheetRow() - 1;

    subtotalCells.push(`C${sheetRow()}`);
    const mpTotal = blank();
    mpTotal[0] = "Manpower Expense —Total"; mpTotal[1] = month;
    mpTotal[2] = `=SUM(C${firstEmp}:C${lastEmp})`; mpTotal[3] = "SUBTOTAL";
    push(mpTotal);

    // ── Standalone categories: blank line items the manager fills in ─────────
    cats.forEach((cat) => {
      const h = blank();
      h[0] = cat; h[1] = month; h[3] = "HEADER";
      push(h);

      const firstItem = sheetRow();
      for (let i = 0; i < ITEM_ROWS; i++) {
        const r = blank();
        r[1] = month; r[3] = "ITEM";
        push(r);
      }
      const lastItem = sheetRow() - 1;

      subtotalCells.push(`C${sheetRow()}`);
      const s = blank();
      s[0] = `${cat} —Total`; s[1] = month;
      s[2] = `=SUM(C${firstItem}:C${lastItem})`; s[3] = "SUBTOTAL";
      push(s);
    });

    // ── Month grand total: the subtotal cells listed one by one. A range here
    //    would swallow the very subtotals it spans and double-count them. ─────
    const grand = blank();
    grand[0] = "GRAND TOTAL"; grand[1] = month;
    grand[2] = `=SUM(${subtotalCells.join(",")})`; grand[3] = "TOTAL";
    push(grand);
  });

  return rows;
}
```

- [ ] **Step 6: Export the new surface**

Add to `module.exports`: `forecastRoster`, `fiscalYearLabel`, `buildForecastTemplate`, `FORECAST_HEADER`, `FORECAST_COMPONENTS`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd firebase/functions && node --check forecastSpend.js && npm test
```

Expected: PASS, all tests.

- [ ] **Step 8: Commit**

```bash
git add firebase/functions/forecastSpend.js firebase/functions/forecastSpend.test.js
git commit -m "feat(forecast): build the forecast entry template and roster filter"
```

---

### Task 4: Wire the bank ledger and the FY tab into the export

**Files:**
- Modify: `firebase/functions/index.js:100` (sheet id constants), `:441-464` (tab reads and bucketing), `:510-526` (step 7)

**Interfaces:**
- Consumes: `forecast.bucketBankRental`, `forecast.forecastRoster`, `forecast.fiscalYearLabel`, `forecast.buildForecastTemplate` from Task 2 and Task 3.
- Produces: nothing — this is the outermost layer.

Read the surrounding function first. `exportForecastSpend` starts at `index.js:417`. It already has `sheets`, `db`, a `readTab` helper, a `todayIST` value, and the `flat` row array in scope. Do not restructure it.

- [ ] **Step 1: Add the bank ledger sheet id**

Beside the existing `FORECAST_SHEET_ID` / `MDD_SHEET_ID` constants near `index.js:100`:

```js
// Bank-statement ledger — the ONLY source for the "Rental of Space" category. Read-only.
const BANK_SHEET_ID = "10-8a0KmY7BI21mG5d3LuTPXHL0L-WJ7Zkj6Dfp9kvrA";
```

- [ ] **Step 2: Read the two bank tabs and bucket them**

After the existing `const comm = forecast.bucketCommunication(commVals);` line, and before `flat.push(...)`, add:

```js
    // Rental of Space lives in a separate bank-statement ledger, not MDD. Two tabs; the third
    // tab there is a flagged-exceptions sheet and is deliberately not read. A failure to read
    // it must not take the whole export down — rent is one category out of 23.
    let rentalRows = [];
    try {
      const bankVals = await Promise.all(["Bank", "TBPR"].map(async (tab) => {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: BANK_SHEET_ID, range: tab });
        return res.data.values || [];
      }));
      bankVals.forEach((values, i) => {
        const b = forecast.bucketBankRental({ values });
        rentalRows = rentalRows.concat(b.rows);
        console.log(`forecast: bank tab '${["Bank", "TBPR"][i]}' dateCol=${b.dateCol} amtCol=${b.amtCol} ` +
          `tagCols=[${b.tagCols.join(",")}] matched=${b.matched} rows=${b.rows.length}`);
      });
    } catch (e) {
      console.error(`forecast: bank ledger read FAILED (Rental of Space will be 0): ${e.message}`);
    }
```

Then extend the existing push to include them:

```js
    flat.push(...vendor.rows, ...office.rows, ...comm.rows, ...rentalRows);
```

- [ ] **Step 3: Replace step 7 with the FY entry tab**

Replace the whole block from the `// 7) Forecast entry template` comment through its closing `}` (currently `index.js:510-526`) with:

```js
    // 7) Forecast entry tab — the manager types his forecast here: a per-employee Manpower grid
    // plus 20 blank line-item rows per category, one block per fiscal month. Created ONCE and
    // never overwritten: if the tab already has content (his entries), we leave it alone.
    const fyTab = `Forecast ${forecast.fiscalYearLabel(todayIST)}`;
    await ensureTab(sheets, FORECAST_SHEET_ID, fyTab);
    const existingForecast = await sheets.spreadsheets.values.get({
      spreadsheetId: FORECAST_SHEET_ID, range: `${fyTab}!A1`,
    });
    if (!existingForecast.data.values || existingForecast.data.values.length === 0) {
      // Read the roster only when we are actually going to write — on every later run this
      // branch is skipped and the Firestore read never happens.
      const usersSnap = await db.collection("users").get();
      const { employees, duplicates } = forecast.forecastRoster(usersSnap.docs.map((d) => d.data()));
      if (duplicates.length) {
        console.warn(`forecast: duplicate employee ids collapsed to one row: ${duplicates.join(", ")}`);
      }
      const template = forecast.buildForecastTemplate({
        employees, months: forecast.fiscalYearMonths(todayIST),
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: FORECAST_SHEET_ID, range: `${fyTab}!A1`,
        valueInputOption: "USER_ENTERED", requestBody: { values: template },
      });
      console.log(`forecast: created '${fyTab}' — ${template.length} rows, ` +
        `${employees.length} employees × 12 months`);
    } else {
      console.log(`forecast: '${fyTab}' already has content — left untouched`);
    }
```

**Notes on the surrounding scope.** `exportForecastSpend` does NOT currently read `users` — the read above is new, and belongs inside the `if` so it is skipped on every run after the first. `todayIST` is already defined at `index.js:482`, above this block, so it is in scope. `db`, `sheets`, and `ensureTab` are all in scope too. The `users` documents carry `employeeId` and `name` fields, which is exactly what `forecastRoster` expects — pass `d.data()` through unchanged.

- [ ] **Step 4: Verify the file parses and the suite still passes**

```bash
cd firebase/functions && node --check index.js && npm test
```

Expected: PASS. `index.js` has no unit tests of its own; this confirms it parses and that nothing in the pure module regressed.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(forecast): read the bank ledger and write the FY forecast entry tab"
```

---

## Deployment (manual, not agent work)

Requires `firebase login --reauth` from a real terminal — the `!` prefix will not work for it.

- [ ] Deploy: `firebase deploy --only functions:exportForecastSpend`
- [ ] Force-run the Cloud Scheduler job `firebase-schedule-exportForecastSpend-us-central1`
- [ ] Check the logs for: `bank tab 'Bank' …` lines with sensible column indices, no 403 on the bank sheet, and `created 'Forecast FY26-27'`
- [ ] Check the sheet: `Forecast FY26-27` exists, subtotals and the grand total evaluate to 0 (not `#REF!` or `#VALUE!`), `Daily Snapshot` shows the renamed categories and a `Rental of Space` line
- [ ] Force-run a second time and confirm the log says `already has content — left untouched`

## Out of scope

`dailySpend` is writing negative `Salary` and `OT amount` values (−2000, −1996, −1992 repeatedly across July 2026). Manpower actuals are understated until that is investigated. Do not attempt to fix it in this plan.
