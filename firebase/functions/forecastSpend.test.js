"use strict";

// Boundary suite for the pure forecast bucketing/parsing. Run: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normTag, findCol, parseAmount, parseDate,
  VENDOR_CATEGORIES, OFFICE_CATEGORIES, MANPOWER_COMPONENTS, STANDALONE_CATEGORIES,
  bucketMddTab, dailySpendToFlat, pickTabName, bucketCommunication, bucketBankRental,
  monthLabelOf, datesInRange, buildDailySnapshot, distinctTags, fiscalYearMonths,
  forecastRoster, fiscalYearLabel, buildForecastTemplate, FORECAST_HEADER, FORECAST_COMPONENTS,
} = require("./forecastSpend");

test("normTag trims, lowercases, collapses whitespace", () => {
  assert.equal(normTag("  Core   Asset "), "core asset");
  assert.equal(normTag("Subscription - CLOUD"), "subscription - cloud");
  assert.equal(normTag(null), "");
});

test("catalog maps known tags to category names", () => {
  assert.equal(VENDOR_CATEGORIES[normTag("Tool")], "Tools Purchase");
  assert.equal(VENDOR_CATEGORIES[normTag("Transporter Purchase")], "Transporter Purchase");
  assert.equal(OFFICE_CATEGORIES[normTag("Celebration")], "Celebration");
  assert.equal(OFFICE_CATEGORIES[normTag("stationery")], "Stationery");
  assert.equal(OFFICE_CATEGORIES[normTag("overhead")], "Overhead");
  assert.equal(OFFICE_CATEGORIES[normTag("cleaning eq")], "Office Cleaning");
  assert.equal(OFFICE_CATEGORIES[normTag("customer entertainment expenses")], "Client/Vendor Ent Expense");
  assert.equal(OFFICE_CATEGORIES[normTag("subscription – hr related")], "Subscription Job Portal");
  assert.equal(OFFICE_CATEGORIES[normTag("Employee Welfare & Retention")], undefined);
});

test("MANPOWER_COMPONENTS covers the seven firestore fields, sa last", () => {
  const fields = MANPOWER_COMPONENTS.map((c) => c[0]);
  assert.deepEqual(fields, ["salary", "conveyance", "imprest", "otWo", "pf", "esi", "sa"]);
  assert.deepEqual(MANPOWER_COMPONENTS[MANPOWER_COMPONENTS.length - 1], ["sa", "Special Allowance"]);
});

test("findCol locates a column by regex, case-insensitive, trimmed", () => {
  const header = ["Voucher No.", " Payment Date ", "tags", "Amount (₹)"];
  assert.equal(findCol(header, [/payment date/i, /^date$/i]), 1);
  assert.equal(findCol(header, [/^tags?$/i]), 2);
  assert.equal(findCol(header, [/amount|₹/i]), 3);
  assert.equal(findCol(header, [/nope/i]), -1);
});

test("parseAmount strips ₹/commas, keeps sign, junk→0", () => {
  assert.equal(parseAmount("1,586"), 1586);
  assert.equal(parseAmount("₹ 2,750.50"), 2750.5);
  assert.equal(parseAmount("-160"), -160);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount("NA"), 0);
  assert.equal(parseAmount(400), 400);
});

test("parseDate handles dd/mm/yyyy, dd-mm-yyyy, ISO, and Date", () => {
  assert.equal(parseDate("09/07/2026"), "2026-07-09");
  assert.equal(parseDate("13/07/2026"), "2026-07-13");
  assert.equal(parseDate("20-07-2026"), "2026-07-20");
  assert.equal(parseDate("2026-07-09"), "2026-07-09");
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("garbage"), null);
});

test("parseDate disambiguates mm-dd via the >12 field", () => {
  assert.equal(parseDate("07-13-2026"), "2026-07-13");
  assert.equal(parseDate("14-07-2026"), "2026-07-14");
});

