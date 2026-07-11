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
import { TAG_LABELS, ALL_TAGS } from '@/lib/portalAccess';

const ROLES = ['operations', 'office', 'admin'] as const;
type Role = typeof ROLES[number];

interface FormState {
  name: string;
  loginEmail: string;
  contactEmail: string;
  password: string;
  employeeId: string;
  role: Role;
  tags: string[];
  salaryRate: string;
  homeLat: string;
  homeLng: string;
  conveyanceRateType: '' | '1' | '2';
}

const EMPTY_FORM: FormState = {
  name: '', loginEmail: '', contactEmail: '', password: '', employeeId: '', role: 'operations',
  tags: [], salaryRate: '', homeLat: '', homeLng: '', conveyanceRateType: '',
};

// A short random temp password for new hires / admin resets (synthetic logins get no email link).
function makeTempPassword() {
  return 'Wc' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 90);
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

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError('');
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
      tags: (u.tags ?? []).filter(t => t in TAG_LABELS),
      salaryRate: u.salaryRate ? String(u.salaryRate) : '',
      homeLat: u.homeLat ? String(u.homeLat) : '',
      homeLng: u.homeLng ? String(u.homeLng) : '',
      conveyanceRateType: u.conveyanceRateType ? String(u.conveyanceRateType) as '1' | '2' : '',
    });
    setFormError('');
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
      const homeLat = form.homeLat ? parseFloat(form.homeLat) : undefined;
      const homeLng = form.homeLng ? parseFloat(form.homeLng) : undefined;
      const conveyanceRateType = form.conveyanceRateType ? (parseInt(form.conveyanceRateType) as 1 | 2) : undefined;
      const contactEmail = form.contactEmail.trim().toLowerCase();

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
          tags: form.tags, contactEmail, salaryRate, homeLat, homeLng, conveyanceRateType,
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
          role: form.role, tags: form.tags, employeeId: form.employeeId.trim(), salaryRate,
          homeLat, homeLng, conveyanceRateType,
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

  async function handleToggleActive() {
    if (!editing) return;
    const next = editing.active === false; // reactivate if currently inactive
    const verb = next ? 'Reactivate' : 'Deactivate';
    if (!window.confirm(`${verb} ${editing.name || 'this employee'}? ${next ? 'They will be able to log in again.' : 'Their login will be disabled; data is kept.'}`)) return;
    setSaving(true);
    try {
      await setUserActive(editing.id, next);
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : `${verb} failed. Try again.`);
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
      Status: u.active === false ? 'Inactive' : 'Active',
      'Employee ID': u.employeeId ?? '',
      Role: u.role ?? '',
      Tags: u.role !== 'admin' ? (u.tags ?? []).filter(t => t in TAG_LABELS).map(t => TAG_LABELS[t]).join(', ') : '',
      'Salary Rate': u.salaryRate ?? '',
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
            Show inactive
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
                            {u.active === false && <span className="bg-[#F3E9E7] text-[#B4463A] px-1.5 py-0.5 rounded-[6px] text-[11px] font-normal">Inactive</span>}
                          </div>
                          <div className="text-[12px] text-[#9A938C]">{u.contactEmail || u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} font-mono text-[#6B635C]`}>{u.employeeId || '—'}</td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RoleBadge role={u.role} />
                        {u.role !== 'admin' && (u.tags ?? []).filter(t => t in TAG_LABELS).map(t => (
                          <span key={t} className="bg-[#EDF2FD] text-[#2456C7] px-1.5 py-0.5 rounded-[6px] text-[11px]">{TAG_LABELS[t]}</span>
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

              <div>
                <label className="label">Portal Access Tags <span className="text-text-secondary font-normal">(scoped admin-portal tabs)</span></label>
                {form.role === 'admin' ? (
                  <p className="text-[12px] text-text-secondary">Admins always see the entire portal — tags don’t apply.</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      {ALL_TAGS.map(tag => {
                        const checked = form.tags.includes(tag);
                        return (
                          <label key={tag} className="flex items-center gap-2 text-[13.5px] text-[#2A241F] select-none cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => setForm(f => ({
                                ...f,
                                tags: e.target.checked ? [...f.tags, tag] : f.tags.filter(t => t !== tag),
                              }))}
                            />
                            {TAG_LABELS[tag]}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[12px] text-text-secondary mt-1">Tagged non-admins can sign into the portal and see only the tabs their tags grant.</p>
                  </>
                )}
              </div>

              <div><label className="label">Salary Rate (₹/day)</label><input className="input" type="number" step="any" min="0" value={form.salaryRate} onChange={e => setForm(f => ({ ...f, salaryRate: e.target.value }))} placeholder="e.g. 800" /></div>

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
                    <button className="btn-success w-full" onClick={handleToggleActive} disabled={saving}>Reactivate Employee</button>
                  ) : (
                    <button className="btn-danger w-full" onClick={handleToggleActive} disabled={saving}>Deactivate Employee</button>
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
