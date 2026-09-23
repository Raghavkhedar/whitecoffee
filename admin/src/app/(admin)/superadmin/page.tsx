'use client';
/**
 * Superadmin editor — browse and edit/delete any Firestore document directly.
 *
 * Gated entirely by the layout's canAccess/allowedPaths (superAdminOnly tab, see
 * src/lib/portalAccess.ts) — firestore.rules' isSuperAdmin() catch-all is the real
 * boundary. This page has NO domain awareness: editing a document here does not trigger
 * the side effects (OT ledger recompute, plBalance adjustments, notifications, ...) that
 * the app's normal flows would. See docs/superpowers/specs/
 * 2026-09-22-superadmin-portal-editor-design.md.
 */
import { useCallback, useEffect, useState } from 'react';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import {
  listDocumentsPage, getDocumentRaw, setDocumentRaw, deleteDocumentRaw,
  getAllUsers, stamped, type DocListPage,
} from '@/lib/firestore';
import { docToEditableJson, editableJsonToDoc } from '@/lib/firestoreJson';
import { TOP_LEVEL_COLLECTIONS, USER_SUBCOLLECTIONS } from '@/lib/superadminCollections';
import type { User } from '@/types';

const PAGE_SIZE = 25;

type Source = 'top-level' | 'user-sub';

