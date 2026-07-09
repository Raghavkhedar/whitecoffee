'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getDashboardStats, getConveyanceConfig, setConveyanceConfig, getAllUsers, getAttendanceForDate, getAllLeaveRequests, approveLeave, rejectLeave } from '@/lib/firestore';
import type { User, AttendanceRecord, LeaveRequest } from '@/types';
import Icon, { type IconName } from '@/components/Icon';
import { Avatar, RoleBadge, TH, TD } from '@/components/ui';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';
import { istTodayStr } from '@/lib/date';

interface Stats { totalUsers: number; totalSites: number; pendingLeaves: number; todayCheckIns: number; }

interface LiveStatus {
  user: User;
  checkedIn: boolean;
  location: string;
  inTime: Date | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats]     = useState<Stats | null>(null);
  const [error, setError]     = useState('');

  const [rate1, setRate1]           = useState('');
  const [rate2, setRate2]           = useState('');
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesSaving, setRatesSaving]   = useState(false);
  const [ratesMsg, setRatesMsg]     = useState('');

  const [liveStatuses, setLiveStatuses] = useState<LiveStatus[]>([]);
  const [liveLoading, setLiveLoading]   = useState(true);

  const [pending, setPending]   = useState<LeaveRequest[]>([]);
  const [adminName, setAdminName] = useState('Admin');
  const [actioning, setActioning] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) return;
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) setAdminName(snap.data().name ?? 'Admin');
    });
    return unsub;
  }, []);

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

    getConveyanceConfig()
      .then(c => { setRate1(c.rate1 ? String(c.rate1) : ''); setRate2(c.rate2 ? String(c.rate2) : ''); })
      .catch((err: unknown) => setRatesMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setRatesLoading(false));

    getAllLeaveRequests('pending').then(setPending).catch(console.error);

    const todayDate = istTodayStr();
    Promise.all([getAllUsers(), getAttendanceForDate(todayDate)])
      .then(([users, events]) => {
        const ts = (e: AttendanceRecord) => (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
        const statuses: LiveStatus[] = users.map(user => {
          const isOps = user.role === 'operations';
          const userEvents = events.filter(e => e.userId === user.id).sort((a, b) => ts(a) - ts(b));
          // Ops are "in the field" across both site and market visits; office uses office_in/out.
          const isIn  = (e: AttendanceRecord) => isOps ? (e.type === 'site_in'  || e.type === 'market_in')  : e.type === 'office_in';
          const isOut = (e: AttendanceRecord) => isOps ? (e.type === 'site_out' || e.type === 'market_out') : e.type === 'office_out';
          const ins  = userEvents.filter(isIn);
          const outs = userEvents.filter(isOut);
          const lastIn  = ins.length > 0 ? ins[ins.length - 1] : null;
          const lastOut = outs.length > 0 ? outs[outs.length - 1] : null;
          const checkedIn = lastIn != null && (lastOut == null || ts(lastIn) > ts(lastOut));
          return {
            user,
            checkedIn,
            location: checkedIn && lastIn ? (lastIn.siteName || lastIn.marketName || 'Office') : '',
            inTime: checkedIn && lastIn?.timestamp ? lastIn.timestamp.toDate() : null,
          };
        });
        setLiveStatuses(statuses);
      })
      .catch(console.error)
      .finally(() => setLiveLoading(false));
  }, []);

  async function saveRates() {
    setRatesMsg('');
    const r1 = parseFloat(rate1) || 0;
    const r2 = parseFloat(rate2) || 0;
    if (r1 <= 0 && r2 <= 0) { setRatesMsg('Enter at least one rate.'); return; }
    setRatesSaving(true);
    try {
      await setConveyanceConfig(r1, r2);
      setRatesMsg('Saved');
      setTimeout(() => setRatesMsg(''), 2000);
    } catch (err: unknown) {
      setRatesMsg(err instanceof Error ? err.message : 'Failed to save.');
    }
    setRatesSaving(false);
  }

  async function handleApprove(l: LeaveRequest) {
    setActioning(l.id);
    try { await approveLeave(l.userId, l.id, adminName); setPending(p => p.filter(x => x.id !== l.id)); }
    catch { setError('Approval failed.'); }
    setActioning('');
  }
  async function handleReject(l: LeaveRequest) {
    setActioning(l.id);
    try { await rejectLeave(l.userId, l.id, adminName, ''); setPending(p => p.filter(x => x.id !== l.id)); }
    catch { setError('Rejection failed.'); }
    setActioning('');
  }

  const activeCount = liveStatuses.filter(s => s.checkedIn).length;

  const statCards: { icon: IconName; value: string | number; label: string; sub: string; subColor: string }[] = [
    { icon: 'users', value: stats?.totalUsers ?? '—',    label: 'Total employees',  sub: 'Active staff',        subColor: '#9A938C' },
    { icon: 'list',  value: stats?.todayCheckIns ?? '—', label: 'Checked in today', sub: `of ${stats?.totalUsers ?? '—'} staff`, subColor: '#9A938C' },
    { icon: 'leave', value: stats?.pendingLeaves ?? '—', label: 'Pending leaves',   sub: 'Needs review',        subColor: '#B26B07' },
    { icon: 'pin',   value: stats?.totalSites ?? '—',    label: 'Active sites',     sub: 'Geofenced',           subColor: '#9A938C' },
  ];

  const sortedLive = [...liveStatuses].sort((a, b) => {
    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? -1 : 1;
    return a.user.name.localeCompare(b.user.name);
  });

  function exportLive() {
    downloadSheet('live_attendance', 'Live', sortedLive.map(s => ({
      Name: s.user.name,
      Role: s.user.role,
      Status: s.checkedIn ? 'Checked in' : 'Not in',
      Location: s.checkedIn ? s.location : '',
      Since: s.checkedIn && s.inTime ? s.inTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '',
    })));
  }

  return (
    <div className="flex flex-col gap-[22px] max-w-[1240px]">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(c => (
          <div key={c.label} className="bg-white border border-[#E9E6E2] rounded-2xl p-[18px]">
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-primary/[0.12] text-primary"><Icon name={c.icon} size={18} /></div>
            <div className="font-mono text-[30px] font-semibold tracking-tight text-text-primary mt-[15px]">{c.value}</div>
            <div className="text-[13px] text-[#78716C] mt-0.5">{c.label}</div>
            <div className="text-[12px] font-medium mt-[9px]" style={{ color: c.subColor }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.65fr_1fr] gap-[18px] items-start">
        {/* Live attendance */}
        <div className="bg-white border border-[#E9E6E2] rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-[18px] py-4 border-b border-[#F1EFEC]">
            <div>
              <div className="text-[14.5px] font-semibold text-text-primary">Live Attendance</div>
              <div className="text-[12px] text-[#9A938C] mt-px">Real-time check-in status</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-[7px] text-[12px] text-[#0A7A50] font-medium">
                <span className="w-[7px] h-[7px] rounded-full bg-[#16A06A] shadow-[0_0_0_3px_#DCF5E9]" />{activeCount} active now
              </span>
              <ExportButton onClick={exportLive} disabled={liveLoading || sortedLive.length === 0} />
            </div>
          </div>
          {liveLoading ? (
            <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${TH} pl-[18px]`}>Employee</th>
                    <th className={TH}>Role</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Location</th>
                    <th className={`${TH} pr-[18px] text-right`}>Since</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLive.map(s => (
                    <tr key={s.user.id} className="border-t border-[#F4F2EF] hover:bg-[#FBFAF8] transition-colors">
                      <td className={`${TD} pl-[18px]`}>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={s.user.name} size={30} />
                          <span className="font-medium text-[#2A241F]">{s.user.name}</span>
                        </div>
                      </td>
                      <td className={TD}><RoleBadge role={s.user.role} /></td>
                      <td className={TD}>
                        <span className="inline-flex items-center gap-[7px] text-[12.5px] font-medium" style={{ color: s.checkedIn ? '#0A7A50' : '#A8A29E' }}>
                          <span className="w-[7px] h-[7px] rounded-full" style={{ background: s.checkedIn ? '#16A06A' : '#CFC9C1' }} />
                          {s.checkedIn ? 'Checked in' : 'Not in'}
                        </span>
                      </td>
                      <td className={`${TD} text-[#6B635C]`}>{s.checkedIn ? s.location : '—'}</td>
                      <td className={`${TD} pr-[18px] text-right font-mono text-[#6B635C]`}>
                        {s.checkedIn && s.inTime ? s.inTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-[18px]">
          {/* Needs attention */}
          <div className="bg-white border border-[#E9E6E2] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-[17px] py-[15px] border-b border-[#F1EFEC]">
              <div className="text-[14px] font-semibold text-text-primary">Needs your attention</div>
              <span className="font-mono text-[11.5px] font-semibold text-[#B26B07] bg-[#FDF3E4] rounded-[7px] px-2 py-0.5">{pending.length}</span>
            </div>
            <div className="p-2">
              {pending.length === 0 ? (
                <div className="px-3 py-[22px] text-center text-[12.5px] text-[#9A938C]">All caught up — no pending requests.</div>
              ) : pending.slice(0, 5).map(l => (
                <div key={l.id} className="px-2.5 py-[11px] rounded-[10px] hover:bg-[#FBFAF8] transition-colors">
                  <div className="flex items-center gap-[9px]">
                    <Avatar name={l.userName} size={30} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#2A241F] truncate">{l.userName}</div>
                      <div className="text-[11.5px] text-[#9A938C]">{l.leaveType} · {l.fromDate}{l.toDate && l.toDate !== l.fromDate ? ` – ${l.toDate}` : ''}</div>
                    </div>
                    <span className="font-mono text-[11px] text-[#9A938C]">{l.totalDays}d</span>
                  </div>
                  <div className="flex gap-[7px] mt-[9px] pl-[39px]">
                    <button disabled={actioning === l.id} onClick={() => handleApprove(l)}
                      className="text-[12px] font-semibold text-[#0A7A50] bg-[#EAF7F0] hover:bg-[#D8F0E4] rounded-[7px] px-2.5 py-1 transition-colors disabled:opacity-50">Approve</button>
                    <button disabled={actioning === l.id} onClick={() => handleReject(l)}
                      className="text-[12px] font-semibold text-[#C42B2B] bg-[#FBEAEA] hover:bg-[#F6DADA] rounded-[7px] px-2.5 py-1 transition-colors disabled:opacity-50">Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-white border border-[#E9E6E2] rounded-2xl p-2">
            <div className="text-[14px] font-semibold text-text-primary px-[9px] pt-2 pb-1">Quick actions</div>
            {[
              { icon: 'users' as IconName, label: 'Add new employee', href: '/users' },
              { icon: 'leave' as IconName, label: 'Review pending leaves', href: '/leaves' },
              { icon: 'calendar' as IconName, label: 'Open attendance', href: '/attendance' },
              { icon: 'doc' as IconName, label: 'View submissions', href: '/submissions' },
            ].map(q => (
              <button key={q.href} onClick={() => router.push(q.href)}
                className="flex items-center gap-[11px] w-full p-2.5 rounded-[10px] text-[13px] font-medium text-[#3A332D] hover:bg-[#FBFAF8] transition-colors">
                <span className="flex w-[18px] text-primary"><Icon name={q.icon} size={17} /></span>{q.label}
                <span className="ml-auto text-[#C4BEB6] flex"><Icon name="chevron" size={15} /></span>
              </button>
            ))}
          </div>

          {/* Conveyance rates */}
          <div className="bg-white border border-[#E9E6E2] rounded-2xl p-[18px]">
            <div className="text-[14px] font-semibold text-text-primary mb-3">Conveyance Rates</div>
            {ratesLoading ? (
              <div className="text-text-secondary text-sm">Loading…</div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="label">Conveyance 1 (₹/km)</label>
                  <input className="input" type="number" step="any" min="0" value={rate1} onChange={e => setRate1(e.target.value)} placeholder="e.g. 2.5" />
                </div>
                <div>
                  <label className="label">Conveyance 2 (₹/km)</label>
                  <input className="input" type="number" step="any" min="0" value={rate2} onChange={e => setRate2(e.target.value)} placeholder="e.g. 4.0" />
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button className="btn-primary" onClick={saveRates} disabled={ratesSaving}>{ratesSaving ? 'Saving…' : 'Save Rates'}</button>
                  {ratesMsg && <span className={`text-sm ${ratesMsg === 'Saved' ? 'text-[#0A7A50]' : 'text-red-500'}`}>{ratesMsg}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