const VENDOR_HEADER = ["Voucher No.", "Payment Date", "Invoice No.", "tags", "Particulars", "Vendor Name", "Vendor ID", "Amount (₹)", "Mode", "remark"];
const vendorResolve = (t) => {
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
    ["2026-07-09", "Tools Purchase", "", "", "", 1586],
    ["2026-07-10", "Asset Purchase", "", "", "", 400],
  ]);
  assert.ok(seenTags.has("unknownn"));
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

test("dailySpendToFlat: emits a Special Allowance row when a doc has sa", () => {
  const docs = [{ date: "2026-07-28", employeeId: "S271", name: "devendra", sa: 12000 }];
  assert.deepEqual(dailySpendToFlat(docs), [
    ["2026-07-28", "Manpower Expense", "Special Allowance", "S271", "devendra", 12000],
  ]);
});

test("dailySpendToFlat: emits NO Special Allowance row when sa is 0 or absent", () => {
  assert.deepEqual(dailySpendToFlat([{ date: "2026-07-28", employeeId: "S271", name: "devendra", sa: 0 }]), []);
  assert.deepEqual(dailySpendToFlat([{ date: "2026-07-28", employeeId: "S271", name: "devendra" }]), []);
});

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
    ["2026-07-09", "Communication Expenses", "", "", "", 220.8],
    ["2026-07-10", "Communication Expenses", "", "", "", 100],
  ]);
});

const BANK_HEADER = ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.",
  "Deposit Amt.", "Closing Balance", "Payee", "ID (EMP,VEN,OTH)", "comments", "Comments 2",
  "Payment Tag", "Receipt Tag", "CR triggred", "bill done", "INVOICE RECEIVED"];

const bankRow = ({ date = "01/04/2026", wd = "", dep = "", pay = "", rec = "" }) => {
  const r = new Array(16).fill("");
  r[0] = date; r[4] = wd; r[5] = dep; r[11] = pay; r[12] = rec;
  return r;
};

test("bucketBankRental matches on the Payment Tag column", () => {
  const out = bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "25000", pay: "Rental" })] });
  assert.deepEqual(out.rows, [["2026-04-01", "Rental of Space", "", "", "", 25000]]);
  assert.equal(out.matched, 1);
});

test("bucketBankRental matches on the Receipt Tag column too", () => {
  const out = bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "30000", rec: "Rental of Space" })] });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0][5], 30000);
});

test("bucketBankRental matches case-insensitively and as a substring", () => {
  const out = bucketBankRental({ values: [
    BANK_HEADER,
    bankRow({ wd: "1", pay: "  OFFICE RENTAL  " }),
    bankRow({ wd: "2", pay: "rental of space" }),
  ] });
  assert.equal(out.rows.length, 2);
});

test("bucketBankRental ignores rows whose tags do not mention rental", () => {
  const out = bucketBankRental({ values: [
    BANK_HEADER,
    bankRow({ wd: "500", pay: "Electricity" }),
    bankRow({ wd: "600", rec: "Salary" }),
  ] });
  assert.deepEqual(out.rows, []);
  assert.equal(out.matched, 0);
});

test("bucketBankRental takes Withdrawal Amt. and ignores Deposit Amt.", () => {
  const out = bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "9000", dep: "4000", pay: "Rental" })] });
  assert.equal(out.rows[0][5], 9000);
});

test("bucketBankRental skips a matched row with no withdrawal amount", () => {
  const out = bucketBankRental({ values: [BANK_HEADER, bankRow({ wd: "", dep: "5000", pay: "Rental" })] });
  assert.deepEqual(out.rows, []);
  assert.equal(out.matched, 1, "counted as matched even though it produced no row");
});

test("bucketBankRental returns zero rows when a required column is missing", () => {
  const header = BANK_HEADER.slice();
  header[4] = "Debit Amount";               // no /withdrawal/ header any more
  const out = bucketBankRental({ values: [header, bankRow({ wd: "25000", pay: "Rental" })] });
  assert.deepEqual(out.rows, []);
  assert.equal(out.amtCol, -1);
});

