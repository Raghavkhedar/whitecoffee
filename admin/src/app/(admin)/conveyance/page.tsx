'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getConveyanceForMonth, getConveyanceConfig, setConveyanceConfig, approveConveyance, rejectConveyance } from '@/lib/firestore';
import { useAccess } from '@/components/AccessContext';
import type { ConveyanceRecord } from '@/types';
import ExportButton from '@/components/ExportButton';
import { downloadExcel } from '@/lib/excel';
import { useIsMobile } from '@/hooks/useIsMobile';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';
const FILTERS: Filter[] = ['pending', 'approved', 'rejected', 'all'];

// A legacy doc (no `status` field — written before manual approval existed) is grandfathered
// as approved; see firebase/functions/conveyanceApproval.js for the mirrored server-side rule.
function statusOf(r: ConveyanceRecord): 'pending' | 'approved' | 'rejected' {
  return r.status ?? 'approved';
}

// The rupee figure that counts toward payroll: 0 while pending or rejected, the (possibly
// edited) approved amount once approved, the raw computed figure for a grandfathered legacy doc.
function effectiveAmount(r: ConveyanceRecord): number {
  const status = statusOf(r);
  if (status === 'pending' || status === 'rejected') return 0;
  if (r.status === 'approved') return r.approvedAmount ?? r.conveyance;
  return r.conveyance; // legacy, no status field
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'approved' ? 'badge-approved' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
  return <span className={cls}>{status}</span>;
}

