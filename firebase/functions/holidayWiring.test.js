"use strict";

// Pins the WIRING of the holiday-pay approved-OT fix. effectiveHolidayCredit itself is covered in
// holidayCredit.test.js; index.js feeds it from an `ot_approvals` lookup at two sites (the Sheets
// Employee-Dashboard MTD block and the Daily Spend Snapshot). Both sites go through
// approvedOtKey / addApprovedOt / holidayAwareCredit, so the key can never drift between the
// place that builds the index and the place that reads it. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  effectiveHolidayCredit, approvedOtKey, addApprovedOt, holidayAwareCredit,
} = require("./holidayCredit");
const { newAttendanceTally, tallyAttendanceStatus, computeDaysNP } = require("./payrollDeductions");
const { dailySalary } = require("./dailySpend");

// ── approvedOtKey ─────────────────────────────────────────────────────────
test("approvedOtKey: exact uid__date format", () => {
  assert.equal(approvedOtKey("u1", "2026-09-17"), "u1__2026-09-17");
});

// ── addApprovedOt ─────────────────────────────────────────────────────────
const build = (docs) => {
  const index = new Map();
  for (const doc of docs) addApprovedOt(index, doc);
  return index;
};

test("addApprovedOt: rejected docs are skipped, approved counted", () => {
  const index = build([
    { userId: "u1", date: "2026-09-17", status: "rejected", approvedMins: 240 },
    { userId: "u2", date: "2026-09-17", status: "approved", approvedMins: 120 },
  ]);
  assert.equal(index.has(approvedOtKey("u1", "2026-09-17")), false);
  assert.equal(index.get(approvedOtKey("u2", "2026-09-17")), 120);
  assert.equal(index.size, 1);
});

test("addApprovedOt: a doc with no status counts as approved; so does any non-rejected status", () => {
  const index = build([
    { userId: "u1", date: "2026-09-17", approvedMins: 90 },
    { userId: "u2", date: "2026-09-17", status: "pending", approvedMins: 30 },
    { userId: "u3", date: "2026-09-17", status: "", approvedMins: 15 },
  ]);
  assert.equal(index.get("u1__2026-09-17"), 90);
  assert.equal(index.get("u2__2026-09-17"), 30);
  assert.equal(index.get("u3__2026-09-17"), 15);
});

test("addApprovedOt: minutes coerce like the readers do (string, NaN, undefined, junk)", () => {
  const index = build([
    { userId: "a", date: "2026-09-17", status: "approved", approvedMins: "240" },
    { userId: "b", date: "2026-09-17", status: "approved", approvedMins: NaN },
    { userId: "c", date: "2026-09-17", status: "approved" },
    { userId: "d", date: "2026-09-17", status: "approved", approvedMins: "abc" },
    { userId: "e", date: "2026-09-17", status: "approved", approvedMins: null },
  ]);
  assert.equal(index.get("a__2026-09-17"), 240);
  for (const u of ["b", "c", "d", "e"]) {
    assert.equal(index.has(`${u}__2026-09-17`), true, u); // stored, as 0 — not skipped
    assert.equal(index.get(`${u}__2026-09-17`), 0, u);
  }
});

test("addApprovedOt: missing userId or date does nothing and never throws", () => {
  const index = new Map();
  assert.doesNotThrow(() => addApprovedOt(index, { date: "2026-09-17", status: "approved", approvedMins: 240 }));
  assert.doesNotThrow(() => addApprovedOt(index, { userId: "u1", status: "approved", approvedMins: 240 }));
  assert.doesNotThrow(() => addApprovedOt(index, { userId: "", date: "", approvedMins: 240 }));
  assert.doesNotThrow(() => addApprovedOt(index, {}));
  assert.equal(index.size, 0);
});

test("addApprovedOt: different users/dates never collide", () => {
  const index = build([
    { userId: "u1", date: "2026-09-17", status: "approved", approvedMins: 60 },
    { userId: "u1", date: "2026-09-18", status: "approved", approvedMins: 120 },
    { userId: "u2", date: "2026-09-17", status: "approved", approvedMins: 180 },
  ]);
  assert.equal(index.size, 3);
  assert.equal(index.get("u1__2026-09-17"), 60);
  assert.equal(index.get("u1__2026-09-18"), 120);
  assert.equal(index.get("u2__2026-09-17"), 180);
});

