"use strict";

// Boundary suite for the PF / ESI / Imprest payroll percentages.
// Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDeductions, computeDaysNP, newAttendanceTally, tallyAttendanceStatus,
} = require("./payrollDeductions");

const base = {
  salaryDue: 0, covy: 0, settlement: 0,
  pfPercent: 0, esiPercent: 0, imprestPercent: 0,
};

// ── The spec's worked examples ───────────────────────────────────────────────

test("PF is a percentage of Salary Due MTD — ₹100 at 8% is ₹8", () => {
  const r = computeDeductions({ ...base, salaryDue: 100, pfPercent: 8 });
  assert.equal(r.pf, 8);
});

test("ESI has the same shape — ₹100 at 0.75% is ₹0.75", () => {
  const r = computeDeductions({ ...base, salaryDue: 100, esiPercent: 0.75 });
  assert.equal(r.esi, 0.75);
});

test("the base is Salary Due MTD, so PF grows as the month is earned", () => {
  // ₹1000/day × 14 days NP on the 17th → base ₹14,000, PF at 8% = ₹1,120.
  const r = computeDeductions({ ...base, salaryDue: 14000, pfPercent: 8 });
  assert.equal(r.pf, 1120);
});

// ── PF and ESI are DEDUCTED from TOTAL DUE ──────────────────────────────────

test("TOTAL DUE deducts PF and ESI, and adds covy / imprest / settlement", () => {
  const r = computeDeductions({
    salaryDue: 10000, covy: 500, settlement: 1000,
    pfPercent: 8, esiPercent: 0.75, imprestPercent: 5,
  });
  assert.equal(r.pf, 800);
  assert.equal(r.esi, 75);
  assert.equal(r.imprest, 500);
  // 10000 + 500 + 500 + 1000 − 800 − 75
  assert.equal(r.totalDue, 11125);
});

// ── Imprest ─────────────────────────────────────────────────────────────────

test("Imprest is salaryDue × imprestPercent × efficiency", () => {
  const r = computeDeductions({ ...base, salaryDue: 10000, imprestPercent: 5, efficiency: 0.5 });
  assert.equal(r.imprest, 250);
});

test("efficiency DEFAULTS TO 1, never 0 — an absent matrix must not zero the imprest", () => {
  // Load-bearing: the efficiency matrix does not exist yet. A 0 default would silently
  // pay every employee ₹0 imprest, because the computed value replaces the manual column.
  for (const eff of [undefined, null, NaN, ""]) {
    const r = computeDeductions({ ...base, salaryDue: 10000, imprestPercent: 5, efficiency: eff });
    assert.equal(r.imprest, 500, `efficiency ${JSON.stringify(eff)} should behave as 1`);
  }
});

test("an explicit efficiency of 0 IS honoured — only a missing one defaults to 1", () => {
  const r = computeDeductions({ ...base, salaryDue: 10000, imprestPercent: 5, efficiency: 0 });
  assert.equal(r.imprest, 0);
});

// ── Unset percentages (the live state on 2026-07-17: nobody has them) ───────

test("an unset percentage yields 0 — decided: show 0 until the percentages are set", () => {
  const r = computeDeductions({ salaryDue: 10000, covy: 0, settlement: 0 });
  assert.equal(r.pf, 0);
  assert.equal(r.esi, 0);
  assert.equal(r.imprest, 0);
  assert.equal(r.totalDue, 10000);
});

// ── Negative Salary Due (a heavily-Absent month) ────────────────────────────

test("a negative Salary Due deducts nothing — PF/ESI/imprest floor the base at 0", () => {
  // Absent is −2 days NP, so daysNP (and salaryDue) CAN go negative — more likely now that
  // ops are scored every working day. Deducting a percentage of a negative base would
  // ADD money back (−8% of −5000 = +400); flooring the base at 0 keeps it honest.
  const r = computeDeductions({
    salaryDue: -5000, covy: 0, settlement: 0,
    pfPercent: 8, esiPercent: 0.75, imprestPercent: 5,
  });
  assert.equal(r.pf, 0);
  assert.equal(r.esi, 0);
  assert.equal(r.imprest, 0);
  assert.equal(r.totalDue, -5000); // the negative salary itself still carries through
});

// ── Rounding ────────────────────────────────────────────────────────────────

test("money is rounded to 2 decimals", () => {
  const r = computeDeductions({ ...base, salaryDue: 9999, pfPercent: 8.33 });
  assert.equal(r.pf, 832.92); // 9999 × 0.0833 = 832.9167
});

