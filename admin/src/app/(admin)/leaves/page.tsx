'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getAllLeaveRequests, approveLeave, rejectLeave, cancelLeave, getHolidaysForDateRange, sendNotification } from '@/lib/firestore';
import {
  requestedDates, grantedDates, isPartialApproval, isSunday,
  formatDayLabel, formatDatesShort, partialApprovalMessage,
  cancelledDates, effectiveGrantedDates, isCancelled, isPartiallyCancelled,
  leaveCancelledMessage,
} from '@/lib/leaveDates';
import { istTodayStr } from '@/lib/date';
import type { LeaveRequest } from '@/types';
import { Avatar } from '@/components/ui';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';
import { useAccess } from '@/components/AccessContext';

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
  // Cancelling is ADMIN-ONLY, unlike approve/decline which any Leaves manager may do.
  // Reverting an already-scored day writes `attendance_status` (needs /attendance or
  // /regularization) and refunds `plBalance` on the user doc (admin-only in the rules),
  // so a manager's cancellation would be denied by Firestore the moment it touched a past
  // day — atomically, but only after they had filled in the form. Hiding the button is the
  // honest version of a permission they do not have.
  const { user: portalUser } = useAccess();
  const canCancel = portalUser?.role === 'admin';

  const [leaves, setLeaves]   = useState<LeaveRequest[]>([]);
  const [filter, setFilter]   = useState<Filter>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [adminName, setAdminName] = useState('Admin');
  const [rejectModal, setRejectModal] = useState<LeaveRequest | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [actioning, setActioning] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  // Approve modal: the request being actioned, the ticked dates, the approver's note, and
  // the holidays inside the requested range (shown flagged — they are never leave days).
  const [approveModal, setApproveModal] = useState<LeaveRequest | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [modalHolidays, setModalHolidays] = useState<Record<string, string>>({});
  // Cancel modal: the approved request being revoked, the ticked dates, and the mandatory
  // reason. `cancelNote` is the amber "some days were left alone" outcome — a warning, not
  // an error, so it is deliberately not folded into `error`.
  const [cancelModal, setCancelModal] = useState<LeaveRequest | null>(null);
  const [selectedCancelDates, setSelectedCancelDates] = useState<string[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');

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

  // Open the picker with every requested date ticked — approving everything stays two clicks.
  function openApprove(leave: LeaveRequest) {
    const dates = requestedDates(leave);
    setApproveModal(leave);
    setSelectedDates(dates);
    setApproveComment('');
    setModalHolidays({});
    if (dates.length > 0) {
      getHolidaysForDateRange(dates[0], dates[dates.length - 1])
        .then(hs => setModalHolidays(Object.fromEntries(hs.map(h => [h.date, h.title || 'Holiday']))))
        .catch(() => { /* flagging is cosmetic — a failed lookup must not block approval */ });
    }
  }

  async function handleApprove() {
    if (!approveModal || selectedDates.length === 0) return;
    const leave    = approveModal;
    const granted  = [...selectedDates].sort();
    const total    = requestedDates(leave).length;
    const partial  = granted.length < total;
    setActioning(leave.id);
    try {
      await approveLeave(leave.userId, leave.id, adminName, granted, approveComment.trim());
      // Only a partial approval notifies — a full approval keeps today's silent behaviour.
      if (partial) {
        const { title, body } = partialApprovalMessage({ ...leave, status: 'approved', approvedDates: granted });
        try {
          await sendNotification([leave.userId], title, body, 'leave', adminName, 'specific');
        } catch { setError('Leave approved, but the employee notification failed to send.'); }
      }
      setApproveModal(null);
      setSelectedDates([]);
      setApproveComment('');
      await load();
    } catch { setError('Approval failed.'); }
    setActioning('');
  }

  // Opens with NOTHING ticked — the opposite of the approve picker. Approving everything is
  // the common case and should be two clicks; cancelling everything is not, and a
  // pre-ticked list is one stray Enter away from revoking somebody's whole holiday.
  function openCancel(leave: LeaveRequest) {
    setCancelModal(leave);
    setSelectedCancelDates([]);
    setCancelReason('');
    setCancelNote('');
  }

  async function handleCancel() {
    if (!cancelModal || selectedCancelDates.length === 0 || !cancelReason.trim()) return;
    const leave   = cancelModal;
    const revoked = [...selectedCancelDates].sort();
    setActioning(leave.id);
    try {
      const { skippedDates, refundedDays } = await cancelLeave(
        leave.userId, leave.id, adminName, revoked, cancelReason.trim(),
      );
      // Always notify: unlike a full approval, a cancellation is never good news the
      // employee can discover late — they think they have the day off.
      const { title, body } = leaveCancelledMessage(leave, revoked);
      try {
        await sendNotification([leave.userId], title, body, 'leave', adminName, 'specific');
      } catch { setError('Leave cancelled, but the employee notification failed to send.'); }

      if (skippedDates.length > 0) {
        setCancelNote(
          `Cancelled, but ${skippedDates.length === 1 ? 'one day was' : `${skippedDates.length} days were`} left as-is: ` +
          `${formatDatesShort(skippedDates)}. ${skippedDates.length === 1 ? 'It was' : 'They were'} already corrected by an admin ` +
          `(regularization), so that decision stands — adjust ${skippedDates.length === 1 ? 'it' : 'them'} on the Attendance page if needed.`
        );
      } else if (refundedDays > 0) {
        setCancelNote(`${refundedDays} paid-leave ${refundedDays === 1 ? 'day' : 'days'} returned to the employee's PL balance.`);
      }
      setCancelModal(null);
      setSelectedCancelDates([]);
      setCancelReason('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Cancellation failed.'); }
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
      // Requested days alone would report a cancelled leave as fully taken. "Days Off" is what
      // the employee actually still has, matching the backend Sheets "Days Granted" column.
      'Days Off': l.status === 'approved' ? effectiveGrantedDates(l).length : '',
      Reason: l.reason,
      Status: STATUS_LABEL[l.status] ?? l.status,
      'Approved By': l.approvedBy ?? '',
      Comment: l.approverComment ?? '',
      'Cancelled Dates': formatDatesShort(cancelledDates(l)),
      'Cancelled By': l.cancelledBy ?? '',
      'Cancel Reason': l.cancelComment ?? '',
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

      {cancelNote && (
        <div className="mb-4 p-3 bg-[#FDF6E9] border border-[#EDD9B0] rounded-lg text-[#8A6700] text-sm flex items-start gap-3">
          <span className="flex-1">{cancelNote}</span>
          <button className="text-[#8A6700] hover:text-[#5C4500] font-semibold text-[13px] leading-none mt-0.5"
            onClick={() => setCancelNote('')}>Dismiss</button>
        </div>
      )}

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
                <div className="min-w-[160px] flex-1"><div className={metaLabel}>Reason</div><div className="text-[13px] text-[#4A433D] mt-[3px]">{l.reason}{/* Red reads as a rejection reason — approve now takes a comment too, so only tint it when it actually is one. */}
                {l.approverComment && <span className={`block text-[12px] mt-0.5 ${l.status === 'rejected' ? 'text-red-500' : 'text-[#8A817A]'}`}>“{l.approverComment}”</span>}</div></div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2.5 flex-shrink-0">
              {l.status === 'pending' ? (
                <div className="flex gap-2">
                  <button className="btn-outline !py-1.5 !px-3 text-[13px] !text-[#C42B2B] !border-[#F0D3D3] hover:!bg-[#FBEAEA]" disabled={actioning === l.id} onClick={() => { setRejectModal(l); setRejectComment(''); }}>Decline</button>
                  <button className="btn-success !py-1.5 !px-3 text-[13px]" disabled={actioning === l.id} onClick={() => openApprove(l)}>Approve</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <LeaveStatusBadge status={l.status} />
                    {isPartialApproval(l) && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F7EFE3] text-[#9A5B1E]">Partial</span>
                    )}
                    {isCancelled(l) && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FBEAEA] text-[#C42B2B]">
                        {isPartiallyCancelled(l) ? 'Partly cancelled' : 'Cancelled'}
                      </span>
                    )}
                  </div>
                  {/* The original grant — a record of the approval decision, never rewritten by a cancellation. */}
                  {isPartialApproval(l) && (
                    <span className="text-[11.5px] text-[#9A5B1E] text-right max-w-[220px]">
                      {grantedDates(l).length} of {requestedDates(l).length} days: {formatDatesShort(grantedDates(l))}
                    </span>
                  )}
                  {isCancelled(l) && (
                    <span className="text-[11.5px] text-[#C42B2B] text-right max-w-[220px]">
                      {cancelledDates(l).length} cancelled: {formatDatesShort(cancelledDates(l))}
                      {effectiveGrantedDates(l).length > 0
                        ? ` · ${effectiveGrantedDates(l).length} still off`
                        : ' · none left'}
                    </span>
                  )}
                  {l.cancelledBy && (
                    <span className="text-[11.5px] text-[#A8A29E]">cancelled by {l.cancelledBy}</span>
                  )}
                  {l.approvedBy && <span className="text-[11.5px] text-[#A8A29E]">by {l.approvedBy}</span>}
                  {canCancel && l.status === 'approved' && effectiveGrantedDates(l).length > 0 && (
                    <button
                      className="btn-outline !py-1.5 !px-3 text-[13px] !text-[#C42B2B] !border-[#F0D3D3] hover:!bg-[#FBEAEA]"
                      disabled={actioning === l.id}
                      onClick={() => openCancel(l)}>
                      Cancel leave
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Approve modal — pick exactly which requested dates are granted */}
      {approveModal && (() => {
        const dates = requestedDates(approveModal);
        const sel   = new Set(selectedDates);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-text-primary mb-2">Approve Leave — {approveModal.userName}</h2>
              <p className="text-text-secondary text-sm mb-4">
                Requested: {approveModal.fromDate} → {approveModal.toDate} ({dates.length} {dates.length === 1 ? 'day' : 'days'})
              </p>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 max-h-[240px] overflow-y-auto mb-3">
                {dates.map(d => {
                  const holiday = modalHolidays[d];
                  const rest    = isSunday(d) || !!holiday;
                  return (
                    <label key={d} className="flex items-center gap-2 py-1 text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[#0A7A50]"
                        checked={sel.has(d)}
                        onChange={e => setSelectedDates(prev =>
                          e.target.checked ? [...prev, d].sort() : prev.filter(x => x !== d)
                        )}
                      />
                      <span className={rest ? 'text-[#A8A29E]' : 'text-[#2A241F]'}>{formatDayLabel(d)}</span>
                      {rest && (
                        <span className="text-[10.5px] uppercase tracking-[0.04em] font-semibold text-[#B26B07]"
                          title={holiday ? `Holiday: ${holiday}` : 'Sunday'}>
                          {holiday ? 'Holiday' : 'Sun'}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 mb-4">
                <button className="btn-outline !py-1 !px-2.5 text-[12px]" onClick={() => setSelectedDates(dates)}>All</button>
                <button className="btn-outline !py-1 !px-2.5 text-[12px]" onClick={() => setSelectedDates([])}>None</button>
                <span className="ml-auto text-[12.5px] font-medium text-text-secondary">
                  Granting {selectedDates.length} of {dates.length} days
                </span>
              </div>
              {dates.some(d => isSunday(d) || modalHolidays[d]) && (
                <p className="text-[11.5px] text-[#A8A29E] mb-3 -mt-2">
                  Sundays and holidays are rest days — they are never counted as leave.
                </p>
              )}

              <label className="label">Comment (optional)</label>
              <textarea className="input min-h-[64px]" value={approveComment}
                onChange={e => setApproveComment(e.target.value)} placeholder="Note for the employee…" />

              <div className="flex gap-3 mt-4">
                <button className="btn-success flex-1" onClick={handleApprove}
                  disabled={!!actioning || selectedDates.length === 0}>
                  Approve {selectedDates.length} {selectedDates.length === 1 ? 'day' : 'days'}
                </button>
                <button className="btn-outline flex-1" onClick={() => setApproveModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cancel modal — revoke days from an already-approved leave */}
      {cancelModal && (() => {
        const dates  = effectiveGrantedDates(cancelModal);
        const sel    = new Set(selectedCancelDates);
        const today  = istTodayStr();
        const picked = [...selectedCancelDates].sort();
        const pastPicked = picked.filter(d => d < today);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-text-primary mb-2">Cancel Leave — {cancelModal.userName}</h2>
              <p className="text-text-secondary text-sm mb-4">
                Currently approved: {dates.length} {dates.length === 1 ? 'day' : 'days'}. Tick the days to cancel — the rest stay approved.
              </p>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 max-h-[240px] overflow-y-auto mb-3">
                {dates.map(d => {
                  const isPast = d < today;
                  return (
                    <label key={d} className="flex items-center gap-2 py-1 text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[#C42B2B]"
                        checked={sel.has(d)}
                        onChange={e => setSelectedCancelDates(prev =>
                          e.target.checked ? [...prev, d].sort() : prev.filter(x => x !== d)
                        )}
                      />
                      <span className={isSunday(d) ? 'text-[#A8A29E]' : 'text-[#2A241F]'}>{formatDayLabel(d)}</span>
                      {isPast && (
                        <span className="text-[10.5px] uppercase tracking-[0.04em] font-semibold text-[#B26B07]"
                          title="Already scored into payroll — cancelling reverses it">Past</span>
                      )}
                      {isSunday(d) && (
                        <span className="text-[10.5px] uppercase tracking-[0.04em] font-semibold text-[#A8A29E]"
                          title="Sundays are rest days — never scored as leave">Sun</span>
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 mb-4">
                <button className="btn-outline !py-1 !px-2.5 text-[12px]" onClick={() => setSelectedCancelDates(dates)}>All</button>
                <button className="btn-outline !py-1 !px-2.5 text-[12px]" onClick={() => setSelectedCancelDates([])}>None</button>
                <span className="ml-auto text-[12.5px] font-medium text-text-secondary">
                  Cancelling {selectedCancelDates.length} of {dates.length} days
                </span>
              </div>

              {/* Past days already moved money — say so plainly before the admin commits. */}
              {pastPicked.length > 0 && (
                <p className="text-[11.5px] text-[#8A6700] bg-[#FDF6E9] border border-[#EDD9B0] rounded-lg p-2.5 mb-3">
                  {pastPicked.length} selected {pastPicked.length === 1 ? 'day has' : 'days have'} already been scored
                  ({formatDatesShort(pastPicked)}). {pastPicked.length === 1 ? 'It' : 'They'} will be reset to <strong>Absent</strong> and
                  any paid-leave day returned to the balance. A day an admin already corrected by hand is left untouched.
                </p>
              )}

              <label className="label">Reason <span className="text-[#C42B2B]">*</span></label>
              <textarea className="input min-h-[64px]" value={cancelReason}
                onChange={e => setCancelReason(e.target.value)} placeholder="Why is this leave being cancelled?" />

              <div className="flex gap-3 mt-4">
                <button className="btn-danger flex-1" onClick={handleCancel}
                  disabled={!!actioning || selectedCancelDates.length === 0 || !cancelReason.trim()}>
                  Cancel {selectedCancelDates.length} {selectedCancelDates.length === 1 ? 'day' : 'days'}
                </button>
                <button className="btn-outline flex-1" onClick={() => setCancelModal(null)}>Keep leave</button>
              </div>
            </div>
          </div>
        );
      })()}

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
