'use client';
import { useEffect, useState } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getAllUsers, createUserProfile, updateUserProfile,
  employeeIdInUse, setUserActive, resetUserPassword, updateUserEmail } from '@/lib/firestore';
import { firebaseConfig } from '@/lib/firebase';
import { syntheticLoginEmail } from '@/lib/constants';
import type { User } from '@/types';
import Icon from '@/components/Icon';
import { Avatar, RoleBadge, TH, TD } from '@/components/ui';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';
import { TABS } from '@/lib/portalAccess';
import { EMPLOYEE_CATEGORIES, EMPLOYEE_CATEGORY_SET } from '@/lib/categories';
import { getsCategories } from '@/lib/roleCapabilities';

const ROLES = ['operations', 'office', 'sales', 'admin'] as const;
type Role = typeof ROLES[number];

// The tabs a non-admin can be granted (matrix columns / modal checkboxes).
const GRANTABLE_TABS = TABS.filter(t => !t.adminOnly);
const GRANTABLE_PATH_SET = new Set(GRANTABLE_TABS.map(t => t.path));
const tabLabel = (path: string) => GRANTABLE_TABS.find(t => t.path === path)?.label ?? path;

interface FormState {
  name: string;
  loginEmail: string;
  contactEmail: string;
  password: string;
  employeeId: string;
  role: Role;
  tabAccess: string[];
  categories: string[];
  salaryRate: string;
  pfPercent: string;
  esiPercent: string;
  imprestPercent: string;
  homeLat: string;
  homeLng: string;
  conveyanceRateType: '' | '1' | '2';
}

const EMPTY_FORM: FormState = {
  name: '', loginEmail: '', contactEmail: '', password: '', employeeId: '', role: 'operations',
  tabAccess: [], categories: [], salaryRate: '', pfPercent: '', esiPercent: '', imprestPercent: '',
  homeLat: '', homeLng: '', conveyanceRateType: '',
};

// A short random temp password for new hires / admin resets (synthetic logins get no email link).
function makeTempPassword() {
  return 'Wc' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 90);
}