// ── SA (Special Allowance) ──────────────────────────────────────────────────

test("sa adds straight into TOTAL DUE", () => {
  const r = computeDeductions({
    salaryDue: 10000, covy: 500, settlement: 1000, sa: 12000,
    pfPercent: 8, esiPercent: 0.75, imprestPercent: 5,
  });
  assert.equal(r.pf, 800);
  assert.equal(r.esi, 75);
  assert.equal(r.imprest, 500);
  // 10000 + 500 + 500 + 1000 + 12000 − 800 − 75
  assert.equal(r.totalDue, 23125);
});

test("missing sa defaults to 0 in TOTAL DUE", () => {
  const r = computeDeductions({ ...base, salaryDue: 10000 });
  assert.equal(r.totalDue, 10000);
});

test("sa is absent from the PF/ESI/Imprest base — a large sa with salaryDue 0 yields pf/esi/imprest all 0", () => {
  const r = computeDeductions({
    salaryDue: 0, covy: 0, settlement: 0, sa: 50000,
    pfPercent: 8, esiPercent: 0.75, imprestPercent: 5,
  });
  assert.equal(r.pf, 0);
  assert.equal(r.esi, 0);
  assert.equal(r.imprest, 0);
  assert.equal(r.totalDue, 50000); // sa still carries through to TOTAL DUE
});

test("garbage percentages are treated as 0, not NaN", () => {
  const r = computeDeductions({
    salaryDue: 10000, covy: 0, settlement: 0,
    pfPercent: "abc", esiPercent: null, imprestPercent: undefined,
  });
  assert.equal(r.pf, 0);
  assert.equal(r.esi, 0);
  assert.equal(r.imprest, 0);
  assert.equal(r.totalDue, 10000);
});

// ── Days NP ───────────────────────────────────────────────────────────────

test("computeDaysNP: a full Present day counts as 1", () => {
  assert.equal(computeDaysNP({ present: 1 }), 1);
});

test("computeDaysNP: SL/HalfDay/LNF use their fractional weights", () => {
  assert.equal(computeDaysNP({ sl: 1 }), 0.75);
  assert.equal(computeDaysNP({ halfDay: 1 }), 0.5);
  assert.equal(computeDaysNP({ lnf: 1 }), 0.5);
});

test("computeDaysNP: only the paid slice of SCHL counts (the 4-day/2-balance example)", () => {
  // 4 SCHL days, balance covered 2 of them → schlPaid=2, the other 2 are salaryCredit 0
  // and simply aren't counted (they're not passed at all).
  assert.equal(computeDaysNP({ schlPaid: 2 }), 2);
});

test("computeDaysNP: USCHL is not a field — it contributes nothing by construction", () => {
  assert.equal(computeDaysNP({ present: 5 }), 5); // no uschl param exists to add
});

test("computeDaysNP: Holiday credits a full day", () => {
  assert.equal(computeDaysNP({ holiday: 1 }), 1);
});

test("computeDaysNP: Absent is a -2 day penalty", () => {
  assert.equal(computeDaysNP({ absent: 1 }), -2);
});

test("computeDaysNP: a realistic mixed month", () => {
  // 18 Present, 1 SL, 1 HalfDay, 1 LNF, 2 SCHL paid, 1 Holiday, 1 Absent
  const r = computeDaysNP({ present: 18, sl: 1, halfDay: 1, lnf: 1, schlPaid: 2, holiday: 1, absent: 1 });
  assert.equal(r, 18 + 0.75 + 0.5 + 0.5 + 2 + 1 - 2);
});

test("computeDaysNP: missing fields default to 0", () => {
  assert.equal(computeDaysNP({}), 0);
  assert.equal(computeDaysNP(), 0);
});

// ── MTD attendance tally (feeds computeDaysNP in the Sheets Employee Dashboard) ──────────
const ZERO_TALLY = { present: 0, halfDay: 0, sl: 0, slnf: 0, schl: 0, schlPaid: 0, uschl: 0, holiday: 0, absent: 0 };
const tallyOf = (status, credit) => tallyAttendanceStatus(newAttendanceTally(), status, credit);

test("newAttendanceTally: all nine counters start at 0, and each call returns a fresh object", () => {
  assert.deepEqual(newAttendanceTally(), ZERO_TALLY);
  assert.notEqual(newAttendanceTally(), newAttendanceTally());
});

