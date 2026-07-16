'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getDashboardStats, getAllUsers, getAttendanceForDate, getAllLeaveRequests, approveLeave, rejectLeave } from '@/lib/firestore';
import type { User, AttendanceRecord, LeaveRequest } from '@/types';
import Icon, { type IconName } from '@/components/Icon';
import { Avatar, RoleBadge, TH, TD } from '@/components/ui';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';
import { istTodayStr } from '@/lib/date';
import { attendanceInTypes, attendanceOutTypes } from '@/lib/roleCapabilities';

interface Stats { totalUsers: number; totalSites: number; pendingLeaves: number; pendingActions: number; earliestPendingSeconds: number | null; todayCheckIns: number; }

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

  const [liveStatuses, setLiveStatuses] = useState<LiveStatus[]>([]);
  const [liveLoading, setLiveLoading]   = useState(true);

  const [pending, setPending]   = useState<LeaveRequest[]>([]);
  const [adminName, setAdminName] = useState('Admin');
  const [actioning, setActioning] = useState('');

  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [showLeavesModal, setShowLeavesModal] = useState(false);
  const reloadAllLeaves = () => getAllLeaveRequests().then(setAllLeaves).catch(console.error);

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

    getAllLeaveRequests('pending').then(setPending).catch(console.error);
    reloadAllLeaves();

    const todayDate = istTodayStr();
    Promise.all([getAllUsers(), getAttendanceForDate(todayDate)])
      .then(([users, events]) => {
        const ts = (e: AttendanceRecord) => (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
        const statuses: LiveStatus[] = users.map(user => {
          const userEvents = events.filter(e => e.userId === user.id).sort((a, b) => ts(a) - ts(b));
          // Ops are "in the field" across both site and market visits; office uses
          // office_in/out; sales (hybrid) counts either, so a site day still reads as in.
          const inTypes  = new Set<string>(attendanceInTypes(user.role));
          const outTypes = new Set<string>(attendanceOutTypes(user.role));
          const ins  = userEvents.filter(e => inTypes.has(e.type));
          const outs = userEvents.filter(e => outTypes.has(e.type));
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

  // Leaves whose date range overlaps the current calendar month (any status).
  const leavesThisMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEnd   = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
    return allLeaves.filter(l => l.fromDate <= monthEnd && l.toDate >= monthStart);
  }, [allLeaves]);

  const pendingSub = stats == null
    ? 'Needs review'
    : stats.pendingActions === 0
      ? 'All caught up'
      : stats.earliestPendingSeconds != null
        ? `Earliest since ${new Date(stats.earliestPendingSeconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`
        : 'Needs review';

  const statCards: { icon: IconName; value: string | number; label: string; sub: string; subColor: string; onClick?: () => void }[] = [
    { icon: 'users', value: stats?.totalUsers ?? '—',    label: 'Total employees',  sub: 'Active staff',        subColor: '#9A938C' },
    { icon: 'list',  value: stats?.todayCheckIns ?? '—', label: 'Checked in today', sub: `of ${stats?.totalUsers ?? '—'} staff`, subColor: '#9A938C' },
    { icon: 'leave', value: stats?.pendingActions ?? '—', label: 'Pending actions', sub: pendingSub,            subColor: '#B26B07' },
    { icon: 'calendar', value: leavesThisMonth.length,   label: 'Leaves this month', sub: 'Click to view calendar', subColor: '#2456C7', onClick: () => setShowLeavesModal(true) },
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
        {statCards.map(c => {
          const Tag = c.onClick ? 'button' : 'div';
          return (
            <Tag key={c.label} onClick={c.onClick}
              className={`bg-white border border-[#E9E6E2] rounded-2xl p-[18px] text-left ${c.onClick ? 'cursor-pointer hover:border-primary/40 transition-colors' : ''}`}>
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-primary/[0.12] text-primary"><Icon name={c.icon} size={18} /></div>
              <div className="font-mono text-[30px] font-semibold tracking-tight text-text-primary mt-[15px]">{c.value}</div>
              <div className="text-[13px] text-[#78716C] mt-0.5">{c.label}</div>
              <div className="text-[12px] font-medium mt-[9px]" style={{ color: c.subColor }}>{c.sub}</div>
            </Tag>
          );
        })}
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
        </div>
      </div>

      {showLeavesModal && (
        <LeavesModal
          leaves={allLeaves}
          adminName={adminName}
          onClose={() => setShowLeavesModal(false)}
          onChanged={reloadAllLeaves}
        />
      )}
    </div>
  );
}

// ── Leaves modal (calendar + pending actions) ───────────────────────────────

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function submittedSeconds(l: LeaveRequest): number {
  return (l.submittedAt as unknown as { seconds: number })?.seconds ?? 0;
}

function fmtSubmitted(l: LeaveRequest): string {
  const secs = submittedSeconds(l);
  if (!secs) return '—';
  return new Date(secs * 1000).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function LeavesModal({ leaves, adminName, onClose, onChanged }: {
  leaves: LeaveRequest[];
  adminName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [viewDate, setViewDate]       = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [actioning, setActioning]     = useState('');
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [error, setError]             = useState('');

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const firstWeekDay = new Date(year, month, 1).getDay();
  const calendarCells: (number | null)[] = [
    ...Array<null>(firstWeekDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  function leavesOn(ds: string) {
    return leaves.filter(l => l.fromDate <= ds && l.toDate >= ds);
  }
  const selectedLeaves = selectedDate ? leavesOn(selectedDate) : [];

  const pendingSorted = useMemo(
    () => leaves.filter(l => l.status === 'pending').sort((a, b) => submittedSeconds(a) - submittedSeconds(b)),
    [leaves],
  );

  async function handleApprove(l: LeaveRequest) {
    setActioning(l.id);
    try { await approveLeave(l.userId, l.id, adminName); onChanged(); }
    catch { setError('Approval failed.'); }
    setActioning('');
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setActioning(rejectTarget.id);
    try {
      await rejectLeave(rejectTarget.userId, rejectTarget.id, adminName, rejectComment);
      setRejectTarget(null);
      setRejectComment('');
      onChanged();
    } catch { setError('Rejection failed.'); }
    setActioning('');
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h2 className="text-lg font-bold text-text-primary">Leaves</h2>
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-xl leading-none">×</button>
          </div>

          <div className="overflow-y-auto p-5 space-y-5">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

            {/* Month calendar */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setViewDate(new Date(year, month - 1, 1))}
                  className="p-1.5 rounded-lg text-text-secondary hover:bg-background hover:text-text-primary transition-colors text-lg leading-none">‹</button>
                <h3 className="text-sm font-semibold text-text-primary">
                  {viewDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
                </h3>
                <button onClick={() => setViewDate(new Date(year, month + 1, 1))}
                  className="p-1.5 rounded-lg text-text-secondary hover:bg-background hover:text-text-primary transition-colors text-lg leading-none">›</button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {DAYS_OF_WEEK.map(d => (
                  <div key={d} className="text-center text-[11px] font-semibold text-text-secondary py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const ds = toDateStr(year, month, day);
                  const dayLeaves = leavesOn(ds);
                  const counts = {
                    pending:  dayLeaves.filter(l => l.status === 'pending').length,
                    approved: dayLeaves.filter(l => l.status === 'approved').length,
                    rejected: dayLeaves.filter(l => l.status === 'rejected').length,
                  };
                  const isSelected = ds === selectedDate;
                  return (
                    <button key={i} onClick={() => setSelectedDate(isSelected ? null : ds)}
                      className={`min-h-[54px] p-1.5 rounded-lg text-left transition-all border cursor-pointer ${
                        isSelected ? 'border-primary bg-accent-light shadow-sm' : 'border-transparent hover:border-border hover:bg-background'
                      }`}>
                      <div className="text-xs font-bold text-text-primary mb-1">{day}</div>
                      {dayLeaves.length > 0 && (
                        <div className="flex flex-wrap gap-0.5">
                          {counts.pending > 0 && <span className="text-[9px] leading-tight bg-amber-100 text-amber-700 rounded px-1 py-0.5">{counts.pending}P</span>}
                          {counts.approved > 0 && <span className="text-[9px] leading-tight bg-green-100 text-green-700 rounded px-1 py-0.5">{counts.approved}A</span>}
                          {counts.rejected > 0 && <span className="text-[9px] leading-tight bg-gray-100 text-gray-600 rounded px-1 py-0.5">{counts.rejected}R</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
                {[
                  { label: 'P = Pending',  cls: 'bg-amber-100 text-amber-700' },
                  { label: 'A = Approved', cls: 'bg-green-100 text-green-700' },
                  { label: 'R = Rejected', cls: 'bg-gray-100 text-gray-600' },
                ].map(({ label, cls }) => (
                  <span key={label} className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>
                ))}
              </div>
            </div>

            {/* Selected day detail */}
            {selectedDate && (
              <div>
                <div className="text-sm font-semibold text-text-primary mb-2">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                {selectedLeaves.length === 0 ? (
                  <div className="text-sm text-text-secondary">No leave requests on this day.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedLeaves.map(l => (
                      <div key={l.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2 text-sm">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.userName} size={28} />
                          <div>
                            <div className="font-medium text-text-primary">{l.userName}</div>
                            <div className="text-xs text-text-secondary">{l.leaveType} · {l.fromDate}{l.toDate !== l.fromDate ? ` – ${l.toDate}` : ''}</div>
                          </div>
                        </div>
                        <span className={l.status === 'approved' ? 'badge-approved' : l.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}>{l.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pending actions — oldest applied first */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-text-primary">Pending actions</div>
                <span className="font-mono text-[11.5px] font-semibold text-[#B26B07] bg-[#FDF3E4] rounded-[7px] px-2 py-0.5">{pendingSorted.length}</span>
              </div>
              {pendingSorted.length === 0 ? (
                <div className="text-sm text-text-secondary text-center py-4">All caught up — no pending requests.</div>
              ) : (
                <div className="space-y-2">
                  {pendingSorted.map(l => (
                    <div key={l.id} className="border border-border rounded-lg px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.userName} size={30} />
                          <div>
                            <div className="text-sm font-semibold text-text-primary">{l.userName}</div>
                            <div className="text-xs text-text-secondary">{l.leaveType} · {l.fromDate}{l.toDate !== l.fromDate ? ` – ${l.toDate}` : ''} · {l.totalDays}d</div>
                            <div className="text-[11px] text-[#A8A29E] mt-0.5">Applied {fmtSubmitted(l)}</div>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button disabled={actioning === l.id} onClick={() => { setRejectTarget(l); setRejectComment(''); }}
                            className="btn-outline !py-1 !px-2.5 !text-xs !text-[#C42B2B] !border-[#F0D3D3] hover:!bg-[#FBEAEA]">Decline</button>
                          <button disabled={actioning === l.id} onClick={() => handleApprove(l)}
                            className="btn-success !py-1 !px-2.5 !text-xs">Approve</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {rejectTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4" onClick={() => setRejectTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-text-primary mb-2">Reject Leave Request</h2>
            <p className="text-text-secondary text-sm mb-4">{rejectTarget.userName} — {rejectTarget.leaveType} ({rejectTarget.fromDate} to {rejectTarget.toDate})</p>
            <label className="label">Reason for rejection (optional)</label>
            <textarea className="input min-h-[80px]" value={rejectComment} onChange={e => setRejectComment(e.target.value)} placeholder="Enter reason…" />
            <div className="flex gap-3 mt-4">
              <button className="btn-danger flex-1" onClick={handleReject} disabled={!!actioning}>Reject</button>
              <button className="btn-outline flex-1" onClick={() => setRejectTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
