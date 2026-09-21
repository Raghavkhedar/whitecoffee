"use strict";

// Pins the per-user scoring of computeDailyAttendanceStatus BEFORE/while it moved out of index.js
// into nightlyScoring.js (spec: docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-
// design.md §4.4 "regression-first"). Every expected value below was derived by reading the ORIGINAL
// inline loop body (index.js at 5b3d2a9), not the extracted module. Where the original has an
// odd edge (missing timestamp, out-before-in, null role) the test pins it AS-IS and says so:
// this refactor is zero behaviour change, and a quirk is a finding for the owner, not something to
// fix here. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreUserDay, buildStatusDoc, partitionUsers } = require("./nightlyScoring");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const DATE = "2026-09-21";
// A Firestore-Timestamp stand-in: the loop only ever touches `.seconds` (sort) and `.toDate()`.
const at = (hhmm, sec = 0) => {
  const d = new Date(`${DATE}T${hhmm}:${String(sec).padStart(2, "0")}+05:30`);
  return { seconds: Math.floor(d.getTime() / 1000), toDate: () => d };
};
const ev = (type, hhmm, sec = 0) => ({ type, timestamp: at(hhmm, sec), userId: "u1", date: DATE });
const office = (inT, outT) => [ev("office_in", inT), ev("office_out", outT)];
const site = (inT, outT) => [ev("site_in", inT), ev("site_out", outT)];
const score = (over) => scoreUserDay({ role: "office", events: [], plan: undefined, leave: undefined, plBalance: undefined, ...over });
const statusOf = (over) => score(over).status;

// ── Present / HalfDay / SL: the window boundaries (office, fixed 10:00–18:00) ───────────────
test("Present: exactly on the window, and comfortably inside it", () => {
  assert.deepStrictEqual(score({ events: office("10:00", "18:00") }), { status: "Present" });
  assert.deepStrictEqual(score({ events: office("09:30", "18:30") }), { status: "Present" });
});

test("Present is a MINUTE comparison: 10:00:59 is still on time, 18:00:00 out is fine", () => {
  assert.equal(statusOf({ events: [ev("office_in", "10:00", 59), ev("office_out", "18:00", 30)] }), "Present");
});

test("HalfDay: any lateness at all (zero grace) — 10:01 is late", () => {
  assert.equal(statusOf({ events: office("10:01", "18:00") }), "HalfDay");
  assert.equal(statusOf({ events: office("11:30", "19:00") }), "HalfDay");
});

test("SL: early-out with no lateness — 17:59 is early", () => {
  assert.equal(statusOf({ events: office("10:00", "17:59") }), "SL");
  assert.equal(statusOf({ events: office("09:00", "12:00") }), "SL");
});

test("HalfDay (late-in) WINS over SL (early-out) when both apply", () => {
  assert.equal(statusOf({ events: office("10:30", "17:00") }), "HalfDay");
  assert.equal(statusOf({ events: office("10:01", "17:59") }), "HalfDay");
});

test("a fully-punched day never carries a salaryCredit key, and office/admin/sales never a dailyHours key", () => {
  for (const role of ["office", "admin", "sales"]) {
    const r = score({ role, events: office("10:00", "18:00") });
    assert.deepStrictEqual(r, { status: "Present" }, role);
    assert.equal("salaryCredit" in r, false);
    assert.equal("dailyHours" in r, false);
  }
});

// ── LNF: exactly one side punched ───────────────────────────────────────────────────────────
test("LNF: a check-in with no check-out, and a check-out with no check-in", () => {
  assert.deepStrictEqual(score({ events: [ev("office_in", "10:00")] }), { status: "LNF" });
  assert.deepStrictEqual(score({ events: [ev("office_out", "18:00")] }), { status: "LNF" });
});

test("LNF beats an approved leave (the leave only applies to a day with NO punches at all)", () => {
  assert.deepStrictEqual(score({ events: [ev("office_in", "10:00")], leave: { id: "l1" }, plBalance: 5 }), { status: "LNF" });
});

