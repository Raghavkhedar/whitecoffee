'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { getAllUsers, getAttendanceForDateRange, getPlannedHoursForDateRange } from '@/lib/firestore';
import type { User, AttendanceRecord, PlannedHours } from '@/types';

// ── Date range helpers ────────────────────────────────────────────────────────

type Preset = 'custom' | '1d' | '7d' | '15d' | '30d' | '90d' | '180d' | '365d';

const PRESETS: { key: Preset; label: string; days: number | null }[] = [
  { key: 'custom', label: 'Custom Date', days: null },
  { key: '1d',    label: 'Today',        days: 1   },
  { key: '7d',    label: 'Last 7 Days',  days: 7   },
  { key: '15d',   label: 'Last 15 Days', days: 15  },
  { key: '30d',   label: 'Last Month',   days: 30  },
  { key: '90d',   label: 'Last 3 Months',days: 90  },
  { key: '180d',  label: 'Last 6 Months',days: 180 },
  { key: '365d',  label: 'Last Year',    days: 365 },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return d.toISOString().slice(0, 10);
}

function dateRangeFromPreset(preset: Preset, customDate: string): { start: string; end: string } {
  if (preset === 'custom') return { start: customDate, end: customDate };
  const p = PRESETS.find(p => p.key === preset)!;
  return { start: nDaysAgo(p.days!), end: todayStr() };
}

