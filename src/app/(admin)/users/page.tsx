'use client';
import { useEffect, useState } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getAllUsers, createUserProfile, updateUserProfile, deleteUserProfile } from '@/lib/firestore';
import { firebaseConfig } from '@/lib/firebase';
import type { User } from '@/types';
import Icon from '@/components/Icon';
import { Avatar, RoleBadge, TH, TD } from '@/components/ui';
import ExportButton from '@/components/ExportButton';
import { downloadSheet } from '@/lib/excel';

const ROLES = ['operations', 'office', 'admin'] as const;
type Role = typeof ROLES[number];

interface FormState {
  name: string;
  email: string;
  password: string;
  employeeId: string;
  role: Role;
  salaryRate: string;
  homeLat: string;
  homeLng: string;
  conveyanceRateType: '' | '1' | '2';
}

const EMPTY_FORM: FormState = {
  name: '', email: '', password: '', employeeId: '', role: 'operations',
  salaryRate: '', homeLat: '', homeLng: '', conveyanceRateType: '',
};

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

  async function load() {
    setLoading(true);
    setError('');
    try {
      const u = await getAllUsers();
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
      email: u.email ?? '',
      password: '',
      employeeId: u.employeeId ?? '',
      role: (u.role as Role) ?? 'operations',
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
    if (!editing && !form.email.trim()) { setFormError('Email is required.'); return; }
    if (!editing && form.password.length < 6) { setFormError('Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      const salaryRate = form.salaryRate ? parseFloat(form.salaryRate) : 0;
      const homeLat = form.homeLat ? parseFloat(form.homeLat) : undefined;
      const homeLng = form.homeLng ? parseFloat(form.homeLng) : undefined;
      const conveyanceRateType = form.conveyanceRateType ? (parseInt(form.conveyanceRateType) as 1 | 2) : undefined;

      if (editing) {
        await updateUserProfile(editing.id, {
          name: form.name.trim(), role: form.role, employeeId: form.employeeId.trim(),
          salaryRate, homeLat, homeLng, conveyanceRateType,
        });
      } else {
        const secondary = initializeApp(firebaseConfig, `create_${Date.now()}`);
        const secAuth   = getAuth(secondary);
        let uid: string;
        try {
          const cred = await createUserWithEmailAndPassword(secAuth, form.email.trim().toLowerCase(), form.password);
          uid = cred.user.uid;
        } finally {
          await secAuth.signOut().catch(() => {});
          await deleteApp(secondary).catch(() => {});
        }
        await createUserProfile(uid, {
          name: form.name.trim(), email: form.email.trim().toLowerCase(),
          role: form.role, employeeId: form.employeeId.trim(), salaryRate,
          homeLat, homeLng, conveyanceRateType,
        });
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/email-already-in-use') {
        setFormError('This email is already registered.');
      } else if (code === 'auth/invalid-email') {
        setFormError('Please enter a valid email address.');
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
    await sendPasswordResetEmail(getAuth(), editing.email);
    alert(`Password reset email sent to ${editing.email}`);
  }

  async function handleDelete() {
    if (!editing) return;
    const confirmed = window.confirm(`Delete ${editing.name || 'this employee'}? This cannot be undone.`);
    if (!confirmed) return;
    setSaving(true);
    try {
      await deleteUserProfile(editing.id);
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Delete failed. Try again.');
    }
    setSaving(false);
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? users.filter(u =>
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.employeeId ?? '').toLowerCase().includes(q))
    : users;

  function exportXlsx() {
    downloadSheet('employees', 'Employees', shown.map(u => ({
      Name: u.name ?? '',
      Email: u.email ?? '',
      'Employee ID': u.employeeId ?? '',
      Role: u.role ?? '',
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
                  <tr key={u.id} className="border-t border-[#F4F2EF] hover:bg-[#FBFAF8] transition-colors">
                    <td className={`${TD} pl-[18px]`}>
                      <div className="flex items-center gap-[11px]">
                        <Avatar name={u.name} size={34} />
                        <div>
                          <div className="font-medium text-[#2A241F]">{u.name}</div>
                          <div className="text-[12px] text-[#9A938C]">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} font-mono text-[#6B635C]`}>{u.employeeId || '—'}</td>
                    <td className={TD}><RoleBadge role={u.role} /></td>
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

              {!editing && <>
                <div><label className="label">Email Address</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="ravi@senken.com" /></div>
                <div><label className="label">Initial Password</label><input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" /></div>
              </>}

              <div><label className="label">Employee ID</label><input className="input" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="EMP001" /></div>

              <div>
                <label className="label">Role</label>
                <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
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
                  <button className="w-full text-sm text-text-secondary hover:text-primary underline text-center" onClick={handleResetPassword}>
                    Send password reset email
                  </button>
                  <button className="btn-danger w-full" onClick={handleDelete} disabled={saving}>Delete Employee</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
