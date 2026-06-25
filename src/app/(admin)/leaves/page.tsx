'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getAllLeaveRequests, approveLeave, rejectLeave } from '@/lib/firestore';
import type { LeaveRequest } from '@/types';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'approved' ? 'badge-approved' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
  return <span className={cls}>{status}</span>;
}

export default function LeavesPage() {
  const [leaves, setLeaves]   = useState<LeaveRequest[]>([]);
  const [filter, setFilter]   = useState<Filter>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [adminName, setAdminName] = useState('Admin');
  const [rejectModal, setRejectModal] = useState<LeaveRequest | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [actioning, setActioning] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');

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
    try {
      const data = await getAllLeaveRequests(filter === 'all' ? undefined : filter);
      setLeaves(data);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  async function handleApprove(leave: LeaveRequest) {
    setActioning(leave.id);
    try {
      await approveLeave(leave.userId, leave.id, adminName);
      await load();
    } catch { setError('Approval failed.'); }
    setActioning('');
  }

  async function handleReject() {
    if (!rejectModal) return;
    setActioning(rejectModal.id);
    try {
      await rejectLeave(rejectModal.userId, rejectModal.id, adminName, rejectComment);
      setRejectModal(null);
      setRejectComment('');
      await load();
    } catch { setError('Rejection failed.'); }
    setActioning('');
  }

  const FILTERS: Filter[] = ['pending', 'approved', 'rejected', 'all'];
  const filteredLeaves = employeeFilter ? leaves.filter(l => l.userId === employeeFilter) : leaves;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">Leave Requests</h1>
        <p className="text-text-secondary text-sm mt-1">{leaves.length} records</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-primary text-white' : 'bg-white border border-border text-text-secondary hover:border-primary hover:text-primary'}`}>
            {f}
          </button>
        ))}
        <select
          value={employeeFilter}
          onChange={e => setEmployeeFilter(e.target.value)}
          className="ml-auto input text-sm !py-2 min-w-[180px]"
        >
          <option value="">All Employees</option>
          {Array.from(new Map(leaves.map(l => [l.userId, l.userName]))).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading…</div>
        ) : filteredLeaves.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No {filter === 'all' ? '' : filter} leave requests.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background border-b border-border">
              <tr>
                {['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredLeaves.map(l => (
                <tr key={l.id} className="hover:bg-background transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary">{l.userName}</div>
                    <div className="text-xs text-text-secondary">{l.employeeId}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{l.leaveType}</td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{l.fromDate} → {l.toDate}</td>
                  <td className="px-4 py-3 text-text-secondary">{l.totalDays}d</td>
                  <td className="px-4 py-3 text-text-secondary max-w-xs">
                    <p className="truncate">{l.reason}</p>
                    {l.approverComment && <p className="text-xs text-red-500 mt-0.5">"{l.approverComment}"</p>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                  <td className="px-4 py-3">
                    {l.status === 'pending' && (
                      <div className="flex gap-2">
                        <button className="btn-success text-xs py-1 px-3" disabled={actioning === l.id} onClick={() => handleApprove(l)}>Approve</button>
                        <button className="btn-danger text-xs py-1 px-3" disabled={actioning === l.id} onClick={() => { setRejectModal(l); setRejectComment(''); }}>Reject</button>
                      </div>
                    )}
                    {l.status !== 'pending' && (
                      <span className="text-xs text-text-secondary">{l.approvedBy}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-text-primary mb-2">Reject Leave Request</h2>
            <p className="text-text-secondary text-sm mb-4">{rejectModal.userName} — {rejectModal.leaveType} ({rejectModal.fromDate} to {rejectModal.toDate})</p>
            <label className="label">Reason for rejection (optional)</label>
            <textarea className="input min-h-[80px]" value={rejectComment} onChange={e => setRejectComment(e.target.value)} placeholder="Enter reason…" />
            <div className="flex gap-3 mt-4">
              <button className="btn-danger flex-1" onClick={handleReject} disabled={!!actioning}>Reject</button>
              <button className="btn-outline flex-1" onClick={() => setRejectModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
