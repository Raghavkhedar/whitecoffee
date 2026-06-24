'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getAllRegularizationRequests, approveRegularization, rejectRegularization } from '@/lib/firestore';
import type { RegularizationRequest } from '@/types';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'approved' ? 'badge-approved' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
  return <span className={cls}>{status}</span>;
}

function OriginalBadge({ status }: { status: string }) {
  const bg = status === 'Absent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${bg}`}>{status}</span>;
}

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

export default function RegularizationPage() {
  const [requests, setRequests]     = useState<RegularizationRequest[]>([]);
  const [filter, setFilter]         = useState<Filter>('pending');
  const [month, setMonth]           = useState(currentYearMonth());
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [adminName, setAdminName]   = useState('Admin');
  const [actionModal, setActionModal] = useState<{ req: RegularizationRequest; type: 'approve' | 'reject' } | null>(null);
  const [actionComment, setActionComment] = useState('');
  const [actioning, setActioning]   = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) setAdminName(snap.data().name ?? 'Admin');
      }
    });
    return unsub;
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getAllRegularizationRequests(filter === 'all' ? undefined : filter);
      const filtered = data.filter(r => r.date.startsWith(month));
      setRequests(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter, month]);

  async function handleAction() {
    if (!actionModal) return;
    const { req, type } = actionModal;
    setActioning(req.id);
    try {
      if (type === 'approve') {
        await approveRegularization(req.userId, req.id, req.date, adminName, actionComment);
      } else {
        await rejectRegularization(req.userId, req.id, adminName, actionComment);
      }
      setActionModal(null);
      setActionComment('');
      await load();
    } catch { setError(`${type === 'approve' ? 'Approval' : 'Rejection'} failed.`); }
    setActioning('');
  }

  const FILTERS: Filter[] = ['pending', 'approved', 'rejected', 'all'];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">Attendance Regularization</h1>
        <p className="text-text-secondary text-sm mt-1">
          Review and approve employee regularization requests
        </p>
      </div>

      {/* Month selector */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setMonth(offsetMonth(month, -1))}
          className="btn-outline text-sm py-1 px-3">&larr;</button>
        <span className="text-lg font-semibold text-text-primary min-w-[160px] text-center">
          {formatMonthLabel(month)}
        </span>
        <button onClick={() => setMonth(offsetMonth(month, 1))}
          className="btn-outline text-sm py-1 px-3">&rarr;</button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-primary text-white'
                : 'bg-white border border-border text-text-secondary hover:border-primary hover:text-primary'
            }`}>
            {f}
          </button>
        ))}
        <span className="ml-auto text-sm text-text-secondary self-center">
          {requests.length} request{requests.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading&hellip;</div>
        ) : requests.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            No {filter === 'all' ? '' : filter} regularization requests for {formatMonthLabel(month)}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background border-b border-border">
              <tr>
                {['Employee', 'Date', 'Original', 'Reason', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map(r => (
                <tr key={r.id} className="hover:bg-background transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary">{r.userName}</div>
                    <div className="text-xs text-text-secondary">{r.employeeId}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-3"><OriginalBadge status={r.originalStatus} /></td>
                  <td className="px-4 py-3 text-text-secondary max-w-xs">
                    <p className="truncate">{r.reason}</p>
                    {r.approverComment && (
                      <p className={`text-xs mt-0.5 ${r.status === 'rejected' ? 'text-red-500' : 'text-green-600'}`}>&ldquo;{r.approverComment}&rdquo;</p>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' && (
                      <div className="flex gap-2">
                        <button className="btn-success text-xs py-1 px-3"
                          disabled={actioning === r.id}
                          onClick={() => { setActionModal({ req: r, type: 'approve' }); setActionComment(''); }}>
                          Approve
                        </button>
                        <button className="btn-danger text-xs py-1 px-3"
                          disabled={actioning === r.id}
                          onClick={() => { setActionModal({ req: r, type: 'reject' }); setActionComment(''); }}>
                          Reject
                        </button>
                      </div>
                    )}
                    {r.status !== 'pending' && (
                      <span className="text-xs text-text-secondary">{r.approvedBy}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {actionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-text-primary mb-2">
              {actionModal.type === 'approve' ? 'Approve' : 'Reject'} Regularization
            </h2>
            <p className="text-text-secondary text-sm mb-4">
              {actionModal.req.userName} &mdash; {actionModal.req.date} ({actionModal.req.originalStatus})
            </p>
            <label className="label">
              {actionModal.type === 'approve' ? 'Reason for approval' : 'Reason for rejection'}
            </label>
            <textarea
              className="input min-h-[80px]"
              value={actionComment}
              onChange={e => setActionComment(e.target.value)}
              placeholder="Enter reason…"
            />
            <div className="flex gap-3 mt-4">
              <button
                className={`${actionModal.type === 'approve' ? 'btn-success' : 'btn-danger'} flex-1`}
                onClick={handleAction}
                disabled={!!actioning}
              >
                {actionModal.type === 'approve' ? 'Approve' : 'Reject'}
              </button>
              <button className="btn-outline flex-1" onClick={() => setActionModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