test("addApprovedOt: stores GROSS minutes — a fully settled doc still counts as OT granted", () => {
  const index = build([
    { userId: "u1", date: "2026-09-17", status: "approved", approvedMins: 240, settledMins: 240 },
  ]);
  assert.equal(index.get("u1__2026-09-17"), 240);
});

test("addApprovedOt: a settledMins field on the input is ignored (never net)", () => {
  const index = new Map();
  addApprovedOt(index, { userId: "u1", date: "2026-09-17", status: "approved", approvedMins: 240, settledMins: 100 });
  assert.equal(index.get("u1__2026-09-17"), 240);
});

// ── holidayAwareCredit ────────────────────────────────────────────────────
const U = "u1";
const D = "2026-09-17";
const withApproval = (mins) => build([{ userId: U, date: D, status: "approved", approvedMins: mins }]);

test("holidayAwareCredit: every non-Holiday status returns the input credit UNCHANGED", () => {
  const statuses = ["Present", "SCHL", "USCHL", "Absent", "Sunday", "WO", "PL", "LWP", "HalfDay", "SL", "LNF", "mystery", "", undefined];
  const credits = [undefined, 0, 1];
  for (const status of statuses) {
    for (const salaryCredit of credits) {
      for (const index of [withApproval(240), new Map()]) {
        const got = holidayAwareCredit({ status, salaryCredit, role: "operations", userId: U, date: D, index });
        assert.equal(got, salaryCredit, `status=${status} credit=${salaryCredit} approved=${index.size > 0}`);
      }
    }
  }
});

test("holidayAwareCredit: Holiday, operations", () => {
  const hc = (salaryCredit, index) => holidayAwareCredit({ status: "Holiday", salaryCredit, role: "operations", userId: U, date: D, index });
  assert.equal(hc(1, withApproval(240)), 0);           // approved OT withdraws the +1
  assert.equal(hc(1, new Map()), 1);                   // no entry -> paid
  assert.equal(hc(0, new Map()), 0);                   // nightly already withdrew it
  assert.equal(hc(0, withApproval(240)), 0);
  assert.equal(hc(undefined, withApproval(240)), 0);   // legacy doc + approved OT
  assert.equal(hc(undefined, new Map()), 1);           // legacy doc, paid
  assert.equal(hc(1, withApproval(0)), 1);             // approved 0 minutes is no OT
});

test("holidayAwareCredit: Holiday, non-ledger and unknown roles keep the +1 despite approved OT", () => {
  for (const role of ["office", "sales", "admin", "mystery", "", undefined, null]) {
    assert.equal(
      holidayAwareCredit({ status: "Holiday", salaryCredit: 1, role, userId: U, date: D, index: withApproval(240) }),
      1, String(role),
    );
  }
});

test("holidayAwareCredit: an approval for a DIFFERENT user or date does not apply", () => {
  const otherUser = build([{ userId: "u2", date: D, status: "approved", approvedMins: 240 }]);
  const otherDate = build([{ userId: U, date: "2026-09-16", status: "approved", approvedMins: 240 }]);
  for (const index of [otherUser, otherDate]) {
    assert.equal(holidayAwareCredit({ status: "Holiday", salaryCredit: 1, role: "operations", userId: U, date: D, index }), 1);
  }
});

test("holidayAwareCredit: a missing / null / non-Map index behaves as no approvals and never throws", () => {
  for (const index of [undefined, null, {}, [], "u1__2026-09-17", 5, { get: () => 240 }]) {
    let got;
    assert.doesNotThrow(() => {
      got = holidayAwareCredit({ status: "Holiday", salaryCredit: 1, role: "operations", userId: U, date: D, index });
    });
    assert.equal(got, 1);
    assert.equal(holidayAwareCredit({ status: "Holiday", salaryCredit: 0, role: "operations", userId: U, date: D, index }), 0);
    assert.equal(holidayAwareCredit({ status: "Present", salaryCredit: 1, role: "operations", userId: U, date: D, index }), 1);
  }
});