test("tallyAttendanceStatus: mutates in place and returns the same tally", () => {
  const t = newAttendanceTally();
  assert.equal(tallyAttendanceStatus(t, "Present"), t);
  assert.equal(t.present, 1);
});

test("tallyAttendanceStatus: each plain status feeds exactly its own bucket", () => {
  assert.deepEqual(tallyOf("Present"), { ...ZERO_TALLY, present: 1 });
  assert.deepEqual(tallyOf("HalfDay"), { ...ZERO_TALLY, halfDay: 1 });
  assert.deepEqual(tallyOf("SL"), { ...ZERO_TALLY, sl: 1 });
  assert.deepEqual(tallyOf("LNF"), { ...ZERO_TALLY, slnf: 1 });
  assert.deepEqual(tallyOf("SLNF"), { ...ZERO_TALLY, slnf: 1 }); // legacy value, same bucket
  assert.deepEqual(tallyOf("USCHL"), { ...ZERO_TALLY, uschl: 1 });
  assert.deepEqual(tallyOf("Holiday"), { ...ZERO_TALLY, holiday: 1 });
  assert.deepEqual(tallyOf("Absent"), { ...ZERO_TALLY, absent: 1 });
});

test("tallyAttendanceStatus: SCHL counts as leave; only salaryCredit === 1 counts as paid", () => {
  assert.deepEqual(tallyOf("SCHL", 1), { ...ZERO_TALLY, schl: 1, schlPaid: 1 });
  assert.deepEqual(tallyOf("SCHL", 0), { ...ZERO_TALLY, schl: 1 });
  assert.deepEqual(tallyOf("SCHL", undefined), { ...ZERO_TALLY, schl: 1 });
  assert.deepEqual(tallyOf("SCHL", "1"), { ...ZERO_TALLY, schl: 1 }); // strict equality
});

test("tallyAttendanceStatus: PL/LWP are retired — the 2026-09-21 migration left zero such docs, so they now fall through unrecognized like any other unknown status", () => {
  assert.deepEqual(tallyOf("PL"), ZERO_TALLY);
  assert.deepEqual(tallyOf("LWP"), ZERO_TALLY);
  assert.deepEqual(tallyOf("PL", 1), ZERO_TALLY);
  assert.deepEqual(tallyOf("LWP", 0), ZERO_TALLY);
});

test("tallyAttendanceStatus: Sunday / WO / unknown / empty leave the tally unchanged", () => {
  for (const s of ["Sunday", "WO", "Bogus", "", undefined, null]) {
    assert.deepEqual(tallyOf(s), ZERO_TALLY, `status ${String(s)}`);
    assert.deepEqual(tallyOf(s, 1), ZERO_TALLY, `status ${String(s)} with credit`);
  }
});

test("tallyAttendanceStatus: a month's mix [SCHL(1), SCHL(0), USCHL, Holiday, Absent]", () => {
  const t = newAttendanceTally();
  [["SCHL", 1], ["SCHL", 0], ["USCHL"], ["Holiday"], ["Absent"]]
    .forEach(([status, credit]) => tallyAttendanceStatus(t, status, credit));
  assert.deepEqual(t, { ...ZERO_TALLY, schl: 2, schlPaid: 1, uschl: 1, holiday: 1, absent: 1 });
  // 1 paid leave + 1 holiday - 2 (absent penalty) = 0
  const daysNP = computeDaysNP({
    present: t.present, sl: t.sl, halfDay: t.halfDay, lnf: t.slnf,
    schlPaid: t.schlPaid, holiday: t.holiday, absent: t.absent,
  });
  assert.equal(daysNP, 0);
});

// ── Holiday credit (operations who worked the holiday are paid through OT instead) ──────────

test("tally: a Holiday with no salaryCredit (legacy doc) is paid", () => {
  const t = tallyAttendanceStatus(newAttendanceTally(), "Holiday", undefined);
  assert.equal(t.holiday, 1);
});

test("tally: a Holiday with salaryCredit 1 is paid", () => {
  assert.equal(tallyAttendanceStatus(newAttendanceTally(), "Holiday", 1).holiday, 1);
});

test("tally: a Holiday with salaryCredit 0 is NOT counted (paid via OT instead)", () => {
  assert.equal(tallyAttendanceStatus(newAttendanceTally(), "Holiday", 0).holiday, 0);
});
