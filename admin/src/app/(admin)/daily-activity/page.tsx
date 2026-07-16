'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getAttendanceForDate, getAllUsers, restoreAttendanceToEvent, getAttendanceCorrectionsForDate } from '@/lib/firestore';
import type { AttendanceRecord, AttendanceCorrection, User } from '@/types';
import { istTodayStr } from '@/lib/date';
import { deriveState, eventLabel } from '@/lib/attendanceState';

function formatTime(ts: { toDate: () => Date } | undefined) {
  if (!ts) return '—';
  return ts.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function tsSecs(e: AttendanceRecord): number {
  return (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
}

const ROLE_ORDER: Record<string, number> = { office: 0, admin: 1, operations: 2, sales: 3 };
const roleBadge = (role: string) =>
  role === 'admin' ? 'badge-admin'
    : role === 'office' ? 'badge-office'
      : role === 'sales' ? 'badge-sales'
        : 'badge-ops';

// A pending "restore to here" awaiting confirmation.
interface PendingRestore {
  user: User;
  keepEvent: AttendanceRecord;
  removed: AttendanceRecord[];   // punches that will be deleted
  resultLabel: string;           // derived state after removal
}

export default function DailyActivityPage() {
  const todayStr = istTodayStr();
  const [date, setDate]             = useState(todayStr);
  const [events, setEvents]         = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([]);
  const [users, setUsers]           = useState<User[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [roleFilter, setRoleFilter]         = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');

  const [adminName, setAdminName] = useState('Admin');
  const [adminUid, setAdminUid]   = useState('');

  const [pending, setPending]       = useState<PendingRestore | null>(null);
  const [reason, setReason]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isToday = date === todayStr;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) return;
      setAdminUid(user.uid);
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) setAdminName(snap.data().name ?? 'Admin');
    });
    return unsub;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [evs, us, corr] = await Promise.all([
        getAttendanceForDate(date),
        getAllUsers(),
        getAttendanceCorrectionsForDate(date),
      ]);
      setEvents(evs);
      setUsers(us);
      setCorrections(corr);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { loadData(); }, [loadData]);

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  // Employees with punches on this date → one card each, oldest-punch-first per person,
  // sorted office → admin → ops then alphabetical, after role/employee filters.
  const cards = useMemo(() => {
    const byUser = new Map<string, AttendanceRecord[]>();
    for (const e of events) {
      if (!byUser.has(e.userId)) byUser.set(e.userId, []);
      byUser.get(e.userId)!.push(e);
    }
    const rows = Array.from(byUser.entries()).map(([uid, evs]) => {
      // Fallback for a user who has punches but is missing from the users list (rare).
      const user = userMap.get(uid) ?? ({ id: uid, name: evs[0]?.userName || 'Unknown', employeeId: evs[0]?.employeeId || '', role: '' } as unknown as User);
      return { user, events: [...evs].sort((a, b) => tsSecs(a) - tsSecs(b)) };
    });
    return rows
      .filter(r => !roleFilter || r.user.role === roleFilter)
      .filter(r => !employeeFilter || r.user.id === employeeFilter)
      .sort((a, b) =>
        (ROLE_ORDER[a.user.role] ?? 3) - (ROLE_ORDER[b.user.role] ?? 3)
        || a.user.name.localeCompare(b.user.name));
  }, [events, userMap, roleFilter, employeeFilter]);

  // Corrections grouped by employee (already newest-first from the query).
  const correctionsByUser = useMemo(() => {
    const m = new Map<string, AttendanceCorrection[]>();
    for (const c of corrections) {
      const uid = c.removedEvents[0]?.userId;
      if (!uid) continue;
      if (!m.has(uid)) m.set(uid, []);
      m.get(uid)!.push(c);
    }
    return m;
  }, [corrections]);

  const employeesWithEvents = useMemo(() => {
    const ids = new Set(events.map(e => e.userId));
    return users.filter(u => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [events, users]);

  function openRestore(user: User, timeline: AttendanceRecord[], keepIdx: number) {
    const keepEvent = timeline[keepIdx];
    const removed = timeline.slice(keepIdx + 1);
    const resultLabel = deriveState(timeline.slice(0, keepIdx + 1)).label;
    setReason('');
    setPending({ user, keepEvent, removed, resultLabel });
  }

  async function confirmRestore() {
    if (!pending || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await restoreAttendanceToEvent(pending.user.id, date, pending.keepEvent.id, reason.trim(), adminName, adminUid);
      setPending(null);
      setReason('');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSubmitting(false);
  }

  const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label">Date</label>
            <input type="date" max={todayStr} value={date} onChange={e => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Role</label>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input min-w-[150px]">
              <option value="">All Roles</option>
              <option value="office">Office</option>
              <option value="admin">Admin</option>
              <option value="operations">Operations</option>
              <option value="sales">Sales</option>
            </select>
          </div>
          <div>
            <label className="label">Employee</label>
            <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} className="input min-w-[180px]">
              <option value="">All Employees</option>
              {employeesWithEvents.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          {isToday
            ? 'Rewind an employee who checked out by mistake: “Restore to here” removes every punch after the one you pick, and the phone shows them checked in again after a refresh.'
            : 'Viewing a past day (read-only). Corrections are only available for today — use Regularization to fix past days.'}
        </p>
      </div>

      {/* Timelines */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-text-primary">{dateDisplay}</h2>
        <span className="text-xs text-text-secondary">{cards.length} {cards.length === 1 ? 'employee' : 'employees'} with activity</span>
      </div>

      {loading ? (
        <p className="text-text-secondary text-sm text-center py-8">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="text-text-secondary text-sm text-center py-8">No attendance activity on this date.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map(({ user, events: timeline }) => {
            const state = deriveState(timeline);
            return (
              <div key={user.id} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">{user.name}</h3>
                    <p className="text-xs text-text-secondary">{user.employeeId || '—'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={roleBadge(user.role)}>{user.role || '—'}</span>
                    <span className="text-xs font-medium text-text-secondary">{state.label}</span>
                  </div>
                </div>

                <ol className="relative border-l border-border ml-1.5">
                  {timeline.map((e, idx) => {
                    const canRestore = isToday && idx < timeline.length - 1;
                    const place = e.siteName || e.marketName || '';
                    return (
                      <li key={e.id} className="ml-4 pb-3 last:pb-0">
                        <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-primary/60" />
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-text-primary">
                              {eventLabel(e.type)}
                              {place && <span className="text-text-secondary"> · {place}</span>}
                            </p>
                            <p className="text-xs text-text-secondary">{formatTime(e.timestamp as Parameters<typeof formatTime>[0])}</p>
                          </div>
                          {canRestore && (
                            <button
                              className="btn-outline text-xs whitespace-nowrap px-2.5 py-1"
                              onClick={() => openRestore(user, timeline, idx)}
                            >
                              Restore to here
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {(correctionsByUser.get(user.id) ?? []).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs font-medium text-text-secondary mb-2">Corrections</p>
                    <ul className="space-y-2">
                      {(correctionsByUser.get(user.id) ?? []).map(c => (
                        <li key={c.id} className="text-xs text-text-secondary">
                          <span className="text-text-primary">⤺ Removed </span>
                          {c.removedEvents.map((e, i) => (
                            <span key={e.id} className="text-text-primary">
                              {i > 0 && ', '}
                              {eventLabel(e.type)}{(e.siteName || e.marketName) ? ` · ${e.siteName || e.marketName}` : ''} ({formatTime(e.timestamp as Parameters<typeof formatTime>[0])})
                            </span>
                          ))}
                          {' — by '}<span className="text-text-primary">{c.correctedBy}</span>
                          {c.reason && <> · “{c.reason}”</>}
                          {c.correctedAt && <> · {formatTime(c.correctedAt as Parameters<typeof formatTime>[0])}</>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm modal */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !submitting && setPending(null)}>
          <div className="card max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-text-primary mb-1">Restore {pending.user.name}’s timeline</h3>
            <p className="text-sm text-text-secondary mb-4">
              This permanently removes the punches below and puts them back to{' '}
              <span className="font-semibold text-text-primary">{pending.resultLabel}</span>. The removed punches are
              saved to the correction log.
            </p>

            <div className="mb-4 rounded-lg border border-border bg-background p-3">
              <p className="text-xs font-medium text-text-secondary mb-2">
                {pending.removed.length} punch{pending.removed.length === 1 ? '' : 'es'} to remove:
              </p>
              <ul className="space-y-1">
                {pending.removed.map(e => (
                  <li key={e.id} className="text-sm text-text-primary flex justify-between gap-3">
                    <span>{eventLabel(e.type)}{(e.siteName || e.marketName) ? ` · ${e.siteName || e.marketName}` : ''}</span>
                    <span className="text-text-secondary whitespace-nowrap">{formatTime(e.timestamp as Parameters<typeof formatTime>[0])}</span>
                  </li>
                ))}
              </ul>
            </div>

            <label className="label">Reason (required)</label>
            <textarea
              className="input w-full min-h-[72px]"
              placeholder="e.g. Employee tapped Check out by mistake while still on site."
              value={reason}
              onChange={e => setReason(e.target.value)}
            />

            <div className="flex justify-end gap-3 mt-4">
              <button className="btn-outline" onClick={() => setPending(null)} disabled={submitting}>Cancel</button>
              <button className="btn-danger" onClick={confirmRestore} disabled={submitting || !reason.trim()}>
                {submitting ? 'Restoring…' : 'Remove & restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