// ── Pipeline: the two index.js sites, end to end, using only the real modules ──
// Site (a): MTD tally  -> newAttendanceTally + tallyAttendanceStatus(credit) -> computeDaysNP.
// Site (b): daily spend -> dailySalary(rate, status, credit) behind the caller's (status && !sunday) guard.
const RATE = 1000;
const HOLIDAY = "2026-09-17"; // a Thursday
const SUNDAY = "2026-09-20";
const isSunday = (dateStr) => new Date(dateStr + "T00:00:00Z").getUTCDay() === 0;

const otDoc = (userId, date, extra) => ({ userId, date, status: "approved", approvedMins: 240, ...extra });

// Runs both sites for one attendance_status doc, exactly as index.js composes the helpers.
function runSites(statusDoc, roleByUser, approvalDocs) {
  const index = new Map();
  for (const a of approvalDocs) addApprovedOt(index, a);
  const credit = () => holidayAwareCredit({
    status: statusDoc.status, salaryCredit: statusDoc.salaryCredit,
    role: roleByUser[statusDoc.userId], userId: statusDoc.userId, date: statusDoc.date, index,
  });
  // (a) MTD: Sunday skip first, then the tally.
  const tally = newAttendanceTally();
  if (!isSunday(statusDoc.date)) tallyAttendanceStatus(tally, statusDoc.status, credit());
  // (b) daily: (status && !sunday) guard, then dailySalary.
  const daily = (statusDoc && !isSunday(statusDoc.date)) ? dailySalary(RATE, statusDoc.status, credit()) : 0;
  return { holiday: tally.holiday, daysNP: computeDaysNP(tally), daily };
}

const roles = { ops: "operations", off: "office", sal: "sales" };
const holidayDoc = (userId, extra) => ({ userId, date: HOLIDAY, status: "Holiday", ...extra });

test("pipeline: ops forgot to check out, manual OT 240 approved -> +1 withdrawn in both sites", () => {
  const r = runSites(holidayDoc("ops", { salaryCredit: 1 }), roles, [otDoc("ops", HOLIDAY)]);
  assert.deepEqual(r, { holiday: 0, daysNP: 0, daily: 0 });
});

test("pipeline: ops legacy Holiday doc (no salaryCredit) + approved OT -> withdrawn", () => {
  assert.deepEqual(runSites(holidayDoc("ops"), roles, [otDoc("ops", HOLIDAY)]), { holiday: 0, daysNP: 0, daily: 0 });
});

test("pipeline: ops with no OT keeps the +1 (1 day, Rs 1000)", () => {
  assert.deepEqual(runSites(holidayDoc("ops", { salaryCredit: 1 }), roles, []), { holiday: 1, daysNP: 1, daily: 1000 });
});

test("pipeline: ops salaryCredit 0 stays withdrawn (0 / 0)", () => {
  assert.deepEqual(runSites(holidayDoc("ops", { salaryCredit: 0 }), roles, []), { holiday: 0, daysNP: 0, daily: 0 });
});

test("pipeline: office with approved OT keeps the +1 (1 / 1000)", () => {
  assert.deepEqual(runSites(holidayDoc("off", { salaryCredit: 1 }), roles, [otDoc("off", HOLIDAY)]), { holiday: 1, daysNP: 1, daily: 1000 });
  assert.deepEqual(runSites(holidayDoc("sal", { salaryCredit: 1 }), roles, [otDoc("sal", HOLIDAY)]), { holiday: 1, daysNP: 1, daily: 1000 });
});

test("pipeline: ops with a REJECTED 240 doc keeps the +1 (1 / 1000)", () => {
  const r = runSites(holidayDoc("ops", { salaryCredit: 1 }), roles, [otDoc("ops", HOLIDAY, { status: "rejected" })]);
  assert.deepEqual(r, { holiday: 1, daysNP: 1, daily: 1000 });
});

test("pipeline: ops with an approved doc for ANOTHER date keeps the +1 (1 / 1000)", () => {
  const r = runSites(holidayDoc("ops", { salaryCredit: 1 }), roles, [otDoc("ops", "2026-09-16")]);
  assert.deepEqual(r, { holiday: 1, daysNP: 1, daily: 1000 });
});

