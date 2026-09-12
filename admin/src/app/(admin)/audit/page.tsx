'use client';
/**
 * Audit Trail — admin-only view over the tamper-proof `audit_log` collection.
 *
 * The log has existed since the security hardening, but only in Firestore: reading it
 * meant opening the Firebase Console or running a script, which in practice meant nobody
 * looked. This page is what makes it usable.
 *
 * ⚠️ WHY THIS PAGE DOES SO MUCH WORK ON THE WAY IN. A stored entry is two complete
 * document snapshots, and rendering them raw produced the two problems this page was
 * rebuilt to fix: a one-field patch printed sixteen fields twice, and most rows named no
 * author. Neither is fixed by styling. `src/lib/auditEntry.ts` reconstructs the missing
 * verdict on every entry as it is read — including entries already in Firestore, which a
 * writer-side fix alone could never reach — and reduces the snapshots to the fields that
 * actually moved. Read that module before changing anything here.
 *
 * It also surfaces FLAGGED PUNCHES from the onPunchWritten server verdict — mock location,
 * a corrected date, or a large client/server clock gap. Those flags were being recorded
 * and shown to no one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuditLog, getAllUsers, getAttendanceForDateRange } from '@/lib/firestore';
import type { AuditEntry, User } from '@/types';
import { istTodayStr } from '@/lib/date';
import { classifyEntry, diffFields, actorLabel, describeEntry, isSystemEntry } from '@/lib/auditEntry';

type Tab = 'log' | 'flagged';

/** A punch carrying the server-side integrity verdict (see functions/punchIntegrity.js). */
interface FlaggedPunch {
  id: string;
  userId: string;
  date: string;
  type: string;
  timestamp?: { seconds: number };
  integrity?: {
    flags?: string[];
    clockSkewMinutes?: number | null;
    trusted?: boolean;
  };
}

const FLAG_LABEL: Record<string, string> = {
  mock_location: 'Mock location',
  date_mismatch: 'Date corrected',
  delayed_sync: 'Synced late',
  future_timestamp: 'Future-dated',
};

const FLAG_TONE: Record<string, string> = {
  // Mock location and a corrected date are deliberate acts. A late sync is usually just
  // a phone that was offline — colouring it like fraud would train people to ignore it.
  mock_location: 'bg-[#FBEAEA] text-[#C42B2B] border-[#F0D3D3]',
  date_mismatch: 'bg-[#FBEAEA] text-[#C42B2B] border-[#F0D3D3]',
  future_timestamp: 'bg-[#FDF3E3] text-[#9A5B1E] border-[#F0E0C6]',
  delayed_sync: 'bg-[#F1EEEA] text-[#6B625A] border-[#E3DED7]',
};