// Firestore Timestamp → readable IST date/time (suspension log). Tolerates missing values.
function fmtTs(t?: { toDate?: () => Date } | null) {
  return t?.toDate ? t.toDate().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function UsersPage() {
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState<User | null>(null);
  const [form, setForm]         = useState<FormState>({ ...EMPTY_FORM });
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState('');
  const [query, setQuery]       = useState('');
  const [showInactive, setShowInactive] = useState(false);
  // Inline suspend sub-form (inside the edit modal): required reason + optional return date.
  const [suspendOpen, setSuspendOpen]     = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendReturn, setSuspendReturn] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const u = await getAllUsers(true); // include inactive so admins can reactivate
      setUsers(u.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
    } catch (e: unknown) {
      setError(`Failed to load users: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function resetSuspendForm() {
    setSuspendOpen(false);
    setSuspendReason('');
    setSuspendReturn('');
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
    resetSuspendForm();
    setShowModal(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({
      name: u.name ?? '',
      loginEmail: u.email ?? '',
      contactEmail: u.contactEmail ?? '',
      password: '',
      employeeId: u.employeeId ?? '',
      role: (u.role as Role) ?? 'operations',
      tabAccess: (u.tabAccess ?? []).filter(p => GRANTABLE_PATH_SET.has(p)),
      categories: (u.categories ?? []).filter(c => EMPLOYEE_CATEGORY_SET.has(c)),
      salaryRate: u.salaryRate ? String(u.salaryRate) : '',
      pfPercent: u.pfPercent ? String(u.pfPercent) : '',
      esiPercent: u.esiPercent ? String(u.esiPercent) : '',
      imprestPercent: u.imprestPercent ? String(u.imprestPercent) : '',
      homeLat: u.homeLat ? String(u.homeLat) : '',
      homeLng: u.homeLng ? String(u.homeLng) : '',
      conveyanceRateType: u.conveyanceRateType ? String(u.conveyanceRateType) as '1' | '2' : '',
    });
    setFormError('');
    resetSuspendForm();
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    if (!form.employeeId.trim()) { setFormError('Employee ID is required.'); return; }
    if (!editing && form.password.length < 6) { setFormError('Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      const salaryRate = form.salaryRate ? parseFloat(form.salaryRate) : 0;
      const pfPercent = form.pfPercent ? parseFloat(form.pfPercent) : 0;
      const esiPercent = form.esiPercent ? parseFloat(form.esiPercent) : 0;
      const imprestPercent = form.imprestPercent ? parseFloat(form.imprestPercent) : 0;
      const homeLat = form.homeLat ? parseFloat(form.homeLat) : undefined;
      const homeLng = form.homeLng ? parseFloat(form.homeLng) : undefined;
      const conveyanceRateType = form.conveyanceRateType ? (parseInt(form.conveyanceRateType) as 1 | 2) : undefined;
      const contactEmail = form.contactEmail.trim().toLowerCase();
      // Categories only apply to roles that get them (operations); switching to another role clears them.
      const categories = getsCategories(form.role) ? form.categories : [];

      if (editing) {
        // Login email goes through a Cloud Function (Auth + doc); validate before touching anything.
        const nextLogin = form.loginEmail.trim().toLowerCase();
        const loginChanged = nextLogin !== (editing.email ?? '').toLowerCase();
        if (loginChanged && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextLogin)) {
          setFormError('Login email is not a valid email address.');
          setSaving(false);
          return;
        }
        await updateUserProfile(editing.id, {
          name: form.name.trim(), role: form.role, employeeId: form.employeeId.trim(),
          tabAccess: form.tabAccess, categories, contactEmail, salaryRate,
          pfPercent, esiPercent, imprestPercent, homeLat, homeLng, conveyanceRateType,
        });
        if (loginChanged) await updateUserEmail(editing.id, nextLogin);
      } else {
        // New hires log in with just their employee ID → a synthetic login email.
        // Block reusing an ID an active user still holds.
        if (await employeeIdInUse(form.employeeId)) {
          setFormError('An active user already has this Employee ID.');
          setSaving(false);
          return;
        }
        const loginEmail = syntheticLoginEmail(form.employeeId);
        const secondary = initializeApp(firebaseConfig, `create_${Date.now()}`);
        const secAuth   = getAuth(secondary);
        let uid: string;
        try {
          const cred = await createUserWithEmailAndPassword(secAuth, loginEmail, form.password);
          uid = cred.user.uid;
        } finally {
          await secAuth.signOut().catch(() => {});
          await deleteApp(secondary).catch(() => {});
        }
        await createUserProfile(uid, {
          name: form.name.trim(), email: loginEmail, contactEmail,
          role: form.role, tabAccess: form.tabAccess, categories, employeeId: form.employeeId.trim(), salaryRate,
          pfPercent, esiPercent, imprestPercent, homeLat, homeLng, conveyanceRateType,
        });
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'functions/already-exists') {
        setFormError('That login email is already used by another employee.');
      } else if (code === 'auth/email-already-in-use') {
        setFormError('This Employee ID is already registered as a login.');
      } else if (code === 'auth/invalid-email') {
        setFormError('Employee ID produces an invalid login — use letters/numbers only.');
      } else if (code === 'auth/weak-password') {
        setFormError('Password must be at least 6 characters.');
      } else {
        setFormError(e instanceof Error ? e.message : 'Save failed. Try again.');
      }
    }
    setSaving(false);
  }

  async function handleResetPassword() {
    if (!editing) return;
    const temp = makeTempPassword();
    setSaving(true);
    try {
      await resetUserPassword(editing.id, temp);
      window.prompt(`New password for ${editing.name || 'this employee'} — copy and hand it over:`, temp);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Password reset failed. Try again.');
    }
    setSaving(false);
  }

  // Suspend the employee: reason required, expected-return optional (informational).
  async function handleSuspend() {
    if (!editing) return;
    const reason = suspendReason.trim();
    if (!reason) { setFormError('A reason is required to suspend this employee.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await setUserActive(editing.id, false, { reason, expectedReturn: suspendReturn || null });
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Suspend failed. Try again.');
    }
    setSaving(false);
  }

  // End a suspension: re-enable login, clear suspension fields (handled server-side).
  async function handleReactivate() {
    if (!editing) return;
    if (!window.confirm(`Reactivate ${editing.name || 'this employee'}? They will be able to log in again.`)) return;
    setSaving(true);
    setFormError('');
    try {
      await setUserActive(editing.id, true);
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Reactivate failed. Try again.');
    }
    setSaving(false);
  }

  const q = query.trim().toLowerCase();
  const shown = users
    .filter(u => showInactive || u.active !== false)
    .filter(u => !q
      || (u.name ?? '').toLowerCase().includes(q)
      || (u.email ?? '').toLowerCase().includes(q)
      || (u.contactEmail ?? '').toLowerCase().includes(q)
      || (u.employeeId ?? '').toLowerCase().includes(q));

  function exportXlsx() {
    downloadSheet('employees', 'Employees', shown.map(u => ({
      Name: u.name ?? '',
      'Login Email': u.email ?? '',
      'Contact Email': u.contactEmail ?? '',
      Status: u.active === false ? 'Suspended' : 'Active',
      'Employee ID': u.employeeId ?? '',
      Role: u.role ?? '',
      'Tab Access': u.role === 'admin'
        ? 'Full access'
        : (u.tabAccess ?? []).filter(p => GRANTABLE_PATH_SET.has(p)).map(tabLabel).join(', '),
      Categories: getsCategories(u.role) ? (u.categories ?? []).filter(c => EMPLOYEE_CATEGORY_SET.has(c)).join(', ') : '',
      'Salary Rate': u.salaryRate ?? '',
      'PF %': u.pfPercent ?? '',
      'ESI %': u.esiPercent ?? '',
      'Imprest %': u.imprestPercent ?? '',
      'PL Balance': u.plBalance ?? 0,
      'WO Balance': u.woBalance ?? 0,
      Conveyance: u.conveyanceRateType ? `Conveyance ${u.conveyanceRateType}` : '',
      'Home Lat': u.homeLat ?? '',
      'Home Lng': u.homeLng ?? '',
    })));
  }

  return (
    <div className="max-w-[1240px]">
      <div className="flex items-center justify-between gap-4 mb-[18px]">
        <div className="flex items-center gap-2.5 h-[38px] w-80 max-w-[42%] px-3 border border-border rounded-[10px] bg-white">
          <span className="text-[#B4ADA5] flex"><Icon name="search" size={16} /></span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, ID or email"
            className="border-none outline-none bg-transparent flex-1 text-[13.5px] text-[#2A241F]" />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] text-text-secondary select-none cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show suspended
          </label>
          <ExportButton onClick={exportXlsx} disabled={loading || shown.length === 0} />
          <button className="btn-primary flex items-center gap-1.5" onClick={openAdd}><Icon name="plus" size={16} />Add employee</button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      <div className="bg-white border border-[#E9E6E2] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No employees yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH} pl-[18px]`}>Employee</th>
                  <th className={TH}>ID</th>
                  <th className={TH}>Role</th>
                  <th className={`${TH} text-right`}>Salary rate</th>
                  <th className={`${TH} text-right`}>PL balance</th>
                  <th className={`${TH} pr-[18px] text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(u => (
                  <tr key={u.id} className={`border-t border-[#F4F2EF] hover:bg-[#FBFAF8] transition-colors ${u.active === false ? 'opacity-55' : ''}`}>
                    <td className={`${TD} pl-[18px]`}>
                      <div className="flex items-center gap-[11px]">
                        <Avatar name={u.name} size={34} />
                        <div>
                          <div className="font-medium text-[#2A241F] flex items-center gap-2">
                            {u.name}
                            {u.active === false && <span className="bg-[#F3E9E7] text-[#B4463A] px-1.5 py-0.5 rounded-[6px] text-[11px] font-normal">Suspended</span>}
                          </div>
                          <div className="text-[12px] text-[#9A938C]">{u.contactEmail || u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} font-mono text-[#6B635C]`}>{u.employeeId || '—'}</td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RoleBadge role={u.role} />
                        {u.role === 'admin' ? (
                          <span className="bg-[#EDF2FD] text-[#2456C7] px-1.5 py-0.5 rounded-[6px] text-[11px]">Full access</span>
                        ) : (() => {
                          const n = (u.tabAccess ?? []).filter(p => GRANTABLE_PATH_SET.has(p)).length;
                          return n > 0
                            ? <span className="bg-[#EDF2FD] text-[#2456C7] px-1.5 py-0.5 rounded-[6px] text-[11px]">{n} tab{n === 1 ? '' : 's'}</span>
                            : null;
                        })()}
                        {getsCategories(u.role) && (u.categories ?? []).filter(c => EMPLOYEE_CATEGORY_SET.has(c)).map(c => (
                          <span key={c} className="bg-[#F3EEFA] text-[#6A44B8] px-1.5 py-0.5 rounded-[6px] text-[11px] font-mono">{c}</span>
                        ))}
                      </div>
                    </td>
                    <td className={`${TD} text-right font-mono text-[#2A241F]`}>{u.salaryRate ? `₹${u.salaryRate}` : '—'}</td>
                    <td className={`${TD} text-right font-mono`}>
                      {u.plBalance !== undefined
                        ? <span className="bg-[#EDF2FD] text-[#2456C7] px-2 py-0.5 rounded-[6px] text-[12px]">{u.plBalance}</span>
                        : <span className="text-[#9A938C]">—</span>}
                    </td>
                    <td className={`${TD} pr-[18px] text-right`}>
                      <button className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] text-[#6B635C] hover:bg-[#F5F2EE] transition-colors" onClick={() => openEdit(u)}><Icon name="more" size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && (
              <div className="p-[34px] text-center text-[13px] text-[#9A938C]">No employees match “{query}”.</div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-text-primary mb-5">{editing ? 'Edit Employee' : 'Add Employee'}</h2>
            <div className="space-y-4">
              <div><label className="label">Full Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ravi Kumar" /></div>

              <div>
                <label className="label">Employee ID</label>
                <input className="input" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="EMP001" />
                {!editing && <p className="text-[12px] text-text-secondary mt-1">The employee logs in with this ID (login: <span className="font-mono">{form.employeeId.trim() ? syntheticLoginEmail(form.employeeId) : `‹id›@whitecoffee.internal`}</span>).</p>}
              </div>

              {editing && (
                <div>
                  <label className="label">Login Email <span className="text-text-secondary font-normal">(the credential this employee signs in with)</span></label>
                  <input className="input" type="email" value={form.loginEmail} onChange={e => setForm(f => ({ ...f, loginEmail: e.target.value }))} placeholder="ravi@whitecoffee.internal" />
                  <p className="text-[12px] text-text-secondary mt-1">Changing this updates their sign-in credential immediately — they must use the new email to log in.</p>
                </div>
              )}

              <div>
                <label className="label">Contact Email <span className="text-text-secondary font-normal">(optional — notifications only, not a login)</span></label>
                <input className="input" type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="ravi@senken.com" />
              </div>

              {!editing && <div><label className="label">Initial Password</label><input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" /></div>}

              <div>
                <label className="label">Role</label>
                <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>

              {getsCategories(form.role) && (
                <div>
                  <label className="label">Category <span className="text-text-secondary font-normal">(operations classification — pick any that apply)</span></label>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {EMPLOYEE_CATEGORIES.map(cat => {
                      const checked = form.categories.includes(cat);
                      return (
                        <label key={cat} className="flex items-center gap-2 text-[13.5px] text-[#2A241F] select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => setForm(f => ({
                              ...f,
                              categories: e.target.checked ? [...f.categories, cat] : f.categories.filter(c => c !== cat),
                            }))}
                          />
                          <span className="font-mono">{cat}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="label">Portal Tab Access <span className="text-text-secondary font-normal">(which admin-portal tabs this employee can use)</span></label>
                {form.role === 'admin' ? (
                  <p className="text-[12px] text-text-secondary">Admins always see the entire portal — tab access doesn’t apply.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {GRANTABLE_TABS.map(tab => {
                        const checked = form.tabAccess.includes(tab.path);
                        return (
                          <label key={tab.path} className="flex items-center gap-2 text-[13.5px] text-[#2A241F] select-none cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => setForm(f => ({
                                ...f,
                                tabAccess: e.target.checked
                                  ? [...f.tabAccess, tab.path]
                                  : f.tabAccess.filter(p => p !== tab.path),
                              }))}
                            />
                            {tab.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[12px] text-text-secondary mt-1">Non-admins can sign into the portal and see only the tabs ticked here. Manage everyone at once on the Access Control page.</p>
                  </>
                )}
              </div>

              <div><label className="label">Salary Rate (₹/day)</label><input className="input" type="number" step="any" min="0" value={form.salaryRate} onChange={e => setForm(f => ({ ...f, salaryRate: e.target.value }))} placeholder="e.g. 800" /></div>
              {/* Payroll percentages — recorded only; nothing reads them yet (see User type). */}
              <div><label className="label">PF (%)</label><input className="input" type="number" step="any" min="0" max="100" value={form.pfPercent} onChange={e => setForm(f => ({ ...f, pfPercent: e.target.value }))} placeholder="e.g. 12" /></div>
              <div><label className="label">ESI (%)</label><input className="input" type="number" step="any" min="0" max="100" value={form.esiPercent} onChange={e => setForm(f => ({ ...f, esiPercent: e.target.value }))} placeholder="e.g. 0.75" /></div>
              <div><label className="label">Imprest (%)</label><input className="input" type="number" step="any" min="0" max="100" value={form.imprestPercent} onChange={e => setForm(f => ({ ...f, imprestPercent: e.target.value }))} placeholder="e.g. 5" /></div>

              <div>
                <label className="label">Conveyance Rate</label>
                <select className="input" value={form.conveyanceRateType} onChange={e => setForm(f => ({ ...f, conveyanceRateType: e.target.value as '' | '1' | '2' }))}>
                  <option value="">None</option>
                  <option value="1">Conveyance 1</option>
                  <option value="2">Conveyance 2</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Home Latitude</label><input className="input" type="number" step="any" value={form.homeLat} onChange={e => setForm(f => ({ ...f, homeLat: e.target.value }))} placeholder="e.g. 28.6257" /></div>
                <div><label className="label">Home Longitude</label><input className="input" type="number" step="any" value={form.homeLng} onChange={e => setForm(f => ({ ...f, homeLng: e.target.value }))} placeholder="e.g. 77.3760" /></div>
              </div>

              {formError && <p className="text-red-500 text-sm">{formError}</p>}

              <div className="flex gap-3 pt-2">
                <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn-outline flex-1" onClick={() => setShowModal(false)}>Cancel</button>
              </div>

              {editing && (
                <div className="flex flex-col gap-2 pt-1 border-t border-border">
                  <button className="w-full text-sm text-text-secondary hover:text-primary underline text-center disabled:opacity-50" onClick={handleResetPassword} disabled={saving}>
                    Reset password (set a new temporary one)
                  </button>

                  {editing.active === false ? (
                    <>
                      {/* Current suspension detail */}
                      <div className="rounded-[10px] bg-[#FBF6F5] border border-[#EEDDDA] p-3 text-[13px]">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="bg-[#F3E9E7] text-[#B4463A] px-1.5 py-0.5 rounded-[6px] text-[11px]">Suspended</span>
                        </div>
                        <div className="text-[#6B635C] leading-relaxed">
                          <div><span className="text-[#9A938C]">Reason:</span> {editing.suspendedReason || '—'}</div>
                          <div><span className="text-[#9A938C]">By:</span> {editing.suspendedBy || '—'} · {fmtTs(editing.suspendedAt)}</div>
                          {editing.expectedReturn && <div><span className="text-[#9A938C]">Expected return:</span> {editing.expectedReturn}</div>}
                        </div>
                      </div>
                      <button className="btn-success w-full" onClick={handleReactivate} disabled={saving}>Reactivate Employee</button>
                    </>
                  ) : suspendOpen ? (
                    <div className="rounded-[10px] bg-[#FBF6F5] border border-[#EEDDDA] p-3 space-y-3">
                      <div>
                        <label className="label">Reason <span className="text-[#B4463A]">*</span></label>
                        <textarea className="input" rows={2} value={suspendReason} onChange={e => setSuspendReason(e.target.value)} placeholder="e.g. Unpaid leave until further notice" />
                      </div>
                      <div>
                        <label className="label">Expected return <span className="text-text-secondary font-normal">(optional)</span></label>
                        <input className="input" type="date" value={suspendReturn} onChange={e => setSuspendReturn(e.target.value)} />
                      </div>
                      <div className="flex gap-3">
                        <button className="btn-danger flex-1" onClick={handleSuspend} disabled={saving}>{saving ? 'Suspending…' : 'Confirm suspension'}</button>
                        <button className="btn-outline flex-1" onClick={resetSuspendForm} disabled={saving}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn-danger w-full" onClick={() => { setFormError(''); setSuspendOpen(true); }} disabled={saving}>Suspend Employee</button>
                  )}

                  {/* History log (most recent first) */}
                  {(editing.suspensionHistory?.length ?? 0) > 0 && (
                    <div className="pt-2">
                      <div className="text-[12px] font-medium text-[#9A938C] mb-1.5">Suspension history</div>
                      <ul className="space-y-1.5">
                        {editing.suspensionHistory!.slice().reverse().map((ev, i) => (
                          <li key={i} className="text-[12.5px] text-[#6B635C] flex gap-2">
                            <span className={`px-1.5 py-0.5 rounded-[6px] text-[11px] h-fit ${ev.action === 'suspend' ? 'bg-[#F3E9E7] text-[#B4463A]' : 'bg-[#E7F1EA] text-[#2E7D46]'}`}>
                              {ev.action === 'suspend' ? 'Suspended' : 'Reactivated'}
                            </span>
                            <span className="leading-relaxed">
                              {fmtTs(ev.at)} · {ev.by}
                              {ev.reason && <> — {ev.reason}</>}
                              {ev.expectedReturn && <> (return {ev.expectedReturn})</>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
