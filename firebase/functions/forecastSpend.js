"use strict";

// Pure spend-categorisation helpers for the Forecasting export. No Firestore/Sheets here,
// so the whole bucketing/parsing surface is unit-testable via `node --test`.
// Flat row shape everywhere: [date, category, component, employeeId, employeeName, amount].

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
// NOTE: "Employee Welfare & Retention" is intentionally absent — it routes into Manpower
// (a lump line), handled by the integration's officeResolve, not here.
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

// Firestore dailySpend fields that feed Manpower, in display order. All stored positive
// (PF/ESI included as positive company costs — a spend sheet, not the net-paid view).
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
  const a = Number(m[1]), b = Number(m[2]);
  const y = m[3];
  let day, mon;
  if (a > 12) { day = a; mon = b; }        // dd-mm
  else if (b > 12) { mon = a; day = b; }   // mm-dd
  else { day = a; mon = b; }               // ambiguous → dd/mm (Indian)
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${y}-${pad2(mon)}-${pad2(day)}`;
}

// Find the header row: first row (within the first 6) containing a "tag(s)" cell.
function findHeaderRow(values) {
  const limit = Math.min(values.length, 6);
  for (let i = 0; i < limit; i++) {
    const row = values[i] || [];
    if (row.some((c) => /^tags?$/i.test(String(c == null ? "" : c).trim()))) return i;
  }
  return 0;
}

// Bucket one MDD tab. `resolve(normTag) -> {category,component,perEmployee} | null`.
// Returns { rows, seenTags } — seenTags records every tag encountered (matched or not),
// so the caller can warn on catalog tags that never appeared.
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

// Firestore dailySpend docs → Manpower flat rows: one row per non-zero component.
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

// Case-insensitive substring match against a list of tab titles.
function pickTabName(titles, needle) {
  const n = String(needle).toLowerCase();
  return (titles || []).find((t) => String(t).toLowerCase().includes(n)) || null;
}

// Communication tab: sum every dated row (no tag filter) into the "Comm Expenses" category.
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

// The 21 standalone categories in display order (category numbers 2..22 from the spec).
// Manpower Expense (category 1) is NOT here — it is expanded per employee × component.
const STANDALONE_CATEGORIES = [
  "Tool Purchase", "Core Asset", "Asset Purchase", "Material Repair", "Transporter Purchases",
  "Purchase Stock", "Electricity", "Asset Repair", "Tool Repair", "Welfare (Celebrations)",
  "Client/Vendor Ent Expense", "Stationery", "Office Cleaning Eqp. & Exp.", "Training Expense",
  "Subscription – Cloud", "Subscription – Job Portal", "Maint. of Building", "Pantry / House Keeping",
  "OH (Overhead)", "Sales & Adv Expenses", "Comm Expenses",
];

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function monthLabelOf(dateISO) {
  const [y, m] = String(dateISO).split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Inclusive daily date list "yyyy-mm-dd" from minISO..maxISO. UTC arithmetic (functions run UTC).
function datesInRange(minISO, maxISO) {
  const out = [];
  if (!minISO || !maxISO) return out;
  let t = Date.parse(`${minISO}T00:00:00Z`);
  const end = Date.parse(`${maxISO}T00:00:00Z`);
  if (isNaN(t) || isNaN(end)) return out;
  for (; t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Build the materialized Daily Snapshot table from flat rows.
// Output row: [snapshotDate, category, employeeId, employeeName, component, monthLabel,
//              daySpend, monthTotal (month-to-date cumulative), runningTotal (all-time cumulative)].
// Standalone categories are DENSE (every date in the data span, incl. zeros). Manpower is
// SPARSE per (employee, component) — a row only on dates that series actually had spend.
function buildDailySnapshot(flatRows, opts = {}) {
  const manpowerCategory = opts.manpowerCategory || "Manpower Expense";
  const standalone = opts.standaloneCategories || STANDALONE_CATEGORIES;
  const rows = flatRows || [];
  const dates = rows.map((r) => r[0]).filter(Boolean).sort();
  if (dates.length === 0) return [];
  const grid = datesInRange(dates[0], dates[dates.length - 1]);
  const out = [];

  // Standalone: category → (date → summed amount).
  const stdByCatDate = new Map();
  rows.forEach((r) => {
    const cat = r[1];
    if (cat === manpowerCategory) return;
    if (!stdByCatDate.has(cat)) stdByCatDate.set(cat, new Map());
    const dm = stdByCatDate.get(cat);
    dm.set(r[0], (dm.get(r[0]) || 0) + Number(r[5] || 0));
  });
  standalone.forEach((cat) => {
    const dm = stdByCatDate.get(cat) || new Map();
    let monthKey = null, monthTotal = 0, running = 0;
    grid.forEach((date) => {
      const day = dm.get(date) || 0;
      const mk = date.slice(0, 7);
      if (mk !== monthKey) { monthKey = mk; monthTotal = 0; }
      monthTotal += day; running += day;
      out.push([date, cat, "", "", "", monthLabelOf(date), r2(day), r2(monthTotal), r2(running)]);
    });
  });

  // Manpower: series (employeeId, employeeName, component) → (date → summed amount).
  const series = new Map();
  rows.forEach((r) => {
    if (r[1] !== manpowerCategory) return;
    const component = r[2], empId = r[3], empName = r[4];
    const key = `${empId} ${empName} ${component}`;
    if (!series.has(key)) series.set(key, { empId, empName, component, byDate: new Map() });
    const s = series.get(key);
    s.byDate.set(r[0], (s.byDate.get(r[0]) || 0) + Number(r[5] || 0));
  });
  series.forEach((s) => {
    const sdates = [...s.byDate.keys()].sort();
    let monthKey = null, monthTotal = 0, running = 0;
    sdates.forEach((date) => {
      const day = s.byDate.get(date) || 0;
      if (day === 0) return; // sparse
      const mk = date.slice(0, 7);
      if (mk !== monthKey) { monthKey = mk; monthTotal = 0; }
      monthTotal += day; running += day;
      out.push([date, manpowerCategory, s.empId, s.empName, s.component,
        monthLabelOf(date), r2(day), r2(monthTotal), r2(running)]);
    });
  });

  const orderIndex = (cat) => (cat === manpowerCategory ? -1 : standalone.indexOf(cat));
  out.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;      // date
    const oa = orderIndex(a[1]), ob = orderIndex(b[1]);
    if (oa !== ob) return oa - ob;                        // category order (manpower first)
    if (a[3] !== b[3]) return a[3] < b[3] ? -1 : 1;       // employee name
    return a[4] < b[4] ? -1 : (a[4] > b[4] ? 1 : 0);      // component
  });
  return out;
}

module.exports = {
  normTag, findCol, parseAmount, parseDate,
  VENDOR_CATEGORIES, OFFICE_CATEGORIES, MANPOWER_COMPONENTS, STANDALONE_CATEGORIES,
  bucketMddTab, dailySpendToFlat, pickTabName, bucketCommunication,
  monthLabelOf, datesInRange, buildDailySnapshot,
};