function daysAgoStr(n: number) {
  const d = new Date(`${istTodayStr()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** "yyyy-mm-dd" → epoch millis at IST midnight (start) or the following midnight (end). */
function istBound(dateStr: string, end = false) {
  const base = Date.parse(`${dateStr}T00:00:00Z`) - 5.5 * 60 * 60 * 1000;
  return end ? base + 24 * 60 * 60 * 1000 - 1 : base;
}

const CHANGE_TONE: Record<string, string> = {
  create: 'bg-[#E8F3EC] text-[#1E7A46]',
  update: 'bg-[#EAF0FB] text-[#2456C7]',
  delete: 'bg-[#FBEAEA] text-[#C42B2B]',
};

/** A changed value, coloured by whether it is the old or the new one. */
function Value({ text, tone }: { text: string; tone: 'before' | 'after' }) {
  const muted = text === '—' || text === '(none)' || text === '(empty)';
  return (
    <span className={`font-mono text-[12px] ${muted ? 'text-[#A8A29E] italic' : tone === 'before' ? 'text-[#8A817A] line-through decoration-[#D6D0C9]' : 'text-[#1E7A46]'}`}>
      {text}
    </span>
  );
}

export default function AuditPage() {
  const [tab, setTab] = useState<Tab>('log');
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to, setTo] = useState(istTodayStr());
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [punches, setPunches] = useState<FlaggedPunch[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employee, setEmployee] = useState('');
  const [coll, setColl] = useState('');
  const [who, setWho] = useState('');
  // Off by default: every punch produces a server integrity patch, so machine writes
  // outnumber human ones and burying the human edits is what made the log unreadable.
  const [showSystem, setShowSystem] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [log, us, att] = await Promise.all([
        getAuditLog(istBound(from), istBound(to, true)),
        getAllUsers(true),
        getAttendanceForDateRange(from, to),
      ]);
      setEntries(log);
      setUsers(us);
      // Filtered client-side rather than queried: a where() on integrity.trusted would
      // need a new collection-group index, and this range is already bounded.
      setPunches((att as unknown as FlaggedPunch[]).filter(p => (p.integrity?.flags?.length ?? 0) > 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(users.map(u => [u.id, u.name || u.employeeId || u.id]));
    // Falls back to the raw uid: an employee who has since been deleted still has to
    // render as *something*, and a blank cell in an audit trail is a lie.
    return (uid: string | null | undefined) => (uid ? (m.get(uid) ?? uid) : '—');
  }, [users]);

  const collections = useMemo(
    () => Array.from(new Set(entries.map(e => e.collection))).sort(),
    [entries],
  );

  /** Every human who wrote something in this range — the "what did X change" filter. */
  const actors = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) {
      if (!isSystemEntry(e) && e.actor && e.actor !== 'unknown') seen.add(e.actor);
    }
    return Array.from(seen).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [entries, nameOf]);

  const humanOnly = useMemo(() => entries.filter(e => !isSystemEntry(e)), [entries]);
  const systemCount = entries.length - humanOnly.length;

  const shown = useMemo(() => (showSystem ? entries : humanOnly).filter(e =>
    (!employee || e.userId === employee)
    && (!coll || e.collection === coll)
    && (!who || e.actor === who)
  ), [entries, humanOnly, showSystem, employee, coll, who]);

  const label = 'text-[11px] uppercase tracking-[0.05em] font-semibold text-[#A8A29E]';

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-center gap-3 mb-[18px]">
        <div className="flex gap-[5px] bg-[#F1EEEA] rounded-[11px] p-1 w-fit">
          {(['log', 'flagged'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors ${tab === t ? 'bg-white text-text-primary shadow-[0_1px_2px_rgba(26,22,19,0.06)]' : 'text-[#8A817A] hover:text-text-primary'}`}>
              {t === 'log' ? 'All changes' : 'Flagged punches'}
              <span className="ml-1.5 font-mono text-[11px] text-[#9A938C]">
                {t === 'log' ? shown.length : punches.length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm !py-2 !w-auto" />
          <span className="text-[#A8A29E] text-sm">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm !py-2 !w-auto" />
        </div>
      </div>

      {tab === 'log' && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select value={who} onChange={e => setWho(e.target.value)} className="input text-sm !py-2 !w-auto min-w-[180px]">
            <option value="">Anyone made the change</option>
            {actors.map(a => <option key={a} value={a}>{nameOf(a)}</option>)}
          </select>
          <select value={employee} onChange={e => setEmployee(e.target.value)} className="input text-sm !py-2 !w-auto min-w-[180px]">
            <option value="">About any employee</option>
            {users.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
              .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={coll} onChange={e => setColl(e.target.value)} className="input text-sm !py-2 !w-auto min-w-[180px]">
            <option value="">All collections</option>
            {collections.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[12.5px] text-[#6B625A] cursor-pointer select-none ml-auto"
            title="Integrity checks, the nightly status job, auto-logout and auto-filed regularizations. Recorded like any other write, hidden by default because they outnumber the human ones.">
            <input type="checkbox" checked={showSystem} onChange={e => setShowSystem(e.target.checked)}
              className="accent-[#2456C7] w-[14px] h-[14px]" />
            Show system writes
            {systemCount > 0 && <span className="font-mono text-[11px] text-[#9A938C]">{systemCount}</span>}
          </label>
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}

      {loading ? (
        <div className="bg-white border border-[#E9E6E2] rounded-2xl p-10 text-center text-[13px] text-[#9A938C]">Loading…</div>
      ) : tab === 'log' ? (
        shown.length === 0 ? (
          <div className="bg-white border border-[#E9E6E2] rounded-2xl p-10 text-center text-[13px] text-[#9A938C]">
            No changes recorded in this range.
            {!showSystem && systemCount > 0 && (
              <div className="mt-1 text-[12px]">
                {systemCount} system write{systemCount === 1 ? '' : 's'} {systemCount === 1 ? 'is' : 'are'} hidden — tick “Show system writes” to include {systemCount === 1 ? 'it' : 'them'}.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map(e => {
              const actor = actorLabel(e, nameOf);
              const changes = diffFields(e);
              const { systemJob } = classifyEntry(e);
              const open = expanded === e.id;
              return (
                <div key={e.id}
                  className={`bg-white border rounded-xl px-4 py-3 ${actor.system ? 'border-[#EFECE8] bg-[#FCFBFA]' : 'border-[#E9E6E2]'}`}>
                  <div className="flex items-start gap-3 flex-wrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md mt-[2px] ${CHANGE_TONE[e.changeType] ?? ''}`}>
                      {e.changeType}
                    </span>
                    <div className="flex-1 min-w-[260px]">
                      <div className={`text-[13.5px] leading-[1.45] ${actor.system ? 'text-[#6B625A]' : 'text-text-primary'}`}>
                        {describeEntry(e, nameOf)}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-[11.5px] text-[#A8A29E]">
                        <span className="font-mono">{e.collection}</span>
                        {actor.inferred && (
                          <span className="italic px-1.5 py-[1px] rounded border border-[#EDE8E1] bg-[#FAF9F7]" title={actor.note}>
                            author inferred
                          </span>
                        )}
                        {actor.text === 'unknown' && (
                          <span className="italic" title="Written by a server script or an app build that predates write attribution">
                            no author recorded
                          </span>
                        )}
                        {actor.system && systemJob && (
                          <span className="px-1.5 py-[1px] rounded border border-[#EDE8E1] bg-[#F5F3F0]" title={actor.note}>
                            automatic
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[12px] text-[#A8A29E] font-mono mt-[3px]">
                      {new Date(e.atMillis).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </span>
                    <button className="btn-outline !py-1 !px-2.5 text-[12px] mt-[1px]"
                      onClick={() => { setExpanded(open ? null : e.id); setRaw(null); }}>
                      {open ? 'Hide'
                        : !changes.length ? 'Details'
                          : e.changeType === 'update' ? `${changes.length} change${changes.length === 1 ? '' : 's'}`
                            : `${changes.length} field${changes.length === 1 ? '' : 's'}`}
                    </button>
                  </div>

                  {open && (
                    <div className="mt-3 border-t border-[#F1EEEA] pt-3">
                      {changes.length === 0 ? (
                        <div className="text-[12.5px] text-[#A8A29E] italic">
                          No field changed. The write is recorded anyway — knowing one happened is itself evidence.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr>
                                <th className={`${label} pb-1.5 pr-4 font-semibold`}>Field</th>
                                <th className={`${label} pb-1.5 pr-4 font-semibold`}>Before</th>
                                <th className={`${label} pb-1.5 font-semibold`}>After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map(c => (
                                <tr key={c.field} className="border-t border-[#F5F3F0] align-top">
                                  <td className="py-1.5 pr-4 text-[12.5px] text-[#4A433D] whitespace-nowrap">{c.label}</td>
                                  <td className="py-1.5 pr-4 break-all"><Value text={c.before} tone="before" /></td>
                                  <td className="py-1.5 break-all"><Value text={c.after} tone="after" /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="flex items-center gap-3 mt-3 flex-wrap">
                        <span className="text-[11.5px] text-[#A8A29E] font-mono break-all">{e.path}</span>
                        <span className="text-[11.5px] text-[#A8A29E]" title={actor.note}>· author {actor.note}</span>
                        <button className="text-[11.5px] text-[#8A817A] underline underline-offset-2 ml-auto"
                          onClick={() => setRaw(raw === e.id ? null : e.id)}>
                          {raw === e.id ? 'Hide raw record' : 'Raw record'}
                        </button>
                      </div>

                      {/* The untouched snapshots. A summary is for reading; a forensic
                          question needs the document exactly as it was stored. */}
                      {raw === e.id && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          {(['before', 'after'] as const).map(side => (
                            <div key={side}>
                              <div className={label}>{side}</div>
                              <pre className="mt-1 text-[11.5px] bg-[#FAF9F7] border border-[#E9E6E2] rounded-lg p-2.5 overflow-x-auto max-h-[300px]">
{e[side] ? JSON.stringify(e[side], null, 2) : '—'}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : punches.length === 0 ? (
        <div className="bg-white border border-[#E9E6E2] rounded-2xl p-10 text-center text-[13px] text-[#9A938C]">
          No flagged punches in this range.
          <div className="mt-1 text-[12px]">Punches recorded before the integrity check shipped carry no verdict and never appear here.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {punches.map(p => (
            <div key={p.id} className="bg-white border border-[#E9E6E2] rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
              <div><div className={label}>Employee</div>
                <div className="text-[13px] font-medium text-[#2A241F] mt-[2px]">{nameOf(p.userId)}</div></div>
              <div><div className={label}>When</div>
                <div className="text-[13px] text-[#4A433D] mt-[2px] font-mono">{p.date}</div></div>
              <div><div className={label}>Type</div>
                <div className="text-[13px] text-[#4A433D] mt-[2px] font-mono">{p.type}</div></div>
              {typeof p.integrity?.clockSkewMinutes === 'number' && (
                <div><div className={label}>Clock gap</div>
                  <div className="text-[13px] text-[#4A433D] mt-[2px] font-mono">{p.integrity.clockSkewMinutes} min</div></div>
              )}
              <div className="flex gap-1.5 flex-wrap ml-auto">
                {(p.integrity?.flags ?? []).map(f => (
                  <span key={f} className={`text-[11.5px] px-2 py-0.5 rounded-md border ${FLAG_TONE[f] ?? 'bg-[#F1EEEA] text-[#6B625A] border-[#E3DED7]'}`}>
                    {FLAG_LABEL[f] ?? f}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
