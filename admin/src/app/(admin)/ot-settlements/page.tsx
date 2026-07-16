'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  getAllUsers, getAttendanceForDateRange, getPlannedHoursForDateRange,
  getOtApprovalsForDateRange, getHolidaysForDateRange, getAttendanceStatusForDateRange,
  getSettlementsForMonth, settleMonth, unlockMonthSettlement,
} from '@/lib/firestore';
import type { User, AttendanceRecord, PlannedHours, OtApproval, Holiday, AttendanceStatus, Settlement } from '@/types';
import { computeRangeLedger, settlementCash, type RangeLedger } from '@/lib/otAggregate';
import { usesOtShortageLedger } from '@/lib/roleCapabilities';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function formatMonthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function offsetMonth(ym: string, offset: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function minutesToDisplay(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const s = m === 0 ? `${h}h` : `${h}h ${m}m`;
  return mins < 0 ? `-${s}` : s;
}
function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

interface Row {
  user: User;
  ledger: RangeLedger;
  cash: number;
  settlement?: Settlement; // existing stored settlement, if any
}

export default function SettlementsPage() {
  const [month, setMonth]       = useState(currentYearMonth());
  const [users, setUsers]       = useState<User[]>([]);
  const [events, setEvents]     = useState<AttendanceRecord[]>([]);
  const [planned, setPlanned]   = useState<PlannedHours[]>([]);
  const [approvals, setApprovals] = useState<OtApproval[]>([]);
  const [statuses, setStatuses] = useState<AttendanceStatus[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [adminName, setAdminName] = useState('Admin');
  const [working, setWorking]   = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      if (!u) return;
      const snap = await getDoc(doc(db, 'users', u.uid));
      if (snap.exists()) setAdminName(snap.data().name ?? 'Admin');
    });
    return unsub;
  }, []);

  const start = `${month}-01`;
  const end   = `${month}-31`;

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [u, e, p, a, h, s, st] = await Promise.all([
        getAllUsers(),
        getAttendanceForDateRange(start, end),
        getPlannedHoursForDateRange(start, end),
        getOtApprovalsForDateRange(start, end),
        getHolidaysForDateRange(start, end),
        getAttendanceStatusForDateRange(start, end),
        getSettlementsForMonth(month),
      ]);
      setUsers(u); setEvents(e); setPlanned(p); setApprovals(a); setHolidays(h); setStatuses(s);
      setSettlements(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [start, end, month]);

  useEffect(() => { loadData(); }, [loadData]);

  const holidaySet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const settlementByUser = useMemo(() => {
    const m = new Map<string, Settlement>();
    settlements.forEach(s => m.set(s.userId, s));
    return m;
  }, [settlements]);

  const rows = useMemo<Row[]>(() => {
    return users
      .filter(u => usesOtShortageLedger(u.role)) // OT/shortage settlement is ledger-only (operations)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(u => {
        const ledger = computeRangeLedger(u.id, events, planned, approvals, statuses, holidaySet);
        const cash = settlementCash(u.salaryRate ?? 0, ledger.woDates.length, ledger.netMins);
        return { user: u, ledger, cash, settlement: settlementByUser.get(u.id) };
      });
  }, [users, events, planned, approvals, statuses, holidaySet, settlementByUser]);

  const blockers = useMemo(
    () => rows.filter(r => r.ledger.pendingDates.length > 0 || r.ledger.unauthorizedRestDates.length > 0),
    [rows],
  );
  const isLocked = rows.some(r => r.settlement?.locked);
  const lockInfo = rows.find(r => r.settlement?.locked)?.settlement;
  const totalCash = rows.reduce((s, r) => s + r.cash, 0);

  async function handleSettle() {
    if (blockers.length > 0) return;
    setWorking(true); setError('');
    try {
      await settleMonth(rows.map(r => ({
        month,
        userId: r.user.id,
        userName: r.user.name || '',
        employeeId: r.user.employeeId || '',
        role: r.user.role || '',
        autoOtMins: r.ledger.autoOtMins,
        restDayOtMins: r.ledger.restDayOtMins,
        grantedOtMins: r.ledger.grantedOtMins,
        shortageMins: r.ledger.shortageMins,
        woDays: r.ledger.woDates.length,
        woDebitMins: r.ledger.woDebitMins,
        netMins: r.ledger.netMins,
        salaryRate: r.user.salaryRate ?? 0,
        settlementCash: r.cash,
        locked: true,
        settledBy: adminName,
      })));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to settle. Try again.');
    }
    setWorking(false);
  }

  async function handleUnlock() {
    setWorking(true); setError('');
    try {
      await Promise.all(rows.filter(r => r.settlement).map(r => unlockMonthSettlement(r.user.id, month)));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock. Try again.');
    }
    setWorking(false);
  }

  function exportXlsx() {
    downloadSheet(`settlement_${month}`, 'Settlement', rows.map(r => ({
      Name: r.user.name,
      'Emp ID': r.user.employeeId ?? '',
      'Auto OT (mins)': r.ledger.autoOtMins,
      'Rest-day OT (mins)': r.ledger.restDayOtMins,
      'Granted OT (mins)': r.ledger.grantedOtMins,
      'Shortage (mins)': r.ledger.shortageMins,
      'WO days': r.ledger.woDates.length,
      'Net (mins)': r.ledger.netMins,
      'Salary Rate': r.user.salaryRate ?? 0,
      'Settlement (₹)': r.cash,
      Status: r.settlement?.locked ? 'Locked' : (r.ledger.pendingDates.length || r.ledger.unauthorizedRestDates.length ? 'Blocked' : 'Ready'),
    })));
  }

  const TH = 'text-left text-[11px] font-semibold tracking-[0.05em] uppercase text-[#A8A29E] px-[14px] py-3 bg-[#FCFBFA] border-b border-[#F0EEEB] whitespace-nowrap';

  return (
    <div className="max-w-[1240px]">
      {/* Month selector */}
      <div className="flex items-center gap-4 mb-5">
        <button onClick={() => setMonth(offsetMonth(month, -1))} className="btn-outline text-sm py-1 px-3">&larr;</button>
        <span className="text-lg font-semibold text-text-primary min-w-[160px] text-center">{formatMonthLabel(month)}</span>
        <button onClick={() => setMonth(offsetMonth(month, 1))} className="btn-outline text-sm py-1 px-3">&rarr;</button>
        <div className="ml-auto"><ExportButton onClick={exportXlsx} disabled={loading || rows.length === 0} /></div>
      </div>

      {/* Status banner + action */}
      {isLocked ? (
        <div className="mb-5 p-4 rounded-xl bg-[#EAF7F0] border border-[#D6EFE0] flex items-center justify-between gap-4">
          <div className="text-sm text-text-primary">
            <span className="font-semibold">🔒 {formatMonthLabel(month)} is settled & locked.</span>
            {lockInfo?.settledBy && <span className="text-text-secondary"> Settled by {lockInfo.settledBy}.</span>}
            <span className="text-text-secondary"> Total settlement {inr(totalCash)} — added to payroll TOTAL DUE.</span>
          </div>
          <button onClick={handleUnlock} disabled={working} className="btn-outline !py-1.5 !px-4 !text-sm whitespace-nowrap">
            {working ? 'Working…' : 'Unlock to revise'}
          </button>
        </div>
      ) : (
        <div className="mb-5 p-4 rounded-xl bg-[#FBFAF8] border border-[#F0EEEB]">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              <div className="font-semibold text-text-primary">Settle &amp; lock {formatMonthLabel(month)}</div>
              <div className="text-text-secondary text-xs mt-0.5">
                Freezes each ops employee&apos;s OT/shortage/WO into payroll. Total settlement {inr(totalCash)}.
              </div>
            </div>
            <button onClick={handleSettle} disabled={working || loading || rows.length === 0 || blockers.length > 0}
              className="btn-primary !py-2 !px-5 !text-sm whitespace-nowrap disabled:opacity-50">
              {working ? 'Settling…' : 'Settle & Lock'}
            </button>
          </div>
          {blockers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#F0EEEB] text-xs">
              <div className="font-semibold text-[#9A5B1E] mb-1">⚠ Resolve before locking ({blockers.length}):</div>
              <ul className="space-y-0.5 text-text-secondary">
                {blockers.map(b => (
                  <li key={b.user.id}>
                    <span className="font-medium text-text-primary">{b.user.name}</span>
                    {b.ledger.pendingDates.length > 0 && <> · {b.ledger.pendingDates.length} pending OT day(s) (approve/reject on OT &amp; Shortage)</>}
                    {b.ledger.unauthorizedRestDates.length > 0 && <> · {b.ledger.unauthorizedRestDates.length} unauthorized rest-day(s) (authorize on Attendance)</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {/* Table */}
      <div className="bg-white border border-[#E9E6E2] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-background rounded animate-pulse" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} pl-[18px]`}>Name</th>
                  <th className={TH}>Auto OT</th>
                  <th className={TH}>Rest-day OT</th>
                  <th className={TH}>Granted OT</th>
                  <th className={TH}>Shortage</th>
                  <th className={TH}>WO</th>
                  <th className={TH}>Net</th>
                  <th className={TH}>Settlement</th>
                  <th className={`${TH} pr-[18px]`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const blocked = r.ledger.pendingDates.length > 0 || r.ledger.unauthorizedRestDates.length > 0;
                  return (
                    <tr key={r.user.id} className="border-t border-[#F4F2EF]">
                      <td className="px-[14px] py-3 pl-[18px] font-medium text-text-primary whitespace-nowrap">
                        {r.user.name}<span className="block text-[11px] text-text-secondary font-mono">{r.user.employeeId || '—'}</span>
                      </td>
                      <td className="px-[14px] py-3 text-xs font-mono text-[#0A7A50]">{r.ledger.autoOtMins ? `+${minutesToDisplay(r.ledger.autoOtMins)}` : '—'}</td>
                      <td className="px-[14px] py-3 text-xs font-mono text-[#0A7A50]">{r.ledger.restDayOtMins ? `+${minutesToDisplay(r.ledger.restDayOtMins)}` : '—'}</td>
                      <td className="px-[14px] py-3 text-xs font-mono text-[#0A7A50]">{r.ledger.grantedOtMins ? `+${minutesToDisplay(r.ledger.grantedOtMins)}` : '—'}</td>
                      <td className="px-[14px] py-3 text-xs font-mono text-[#C42B2B]">{r.ledger.shortageMins ? `-${minutesToDisplay(r.ledger.shortageMins)}` : '—'}</td>
                      <td className="px-[14px] py-3 text-xs font-mono text-[#1A5FAF]">{r.ledger.woDates.length ? `${r.ledger.woDates.length}d · -${minutesToDisplay(r.ledger.woDebitMins)}` : '—'}</td>
                      <td className="px-[14px] py-3 text-xs font-mono font-semibold">
                        <span className={r.ledger.netMins < 0 ? 'text-[#C42B2B]' : r.ledger.netMins > 0 ? 'text-[#0A7A50]' : 'text-text-secondary'}>
                          {r.ledger.netMins < 0 ? '-' : '+'}{minutesToDisplay(r.ledger.netMins)}
                        </span>
                      </td>
                      <td className="px-[14px] py-3 text-xs font-mono font-semibold">
                        <span className={r.cash < 0 ? 'text-[#C42B2B]' : 'text-text-primary'}>{r.cash < 0 ? `-${inr(-r.cash)}` : inr(r.cash)}</span>
                      </td>
                      <td className="px-[14px] py-3 pr-[18px] text-xs whitespace-nowrap">
                        {r.settlement?.locked ? (
                          <span className="bg-[#EAF7F0] text-[#0A7A50] px-2 py-0.5 rounded font-semibold">Locked</span>
                        ) : blocked ? (
                          <span className="bg-[#FDF3E4] text-[#B26B07] px-2 py-0.5 rounded font-semibold">Blocked</span>
                        ) : (
                          <span className="text-text-secondary">Ready</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="py-10 text-center text-text-secondary text-sm">No operations employees.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-secondary mt-3">
        Net = approved OT (auto + rest-day + granted) − shortage − WO debit. Settlement ₹ = WO days × rate + net ÷ 8h × rate.
        Locked months feed payroll TOTAL DUE (paid in the following month&apos;s export).
      </p>
    </div>
  );
}
