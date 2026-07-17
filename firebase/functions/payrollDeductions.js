"use strict";

/**
 * PF / ESI / Imprest payroll percentages for the Employee Dashboard tab.
 *
 * All three are percentages of **Salary Due MTD** (`daysNP × salaryRate`) — what the employee
 * has actually earned so far this month — so they grow through the month exactly like salary
 * does. Confirmed 2026-07-17 against a worked example; the alternative (a flat full-month
 * salary regardless of days worked) was explicitly rejected. See
 * docs/superpowers/specs/2026-07-17-ops-evaluation-and-payroll-percentages.md
 *
 *   PF      = base × pfPercent%
 *   ESI     = base × esiPercent%
 *   Imprest = base × imprestPercent% × efficiency
 *   TOTAL DUE = salaryDue + covy + imprest + settlement − PF − ESI
 *
 * Percentages live on the user doc (`pfPercent` / `esiPercent` / `imprestPercent`, set from the
 * /users modal). As of 2026-07-17 **no user has any of them set**, which is deliberate and
 * decided: the computed Imprest REPLACES the manual Sheet column, so until the percentages are
 * populated the Imprest column reads ₹0 for everyone. PF and ESI deduct ₹0 meanwhile, so they
 * are inert rather than harmful.
 */

/** Money → 2dp, matching how the rest of the dashboard rounds. */
function round2(n) {
  return parseFloat((n || 0).toFixed(2));
}

/** A percentage/amount from a user doc → a finite number, or 0 for missing/garbage. */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Efficiency → a multiplier, defaulting to **1** when absent.
 *
 * Load-bearing. The efficiency matrix does not exist yet (see the spec — it may end up being
 * the Manpower report's `work done-time`, a spreadsheet, or a new field). Until it does, every
 * caller passes nothing. A 0 default would multiply every imprest to zero, and because the
 * computed Imprest replaces the manual column that would silently pay everyone ₹0 imprest.
 * An *explicit* 0 is still honoured — only a missing value defaults to 1.
 */
function resolveEfficiency(v) {
  if (v === null || v === undefined || v === "") return 1;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
}

/**
 * @param salaryDue      Salary Due MTD (`daysNP × salaryRate`). May be NEGATIVE — Absent is
 *                       −2 days NP, and ops are now scored every working day.
 * @param covy           conveyance due
 * @param settlement     this month's locked OT/shortage/WO settlement cash
 * @param pfPercent      user.pfPercent      (missing → 0)
 * @param esiPercent     user.esiPercent     (missing → 0)
 * @param imprestPercent user.imprestPercent (missing → 0)
 * @param efficiency     multiplier for imprest (missing → 1; see resolveEfficiency)
 */
function computeDeductions({
  salaryDue, covy, settlement, pfPercent, esiPercent, imprestPercent, efficiency,
} = {}) {
  const salary = toNum(salaryDue);

  // Floor the deduction base at 0. A negative Salary Due (a heavily-Absent month) would
  // otherwise make each percentage negative, and subtracting a negative PF would ADD money
  // back to TOTAL DUE. You do not deduct PF from earnings that don't exist. The negative
  // salary itself still carries through to TOTAL DUE untouched.
  const base = Math.max(0, salary);

  const pf      = round2(base * toNum(pfPercent) / 100);
  const esi     = round2(base * toNum(esiPercent) / 100);
  const imprest = round2(base * toNum(imprestPercent) / 100 * resolveEfficiency(efficiency));

  const totalDue = round2(salary + toNum(covy) + imprest + toNum(settlement) - pf - esi);

  return { pf, esi, imprest, totalDue };
}

module.exports = { computeDeductions };
