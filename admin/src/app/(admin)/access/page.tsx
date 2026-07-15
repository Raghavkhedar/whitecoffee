'use client';
import { useEffect, useMemo, useState } from 'react';
import { getAllUsers, updateUserProfile } from '@/lib/firestore';
import { TABS } from '@/lib/portalAccess';
import type { User } from '@/types';
import { Avatar, RoleBadge } from '@/components/ui';

// Matrix columns = every grantable (non-admin-only) tab.
const GRANTABLE_TABS = TABS.filter(t => !t.adminOnly);
const GRANTABLE_PATHS = GRANTABLE_TABS.map(t => t.path);
const GRANTABLE_PATH_SET = new Set(GRANTABLE_PATHS);

// office → operations, then alphabetical by name (admins are never rows).
const ROLE_RANK: Record<string, number> = { office: 0, operations: 1 };
function sortRows(a: User, b: User) {
  const r = (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9);
  if (r !== 0) return r;
  return (a.name ?? '').localeCompare(b.name ?? '');
}

// A row's current granted-set (from a user doc), pruned to real grantable paths.
function grantsOf(u: User): Record<string, boolean> {
  const g: Record<string, boolean> = {};
  for (const p of u.tabAccess ?? []) if (GRANTABLE_PATH_SET.has(p)) g[p] = true;
  return g;
}

function sameGrants(a: Record<string, boolean>, b: Record<string, boolean>) {
  return GRANTABLE_PATHS.every(p => !!a[p] === !!b[p]);
}

export default function AccessPage() {
  const [users, setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  // Working copy: uid → { path → granted }. `original` is the last-saved baseline.
  const [draft, setDraft]       = useState<Record<string, Record<string, boolean>>>({});
  const [original, setOriginal] = useState<Record<string, Record<string, boolean>>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const all = await getAllUsers(); // active only
      const rows = all.filter(u => u.active !== false && u.role !== 'admin').sort(sortRows);
      setUsers(rows);
      const base: Record<string, Record<string, boolean>> = {};
      for (const u of rows) base[u.id] = grantsOf(u);
      setOriginal(base);
      setDraft(structuredClone(base));
    } catch (e: unknown) {
      setError(`Failed to load employees: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Which users changed vs. the last-saved baseline.
  const dirtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const u of users) {
      if (!sameGrants(draft[u.id] ?? {}, original[u.id] ?? {})) ids.add(u.id);
    }
    return ids;
  }, [draft, original, users]);
  const dirty = dirtyIds.size > 0;

  // Warn on navigating away (tab close / reload) with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function setCell(uid: string, path: string, on: boolean) {
    setSavedMsg('');
    setDraft(d => ({ ...d, [uid]: { ...d[uid], [path]: on } }));
  }

  // Row toggle-all: if the employee already holds every tab, revoke all; else grant all.
  function toggleRow(uid: string) {
    setSavedMsg('');
    setDraft(d => {
      const cur = d[uid] ?? {};
      const allOn = GRANTABLE_PATHS.every(p => cur[p]);
      const next: Record<string, boolean> = {};
      for (const p of GRANTABLE_PATHS) next[p] = !allOn;
      return { ...d, [uid]: next };
    });
  }

  // Column toggle-all: if every employee holds this tab, revoke it for all; else grant to all.
  function toggleCol(path: string) {
    setSavedMsg('');
    setDraft(d => {
      const allOn = users.every(u => d[u.id]?.[path]);
      const next = { ...d };
      for (const u of users) next[u.id] = { ...next[u.id], [path]: !allOn };
      return next;
    });
  }

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const changed = users.filter(u => dirtyIds.has(u.id));
      for (const u of changed) {
        const tabAccess = GRANTABLE_PATHS.filter(p => draft[u.id]?.[p]);
        await updateUserProfile(u.id, { tabAccess });
      }
      // Commit the new baseline from the saved draft.
      const base: Record<string, Record<string, boolean>> = {};
      for (const u of users) base[u.id] = { ...(draft[u.id] ?? {}) };
      setOriginal(base);
      setSavedMsg(`Saved access for ${changed.length} employee${changed.length === 1 ? '' : 's'}.`);
    } catch (e: unknown) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  }

  function handleReset() {
    setSavedMsg('');
    setDraft(structuredClone(original));
  }

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-[13px] text-text-secondary">
          Tick the tabs each employee may open. Admins always have full portal access and are not listed here.
        </p>
        <div className="flex items-center gap-2.5">
          {dirty && (
            <span className="text-[12.5px] text-[#B4643A] font-medium">
              {dirtyIds.size} unsaved change{dirtyIds.size === 1 ? '' : 's'}
            </span>
          )}
          {savedMsg && !dirty && <span className="text-[12.5px] text-[#3A8A5A] font-medium">{savedMsg}</span>}
          <button className="btn-outline" onClick={handleReset} disabled={!dirty || saving}>Reset</button>
          <button className="btn-primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">No non-admin employees to manage.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-[#F7F5F2] text-left px-4 py-2.5 border-b border-[#E9E6E2] min-w-[220px] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6B635C]">
                    Employee
                  </th>
                  {GRANTABLE_TABS.map(tab => (
                    <th key={tab.path} className="bg-[#F7F5F2] border-b border-l border-[#E9E6E2] px-2 py-2 align-bottom min-w-[92px]">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-[#4A433D] text-center leading-tight break-words max-w-[84px]">{tab.label}</span>
                        <button
                          className="text-[10.5px] text-primary hover:underline"
                          onClick={() => toggleCol(tab.path)}
                          title={`Toggle ${tab.label} for everyone`}
                        >
                          all
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isDirty = dirtyIds.has(u.id);
                  return (
                    <tr key={u.id} className="hover:bg-[#FBFAF8] transition-colors">
                      <td className={`sticky left-0 z-10 px-4 py-2 border-b border-[#F4F2EF] ${isDirty ? 'bg-[#FDF7F0]' : 'bg-white'}`}>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name} size={30} />
                          <div className="min-w-0">
                            <div className="font-medium text-[#2A241F] flex items-center gap-1.5 truncate">
                              {u.name}
                              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-[#E0862E] flex-shrink-0" title="Unsaved changes" />}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <RoleBadge role={u.role} />
                              <button className="text-[10.5px] text-primary hover:underline" onClick={() => toggleRow(u.id)} title="Toggle all tabs for this employee">
                                all
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                      {GRANTABLE_TABS.map(tab => (
                        <td key={tab.path} className="text-center border-b border-l border-[#F4F2EF] px-2 py-2">
                          <input
                            type="checkbox"
                            className="w-4 h-4 cursor-pointer accent-primary"
                            checked={!!draft[u.id]?.[tab.path]}
                            onChange={e => setCell(u.id, tab.path, e.target.checked)}
                            aria-label={`${u.name} — ${tab.label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