test("a leave is ignored when the day has both punches: scored on the punches, no credit", () => {
  const r = score({ events: office("10:00", "18:00"), leave: { id: "l1" }, plBalance: 5 });
  assert.deepStrictEqual(r, { status: "Present" });
});

// ── Absent ──────────────────────────────────────────────────────────────────────────────────
test("Absent: no punches and no leave — for every role, salaryCredit key absent", () => {
  for (const role of ["office", "admin", "sales", "operations", undefined, "intern"]) {
    const r = score({ role, events: [] });
    assert.deepStrictEqual(r, { status: "Absent" }, String(role));
    assert.equal("salaryCredit" in r, false);
  }
});

test("Absent: `events` may be undefined/null as well as empty", () => {
  assert.deepStrictEqual(score({ events: undefined }), { status: "Absent" });
  assert.deepStrictEqual(score({ events: null }), { status: "Absent" });
});

test("Absent: a falsy `leave` (undefined/null/false/0) is no leave", () => {
  for (const leave of [undefined, null, false, 0, ""]) {
    assert.deepStrictEqual(score({ leave, plBalance: 9 }), { status: "Absent" }, String(leave));
  }
});

// ── SCHL: paid vs unpaid, and the plBalance boundary ────────────────────────────────────────
test("SCHL paid: leave + no punches + plBalance > 0 → salaryCredit 1", () => {
  assert.deepStrictEqual(score({ leave: { id: "l1" }, plBalance: 5 }), { status: "SCHL", salaryCredit: 1 });
  assert.deepStrictEqual(score({ leave: { id: "l1" }, plBalance: 1 }), { status: "SCHL", salaryCredit: 1 });
});

test("SCHL unpaid: plBalance 0 → status SCHL, salaryCredit 0 (key PRESENT, value 0)", () => {
  const r = score({ leave: { id: "l1" }, plBalance: 0 });
  assert.deepStrictEqual(r, { status: "SCHL", salaryCredit: 0 });
  assert.equal("salaryCredit" in r, true);
});

test("SCHL plBalance boundary: exactly 1 paid; 0 / undefined / null / NaN / negative all unpaid", () => {
  const credit = (plBalance) => score({ leave: { id: "l1" }, plBalance }).salaryCredit;
  assert.equal(credit(1), 1);
  assert.equal(credit(0), 0);
  assert.equal(credit(undefined), 0);
  assert.equal(credit(null), 0);
  assert.equal(credit(NaN), 0);
  assert.equal(credit(-1), 0);
});

test("SCHL plBalance is coerced, not type-checked: 0.5 and \"3\" are paid, \"abc\" is unpaid (pinned as-is)", () => {
  const credit = (plBalance) => score({ leave: { id: "l1" }, plBalance }).salaryCredit;
  assert.equal(credit(0.5), 1);
  assert.equal(credit("3"), 1);
  assert.equal(credit("abc"), 0);
});

test("SCHL works for every role, ignores a plan, and never carries dailyHours", () => {
  for (const role of ["office", "admin", "sales", "operations"]) {
    const r = score({ role, leave: { id: "l1" }, plBalance: 2, plan: { startTime: "08:00", endTime: "16:00" } });
    assert.deepStrictEqual(r, { status: "SCHL", salaryCredit: 1 }, role);
  }
});

test("a leave whose punches are all the WRONG type for the role still reads as an unpunched day → SCHL", () => {
  // office role: site punches don't count, so this is an unpunched day under a leave.
  assert.deepStrictEqual(score({ role: "office", events: site("10:00", "18:00"), leave: { id: "l1" }, plBalance: 1 }),
    { status: "SCHL", salaryCredit: 1 });
});

