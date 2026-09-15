// Range/month-level OT/shortage/WO aggregation for one ops employee, built on the pure
// per-day `computeDayLedger`. Used by the Settlements page (and unit-tested via tsx — the
// domain types below are `import type`, so they're erased at runtime).

import type { AttendanceRecord, PlannedHours, OtApproval, AttendanceStatus } from '@/types';
import {
  computeDayLedger, netLedgerMins, WO_DEBIT_MINS, istMinuteOfDay,
  DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} from './otLedger';

const OPS_IN_TYPES  = new Set(['site_in', 'market_in']);
const OPS_OUT_TYPES = new Set(['site_out', 'market_out']);

function tsSeconds(e: AttendanceRecord): number {
  return (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
}
function hhmmToMinutes(s?: string): number {
  if (!s) return 0;
  const [h, m] = s.split(':').map(Number);
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
}
function isSunday(date: string): boolean {
  return new Date(date + 'T12:00:00').getDay() === 0;
}

export interface RangeLedger {
  autoOtMins: number;
  grantedOtMins: number;   // sum of (approvedMins − settledMins) across ot_approvals decisions (Protocol 3)
  shortageMins: number;
  woDates: string[];
  netMins: number;         // (auto + granted) − shortage; WO debt no longer participates (Protocol 3) — see wo_ledger
  pendingDates: string[];  // un-decided pending OT days (block settlement) — includes rest and WO days
  pendingOtMins: number;
}

export function computeRangeLedger(
  userId: string,
  events: AttendanceRecord[],
  planned: PlannedHours[],
  approvals: OtApproval[],
  statuses: AttendanceStatus[],
  holidays: Set<string>,
): RangeLedger {
  const plannedByDate = new Map<string, { startMin: number; endMin: number; declared: number }>();
  planned.filter(p => p.userId === userId).forEach(p => {
    const startMin = hhmmToMinutes(p.startTime), endMin = hhmmToMinutes(p.endTime);
    if (endMin > startMin) plannedByDate.set(p.date, { startMin, endMin, declared: Math.max(0, p.declaredOtMins ?? 0) });
  });

  const eventsByDate = new Map<string, AttendanceRecord[]>();
  events.filter(e => e.userId === userId).forEach(e => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date)!.push(e);
  });

  const apprByDate = new Map<string, OtApproval>();
  approvals.filter(a => a.userId === userId).forEach(a => apprByDate.set(a.date, a));

  // Regularized-to-Present days carry an effective in/out captured by the admin (missed-punch
  // fix). These override raw events for the date so the corrected day can carry shortage/OT.
  const overrideByDate = new Map<string, { inMin: number; outMin: number }>();
  statuses.filter(s => s.userId === userId && s.status === 'Present' && s.inTime && s.outTime).forEach(s => {
    const inMin = hhmmToMinutes(s.inTime), outMin = hhmmToMinutes(s.outTime);
    if (outMin > inMin) overrideByDate.set(s.date, { inMin, outMin });
  });

  // Protocol 3: WO dates are computed BEFORE the accrual loop (previously derived after it)
  // so each date's accrueDay call can suppress that date's shift math exactly like a rest day.
  const woDates = statuses.filter(s => s.userId === userId && s.status === 'WO').map(s => s.date).sort();
  const woDateSet = new Set(woDates);

  let autoOtMins = 0, shortageMins = 0, pendingOtMins = 0;
  const pendingDates: string[] = [];

  const accrueDay = (date: string, inMin: number, outMin: number) => {
    const info = plannedByDate.get(date);
    const led = computeDayLedger({
      shiftStartMin: info?.startMin ?? DEFAULT_SHIFT_START_MIN,
      shiftEndMin:   info?.endMin   ?? DEFAULT_SHIFT_END_MIN,
      inMin, outMin,
      declaredOtMins: info?.declared ?? 0,
      isRestDay: isSunday(date) || holidays.has(date),
      isWoDay: woDateSet.has(date),
    });
    shortageMins   += led.shortageMins;
    autoOtMins     += led.autoOtMins;
    const remaining = Math.max(0, led.pendingExtraMins - (apprByDate.get(date)?.requestedMins ?? 0));
    if (remaining > 0) { pendingOtMins += remaining; pendingDates.push(date); }
  };

  eventsByDate.forEach((dayEvents, date) => {
    if (overrideByDate.has(date)) return; // regularization in/out is authoritative for this date
    const ins  = dayEvents.filter(e => OPS_IN_TYPES.has(e.type));
    const outs = dayEvents.filter(e => OPS_OUT_TYPES.has(e.type));
    if (ins.length === 0) return;
    const firstIn = Math.min(...ins.map(tsSeconds));
    const lastOut = outs.length ? Math.max(...outs.map(tsSeconds)) : null;
    if (lastOut === null || lastOut <= firstIn) return; // open/invalid day
    accrueDay(date, istMinuteOfDay(firstIn), istMinuteOfDay(lastOut));
  });

  // A WO day's own status doc always wins over a stale Present-regularization override for the
  // same date (WO is the later, authoritative admin decision) — accrueDay already treats it as
  // a WO day via woDateSet regardless of which branch called it.
  overrideByDate.forEach(({ inMin, outMin }, date) => accrueDay(date, inMin, outMin));

  // Protocol 3: granted OT is net of whatever has already been spent settling a WO debt —
  // settled-away minutes must not ALSO count as payable cash (that would double-pay them).
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
export function settlementCash(salaryRate: number, woDays: number, netMins: number): number {
  const cash = woDays * salaryRate + (netMins / WO_DEBIT_MINS) * salaryRate;
  return Math.round(cash * 100) / 100;
}