test("pipeline: ops with another user's approval for the same date keeps the +1", () => {
  const r = runSites(holidayDoc("ops", { salaryCredit: 1 }), roles, [otDoc("someoneElse", HOLIDAY)]);
  assert.deepEqual(r, { holiday: 1, daysNP: 1, daily: 1000 });
});

test("pipeline: a fully settled approval (settledMins == approvedMins) still withdraws the +1", () => {
  const r = runSites(holidayDoc("ops", { salaryCredit: 1 }), roles, [otDoc("ops", HOLIDAY, { settledMins: 240 })]);
  assert.deepEqual(r, { holiday: 0, daysNP: 0, daily: 0 });
});

test("pipeline: a Present day in the same month is untouched by an approval on that date", () => {
  const r = runSites({ userId: "ops", date: HOLIDAY, status: "Present", salaryCredit: 1 }, roles, [otDoc("ops", HOLIDAY)]);
  assert.deepEqual(r, { holiday: 0, daysNP: 1, daily: 1000 });
  const nc = runSites({ userId: "ops", date: HOLIDAY, status: "Present" }, roles, [otDoc("ops", HOLIDAY)]);
  assert.deepEqual(nc, { holiday: 0, daysNP: 1, daily: 1000 });
});

test("pipeline: a Sunday-dated Holiday contributes 0 to both sites under the caller's Sunday guard", () => {
  assert.equal(isSunday(SUNDAY), true);
  for (const approvals of [[], [otDoc("ops", SUNDAY)]]) {
    const r = runSites({ userId: "ops", date: SUNDAY, status: "Holiday", salaryCredit: 1 }, roles, approvals);
    assert.deepEqual(r, { holiday: 0, daysNP: 0, daily: 0 });
  }
});

// ── Golden equivalence: holidayAwareCredit == the inline logic it replaced in index.js ──
function referenceCredit({ status, salaryCredit, role, userId, date, docs }) {
  const map = new Map();
  docs.forEach((d) => {
    const key = `${d.userId}__${d.date || ""}`;
    if (d.status !== "rejected") map.set(key, Number(d.approvedMins) || 0);
  });
  return status === "Holiday"
    ? effectiveHolidayCredit(salaryCredit, role, map.get(`${userId}__${date}`))
    : salaryCredit;
}

test("golden: holidayAwareCredit matches the previous inline logic over the full grid", () => {
  const statuses = ["Holiday", "Present", "SCHL", "USCHL", "Absent", "Sunday", "WO", "PL", "LWP", "mystery"];
  const credits = [undefined, 0, 1];
  const roleList = ["operations", "office", "sales", "admin", "mystery", undefined];
  const minutes = [{ absent: true }, 0, 240, "240", NaN];
  const docStatuses = [undefined, "approved", "rejected"];
  let cases = 0;
  for (const status of statuses) for (const salaryCredit of credits) for (const role of roleList) {
    for (const m of minutes) for (const docStatus of docStatuses) {
      const doc = { userId: U, date: D };
      if (!(m && m.absent)) doc.approvedMins = m;
      if (docStatus !== undefined) doc.status = docStatus;
      for (const docs of [[doc], []]) {
        const expected = referenceCredit({ status, salaryCredit, role, userId: U, date: D, docs });
        const index = new Map();
        docs.forEach((d) => addApprovedOt(index, d));
        const got = holidayAwareCredit({ status, salaryCredit, role, userId: U, date: D, index });
        assert.equal(got, expected, JSON.stringify({ status, salaryCredit, role, m: String(m && m.absent ? "absent" : m), docStatus, n: docs.length }));
        cases++;
      }
    }
  }
  assert.equal(cases, 10 * 3 * 6 * 5 * 3 * 2);
});

test("golden: two docs for one key — the LAST non-rejected one wins, exactly as the old inline set() did", () => {
  const docs = [
    { userId: U, date: D, status: "approved", approvedMins: 240 },
    { userId: U, date: D, status: "approved", approvedMins: 0 },
  ];
  const index = new Map();
  docs.forEach((d) => addApprovedOt(index, d));
  const args = { status: "Holiday", salaryCredit: 1, role: "operations", userId: U, date: D };
  assert.equal(holidayAwareCredit({ ...args, index }), referenceCredit({ ...args, docs }));
  assert.equal(holidayAwareCredit({ ...args, index }), 1);
});