// ── which event types open/close a day, per role ────────────────────────────────────────────
test("role × event-type family: who is Present on which punches (else Absent)", () => {
  const fam = {
    office: office("10:00", "18:00"),
    site: site("10:00", "18:00"),
    market: [ev("market_in", "10:00"), ev("market_out", "18:00")],
  };
  const expected = {
    office:     { office: "Present", site: "Absent",  market: "Absent"  },
    admin:      { office: "Present", site: "Absent",  market: "Absent"  },
    operations: { office: "Absent",  site: "Present", market: "Present" },
    sales:      { office: "Present", site: "Present", market: "Present" },
    intern:     { office: "Present", site: "Absent",  market: "Absent"  }, // unknown → office
    [undefined]: { office: "Present", site: "Absent", market: "Absent"  }, // no role → office
  };
  for (const [role, row] of Object.entries(expected)) {
    for (const [f, want] of Object.entries(row)) {
      assert.equal(statusOf({ role: role === "undefined" ? undefined : role, events: fam[f] }), want, `${role}/${f}`);
    }
  }
});

test("sales: first in / last out are taken ACROSS all three in-types and out-types", () => {
  // Unsorted on purpose. Earliest in = market_in 09:00, latest out = site_out 18:00 → Present.
  const events = [ev("site_in", "10:00"), ev("office_out", "12:00"), ev("site_out", "18:00"), ev("market_in", "09:00")];
  assert.deepStrictEqual(score({ role: "sales", events }), { status: "Present" });
  // A late office_in does not matter when an earlier site_in exists.
  assert.equal(statusOf({ role: "sales", events: [ev("office_in", "10:15"), ev("site_in", "09:30"), ev("market_out", "18:00")] }), "Present");
  // ...and it does when it is the earliest.
  assert.equal(statusOf({ role: "sales", events: [ev("office_in", "10:15"), ev("site_in", "11:00"), ev("market_out", "18:00")] }), "HalfDay");
});

test("sales is scored on the FIXED window: a planned shift is ignored, and there is no dailyHours", () => {
  const plan = { startTime: "06:00", endTime: "14:00" };
  // Under the plan (06–14) an 10:00–18:00 day would be HalfDay; on the fixed window it is Present.
  assert.deepStrictEqual(score({ role: "sales", events: site("10:00", "18:00"), plan }), { status: "Present" });
  // Under the plan 06:00–14:00 would be Present; on the fixed window the 14:00 out is an early-out.
  assert.deepStrictEqual(score({ role: "sales", events: site("06:00", "14:00"), plan }), { status: "SL" });
});

test("office/admin ignore a planned shift as well (it is never loaded for them, but the module must not read it)", () => {
  const plan = { startTime: "06:00", endTime: "14:00" };
  assert.equal(statusOf({ role: "office", events: office("06:00", "14:00"), plan }), "SL");
  assert.equal(statusOf({ role: "admin", events: office("10:00", "18:00"), plan }), "Present");
});

// ── operations: planned window vs the fallbacks ─────────────────────────────────────────────
const ops = (over) => score({ role: "operations", ...over });

test("ops planned window: scored against the plan, not 10:00–18:00", () => {
  const plan = { startTime: "08:00", endTime: "16:00" };
  assert.equal(ops({ events: site("08:00", "16:00"), plan }).status, "Present");
  assert.equal(ops({ events: site("08:01", "16:00"), plan }).status, "HalfDay");
  assert.equal(ops({ events: site("08:00", "15:59"), plan }).status, "SL");
});

test("ops with NO plan keeps the 10:00–18:00 default (same punches that are Present under a plan are SL)", () => {
  assert.equal(ops({ events: site("08:00", "16:00"), plan: undefined }).status, "SL");
  assert.equal(ops({ events: site("10:00", "18:00"), plan: undefined }).status, "Present");
});

test("ops inverted / zero-length plan falls back to 10:00–18:00", () => {
  for (const plan of [
    { startTime: "18:00", endTime: "10:00" }, // inverted
    { startTime: "09:00", endTime: "09:00" }, // zero window
  ]) {
    assert.equal(ops({ events: site("08:00", "16:00"), plan }).status, "SL", JSON.stringify(plan));
    assert.equal(ops({ events: site("10:00", "18:00"), plan }).status, "Present", JSON.stringify(plan));
  }
});

