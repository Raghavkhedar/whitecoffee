'use client';
import { useEffect, useMemo, useState } from 'react';
import { getAllLeaveRequests, getAllUsers } from '@/lib/firestore';
import { effectiveGrantedDates } from '@/lib/leaveDates';
import { istTodayStr } from '@/lib/date';
import type { LeaveRequest, User } from '@/types';

// "Department" has no backing field, so people are grouped by role.
const ROLES = ['admin', 'office', 'operations', 'sales'] as const;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function LeaveCalendarPage() {
  const today = istTodayStr();
  const [month, setMonth] = useState(today.slice(0, 7)); // yyyy-MM
  const [selected, setSelected] = useState(today);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [roleOf, setRoleOf] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getAllLeaveRequests('approved'), getAllUsers(true)])
      .then(([l, users]: [LeaveRequest[], User[]]) => {
        setLeaves(l);
        setRoleOf(Object.fromEntries(users.map(u => [u.id, u.role])));
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // date → leaves covering it (granted minus cancelled)
  const byDate = useMemo(() => {
    const m: Record<string, LeaveRequest[]> = {};
    for (const l of leaves) for (const d of effectiveGrantedDates(l)) (m[d] ||= []).push(l);
    return m;
  }, [leaves]);

  const [y, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday-first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];

  function shift(n: number) {
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  const onLeave = byDate[selected] ?? [];
  const groups = ROLES.map(r => ({ role: r, people: onLeave.filter(l => roleOf[l.userId] === r) }));
  const other = onLeave.filter(l => !ROLES.includes(roleOf[l.userId] as typeof ROLES[number]));
  if (other.length) groups.push({ role: 'other' as never, people: other });

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-text-primary mb-4">Leave Calendar</h1>
      {error && <p className="text-red-600 mb-3">{error}</p>}
      {loading ? <p className="text-text-secondary">Loading…</p> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <button className="btn-outline" onClick={() => shift(-1)}>‹</button>
              <strong>{new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
              <button className="btn-outline" onClick={() => shift(1)}>›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary mb-1">
              {DOW.map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => d ? (
                <button key={d} onClick={() => setSelected(d)}
                  className={`h-16 rounded border text-sm flex flex-col items-center justify-center ${d === selected ? 'border-primary bg-blue-50' : 'border-border-custom'}`}>
                  <span className={d === today ? 'font-bold text-primary' : ''}>{Number(d.slice(8))}</span>
                  {(byDate[d]?.length ?? 0) > 0 && <span className="badge-pending">{byDate[d].length} on leave</span>}
                </button>
              ) : <div key={`b${i}`} />)}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-1">{selected}</h2>
            <p className="text-sm text-text-secondary mb-3">{onLeave.length} on leave</p>
            {onLeave.length === 0 && <p className="text-text-secondary">Nobody is on leave.</p>}
            {groups.filter(g => g.people.length).map(g => (
              <div key={g.role} className="mb-3">
                <div className="label capitalize">{g.role} ({g.people.length})</div>
                <ul className="text-sm">
                  {g.people.map(l => (
                    <li key={l.id ?? `${l.userId}-${l.fromDate}`} className="py-1 border-b border-border-custom">
                      {l.userName} <span className="text-text-secondary">· {l.employeeId} · {l.leaveType}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
