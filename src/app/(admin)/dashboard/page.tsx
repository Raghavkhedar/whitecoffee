'use client';
import { useEffect, useState } from 'react';
import { getDashboardStats } from '@/lib/firestore';

interface Stats { totalUsers: number; totalSites: number; pendingLeaves: number; todayCheckIns: number; }

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

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

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

      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-bold text-text-primary mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { href: '/users', label: '+ Add new employee', icon: '👤' },
              // { href: '/sites',  label: '+ Add new site',     icon: '📍' },  // site management not in use
              { href: '/leaves', label: 'Review pending leaves', icon: '✅' },
            ].map(a => (
              <a key={a.href} href={a.href} className="flex items-center gap-3 p-3 rounded-lg hover:bg-background transition-colors text-sm text-primary font-medium">
                <span>{a.icon}</span>{a.label}
              </a>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="font-bold text-text-primary mb-4">About This Portal</h2>
          <ul className="text-sm text-text-secondary space-y-2">
            <li>• Manage all employees — add, edit roles and details</li>
            <li>• Review and approve/reject leave requests</li>
            <li>• Monitor real-time attendance across all locations</li>
            <li>• View all form submissions from field teams</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