export default function SuperadminPage() {
  const [source, setSource] = useState<Source>('top-level');
  const [topLevel, setTopLevel] = useState(TOP_LEVEL_COLLECTIONS[0].path);
  const [users, setUsers] = useState<User[]>([]);
  const [employeeUid, setEmployeeUid] = useState('');
  const [subcollection, setSubcollection] = useState(USER_SUBCOLLECTIONS[0].name);
  const [collectionPath, setCollectionPath] = useState<string | null>(null);

  const [page, setPage] = useState<DocListPage | null>(null);
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [idFilter, setIdFilter] = useState('');

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [docError, setDocError] = useState('');
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [subPathInput, setSubPathInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { getAllUsers(true).then(setUsers).catch(() => {}); }, []);

  const loadPage = useCallback(async (path: string, after: QueryDocumentSnapshot<DocumentData> | null) => {
    setListLoading(true); setListError('');
    try {
      const result = await listDocumentsPage(path, PAGE_SIZE, after);
      setPage(result);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      setPage(null);
    }
    setListLoading(false);
  }, []);

  const openCollection = useCallback((path: string) => {
    setCollectionPath(path);
    setCursorStack([null]);
    setOpenPath(null);
    setIdFilter('');
    loadPage(path, null);
  }, [loadPage]);

  const goNext = () => {
    if (!collectionPath || !page?.cursor) return;
    const next = [...cursorStack, page.cursor];
    setCursorStack(next);
    loadPage(collectionPath, page.cursor);
  };

  const goPrev = () => {
    if (!collectionPath || cursorStack.length <= 1) return;
    const next = cursorStack.slice(0, -1);
    setCursorStack(next);
    loadPage(collectionPath, next[next.length - 1]);
  };

  const openDoc = useCallback(async (id: string) => {
    if (!collectionPath) return;
    const path = `${collectionPath}/${id}`;
    setDocError(''); setConfirmingSave(false); setDeleteConfirmText(''); setSubPathInput('');
    try {
      const data = await getDocumentRaw(path);
      if (!data) { setDocError(`No document at ${path}.`); return; }
      setOpenPath(path);
      setOriginal(data);
      setJsonText(docToEditableJson(data));
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
  }, [collectionPath]);

  const openById = () => { if (idFilter.trim()) openDoc(idFilter.trim()); };

  const closeDoc = () => {
    setOpenPath(null); setOriginal(null); setJsonText(''); setDocError('');
    setConfirmingSave(false); setDeleteConfirmText(''); setSubPathInput('');
  };

  const requestSave = () => {
    setDocError('');
    try {
      editableJsonToDoc(jsonText); // validate before showing the confirm step
      setConfirmingSave(true);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmSave = async () => {
    if (!openPath) return;
    setSaving(true); setDocError('');
    try {
      const parsed = editableJsonToDoc(jsonText);
      await setDocumentRaw(openPath, stamped(parsed));
      const fresh = await getDocumentRaw(openPath);
      setOriginal(fresh);
      setJsonText(docToEditableJson(fresh ?? {}));
      setConfirmingSave(false);
      if (collectionPath) loadPage(collectionPath, cursorStack[cursorStack.length - 1]);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const idOf = (path: string) => path.split('/').pop() ?? path;

  const confirmDelete = async () => {
    if (!openPath || deleteConfirmText !== idOf(openPath)) return;
    setSaving(true); setDocError('');
    try {
      await deleteDocumentRaw(openPath);
      closeDoc();
      if (collectionPath) loadPage(collectionPath, cursorStack[cursorStack.length - 1]);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const openSubcollection = () => {
    if (!openPath || !subPathInput.trim()) return;
    openCollection(`${openPath}/${subPathInput.trim()}`);
  };

  return (
    <div className="max-w-[1200px]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Superadmin — Document Editor</h1>
        <p className="text-sm text-[#8A817A] mt-1">
          Raw read/write on any collection except audit_log. No domain logic runs on save —
          this edits exactly what you type.
        </p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-[5px] bg-[#F1EEEA] rounded-[11px] p-1 w-fit">
            {(['top-level', 'user-sub'] as Source[]).map((s) => (
              <button key={s} onClick={() => setSource(s)}
                className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors ${source === s ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(26,22,19,0.06)]' : 'text-[#8A817A] hover:text-text-primary'}`}>
                {s === 'top-level' ? 'Top-level collection' : 'Employee subcollection'}
              </button>
            ))}
          </div>

          {source === 'top-level' ? (
            <div>
              <label className="label">Collection</label>
              <select className="input !w-auto min-w-[220px]" value={topLevel} onChange={(e) => setTopLevel(e.target.value)}>
                {TOP_LEVEL_COLLECTIONS.map((c) => <option key={c.path} value={c.path}>{c.label}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="label">Employee</label>
                <select className="input !w-auto min-w-[220px]" value={employeeUid} onChange={(e) => setEmployeeUid(e.target.value)}>
                  <option value="">Select an employee…</option>
                  {users.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
                    .map((u) => <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Subcollection</label>
                <select className="input !w-auto min-w-[200px]" value={subcollection} onChange={(e) => setSubcollection(e.target.value)}>
                  {USER_SUBCOLLECTIONS.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </div>
            </>
          )}

          <button
            className="btn-primary"
            disabled={source === 'user-sub' && !employeeUid}
            onClick={() => openCollection(source === 'top-level' ? topLevel : `users/${employeeUid}/${subcollection}`)}
          >
            Browse
          </button>
        </div>
      </div>

      {collectionPath && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-sm text-[#6B625A]">{collectionPath}</div>
            <div className="flex items-center gap-2">
              <input
                className="input !w-auto !py-2 text-sm"
                placeholder="Open by exact document ID…"
                value={idFilter}
                onChange={(e) => setIdFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') openById(); }}
              />
              <button className="btn-outline" onClick={openById} disabled={!idFilter.trim()}>Open</button>
            </div>
          </div>

          {listLoading ? (
            <div className="text-center text-[13px] text-[#9A938C] py-8">Loading…</div>
          ) : listError ? (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{listError}</div>
          ) : !page || page.docs.length === 0 ? (
            <div className="text-center text-[13px] text-[#9A938C] py-8">No documents.</div>
          ) : (
            <>
              <ul className="divide-y divide-[#EFEBE6]">
                {page.docs.map((d) => (
                  <li key={d.id}>
                    <button className="w-full text-left py-2 font-mono text-sm hover:text-primary" onClick={() => openDoc(d.id)}>
                      {d.id}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 mt-3">
                <button className="btn-outline" onClick={goPrev} disabled={cursorStack.length <= 1}>Prev</button>
                <button className="btn-outline" onClick={goNext} disabled={!page.cursor || page.docs.length < PAGE_SIZE}>Next</button>
              </div>
            </>
          )}
        </div>
      )}

      {openPath && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-sm text-[#6B625A]">{openPath}</div>
            <button className="btn-outline" onClick={closeDoc}>Close</button>
          </div>

          {docError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{docError}</div>}

          <textarea
            className="input font-mono text-xs !h-[420px] resize-y"
            value={jsonText}
            onChange={(e) => { setJsonText(e.target.value); setConfirmingSave(false); }}
            spellCheck={false}
          />

          {!confirmingSave ? (
            <div className="flex items-center gap-2 mt-3">
              <button className="btn-primary" onClick={requestSave}>Save…</button>
            </div>
          ) : (
            <div className="mt-3 p-3 bg-[#FDF3E3] border border-[#F0E0C6] rounded-lg">
              <div className="text-sm font-medium mb-2">Confirm write to {openPath}</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="label">Before</div>
                  <pre className="text-xs bg-white border border-border rounded-lg p-2 max-h-[240px] overflow-auto">{original ? docToEditableJson(original) : 'null'}</pre>
                </div>
                <div>
                  <div className="label">After</div>
                  <pre className="text-xs bg-white border border-border rounded-lg p-2 max-h-[240px] overflow-auto">{jsonText}</pre>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-success" onClick={confirmSave} disabled={saving}>{saving ? 'Writing…' : 'Confirm write'}</button>
                <button className="btn-outline" onClick={() => setConfirmingSave(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-[#EFEBE6]">
            <div className="label">Danger zone</div>
            <div className="flex items-center gap-2 mb-3">
              <input
                className="input !w-auto !py-2 text-sm"
                placeholder={`Type "${idOf(openPath)}" to confirm delete`}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
              <button
                className="btn-danger"
                disabled={deleteConfirmText !== idOf(openPath) || saving}
                onClick={confirmDelete}
              >
                Delete document
              </button>
            </div>

            <div className="label">Browse a subcollection of this document</div>
            <div className="flex items-center gap-2">
              <input
                className="input !w-auto !py-2 text-sm"
                placeholder="e.g. settlements"
                value={subPathInput}
                onChange={(e) => setSubPathInput(e.target.value)}
              />
              <button className="btn-outline" onClick={openSubcollection} disabled={!subPathInput.trim()}>Browse</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
