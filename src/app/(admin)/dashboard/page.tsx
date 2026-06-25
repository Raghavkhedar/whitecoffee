'use client';
import { useEffect, useState } from 'react';
import { getDashboardStats, getConveyanceConfig, setConveyanceConfig, getAllUsers, getAttendanceForDate } from '@/lib/firestore';
import type { User, AttendanceRecord } from '@/types';

interface Stats { totalUsers: number; totalSites: number; pendingLeaves: number; todayCheckIns: number; }

interface LiveStatus {
  user: User;
  checkedIn: boolean;
  location: string;
  inTime: Date | null;
  type: 'office' | 'site';
}

const STAT_CARDS = [
  { key: 'totalUsers',    icon: '👥', label: 'Total Employees', color: 'bg-blue-50 border-blue-200' },
  { key: 'totalSites',    icon: '🏗️', label: 'Active Sites',    color: 'bg-emerald-50 border-emerald-200' },
  { key: 'pendingLeaves', icon: '📅', label: 'Pending Leaves',  color: 'bg-amber-50 border-amber-200' },
  { key: 'todayCheckIns', icon: '📋', label: "Today's Check-ins", color: 'bg-purple-50 border-purple-200' },
];

export default function DashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [rate1, setRate1]           = useState('');
  const [rate2, setRate2]           = useState('');
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesSaving, setRatesSaving]   = useState(false);
  const [ratesMsg, setRatesMsg]     = useState('');

  const [liveStatuses, setLiveStatuses] = useState<LiveStatus[]>([]);
  const [liveLoading, setLiveLoading]   = useState(true);

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));

    getConveyanceConfig()
      .then(c => { setRate1(c.rate1 ? String(c.rate1) : ''); setRate2(c.rate2 ? String(c.rate2) : ''); })
      .catch((err: unknown) => setRatesMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setRatesLoading(false));

    const todayDate = new Date().toISOString().split('T')[0];
    Promise.all([getAllUsers(), getAttendanceForDate(todayDate)])
      .then(([users, events]) => {
        const ts = (e: AttendanceRecord) => (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
        const statuses: LiveStatus[] = users.map(user => {
          const isOps = user.role === 'operations';
          const userEvents = events.filter(e => e.userId === user.id).sort((a, b) => ts(a) - ts(b));

          const inType  = isOps ? 'site_in'  : 'office_in';
          const outType = isOps ? 'site_out' : 'office_out';
          const ins  = userEvents.filter(e => e.type === inType);
          const outs = userEvents.filter(e => e.type === outType);

          const lastIn  = ins.length > 0 ? ins[ins.length - 1] : null;
          const lastOut = outs.length > 0 ? outs[outs.length - 1] : null;
          const checkedIn = lastIn != null && (lastOut == null || ts(lastIn) > ts(lastOut));

          return {
            user,
            checkedIn,
            location: checkedIn && lastIn ? (lastIn.siteName || lastIn.marketName || 'Office') : '',
            inTime: checkedIn && lastIn?.timestamp ? lastIn.timestamp.toDate() : null,
            type: isOps ? 'site' : 'office',
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

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary text-sm mt-1">{today}</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="card animate-pulse h-32" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {STAT_CARDS.map(card => (
            <div key={card.key} className={`card border ${card.color}`}>
              <div className="text-3xl mb-3">{card.icon}</div>
              <div className="text-3xl font-bold text-text-primary">
                {stats ? stats[card.key as keyof Stats] : '—'}
              </div>
              <div className="text-text-secondary text-sm mt-1">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Live Attendance */}
      <div className="mt-8 card">
        <h2 className="font-bold text-text-primary mb-4">Live Attendance</h2>
        {liveLoading ? (
          <div className="text-text-secondary text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Name</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Role</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Status</th>
                  <th className="text-left py-2.5 pr-4 font-medium text-text-secondary">Location</th>
                  <th className="text-left py-2.5 font-medium text-text-secondary">Since</th>
                </tr>
              </thead>
              <tbody>
                {liveStatuses
                  .sort((a, b) => {
                    if (a.checkedIn !== b.checkedIn) return a.checkedIn ? -1 : 1;
                    return a.user.name.localeCompare(b.user.name);
                  })
                  .map(s => (
                    <tr key={s.user.id} className="border-b border-border/40 hover:bg-background/60 transition-colors">
                      <td className="py-2.5 pr-4 font-medium text-text-primary">{s.user.name}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                          s.user.role === 'operations'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : s.user.role === 'admin'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-sky-50 text-sky-700 border-sky-200'
                        }`}>
                          {s.user.role}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        {s.checkedIn ? (
                          <span className="text-xs px-2.5 py-1 rounded border font-medium bg-green-100 text-green-700 border-green-200">
                            Checked In
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded border font-medium bg-gray-100 text-gray-500 border-gray-200">
                            Not Checked In
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-text-secondary text-xs">
                        {s.checkedIn ? s.location : '—'}
                      </td>
                      <td className="py-2.5 text-text-secondary text-xs">
                        {s.checkedIn && s.inTime
                          ? s.inTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-bold text-text-primary mb-4">Conveyance Rates</h2>
          {ratesLoading ? (
            <div className="text-text-secondary text-sm">Loading…</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">Conveyance 1 (₹/km)</label>
                <input className="input" type="number" step="any" min="0" value={rate1} onChange={e => setRate1(e.target.value)} placeholder="e.g. 2.5" />
              </div>
              <div>
                <label className="label">Conveyance 2 (₹/km)</label>
                <input className="input" type="number" step="any" min="0" value={rate2} onChange={e => setRate2(e.target.value)} placeholder="e.g. 4.0" />
              </div>
              <div className="flex items-center gap-3">
                <button className="btn-primary" onClick={saveRates} disabled={ratesSaving}>
                  {ratesSaving ? 'Saving…' : 'Save Rates'}
                </button>
                {ratesMsg && (
                  <span className={`text-sm ${ratesMsg === 'Saved' ? 'text-green-600' : 'text-red-500'}`}>{ratesMsg}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-bold text-text-primary mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { href: '/users', label: '+ Add new employee', icon: '👤' },
              { href: '/leaves', label: 'Review pending leaves', icon: '✅' },
            ].map(a => (
              <a key={a.href} href={a.href} className="flex items-center gap-3 p-3 rounded-lg hover:bg-background transition-colors text-sm text-primary font-medium">
                <span>{a.icon}</span>{a.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