export default function ConveyancePage() {
  const isMobile = useIsMobile();
  const { user: portalUser } = useAccess();
  const isAdmin = portalUser?.role === 'admin';
  const canApprove = isAdmin || (portalUser?.tabAccess ?? []).includes('/conveyance');

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [records, setRecords] = useState<ConveyanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [filter, setFilter]   = useState<Filter>('pending');

  const [rate1, setRate1]           = useState('');
  const [rate2, setRate2]           = useState('');
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesSaving, setRatesSaving]   = useState(false);
  const [ratesMsg, setRatesMsg]     = useState('');

  const [actionModal, setActionModal] = useState<{ rec: ConveyanceRecord; type: 'approve' | 'reject' } | null>(null);
  const [approvedAmount, setApprovedAmount] = useState('');
  const [actionComment, setActionComment]   = useState('');
  const [actioning, setActioning]           = useState('');
  const [adminName, setAdminName]           = useState('Admin');

  useEffect(() => {
    if (portalUser?.name) setAdminName(portalUser.name);
  }, [portalUser]);

  useEffect(() => {
    getConveyanceConfig()
      .then(c => { setRate1(c.rate1 ? String(c.rate1) : ''); setRate2(c.rate2 ? String(c.rate2) : ''); })
      .catch((err: unknown) => setRatesMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setRatesLoading(false));
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getConveyanceForMonth(month);
      setRecords(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { loadData(); }, [loadData]);

  const employeeFiltered = useMemo(
    () => employeeFilter ? records.filter(r => r.userId === employeeFilter) : records,
    [records, employeeFilter],
  );

  // The payroll-facing summary/grand total always reflect ALL of this month's records (pending
  // and rejected contributing ₹0) regardless of which status tab is being reviewed below — an
  // admin should never have to switch to "Approved" just to see what's actually going to pay.
  const summary = useMemo(() => {
    const map = new Map<string, { userName: string; employeeId: string; totalKm: number; totalConveyance: number; days: number }>();
    employeeFiltered.forEach(r => {
      const entry = map.get(r.userId) || { userName: r.userName, employeeId: r.employeeId, totalKm: 0, totalConveyance: 0, days: 0 };
      entry.totalKm += r.totalKm;
      entry.totalConveyance += effectiveAmount(r);
      entry.days += 1;
      map.set(r.userId, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [employeeFiltered]);

  const grandTotal = summary.reduce((s, e) => s + e.totalConveyance, 0);
  const grandKm    = summary.reduce((s, e) => s + e.totalKm, 0);

  const tabFiltered = useMemo(
    () => filter === 'all' ? employeeFiltered : employeeFiltered.filter(r => statusOf(r) === filter),
    [employeeFiltered, filter],
  );
  const sorted = useMemo(
    () => [...tabFiltered].sort((a, b) => a.date.localeCompare(b.date) || a.userName.localeCompare(b.userName)),
    [tabFiltered],
  );

  const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  function changeMonth(delta: number) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  function exportXlsx() {
    downloadExcel(`conveyance_${month}`, [
      { name: 'Summary', rows: summary.map(s => ({
        Employee: s.userName, 'Emp ID': s.employeeId || '', Days: s.days,
        'Total KM': Number(s.totalKm.toFixed(2)), 'Total Conveyance': Number(s.totalConveyance.toFixed(2)),
      })) },
      { name: 'Daily', rows: sorted.map(r => ({
        Date: r.date, Employee: r.userName, 'Emp ID': r.employeeId || '', Route: r.route,
        KM: Number(r.totalKm.toFixed(2)), 'Rate (/km)': r.ratePerKm, Status: statusOf(r),
        Amount: Number(effectiveAmount(r).toFixed(2)),
      })) },
    ]);
  }

  function openModal(rec: ConveyanceRecord, type: 'approve' | 'reject') {
    setActionModal({ rec, type });
    setApprovedAmount(String(rec.conveyance.toFixed(2)));
    setActionComment('');
    setError('');
  }

  async function handleAction() {
    if (!actionModal) return;
    const { rec, type } = actionModal;
    if (!actionComment.trim()) { setError(`A reason is required to ${type} conveyance.`); return; }
    let amountValue = 0;
    if (type === 'approve') {
      amountValue = parseFloat(approvedAmount);
      if (isNaN(amountValue) || amountValue < 0) { setError('Approved amount must be a non-negative number.'); return; }
    }
    setError('');
    setActioning(rec.id);
    try {
      if (type === 'approve') {
        await approveConveyance(rec.id, amountValue, adminName, actionComment.trim());
      } else {
        await rejectConveyance(rec.id, adminName, actionComment.trim());
      }
      setActionModal(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${type === 'approve' ? 'Approval' : 'Rejection'} failed.`);
    }
    setActioning('');
  }

  const isActionDisabled = !!actioning || actionComment.trim() === '' ||
    (actionModal?.type === 'approve' && (approvedAmount.trim() === '' || isNaN(parseFloat(approvedAmount)) || parseFloat(approvedAmount) < 0));

  return (
    <div>
      {/* Conveyance rates */}
      <div className="card mb-6">
        <h2 className="font-bold text-text-primary mb-4">Conveyance Rates</h2>
        {ratesLoading ? (
          <div className="text-text-secondary text-sm">Loading…</div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="label">Public Transport (₹/km)</label>
              <input className="input" type="number" step="any" min="0" value={rate1} onChange={e => setRate1(e.target.value)} placeholder="e.g. 2.5" />
            </div>
            <div>
              <label className="label">Personal Vechicle (₹/km)</label>
              <input className="input" type="number" step="any" min="0" value={rate2} onChange={e => setRate2(e.target.value)} placeholder="e.g. 4.0" />
            </div>
            <div className="flex items-center gap-3">
              <button className="btn-primary" onClick={saveRates} disabled={ratesSaving}>{ratesSaving ? 'Saving…' : 'Save Rates'}</button>
              {ratesMsg && <span className={`text-sm ${ratesMsg === 'Saved' ? 'text-[#0A7A50]' : 'text-red-500'}`}>{ratesMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Month picker + employee filter */}
      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg text-text-secondary hover:bg-background hover:text-text-primary transition-colors text-lg leading-none">‹</button>
          <h2 className="text-base font-semibold text-text-primary">{monthLabel}</h2>
          <button onClick={() => changeMonth(1)} className="p-2 rounded-lg text-text-secondary hover:bg-background hover:text-text-primary transition-colors text-lg leading-none">›</button>
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <select
            value={employeeFilter}
            onChange={e => setEmployeeFilter(e.target.value)}
            className="input text-sm !py-2 min-w-[180px]"
          >
            <option value="">All Employees</option>
            {Array.from(new Map(records.map(r => [r.userId, r.userName]))).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}

      {/* Employee summary — always reflects reviewed (payroll) money for the month */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-text-primary">Employee Summary</h2>
          <ExportButton onClick={exportXlsx} disabled={loading || sorted.length === 0} />
        </div>
        {loading ? (
          <div className="text-text-secondary text-sm py-4 text-center">Loading…</div>
        ) : summary.length === 0 ? (
          <div className="text-text-secondary text-sm py-4 text-center">No conveyance data for {monthLabel}.</div>
        ) : isMobile ? (
          <div className="divide-y divide-border">
            {summary.map(s => (
              <div key={s.employeeId} className="py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-text-primary truncate">{s.userName}</div>
                  <div className="text-xs text-text-secondary">{s.employeeId || '—'} · {s.days}d · {s.totalKm.toFixed(2)} km</div>
                </div>
                <div className="font-medium text-text-primary flex-shrink-0">₹{s.totalConveyance.toFixed(2)}</div>
              </div>
            ))}
            <div className="py-3 flex items-center justify-between gap-2 font-bold">
              <div>Grand Total · {summary.reduce((s, e) => s + e.days, 0)}d · {grandKm.toFixed(2)} km</div>
              <div className="text-text-primary">₹{grandTotal.toFixed(2)}</div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background border-b border-border">
                <tr>
                  {['Employee', 'Emp ID', 'Days', 'Total KM', 'Total Conveyance'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map(s => (
                  <tr key={s.employeeId} className="hover:bg-background transition-colors">
                    <td className="px-4 py-3 font-medium text-text-primary">{s.userName}</td>
                    <td className="px-4 py-3 text-text-secondary">{s.employeeId || '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{s.days}</td>
                    <td className="px-4 py-3 text-text-secondary">{s.totalKm.toFixed(2)} km</td>
                    <td className="px-4 py-3 font-medium text-text-primary">₹{s.totalConveyance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border">
                <tr className="font-bold">
                  <td className="px-4 py-3 text-text-primary" colSpan={2}>Grand Total</td>
                  <td className="px-4 py-3 text-text-secondary">{summary.reduce((s, e) => s + e.days, 0)}</td>
                  <td className="px-4 py-3 text-text-secondary">{grandKm.toFixed(2)} km</td>
                  <td className="px-4 py-3 text-text-primary">₹{grandTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Daily breakdown + approval queue */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 pb-0">
          <h2 className="font-bold text-text-primary mb-3">Daily Breakdown</h2>
          <div className="flex flex-wrap items-center gap-2 mb-4">
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
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No {filter === 'all' ? '' : filter} conveyance records for {monthLabel}.</div>
        ) : isMobile ? (
          <div className="divide-y divide-border">
            {sorted.map(r => {
              const status = statusOf(r);
              return (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary truncate">{r.userName}</div>
                      <div className="text-xs text-text-secondary">{r.employeeId || '—'} · {r.date}</div>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-xs text-text-secondary mt-1.5 truncate" title={r.route}>{r.route}</div>
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="text-text-secondary">{r.totalKm.toFixed(2)} km · ₹{r.ratePerKm}/km</span>
                    <span className="font-medium text-text-primary">₹{effectiveAmount(r).toFixed(2)}</span>
                  </div>
                  {status === 'pending' && canApprove ? (
                    <div className="flex gap-2 mt-3">
                      <button className="btn-success text-xs py-1.5 px-3 flex-1"
                        disabled={actioning === r.id}
                        onClick={() => openModal(r, 'approve')}>
                        Approve
                      </button>
                      <button className="btn-danger text-xs py-1.5 px-3 flex-1"
                        disabled={actioning === r.id}
                        onClick={() => openModal(r, 'reject')}>
                        Reject
                      </button>
                    </div>
                  ) : r.approvedBy ? (
                    <p className="text-xs text-text-secondary mt-2">{r.approvedBy}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background border-b border-border">
                <tr>
                  {['Date', 'Employee', 'Emp ID', 'Route', 'KM', 'Rate', 'Amount', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map(r => {
                  const status = statusOf(r);
                  return (
                    <tr key={r.id} className="hover:bg-background transition-colors">
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-3 font-medium text-text-primary">{r.userName}</td>
                      <td className="px-4 py-3 text-text-secondary">{r.employeeId || '—'}</td>
                      <td className="px-4 py-3 text-text-secondary text-xs max-w-xs truncate" title={r.route}>{r.route}</td>
                      <td className="px-4 py-3 text-text-secondary">{r.totalKm.toFixed(2)}</td>
                      <td className="px-4 py-3 text-text-secondary">₹{r.ratePerKm}/km</td>
                      <td className="px-4 py-3 font-medium text-text-primary">₹{effectiveAmount(r).toFixed(2)}</td>
                      <td className="px-4 py-3"><StatusBadge status={status} /></td>
                      <td className="px-4 py-3">
                        {status === 'pending' && canApprove ? (
                          <div className="flex gap-2">
                            <button className="btn-success text-xs py-1 px-3"
                              disabled={actioning === r.id}
                              onClick={() => openModal(r, 'approve')}>
                              Approve
                            </button>
                            <button className="btn-danger text-xs py-1 px-3"
                              disabled={actioning === r.id}
                              onClick={() => openModal(r, 'reject')}>
                              Reject
                            </button>
                          </div>
                        ) : r.approvedBy ? (
                          <span className="text-xs text-text-secondary">{r.approvedBy}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {actionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-text-primary mb-1">
              {actionModal.type === 'approve' ? 'Approve' : 'Reject'} Conveyance
            </h2>
            <p className="text-text-secondary text-sm mb-1">
              <span className="font-semibold text-text-primary">{actionModal.rec.userName}</span>
              &ensp;&mdash;&ensp;{actionModal.rec.date}
            </p>
            <p className="text-text-secondary text-sm mb-5">
              {actionModal.rec.route} &ensp;&middot;&ensp; {actionModal.rec.totalKm.toFixed(2)} km @ ₹{actionModal.rec.ratePerKm}/km
            </p>

            {actionModal.type === 'approve' && (
              <div className="mb-4">
                <label className="label">Approved amount (₹)</label>
                <input
                  type="number" min="0" step="0.01"
                  className="input mt-1"
                  value={approvedAmount}
                  onChange={e => setApprovedAmount(e.target.value)}
                />
                <p className="text-xs text-text-secondary mt-1.5">
                  Defaults to the computed figure (₹{actionModal.rec.conveyance.toFixed(2)}) — edit it to approve a different amount.
                </p>
              </div>
            )}

            <div className="mb-1">
              <label className="label">
                {actionModal.type === 'approve' ? 'Reason for approval' : 'Reason for rejection'}
                <span className="text-red-500 ml-1">*</span>
              </label>
              <textarea
                className="input mt-1 min-h-[80px]"
                value={actionComment}
                onChange={e => setActionComment(e.target.value)}
                placeholder="Enter reason…"
              />
            </div>

            <div className="flex gap-3 mt-5">
              <button
                className={`${actionModal.type === 'approve' ? 'btn-success' : 'btn-danger'} flex-1`}
                onClick={handleAction}
                disabled={isActionDisabled}
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
