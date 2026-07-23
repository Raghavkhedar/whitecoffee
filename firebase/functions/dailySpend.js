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

module.exports = { round2, dayWeight, dailySalary };