test("ops with a half-filled plan (one time missing/blank) is treated as no plan", () => {
  for (const plan of [{ startTime: "08:00" }, { endTime: "16:00" }, { startTime: "", endTime: "16:00" }, {}]) {
    assert.equal(ops({ events: site("08:00", "16:00"), plan }).status, "SL", JSON.stringify(plan));
  }
});

test("ops plan with one malformed time: that side falls back to its 10:00/18:00 default (pinned as-is)", () => {
  // start 12:00 parses; end "xx" → 18:00 default → window 12:00–18:00.
  const plan = { startTime: "12:00", endTime: "xx" };
  // 11:00–17:00: inside-out of the window 12–18 → not late, 60m early → SL. (Default window would say HalfDay.)
  assert.equal(ops({ events: site("11:00", "17:00"), plan }).status, "SL");
});

// ── unsorted events / duplicates / edge timestamps ──────────────────────────────────────────
test("events are scored by TIME, not array order: reversed and shuffled arrays agree", () => {
  const sorted = [ev("office_in", "09:00"), ev("office_in", "10:30"), ev("office_out", "12:00"), ev("office_out", "18:00")];
  const reversed = [...sorted].reverse();
  const shuffled = [sorted[2], sorted[1], sorted[3], sorted[0]];
  for (const events of [sorted, reversed, shuffled]) {
    assert.equal(statusOf({ events }), "Present"); // first in 09:00, last out 18:00
  }
  // The late in (10:30) is NOT the first in; the early out (12:00) is NOT the last out.
  assert.equal(statusOf({ events: [ev("office_out", "17:00"), ev("office_in", "10:30")] }), "HalfDay");
});

test("scoreUserDay does not reorder the caller's array (it sorts a copy)", () => {
  const events = [ev("office_out", "18:00"), ev("office_in", "10:00")];
  const before = [...events];
  scoreUserDay({ role: "office", events, plan: undefined, leave: undefined, plBalance: 0 });
  assert.deepStrictEqual(events, before);
  assert.strictEqual(events[0], before[0]);
});

test("non-attendance event types are ignored (e.g. a conveyance/other type in the same list)", () => {
  const events = [ev("office_in", "10:00"), { type: "site_visit", timestamp: at("09:00"), userId: "u1" }, ev("office_out", "18:00")];
  assert.equal(statusOf({ events }), "Present");
});

test("out BEFORE in (pinned as-is): last out is earlier than first in → early-out, so SL for a punctual in", () => {
  // first in 10:00 (600), last out 09:00 (540): late 0, early 1080-540 → SL.
  assert.equal(statusOf({ events: [ev("office_in", "10:00"), ev("office_out", "09:00")] }), "SL");
});

test("a punch with no timestamp sorts first and reads as -60 minutes (pinned as-is)", () => {
  // Missing timestamp → getHourIST = -1, minute 0 → -60min, i.e. "very early" — never late.
  const noTs = { type: "office_in", userId: "u1" };
  assert.equal(statusOf({ events: [noTs, ev("office_out", "18:00")] }), "Present");
  assert.equal(statusOf({ events: [noTs, ev("office_out", "17:00")] }), "SL");
});

// ── daily_hours: eligibility + arithmetic ───────────────────────────────────────────────────
test("dailyHours eligibility: ONLY roles that run the OT/shortage ledger (operations) AND both punches", () => {
  // operations + both punches → yes
  assert.ok("dailyHours" in ops({ events: site("10:00", "18:00") }));
  // operations + one punch, or none, or leave → no
  assert.equal("dailyHours" in ops({ events: [ev("site_in", "10:00")] }), false);
  assert.equal("dailyHours" in ops({ events: [ev("site_out", "18:00")] }), false);
  assert.equal("dailyHours" in ops({ events: [] }), false);
  assert.equal("dailyHours" in ops({ events: [], leave: { id: "l1" }, plBalance: 3 }), false);
  // punches of the wrong family for operations (office punches) → no in/out → no
  assert.equal("dailyHours" in ops({ events: office("10:00", "18:00") }), false);
  // every other role, even fully punched → no
  for (const role of ["office", "admin", "sales", undefined, "intern"]) {
    assert.equal("dailyHours" in score({ role, events: [...office("10:00", "18:00"), ...site("10:00", "18:00")] }), false, String(role));
  }
});

