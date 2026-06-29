'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getAllLeaveRequests, approveLeave, rejectLeave } from '@/lib/firestore';
import type { LeaveRequest } from '@/types';
import { Avatar } from '@/components/ui';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

const STATUS_LABEL: Record<string, string> = { approved: 'Approved', rejected: 'Declined', pending: 'Pending' };
function LeaveStatusBadge({ status }: { status: string }) {
  const cls = status === 'approved' ? 'badge-approved' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
  return <span className={cls}>{STATUS_LABEL[status] ?? status}</span>;
}

function typeDotColor(t: string) {
  const s = (t || '').toLowerCase();
  if (s.includes('sick')) return '#C42B2B';
  if (s.includes('paid')) return '#9A5B1E';
  if (s.includes('casual')) return '#2456C7';
  return '#9A938C';
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

  const metaLabel = 'text-[11px] uppercase tracking-[0.05em] font-semibold text-[#A8A29E]';
  const metaVal   = 'text-[13px] font-medium text-[#2A241F] mt-[3px] flex items-center gap-1.5';

  function exportXlsx() {
    downloadSheet('leave_requests', 'Leaves', filteredLeaves.map(l => ({
      Employee: l.userName,
      'Emp ID': l.employeeId,
      Type: l.leaveType,
      From: l.fromDate,
      To: l.toDate,
      Days: l.totalDays,
      Reason: l.reason,
      Status: STATUS_LABEL[l.status] ?? l.status,
      'Approved By': l.approvedBy ?? '',
      Comment: l.approverComment ?? '',
    })));
  }

  return (
    <div className="max-w-[1100px]">
      {/* Tabs + employee filter */}
      <div className="flex flex-wrap items-center gap-3 mb-[18px]">
        <div className="flex gap-[5px] bg-[#F1EEEA] rounded-[11px] p-1 w-fit">
          {FILTERS.map(f => {
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium capitalize transition-colors ${active ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(26,22,19,0.06)]' : 'text-[#8A817A] hover:text-text-primary'}`}>
                {f}{active && <span className="ml-1.5 font-mono text-[11px] text-[#9A938C]">{filteredLeaves.length}</span>}
              </button>
            );
          })}
        </div>
        <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} className="ml-auto input text-sm !py-2 !w-auto min-w-[180px]">
          <option value="">All Employees</option>
          {Array.from(new Map(leaves.map(l => [l.userId, l.userName]))).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <ExportButton onClick={exportXlsx} disabled={loading || filteredLeaves.length === 0} />
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="bg-white border border-[#E9E6E2] rounded-2xl p-10 text-center text-[13px] text-[#9A938C]">Loading…</div>
        ) : filteredLeaves.length === 0 ? (
          <div className="bg-white border border-[#E9E6E2] rounded-2xl p-10 text-center text-[13px] text-[#9A938C]">No {filter === 'all' ? '' : filter} requests.</div>
        ) : filteredLeaves.map(l => (
          <div key={l.id} className="bg-white border border-[#E9E6E2] rounded-2xl px-5 py-[18px] flex items-start gap-4">
            <Avatar name={l.userName} size={44} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[14.5px] font-semibold text-text-primary">{l.userName}</span>
                <span className="font-mono text-[12px] text-[#A8A29E]">{l.employeeId}</span>
              </div>
              <div className="flex items-center gap-[18px] mt-[11px] flex-wrap">
                <div><div className={metaLabel}>Type</div><div className={metaVal}><span className="w-[7px] h-[7px] rounded-full" style={{ background: typeDotColor(l.leaveType) }} />{l.leaveType}</div></div>
                <div><div className={metaLabel}>Dates</div><div className={metaVal}>{l.fromDate}{l.toDate && l.toDate !== l.fromDate ? ` → ${l.toDate}` : ''}</div></div>
                <div><div className={metaLabel}>Days</div><div className={`${metaVal} font-mono`}>{l.totalDays}</div></div>
                <div className="min-w-[160px] flex-1"><div className={metaLabel}>Reason</div><div className="text-[13px] text-[#4A433D] mt-[3px]">{l.reason}{l.approverComment && <span className="block text-[12px] text-red-500 mt-0.5">“{l.approverComment}”</span>}</div></div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2.5 flex-shrink-0">
              {l.status === 'pending' ? (
                <div className="flex gap-2">
                  <button className="btn-outline !py-1.5 !px-3 text-[13px] !text-[#C42B2B] !border-[#F0D3D3] hover:!bg-[#FBEAEA]" disabled={actioning === l.id} onClick={() => { setRejectModal(l); setRejectComment(''); }}>Decline</button>
                  <button className="btn-success !py-1.5 !px-3 text-[13px]" disabled={actioning === l.id} onClick={() => handleApprove(l)}>Approve</button>
                </div>
              ) : (
                <>
                  <LeaveStatusBadge status={l.status} />
                  {l.approvedBy && <span className="text-[11.5px] text-[#A8A29E]">by {l.approvedBy}</span>}
                </>
              )}
            </div>
          </div>
        ))}
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
