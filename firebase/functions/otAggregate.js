"use strict";

// Range/month OT/shortage/WO aggregation for one ops employee — CommonJS port of
// admin/src/lib/otAggregate.ts, built on the pure per-day computeDayLedger (otLedger.js).
// Divergence from the TS source: isSunday uses UTC-safe getUTCDay() (functions run on UTC).

const {
  computeDayLedger, netLedgerMins, WO_DEBIT_MINS, istMinuteOfDay,
  DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");

const OPS_IN_TYPES  = new Set(["site_in", "market_in"]);
const OPS_OUT_TYPES = new Set(["site_out", "market_out"]);

function tsSeconds(e) {
  return (e.timestamp && e.timestamp.seconds) || 0;
}
function hhmmToMin(s) {
  if (!s) return 0;
  const [h, m] = String(s).split(":").map(Number);
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
}
// UTC-safe weekday: functions run on UTC, so read getUTCDay() on a Z-anchored string.
function isSunday(date) {
  return new Date(date + "T00:00:00Z").getUTCDay() === 0;
}

// Aggregate one ops employee's ledger over already-fetched arrays for a month/range.
function computeRangeLedger(userId, events, planned, approvals, statuses, holidays) {
  const plannedByDate = new Map();
  planned.filter((p) => p.userId === userId).forEach((p) => {
    const startMin = hhmmToMin(p.startTime), endMin = hhmmToMin(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins || 0) });
  });

  const eventsByDate = new Map();
  events.filter((e) => e.userId === userId).forEach((e) => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date).push(e);
  });

  const apprByDate = new Map();
  approvals.filter((a) => a.userId === userId).forEach((a) => apprByDate.set(a.date, a));

  const overrideByDate = new Map();
  statuses.filter((s) => s.userId === userId && s.status === "Present" && s.inTime && s.outTime).forEach((s) => {
    const inMin = hhmmToMin(s.inTime), outMin = hhmmToMin(s.outTime);
    if (outMin > inMin) overrideByDate.set(s.date, { inMin, outMin });
  });

  const woDates = statuses.filter((s) => s.userId === userId && s.status === "WO").map((s) => s.date).sort();
  const woDateSet = new Set(woDates);

  let autoOtMins = 0, shortageMins = 0, pendingOtMins = 0;
  const pendingDates = [];

  const accrueDay = (date, inMin, outMin) => {
    const info = plannedByDate.get(date);
    const led = computeDayLedger({
      shiftStartMin: info ? info.startMin : DEFAULT_SHIFT_START_MIN,
      shiftEndMin:   info ? info.endMin   : DEFAULT_SHIFT_END_MIN,
      inMin, outMin,
      declaredOtMins: info ? info.declared : 0,
      isRestDay: isSunday(date) || holidays.has(date),
      isWoDay: woDateSet.has(date),
    });
    shortageMins += led.shortageMins;
    autoOtMins   += led.autoOtMins;
    const remaining = Math.max(0, led.pendingExtraMins - ((apprByDate.get(date) || {}).requestedMins || 0));
    if (remaining > 0) { pendingOtMins += remaining; pendingDates.push(date); }
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return;
    const ins  = dayEvents.filter((e) => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter((e) => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return;
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });

  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  const grantedOtMins = Array.from(apprByDate.values())
    .reduce((s, a) => s + Math.max(0, (Number(a.approvedMins) || 0) - (Number(a.settledMins) || 0)), 0);
  const netMins = netLedgerMins({ autoOtMins, approvedGrantedMins: grantedOtMins, shortageMins });

  return {
    autoOtMins, grantedOtMins, shortageMins,
    woDates, netMins,
    pendingDates: pendingDates.sort(), pendingOtMins,
  };
}

// Settlement cash added to payroll TOTAL DUE: WO paid days — unconditional as of Protocol 3,
// no longer entangled with whether OT ever offsets them (that offsetting now happens entirely
// through the separate wo_ledger settlement flow, outside this function) — plus net OT/
// shortage at the straight per-minute rate (salaryRate/480).
function settlementCash(salaryRate, woDays, netMins) {
  const cash = woDays * salaryRate + (netMins / WO_DEBIT_MINS) * salaryRate;
  return Math.round(cash * 100) / 100;
}

// Per-date OT/WO cash for one ops employee. Mirrors computeRangeLedger's accrual but emits each
// date's rupees instead of summing, so a daily snapshot can freeze per day. Returns UNROUNDED
// values (caller rounds); their sum equals settlementCash(rate, woDates.length, netMins) exactly.
function dailyOtWoCash(userId, salaryRate, events, planned, approvals, statuses, holidays) {
  const rate = Number(salaryRate) || 0;

  const plannedByDate = new Map();
  planned.filter((p) => p.userId === userId).forEach((p) => {
    const startMin = hhmmToMin(p.startTime), endMin = hhmmToMin(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins || 0) });
  });

  const eventsByDate = new Map();
  events.filter((e) => e.userId === userId).forEach((e) => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date).push(e);
  });

  const apprByDate = new Map();
  approvals.filter((a) => a.userId === userId).forEach((a) => apprByDate.set(a.date, a));

  const overrideByDate = new Map();
  statuses.filter((s) => s.userId === userId && s.status === "Present" && s.inTime && s.outTime).forEach((s) => {
    const inMin = hhmmToMin(s.inTime), outMin = hhmmToMin(s.outTime);
    if (outMin > inMin) overrideByDate.set(s.date, { inMin, outMin });
  });

  const woByDate = new Set(
    statuses.filter((s) => s.userId === userId && s.status === "WO").map((s) => s.date),
  );

  const perDate = new Map(); // date → { autoOtMins, shortageMins }
  const ensure = (d) => {
    if (!perDate.has(d)) perDate.set(d, { autoOtMins: 0, shortageMins: 0 });
    return perDate.get(d);
  };
  const accrueDay = (date, inMin, outMin) => {
    const info = plannedByDate.get(date);
    const led = computeDayLedger({
      shiftStartMin: info ? info.startMin : DEFAULT_SHIFT_START_MIN,
      shiftEndMin:   info ? info.endMin   : DEFAULT_SHIFT_END_MIN,
      inMin, outMin,
      declaredOtMins: info ? info.declared : 0,
      isRestDay: isSunday(date) || holidays.has(date),
      isWoDay: woByDate.has(date),
    });
    const acc = ensure(date);
    acc.shortageMins += led.shortageMins;
    acc.autoOtMins   += led.autoOtMins;
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return;
    const ins  = dayEvents.filter((e) => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter((e) => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return;
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });
  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  // Union of every date carrying a contribution: worked/override, approval, or WO.
  const dates = new Set([...perDate.keys(), ...apprByDate.keys(), ...woByDate]);
  const cash = new Map();
  dates.forEach((date) => {
    const p = perDate.get(date) || { autoOtMins: 0, shortageMins: 0 };
    const appr = apprByDate.get(date) || {};
    const granted = Math.max(0, (Number(appr.approvedMins) || 0) - (Number(appr.settledMins) || 0));
    const isWO = woByDate.has(date);
    // Protocol 3: a WO date pays unconditionally (no debit term); OT/shortage on any date
    // (WO or not) nets independently at the straight per-minute rate.
    const netMinsForDate = p.autoOtMins + granted - p.shortageMins;
    cash.set(date, (isWO ? rate : 0) + (netMinsForDate / WO_DEBIT_MINS) * rate);
  });
  return cash;
}

module.exports = { computeRangeLedger, settlementCash, dailyOtWoCash };