test("dailyHours is exactly the four numbers, no more", () => {
  assert.deepStrictEqual(ops({ events: site("10:00", "18:00") }), {
    status: "Present",
    dailyHours: { plannedMins: 480, actualMins: 480, shortageMins: 0, otMins: 0 },
  });
});

test("dailyHours arithmetic on the default window (600–1080): late-out earns OT, arriving early earns nothing", () => {
  // 09:00–19:00: actual 600; nothing short; OT = 19:00 - 18:00 = 60. Early arrival adds no OT.
  assert.deepStrictEqual(ops({ events: site("09:00", "19:00") }), {
    status: "Present", dailyHours: { plannedMins: 480, actualMins: 600, shortageMins: 0, otMins: 60 },
  });
});

test("dailyHours: late-in + early-out both count as shortage (30 + 60), no OT", () => {
  assert.deepStrictEqual(ops({ events: site("10:30", "17:00") }), {
    status: "HalfDay", dailyHours: { plannedMins: 480, actualMins: 390, shortageMins: 90, otMins: 0 },
  });
});

test("dailyHours: early-out only", () => {
  assert.deepStrictEqual(ops({ events: site("09:00", "17:00") }), {
    status: "SL", dailyHours: { plannedMins: 480, actualMins: 480, shortageMins: 60, otMins: 0 },
  });
});

test("dailyHours: late-in AND late-out — shortage and OT are independent", () => {
  assert.deepStrictEqual(ops({ events: site("11:00", "19:00") }), {
    status: "HalfDay", dailyHours: { plannedMins: 480, actualMins: 480, shortageMins: 60, otMins: 60 },
  });
});

test("dailyHours uses the PLANNED window when one exists", () => {
  const plan = { startTime: "08:00", endTime: "16:00" };
  // start 480, end 960. in 08:30 (510), out 16:45 (1005): actual 495; shortage 30; OT 45.
  assert.deepStrictEqual(ops({ events: site("08:30", "16:45"), plan }), {
    status: "HalfDay", dailyHours: { plannedMins: 480, actualMins: 495, shortageMins: 30, otMins: 45 },
  });
  // A longer plan: 08:00–20:00 → planned 720.
  assert.deepStrictEqual(ops({ events: site("08:00", "20:00"), plan: { startTime: "08:00", endTime: "20:00" } }), {
    status: "Present", dailyHours: { plannedMins: 720, actualMins: 720, shortageMins: 0, otMins: 0 },
  });
});

test("dailyHours with an inverted plan uses the 480-minute default window", () => {
  assert.deepStrictEqual(ops({ events: site("10:00", "18:00"), plan: { startTime: "18:00", endTime: "10:00" } }), {
    status: "Present", dailyHours: { plannedMins: 480, actualMins: 480, shortageMins: 0, otMins: 0 },
  });
});

test("dailyHours across several punches: first in → last out, unsorted, mixed site/market", () => {
  const events = [ev("market_out", "19:00"), ev("site_in", "09:00"), ev("market_in", "10:30"), ev("site_out", "12:00")];
  assert.deepStrictEqual(ops({ events }), {
    status: "Present", dailyHours: { plannedMins: 480, actualMins: 600, shortageMins: 0, otMins: 60 },
  });
});

test("dailyHours out-before-in (pinned as-is): actual clamps to 0, shortage is the whole early-out", () => {
  // in 10:00 (600), out 09:00 (540): actual max(0,-60)=0; shortage 0 + (1080-540) = 540; OT 0.
  assert.deepStrictEqual(ops({ events: [ev("site_in", "10:00"), ev("site_out", "09:00")] }), {
    status: "SL", dailyHours: { plannedMins: 480, actualMins: 0, shortageMins: 540, otMins: 0 },
  });
});