function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) =>
    new Date(s + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

// Count Mon–Sat days (no Sundays) in a date range, inclusive.
function countWorkingDays(start: string, end: string): number {
  let count = 0;
  const d = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  while (d <= e) {
    if (d.getDay() !== 0) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ── Hour computation helpers ──────────────────────────────────────────────────

function hhmmToMinutes(s?: string): number {
  if (!s) return 0;
  const [h, m] = s.split(':').map(Number);
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
}

function minutesToDisplay(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function tsSeconds(e: AttendanceRecord): number {
  return (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
}

// Field-work event types for operations (home events excluded — commute bookends)
const OPS_IN_TYPES  = new Set(['site_in', 'market_in']);
const OPS_OUT_TYPES = new Set(['site_out', 'market_out']);

function formatTime(secs: number): string {
  return new Date(secs * 1000).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}

// ── Per-employee aggregation ──────────────────────────────────────────────────

interface EmployeeRow {
  user: User;
  workingMins: number | null;  // null = no plan (ops only)
  actualMins: number | null;   // null = no events
  shortage: number | null;     // null when either side is missing
  // Single-day extras
  firstInSecs: number | null;
  lastOutSecs: number | null;
}

function aggregateForEmployee(
  user: User,
  allEvents: AttendanceRecord[],
  plannedItems: PlannedHours[],
  start: string,
  end: string,
): EmployeeRow {
  const isSingleDay = start === end;
  const isOps = user.role === 'operations';
  const userEvents = allEvents.filter(e => e.userId === user.id);

  // ── Working minutes ────────────────────────────────────────────────────
  let workingMins: number | null;
  if (isOps) {
    const total = plannedItems
      .filter(p => p.userId === user.id)
      .reduce((sum, p) => {
        const dur = hhmmToMinutes(p.endTime) - hhmmToMinutes(p.startTime);
        return sum + (dur > 0 ? dur : 0);
      }, 0);
    workingMins = total > 0 ? total : null;
  } else {
    workingMins = countWorkingDays(start, end) * 8 * 60;
  }

  // ── Actual minutes (aggregate per day, then sum) ───────────────────────
  const eventsByDate = new Map<string, AttendanceRecord[]>();
  userEvents.forEach(e => {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date)!.push(e);
  });

  let totalActualMins = 0;
  let hasAnyActual = false;
  let globalFirstIn: number | null = null;
  let globalLastOut: number | null = null;

  eventsByDate.forEach((dayEvents, _date) => {
    const inEvents  = dayEvents.filter(e => isOps ? OPS_IN_TYPES.has(e.type)  : e.type === 'office_in');
    const outEvents = dayEvents.filter(e => isOps ? OPS_OUT_TYPES.has(e.type) : e.type === 'office_out');
    if (inEvents.length === 0 || outEvents.length === 0) return;

    const firstIn  = Math.min(...inEvents.map(tsSeconds));
    const lastOut  = Math.max(...outEvents.map(tsSeconds));
    if (lastOut <= firstIn) return;

    const dayMins = Math.round((lastOut - firstIn) / 60);
    totalActualMins += dayMins;
    hasAnyActual = true;

    if (globalFirstIn === null || firstIn < globalFirstIn) globalFirstIn = firstIn;
    if (globalLastOut === null || lastOut > globalLastOut) globalLastOut = lastOut;
  });

  const actualMins = hasAnyActual ? totalActualMins : null;
  const shortage   = workingMins !== null && actualMins !== null
    ? workingMins - actualMins
    : null;

  return {
    user,
    workingMins,
    actualMins,
    shortage,
    firstInSecs:  isSingleDay ? globalFirstIn  : null,
    lastOutSecs:  isSingleDay ? globalLastOut : null,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDashboardPage() {
  const [preset, setPreset]           = useState<Preset>('1d');
  const [customDate, setCustomDate]   = useState(todayStr());
  const [users, setUsers]             = useState<User[]>([]);
  const [events, setEvents]           = useState<AttendanceRecord[]>([]);
  const [planned, setPlanned]         = useState<PlannedHours[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [roleFilter, setRoleFilter]   = useState('');
  const [empFilter, setEmpFilter]     = useState('');

  const { start, end } = useMemo(
    () => dateRangeFromPreset(preset, customDate),
    [preset, customDate],
  );

  const isSingleDay = start === end;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fetchedUsers, fetchedEvents, fetchedPlanned] = await Promise.all([
        getAllUsers(),
        getAttendanceForDateRange(start, end),
        getPlannedHoursForDateRange(start, end),
      ]);
      setUsers(fetchedUsers);
      setEvents(fetchedEvents);
      setPlanned(fetchedPlanned);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [start, end]);

  useEffect(() => { loadData(); }, [loadData]);

  const rows = useMemo<EmployeeRow[]>(() => {
    return [...users]
      .filter(u => !roleFilter || u.role === roleFilter)
      .filter(u => !empFilter  || u.id   === empFilter)
      .sort((a, b) => {
        const order: Record<string, number> = { office: 0, admin: 1, operations: 2 };
        return (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.name.localeCompare(b.name);
      })
      .map(u => aggregateForEmployee(u, events, planned, start, end));
  }, [users, events, planned, roleFilter, empFilter, start, end]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Employee Dashboard</h1>
        <p className="text-text-secondary text-sm mt-1">
          {formatDateRange(start, end)}
          {!isSingleDay && ` · ${countWorkingDays(start, end)} working days`}
        </p>
      </div>

      {/* Preset buttons */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                preset === p.key
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-text-secondary border-border hover:border-primary hover:text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date picker — shown only in custom mode */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 pt-3 border-t border-border">
            <label className="text-sm text-text-secondary whitespace-nowrap">Pick date:</label>
            <input
              type="date"
              value={customDate}
              max={todayStr()}
              onChange={e => setCustomDate(e.target.value)}
              className="input text-sm !py-1.5"
            />
          </div>
        )}
      </div>

      {/* Secondary filters */}
      <div className="flex flex-wrap gap-3 items-center mb-5">
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="input text-sm !py-2"
        >
          <option value="">All Roles</option>
          <option value="office">Office</option>
          <option value="operations">Operations</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={empFilter}
          onChange={e => setEmpFilter(e.target.value)}
          className="input text-sm !py-2 min-w-[180px]"
        >
          <option value="">All Employees</option>
          {[...users].sort((a, b) => a.name.localeCompare(b.name)).map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <button onClick={loadData} className="btn-outline !py-2 !px-4 !text-sm">
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-10 bg-background rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Name</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Emp ID</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Role</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">PL Bal</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">WO Bal</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Working Hrs</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Actual Hrs</th>
                  {isSingleDay && (
                    <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Check-in / Out</th>
                  )}
                  <th className="text-left py-2.5 font-medium text-text-secondary">Shortage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user, workingMins, actualMins, shortage, firstInSecs, lastOutSecs }) => (
                  <tr key={user.id} className="border-b border-border/40 hover:bg-background/60 transition-colors">
                    <td className="py-3 pr-4 font-medium text-text-primary whitespace-nowrap">{user.name}</td>
                    <td className="py-3 pr-4 text-text-secondary text-xs whitespace-nowrap">{user.employeeId || '—'}</td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        user.role === 'operations' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        user.role === 'admin'      ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-sky-50 text-sky-700 border-sky-200'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-xs">
                        {user.plBalance ?? 0} PL
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-xs">
                        {user.woBalance ?? 0} WO
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs whitespace-nowrap">
                      {workingMins !== null
                        ? <span className="font-medium text-text-primary">{minutesToDisplay(workingMins)}</span>
                        : <span className="italic text-text-secondary/60">{user.role === 'operations' ? 'No plan' : '—'}</span>}
                    </td>
                    <td className="py-3 pr-4 text-xs whitespace-nowrap">
                      {actualMins !== null
                        ? <span className="font-medium text-text-primary">{minutesToDisplay(actualMins)}</span>
                        : <span className="italic text-text-secondary/60">No data</span>}
                    </td>
                    {isSingleDay && (
                      <td className="py-3 pr-4 text-xs text-text-secondary whitespace-nowrap">
                        {firstInSecs && lastOutSecs
                          ? `${formatTime(firstInSecs)} – ${formatTime(lastOutSecs)}`
                          : '—'}
                      </td>
                    )}
                    <td className="py-3 text-xs whitespace-nowrap">
                      {shortage === null ? (
                        <span className="text-text-secondary/60">—</span>
                      ) : shortage <= 0 ? (
                        <span className="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">
                          {shortage < 0 ? `+${minutesToDisplay(-shortage)} extra` : 'On time'}
                        </span>
                      ) : (
                        <span className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded">
                          -{minutesToDisplay(shortage)} short
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={isSingleDay ? 9 : 8} className="py-10 text-center text-text-secondary text-sm">
                      No employees match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
