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
function dailyDeductions({ salary, pfPercent, esiPercent, imprestPercent, efficiency } = {}) {
  const base = toNum(salary);
  return {
    pf:      round2(base * toNum(pfPercent) / 100),
    esi:     round2(base * toNum(esiPercent) / 100),
    imprest: round2(base * toNum(imprestPercent) / 100 * resolveEfficiency(efficiency)),
  };
}

function dailyTotal({ salary, conveyance, imprest, otWo, pf, esi } = {}) {
  return round2(toNum(salary) + toNum(conveyance) + toNum(imprest) + toNum(otWo) - toNum(pf) - toNum(esi));
}

module.exports = { round2, dayWeight, dailySalary, dailyDeductions, dailyTotal };