test("dailyHours with a missing out timestamp (pinned as-is): reads as -60min → 1140 shortage", () => {
  // out = -60: actual max(0,-660)=0; shortage 0 + (1080 - -60) = 1140; OT max(0,-60-1080)=0.
  assert.deepStrictEqual(ops({ events: [ev("site_in", "10:00"), { type: "site_out", userId: "u1" }] }), {
    status: "SL", dailyHours: { plannedMins: 480, actualMins: 0, shortageMins: 1140, otMins: 0 },
  });
});

// ── buildStatusDoc: the EXACT doc the main branch writes ────────────────────────────────────
const USER = { id: "u1", name: "Asha", employeeId: "E-7", role: "operations", plBalance: 3 };
const NOW = { fakeTimestamp: "now-1" };
const build = (over) => buildStatusDoc({ user: USER, today: DATE, status: "Present", salaryCredit: undefined, now: () => NOW, ...over });

test("buildStatusDoc: the exact field set for a non-SCHL day (deepStrictEqual against the old literal)", () => {
  assert.deepStrictEqual(build(), {
    date: DATE, userId: "u1", userName: "Asha",
    employeeId: "E-7", role: "operations", status: "Present",
    markedBy: "auto", updatedAt: NOW,
  });
});

test("buildStatusDoc: SCHL paid and unpaid carry salaryCredit (0 is kept, not dropped)", () => {
  assert.deepStrictEqual(build({ status: "SCHL", salaryCredit: 1 }), {
    date: DATE, userId: "u1", userName: "Asha", employeeId: "E-7", role: "operations",
    status: "SCHL", salaryCredit: 1, markedBy: "auto", updatedAt: NOW,
  });
  const unpaid = build({ status: "SCHL", salaryCredit: 0 });
  assert.equal("salaryCredit" in unpaid, true);
  assert.equal(unpaid.salaryCredit, 0);
});

test("buildStatusDoc: salaryCredit key is ABSENT (not undefined, not null) whenever it is undefined", () => {
  const doc = build({ status: "Absent", salaryCredit: undefined });
  assert.equal("salaryCredit" in doc, false);
  assert.equal(Object.values(doc).includes(undefined), false, "Firestore rejects undefined field values");
  const omitted = buildStatusDoc({ user: USER, today: DATE, status: "Absent", now: () => NOW });
  assert.equal("salaryCredit" in omitted, false);
});

test("buildStatusDoc: only `undefined` suppresses salaryCredit (null would be written, as before)", () => {
  assert.equal("salaryCredit" in build({ salaryCredit: null }), true);
});

test("buildStatusDoc: key order is identical to the old literal", () => {
  assert.deepStrictEqual(Object.keys(build({ status: "SCHL", salaryCredit: 1 })),
    ["date", "userId", "userName", "employeeId", "role", "status", "salaryCredit", "markedBy", "updatedAt"]);
  assert.deepStrictEqual(Object.keys(build()),
    ["date", "userId", "userName", "employeeId", "role", "status", "markedBy", "updatedAt"]);
});

test("buildStatusDoc: markedBy is always \"auto\"", () => {
  for (const status of ["Present", "HalfDay", "SL", "LNF", "Absent", "SCHL"]) {
    assert.equal(build({ status }).markedBy, "auto");
  }
});

test("buildStatusDoc: updatedAt is whatever `now()` returns — passed through by identity, called once", () => {
  let calls = 0;
  const stamp = { some: "timestamp" };
  const doc = buildStatusDoc({ user: USER, today: DATE, status: "Present", now: () => { calls++; return stamp; } });
  assert.strictEqual(doc.updatedAt, stamp);
  assert.equal(calls, 1);
});

test("buildStatusDoc: missing name/employeeId default to \"\"; role and id are passed through RAW (as the loop did)", () => {
  const doc = buildStatusDoc({ user: { id: "u9" }, today: DATE, status: "Absent", now: () => NOW });
  assert.equal(doc.userName, "");
  assert.equal(doc.employeeId, "");
  assert.equal(doc.userId, "u9");
  // Pinned as-is: `role: user.role` has NO `|| ""` fallback here (the rest-day branch does), so a
  // role-less user yields `role: undefined`. Reported as a finding, not fixed by this extraction.
  assert.equal("role" in doc, true);
  assert.equal(doc.role, undefined);
});