test("bucketBankRental tolerates empty input", () => {
  assert.deepEqual(bucketBankRental({ values: [] }).rows, []);
  assert.deepEqual(bucketBankRental({}).rows, []);
});

test("STANDALONE_CATEGORIES has the 22 non-Manpower categories", () => {
  assert.equal(STANDALONE_CATEGORIES.length, 22);
  assert.ok(!STANDALONE_CATEGORIES.includes("Manpower Expense"));
  assert.equal(STANDALONE_CATEGORIES[0], "Purchase Stock");
});

test("STANDALONE_CATEGORIES has 22 entries, no duplicates, and includes Rental of Space", () => {
  assert.equal(STANDALONE_CATEGORIES.length, 22);
  assert.equal(new Set(STANDALONE_CATEGORIES).size, 22);
  assert.ok(STANDALONE_CATEGORIES.includes("Rental of Space"));
});

test("every tag map value is a known standalone category", () => {
  const known = new Set(STANDALONE_CATEGORIES);
  for (const v of Object.values(VENDOR_CATEGORIES)) assert.ok(known.has(v), `unknown vendor category: ${v}`);
  for (const v of Object.values(OFFICE_CATEGORIES)) assert.ok(known.has(v), `unknown office category: ${v}`);
});

test("fiscalYearMonths: 12 labels April→March for the FY containing the anchor", () => {
  const fm = fiscalYearMonths("2026-07-01");
  assert.equal(fm.length, 12);
  assert.equal(fm[0], "April 2026");
  assert.equal(fm[8], "December 2026");
  assert.equal(fm[9], "January 2027");
  assert.equal(fm[11], "March 2027");
  // a date before April belongs to the previous fiscal year
  assert.equal(fiscalYearMonths("2026-02-15")[0], "April 2025");
});

test("monthLabelOf + datesInRange", () => {
  assert.equal(monthLabelOf("2026-07-21"), "July 2026");
  assert.deepEqual(datesInRange("2026-07-01", "2026-07-03"), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.deepEqual(datesInRange("", "2026-07-03"), []);
});

test("buildDailySnapshot: standalone dense with month/running totals incl. zero days", () => {
  const flat = [
    ["2026-07-01", "Electricity", "", "", "", 100],
    ["2026-07-03", "Electricity", "", "", "", 50],
  ];
  const out = buildDailySnapshot(flat, { standaloneCategories: ["Electricity"] });
  assert.deepEqual(out, [
    ["2026-07-01", "Electricity", "", "", "", "July 2026", 100, 100, 100],
    ["2026-07-02", "Electricity", "", "", "", "July 2026", 0, 100, 100],
    ["2026-07-03", "Electricity", "", "", "", "July 2026", 50, 150, 150],
  ]);
});

test("buildDailySnapshot: month total resets across a month boundary; running does not", () => {
  const flat = [
    ["2026-06-30", "Electricity", "", "", "", 10],
    ["2026-07-01", "Electricity", "", "", "", 5],
  ];
  const out = buildDailySnapshot(flat, { standaloneCategories: ["Electricity"] });
  // 06-30: month 10, run 10 ; 07-01: month resets → 5, run 15
  assert.deepEqual(out[0], ["2026-06-30", "Electricity", "", "", "", "June 2026", 10, 10, 10]);
  assert.deepEqual(out[1], ["2026-07-01", "Electricity", "", "", "", "July 2026", 5, 5, 15]);
});

test("distinctTags collects normalized tag-column values", () => {
  const values = [["Voucher", "Date", "tags", "Amount"],
    ["v", "1/1/2026", "Tool", "5"], ["v", "2/1/2026", "tool ", "6"], ["v", "3/1/2026", "", "7"]];
  assert.deepEqual(distinctTags(values), ["tool"]);
  assert.deepEqual(distinctTags([["a", "b"], ["1", "2"]]), []); // no tag column
});

test("buildDailySnapshot: Manpower sparse per employee×component, no zero-day rows", () => {
  const flat = [
    ["2026-07-01", "Manpower Expense", "Salary", "S1", "alice", 800],
    ["2026-07-03", "Manpower Expense", "Salary", "S1", "alice", 800],
    ["2026-07-01", "Manpower Expense", "PF", "S1", "alice", 96],
  ];
  const out = buildDailySnapshot(flat, { standaloneCategories: [] });
  assert.deepEqual(out, [
    ["2026-07-01", "Manpower Expense", "S1", "alice", "PF", "July 2026", 96, 96, 96],
    ["2026-07-01", "Manpower Expense", "S1", "alice", "Salary", "July 2026", 800, 800, 800],
    ["2026-07-03", "Manpower Expense", "S1", "alice", "Salary", "July 2026", 800, 1600, 1600],
  ]);
});

test("buildDailySnapshot: a single sparse Special Allowance row lands on its date only, no zero-fill on other days", () => {
  const flat = [
    ["2026-07-01", "Manpower Expense", "Salary", "S1", "alice", 800],
    ["2026-07-03", "Manpower Expense", "Salary", "S1", "alice", 800],
    ["2026-07-03", "Manpower Expense", "Special Allowance", "S1", "alice", 12000],
  ];
  const out = buildDailySnapshot(flat, { standaloneCategories: [] });
  const saRows = out.filter((r) => r[4] === "Special Allowance");
  assert.deepEqual(saRows, [
    ["2026-07-03", "Manpower Expense", "S1", "alice", "Special Allowance", "July 2026", 12000, 12000, 12000],
  ]);
  // no SA row on 07-01 or 07-02, and Salary rows are untouched by SA's presence
  assert.ok(!out.some((r) => r[4] === "Special Allowance" && r[0] !== "2026-07-03"));
  assert.deepEqual(
    out.filter((r) => r[4] === "Salary"),
    [
      ["2026-07-01", "Manpower Expense", "S1", "alice", "Salary", "July 2026", 800, 800, 800],
      ["2026-07-03", "Manpower Expense", "S1", "alice", "Salary", "July 2026", 800, 1600, 1600],
    ],
  );
});

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
  const { employees } = forecastRoster(USERS);
  const ids = employees.map((e) => e.id);
  assert.ok(!ids.includes("TEST001"));
  assert.ok(!ids.includes("EMP001"));
  assert.ok(!ids.includes("ADMIN-INFO"));
});

