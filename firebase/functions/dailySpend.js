"use strict";

// Pure per-day spend decomposition for the Daily Spend Snapshot. Firestore-free so it can be
// unit-tested via `npm test`. See docs/superpowers/specs/2026-07-24-daily-spend-snapshot-design.md.

// Attendance-status → payroll multiplier. Mirrors the MTD `daysNP` weights in index.js:
// Present ×1, SL ×0.75, HalfDay/LNF/SLNF ×0.5, PL ×1, LWP ×0, Absent ×−2 (the −2 penalty).
const STATUS_WEIGHT = {
  Present: 1, SL: 0.75, HalfDay: 0.5, LNF: 0.5, SLNF: 0.5, PL: 1, LWP: 0, Absent: -2,
};

function round2(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

function dayWeight(status) {
  return STATUS_WEIGHT[status] ?? 0;
}

function dailySalary(salaryRate, status) {
  return round2((Number(salaryRate) || 0) * dayWeight(status));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Missing efficiency → 1 (matrix not built yet, see payrollDeductions.js); explicit 0 honoured.
function resolveEfficiency(v) {
  if (v === null || v === undefined || v === "") return 1;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

// PF/ESI/Imprest as flat percentages of the DAY's salary. Deliberately NOT floored at 0
// (unlike the monthly computeDeductions): a negative Absent-day salary yields negative
// components so the daily rows sum exactly to the monthly figure when monthly salary ≥ 0.
// SA (Special Allowance) is NOT a parameter here and never has been — this base is
// intentionally just `salary`. SA is a flat monthly amount, not something PF/ESI/Imprest
// are ever computed against; see dailyTotal below for where SA actually enters.
function dailyDeductions({ salary, pfPercent, esiPercent, imprestPercent, efficiency } = {}) {
  const base = toNum(salary);
  return {
    pf:      round2(base * toNum(pfPercent) / 100),
    esi:     round2(base * toNum(esiPercent) / 100),
    imprest: round2(base * toNum(imprestPercent) / 100 * resolveEfficiency(efficiency)),
  };
}

function dailyTotal({ salary, conveyance, imprest, otWo, pf, esi, sa } = {}) {
  return round2(toNum(salary) + toNum(conveyance) + toNum(imprest) + toNum(otWo) + toNum(sa) - toNum(pf) - toNum(esi));
}

function addMonths(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const idx = (y * 12 + (m - 1)) + delta;      // month index since year 0
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

// Months to recompute each run: current month + consecutive unlocked priors (walking back),
// stopping at the first locked month or after `cap` priors. Ascending order.
function openWindowMonths(currentKey, lockedSet, cap = 3) {
  const months = [currentKey];
  for (let i = 1; i <= cap; i++) {
    const prev = addMonths(currentKey, -i);
    if (lockedSet.has(prev)) break;
    months.push(prev);
  }
  return months.sort();
}

// ── Special Allowance reconciliation (snapshotDailySpend Pass 1 / backstop) ──────────
// SA is the one dailySpend component a human types, so it is the one component that can be
// entered after the last nightly run and before Settle & Lock — see the long comment in
// snapshotDailySpend Pass 1 for why that makes it the single exception to "a locked month is
// never recomputed".

// Does an existing dailySpend row already carry this SA amount? A missing row never does.
function saIsReflected(row, amount) {
  if (!row) return false;
  return round2(row.sa) === round2(amount);
}

/**
 * The MINIMAL patch that puts `sa` on a dailySpend row, or null when there is nothing to do.
 * `totalSpend` is re-derived from the row's OWN stored components — nothing is recomputed
 * from source data, which is what makes this safe to apply to a month being frozen.
 * `row` may be null (no row exists yet) — then every other component is 0.
 *
 * ⚠️ ₹0 is a REAL amount, not "nothing entered" (the Users page accepts it: the validation
 * rejects only amount < 0). So a correction to ₹0 against a row carrying ₹5000 MUST produce a
 * patch — callers must lean on this null/non-null answer rather than testing the amount for
 * truthiness, or a zero-correction is silently dropped and the stale figure freezes forever.
 * The one case ₹0 means "do nothing" is when there is no row at all: an SA of ₹0 must not
 * conjure an all-zero dailySpend row, so that returns null too.
 */
function saRowPatch(row, amount) {
  const sa = round2(amount);
  if (saIsReflected(row, sa)) return null;
  if (!row && sa === 0) return null; // nothing to carry, nothing to create
  const r = row || {};
  return {
    sa,
    totalSpend: dailyTotal({
      salary: r.salary, conveyance: r.conveyance, imprest: r.imprest,
      otWo: r.otWo, pf: r.pf, esi: r.esi, sa,
    }),
  };
}

module.exports = {
  round2, dayWeight, dailySalary, dailyDeductions, dailyTotal, addMonths, openWindowMonths,
  saIsReflected, saRowPatch,
};
