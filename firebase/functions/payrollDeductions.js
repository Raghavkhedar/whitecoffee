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
 *   TOTAL DUE = salaryDue + covy + imprest + settlement + sa − PF − ESI
 *
 * SA (Special Allowance, monthly, per employee) is added straight into TOTAL DUE and is
 * deliberately excluded from `base` — PF/ESI/Imprest are computed on Salary Due MTD only.
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
 * @param sa             this month's Special Allowance (missing → 0). Added straight into
 *                       TOTAL DUE; deliberately excluded from the PF/ESI/Imprest base.
 * @param pfPercent      user.pfPercent      (missing → 0)
 * @param esiPercent     user.esiPercent     (missing → 0)
 * @param imprestPercent user.imprestPercent (missing → 0)
 * @param efficiency     multiplier for imprest (missing → 1; see resolveEfficiency)
 */
function computeDeductions({
  salaryDue, covy, settlement, sa, pfPercent, esiPercent, imprestPercent, efficiency,
} = {}) {
  const salary = toNum(salaryDue);

  // Floor the deduction base at 0. A negative Salary Due (a heavily-Absent month) would
  // otherwise make each percentage negative, and subtracting a negative PF would ADD money
  // back to TOTAL DUE. You do not deduct PF from earnings that don't exist. The negative
  // salary itself still carries through to TOTAL DUE untouched. SA is never part of this
  // base — see the module JSDoc.
  const base = Math.max(0, salary);

  const pf      = round2(base * toNum(pfPercent) / 100);
  const esi     = round2(base * toNum(esiPercent) / 100);
  const imprest = round2(base * toNum(imprestPercent) / 100 * resolveEfficiency(efficiency));

  const totalDue = round2(salary + toNum(covy) + imprest + toNum(settlement) + toNum(sa) - pf - esi);

  return { pf, esi, imprest, totalDue };
}

/**
 * Days NP ("net pay days") for the Employee Dashboard tab — the day-count that
 * `salaryDue = daysNP × salaryRate` is built from.
 *
 * SCHL's pay is per-day, not per-status (see attendanceRules.resolveLeaveStatus): pass only
 * the PAID slice as `schlPaid` (the sum of `salaryCredit` across that user's SCHL docs this
 * month) — the unpaid slice contributes nothing, same as USCHL, which has no parameter here
 * at all because it never earns credit.
 *
 * @param present   count of Present days (×1)
 * @param sl        count of SL (Short Leave) days (×0.75)
 * @param halfDay   count of HalfDay days (×0.5)
 * @param lnf       count of LNF (Log Not Found) days (×0.5)
 * @param schlPaid  sum of `salaryCredit` across this month's SCHL days (×1 each)
 * @param holiday   count of Holiday days (×1)
 * @param absent    count of Absent days (×-2, the no-show penalty)
 */
function computeDaysNP({ present, sl, halfDay, lnf, schlPaid, holiday, absent } = {}) {
  const n = (v) => Number(v) || 0;
  return n(present) + n(sl) * 0.75 + n(halfDay) * 0.5 + n(lnf) * 0.5
    + n(schlPaid) + n(holiday) - n(absent) * 2;
}

/** A zeroed month-to-date attendance tally — the shape `tallyAttendanceStatus` fills. */
function newAttendanceTally() {
  return { present: 0, halfDay: 0, sl: 0, slnf: 0, schl: 0, schlPaid: 0, uschl: 0, holiday: 0, absent: 0 };
}

/**
 * Add ONE attendance-status doc to a month-to-date tally (in place; returns the tally).
 * Feeds `computeDaysNP` in the Sheets Employee Dashboard (map schlPaid/holiday/absent
 * straight across and lnf ← slnf). The caller owns date filtering and the Sunday skip —
 * this only maps a status to a bucket. Sunday / WO / anything unknown changes nothing.
 * A Holiday counts unless salaryCredit is exactly 0 (an operations employee who worked it is
 * paid through OT approval instead); a legacy Holiday doc with no salaryCredit counts.
 *
 * Legacy PL/LWP: this tally covers the CURRENT month and is rebuilt live every run, so a
 * mid-month deploy leaves early-month days still scored "PL"/"LWP" beside "SCHL" days. They
 * fold onto SCHL's buckets — PL behaved exactly like salaryCredit 1, LWP like 0 — so Days NP
 * keeps the credit for leave already taken. (A past month's docs never reach this.)
 *
 * The Days-NP weights are mirrored in dailySpend.js (STATUS_WEIGHT / dayWeight) — change
 * both together.
 */
function tallyAttendanceStatus(tally, status, salaryCredit) {
  switch (status) {
    case "Present":  tally.present++; break;
    case "HalfDay":  tally.halfDay++; break;
    case "SL":       tally.sl++;      break;
    case "LNF":      tally.slnf++;    break; // "Log Not Found"
    case "SLNF":     tally.slnf++;    break; // legacy value, same bucket
    case "SCHL":
      tally.schl++;
      if (salaryCredit === 1) tally.schlPaid++;
      break;
    case "PL":       tally.schl++; tally.schlPaid++; break; // legacy ≡ salaryCredit 1
    case "LWP":      tally.schl++;                   break; // legacy ≡ salaryCredit 0
    case "USCHL":    tally.uschl++;   break;
    case "Holiday":  if (salaryCredit !== 0) tally.holiday++; break; // 0 = operations worked it, paid via OT instead
    case "Absent":   tally.absent++;  break;
    default: break; // Sunday, WO, unknown → no change
  }
  return tally;
}

module.exports = { computeDeductions, computeDaysNP, newAttendanceTally, tallyAttendanceStatus };