test("forecastRoster keeps S369 and S369A as distinct people", () => {
  const ids = forecastRoster(USERS).employees.map((e) => e.id);
  assert.ok(ids.includes("S369"));
  assert.ok(ids.includes("S369A"));
});

test("forecastRoster sorts by name and reports duplicate ids", () => {
  const { employees, duplicates } = forecastRoster(
    USERS.concat([{ employeeId: "S243", name: "Arvind Duplicate" }]));
  assert.deepEqual(employees.map((e) => e.name), ["Arvind", "Pinky", "Vishnu", "Vishnu kumar"]);
  assert.deepEqual(duplicates, ["S243"]);
});

test("forecastRoster skips rows missing an id or a name", () => {
  const { employees } = forecastRoster([{ employeeId: "", name: "Nobody" }, { employeeId: "S9", name: "" }]);
  assert.deepEqual(employees, []);
});

test("fiscalYearLabel spans April to March", () => {
  assert.equal(fiscalYearLabel("2026-08-01"), "FY26-27");
  assert.equal(fiscalYearLabel("2026-04-01"), "FY26-27");
  assert.equal(fiscalYearLabel("2027-03-31"), "FY26-27");
  assert.equal(fiscalYearLabel("2026-03-31"), "FY25-26");
});

const EMPLOYEES = [{ id: "S243", name: "Arvind" }, { id: "S1", name: "Pinky" }];
const MONTHS = fiscalYearMonths("2026-08-01");
const build = () => buildForecastTemplate({ employees: EMPLOYEES, months: MONTHS });

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
  for (const cat of STANDALONE_CATEGORIES) {
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
  assert.deepEqual(rows.map((r) => r[0]), ["Manpower Expense", ...STANDALONE_CATEGORIES]);
});