test("scoreUserDay → buildStatusDoc composes to the old status doc for a SCHL-paid user", () => {
  const s = scoreUserDay({ role: "operations", events: [], plan: undefined, leave: { id: "l" }, plBalance: USER.plBalance });
  assert.deepStrictEqual(buildStatusDoc({ user: USER, today: DATE, status: s.status, salaryCredit: s.salaryCredit, now: () => NOW }), {
    date: DATE, userId: "u1", userName: "Asha", employeeId: "E-7", role: "operations",
    status: "SCHL", salaryCredit: 1, markedBy: "auto", updatedAt: NOW,
  });
});

// ── partitionUsers ──────────────────────────────────────────────────────────────────────────
test("partitionUsers: Absent and SCHL go to txn, everything else to fast", () => {
  const items = ["Present", "HalfDay", "SL", "LNF", "Absent", "SCHL"].map((status, i) => ({ id: `u${i}`, status }));
  const { fast, txn } = partitionUsers(items);
  assert.deepStrictEqual(fast.map((x) => x.status), ["Present", "HalfDay", "SL", "LNF"]);
  assert.deepStrictEqual(txn.map((x) => x.status), ["Absent", "SCHL"]);
});

test("partitionUsers: any status outside {Absent, SCHL} — even unknown/odd ones — is fast; matching is exact", () => {
  const items = [{ status: "Sunday" }, { status: "Holiday" }, { status: "WO" }, { status: "PL" }, { status: undefined },
    { status: "absent" }, { status: "schl" }, {}];
  const { fast, txn } = partitionUsers(items);
  assert.equal(fast.length, items.length);
  assert.equal(txn.length, 0);
});

test("partitionUsers: keeps order, passes the SAME item objects through, does not mutate the input, empty is fine", () => {
  const a = { id: "a", status: "Absent" }, b = { id: "b", status: "Present" }, c = { id: "c", status: "SCHL" }, d = { id: "d", status: "LNF" };
  const input = [a, b, c, d];
  const { fast, txn } = partitionUsers(input);
  assert.deepStrictEqual(input, [a, b, c, d]);
  assert.strictEqual(fast[0], b);
  assert.strictEqual(fast[1], d);
  assert.strictEqual(txn[0], a);
  assert.strictEqual(txn[1], c);
  assert.deepStrictEqual(partitionUsers([]), { fast: [], txn: [] });
});

test("partitionUsers ∘ scoreUserDay: a dailyHours payload never lands in txn, and every dailyHours item is fast", () => {
  // Sweep roles × punch shapes × leave. Absent/SCHL only ever arise on an unpunched day, and
  // dailyHours needs both punches — so the two can never coincide. This pins that invariant.
  const punchShapes = [[], office("10:00", "18:00"), site("09:00", "19:00"), [ev("site_in", "10:00")], [ev("office_out", "18:00")],
    [ev("market_in", "10:00"), ev("market_out", "17:00")]];
  const items = [];
  for (const role of ["office", "admin", "sales", "operations", undefined]) {
    for (const events of punchShapes) {
      for (const leave of [undefined, { id: "l" }]) {
        for (const plBalance of [0, 2]) {
          items.push({ role, ...scoreUserDay({ role, events, plan: undefined, leave, plBalance }) });
        }
      }
    }
  }
  const { fast, txn } = partitionUsers(items);
  assert.equal(fast.length + txn.length, items.length);
  assert.ok(txn.length > 0 && fast.length > 0, "the sweep must exercise both sets");
  assert.equal(txn.some((x) => "dailyHours" in x), false);
  assert.equal(fast.some((x) => "dailyHours" in x), true);
  assert.equal(items.filter((x) => "dailyHours" in x).every((x) => fast.includes(x)), true);
  assert.equal(txn.every((x) => x.status === "Absent" || x.status === "SCHL"), true);
});
