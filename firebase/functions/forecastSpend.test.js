"use strict";

// Boundary suite for the pure forecast bucketing/parsing. Run: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normTag, findCol, parseAmount, parseDate,
  VENDOR_CATEGORIES, OFFICE_CATEGORIES, MANPOWER_COMPONENTS, STANDALONE_CATEGORIES,
  bucketMddTab, dailySpendToFlat, pickTabName, bucketCommunication,
  monthLabelOf, datesInRange, buildDailySnapshot,
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
    ["2026-07-09", "Tool Purchase", "", "", "", 1586],
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

test("STANDALONE_CATEGORIES has the 21 non-Manpower categories", () => {
  assert.equal(STANDALONE_CATEGORIES.length, 21);
  assert.ok(!STANDALONE_CATEGORIES.includes("Manpower Expense"));
  assert.equal(STANDALONE_CATEGORIES[0], "Tool Purchase");
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
