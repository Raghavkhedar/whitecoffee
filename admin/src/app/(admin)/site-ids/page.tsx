'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getAttendanceForDate, getAllUsers, updateAttendanceSiteId } from '@/lib/firestore';
import type { AttendanceRecord, User } from '@/types';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';
import { istTodayStr } from '@/lib/date';
import { WORK_DONE_CATEGORIES, WORK_DONE_CATEGORY_SET, WORK_DONE_NA } from '@/lib/categories';

function formatTime(ts: { toDate: () => Date } | undefined) {
  if (!ts) return '—';
  return ts.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function SiteIdsPage() {
  const todayStr = istTodayStr();
  const [date, setDate]               = useState(todayStr);
  const [events, setEvents]           = useState<AttendanceRecord[]>([]);
  const [users, setUsers]             = useState<User[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');

  // Per-entry edit state: eventId → current input value, and saving/saved flags.
  const [drafts, setDrafts]               = useState<Record<string, string>>({});   // siteId drafts
  const [visitDrafts, setVisitDrafts]     = useState<Record<string, string>>({});   // visitType drafts
  const [workDrafts, setWorkDrafts]       = useState<Record<string, string[]>>({}); // workDoneCategories drafts
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [savedOk, setSavedOk] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [evs, us] = await Promise.all([getAttendanceForDate(date), getAllUsers()]);
      setEvents(evs);
      setUsers(us);
      // Seed drafts from stored siteId + visitType + workDoneCategories.
      const seed: Record<string, string> = {};
      const visitSeed: Record<string, string> = {};
      const workSeed: Record<string, string[]> = {};
      evs.forEach(e => {
        seed[e.id] = e.siteId || '';
        visitSeed[e.id] = e.visitType || '';
        workSeed[e.id] = (e.workDoneCategories || []).filter(c => WORK_DONE_CATEGORY_SET.has(c));
      });
      setDrafts(seed);
      setVisitDrafts(visitSeed);
      setWorkDrafts(workSeed);
      setSavedOk({});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { loadData(); }, [loadData]);

  const userNameMap = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users]);
  const userEmpIdMap = useMemo(() => new Map(users.map(u => [u.id, u.employeeId])), [users]);

  // Only site check-in/out entries carry a site name + Site ID.
  const siteEntries = useMemo(() => {
    const ts = (e: AttendanceRecord) => (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
    return events
      .filter(e => e.type === 'site_in' || e.type === 'site_out')
      .filter(e => !employeeFilter || e.userId === employeeFilter)
      .sort((a, b) =>
        (userNameMap.get(a.userId) || a.userName || '').localeCompare(userNameMap.get(b.userId) || b.userName || '')
        || ts(a) - ts(b));
  }, [events, employeeFilter, userNameMap]);

  // Employees that appear in the (unfiltered) site entries — for the filter dropdown.
  const employeesWithEntries = useMemo(() => {
    const ids = new Set(events.filter(e => e.type === 'site_in' || e.type === 'site_out').map(e => e.userId));
    return users.filter(u => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [events, users]);

  async function handleSave(entry: AttendanceRecord) {
    const value = drafts[entry.id] ?? '';
    const visit = visitDrafts[entry.id] ?? '';
    const work  = workDrafts[entry.id] ?? [];
    setSaving(prev => ({ ...prev, [entry.id]: true }));
    setError('');
    try {
      await updateAttendanceSiteId(entry.userId, entry.id, value, visit, work);
      // Reflect the saved values locally without a full reload.
      setEvents(prev => prev.map(e => e.id === entry.id ? { ...e, siteId: value.trim(), visitType: visit.trim(), workDoneCategories: work } : e));
      setSavedOk(prev => ({ ...prev, [entry.id]: true }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(prev => ({ ...prev, [entry.id]: false }));
  }

  const dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  function exportXlsx() {
    downloadSheet(`site_ids_${date}`, 'Site IDs', siteEntries.map(e => ({
      Date: date,
      Employee: userNameMap.get(e.userId) || e.userName || '',
      'Emp ID': userEmpIdMap.get(e.userId) || e.employeeId || '',
      Time: formatTime(e.timestamp as Parameters<typeof formatTime>[0]),
      'In / Out': e.type === 'site_in' ? 'In' : 'Out',
      'Site Name': e.siteName || e.marketName || '',
      'Site ID': e.siteId || '',
      'Visit Type': e.visitType || '',
      'Work Done': (e.workDoneCategories || []).join(', '),
    })));
  }

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
            <input
              type="date"
              max={todayStr}
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Employee</label>
            <select
              value={employeeFilter}
              onChange={e => setEmployeeFilter(e.target.value)}
              className="input min-w-[180px]"
            >
              <option value="">All Employees</option>
              {employeesWithEntries.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Entries table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">{dateDisplay}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary">{siteEntries.length} site entries</span>
            <ExportButton onClick={exportXlsx} disabled={loading || siteEntries.length === 0} />
          </div>
        </div>

        {loading ? (
          <p className="text-text-secondary text-sm text-center py-8">Loading…</p>
        ) : siteEntries.length === 0 ? (
          <p className="text-text-secondary text-sm text-center py-8">No site check-in/out entries on this date.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Employee</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Emp ID</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Time</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">In / Out</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Site Name</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Site ID</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Visit Type</th>
                  <th className="text-left py-2.5 font-medium text-text-secondary">Work Done</th>
                </tr>
              </thead>
              <tbody>
                {siteEntries.map(entry => {
                  const draft      = drafts[entry.id] ?? '';
                  const visitDraft = visitDrafts[entry.id] ?? '';
                  const workDraft  = workDrafts[entry.id] ?? [];
                  const workSaved  = (entry.workDoneCategories || []).filter(c => WORK_DONE_CATEGORY_SET.has(c));
                  const normWork   = (a: string[]) => [...a].sort().join('|');
                  const isDirty = draft.trim() !== (entry.siteId || '').trim()
                    || visitDraft.trim() !== (entry.visitType || '').trim()
                    || normWork(workDraft) !== normWork(workSaved);
                  const isSaving = saving[entry.id] || false;
                  // NA is exclusive: ticking NA clears the rest; ticking any trade clears NA.
                  const toggleWork = (cat: string, checked: boolean) => {
                    setWorkDrafts(prev => {
                      const cur = prev[entry.id] ?? [];
                      let next: string[];
                      if (!checked) next = cur.filter(c => c !== cat);
                      else if (cat === WORK_DONE_NA) next = [WORK_DONE_NA];
                      else next = [...cur.filter(c => c !== WORK_DONE_NA && c !== cat), cat];
                      return { ...prev, [entry.id]: next };
                    });
                    setSavedOk(prev => ({ ...prev, [entry.id]: false }));
                  };
                  const isIn    = entry.type === 'site_in';
                  return (
                    <tr key={entry.id} className="border-b border-border/40 hover:bg-background/60 transition-colors">
                      <td className="py-3 pr-4 font-medium text-text-primary">
                        {userNameMap.get(entry.userId) || entry.userName || '—'}
                      </td>
                      <td className="py-3 pr-4 text-text-secondary text-xs">
                        {userEmpIdMap.get(entry.userId) || entry.employeeId || '—'}
                      </td>
                      <td className="py-3 pr-4 text-text-secondary text-xs">
                        {formatTime(entry.timestamp as Parameters<typeof formatTime>[0])}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                          isIn ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {isIn ? 'In' : 'Out'}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-text-primary">{entry.siteName || entry.marketName || '—'}</td>
                      <td className="py-3 pr-4">
                        <input
                          className="input !py-1.5 !w-36"
                          value={draft}
                          placeholder="Site ID"
                          onChange={e => {
                            const v = e.target.value;
                            setDrafts(prev => ({ ...prev, [entry.id]: v }));
                            setSavedOk(prev => ({ ...prev, [entry.id]: false }));
                          }}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <input
                          className="input !py-1.5 !w-44"
                          value={visitDraft}
                          placeholder="Visit type"
                          onChange={e => {
                            const v = e.target.value;
                            setVisitDrafts(prev => ({ ...prev, [entry.id]: v }));
                            setSavedOk(prev => ({ ...prev, [entry.id]: false }));
                          }}
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-wrap gap-x-3 gap-y-1 max-w-[280px]">
                            {WORK_DONE_CATEGORIES.map(cat => (
                              <label key={cat} className="flex items-center gap-1.5 text-xs text-text-primary select-none cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={workDraft.includes(cat)}
                                  onChange={e => toggleWork(cat, e.target.checked)}
                                />
                                {cat}
                              </label>
                            ))}
                          </div>
                          <button
                            onClick={() => handleSave(entry)}
                            disabled={isSaving || !isDirty}
                            className="btn-primary !py-1 !px-3 !text-xs disabled:opacity-40 shrink-0"
                          >
                            {isSaving ? 'Saving…' : 'Save'}
                          </button>
                          {savedOk[entry.id] && !isDirty && (
                            <span className="text-green-600 text-xs shrink-0">✓</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
