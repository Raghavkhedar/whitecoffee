/**
 * Reading the audit log.
 *
 * `audit_log` stores two full document snapshots per write. That is the right thing to
 * STORE — a forensic record should not lose anything — but it is the wrong thing to show:
 * a one-field patch arrives as sixteen fields printed twice. This module turns a stored
 * entry into the three things a person actually asks: who did it, what changed, and from
 * what to what.
 *
 * ⚠️ MIRROR OF `firebase/functions/auditLog.js`. `classifyEntry` reimplements that file's
 * `classifyOrigin`, and the two must change together — there is no shared JS build graph
 * (see the monorepo CLAUDE.md, which mirrors `roleCapabilities` the same way).
 *
 * The duplication earns its keep: entries written before the function learned to record
 * `origin` carry no verdict, so recomputing it here is what makes the EXISTING history
 * read correctly instead of only writes made after the deploy. The most visible case is
 * the punch-integrity patch, which used to inherit the employee's own `lastModifiedBy`
 * and file a server write under the employee's name. A stored verdict always wins — the
 * trigger saw the write; we are reconstructing it.
 *
 * Pure and dependency-free so it runs under `npx tsx src/lib/auditEntry.test.ts`.
 */

export type AuditOrigin = 'user' | 'system';
export type ActorSource = 'lastModifiedBy' | 'businessField' | 'owner' | 'system' | 'none';

/** The shape this module needs — satisfied by `AuditEntry`, minus the fields it ignores. */
export interface AuditLike {
  id: string;
  path: string;
  collection: string;
  docId: string;
  userId: string | null;
  changeType: 'create' | 'update' | 'delete';
  changedKeys: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actorSource?: ActorSource;
  origin?: AuditOrigin;
  systemJob?: string | null;
  at: string;
  atMillis: number;
}

// ── Origin ─────────────────────────────────────────────────────────────────
// Mirrors auditLog.js. Keep the constants and the ordering identical.

const SERVER_PATCH_FIELDS = ['integrity'];
const SERVER_OWNED_COLLECTIONS = ['daily_hours'];
const SERVER_OWNED_ROOTS = ['system'];
const SYSTEM_STAMP_PREFIX = 'system:';

const SYSTEM_MARKERS: { field: string; value: unknown; job: string }[] = [
  { field: 'markedBy', value: 'auto', job: 'nightly-attendance-status' },
  { field: 'autoFiled', value: true, job: 'auto-regularization' },
  { field: 'autoLogout', value: true, job: 'auto-logout' },
];

/** The client stamp, if the record carries a real one (a `system:` value is not one). */
function clientStamp(data: Record<string, unknown> | null): string | null {
  const v = data?.lastModifiedBy;
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.startsWith(SYSTEM_STAMP_PREFIX) ? null : v.trim();
}

/** Keys whose value differs between the two snapshots, sorted. */
function changedFieldNames(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = Array.from(new Set(Object.keys(before ?? {}).concat(Object.keys(after ?? {}))));
  return keys
    .filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .sort();
}

/**
 * Did a person write this, or did a Cloud Function? A stored `origin` is authoritative;
 * otherwise it is reconstructed from the tells a system write leaves in the document.
 */
export function classifyEntry(e: AuditLike): { origin: AuditOrigin; systemJob: string | null } {
  if (e.origin) return { origin: e.origin, systemJob: e.systemJob ?? null };

  const state = e.after ?? e.before ?? {};
  const segments = (e.path || '').split('/');
  const collection = e.collection || segments[segments.length - 2] || '';
  const sys = (job: string) => ({ origin: 'system' as const, systemJob: job });

  const stamp = state.lastModifiedBy;
  if (typeof stamp === 'string' && stamp.startsWith(SYSTEM_STAMP_PREFIX)) {
    return sys(stamp.slice(SYSTEM_STAMP_PREFIX.length) || 'job');
  }

  // `integrity` moved and nothing else did: onPunchWritten, not the employee whose stamp
  // is still sitting on the punch. Checked before any stamp, for exactly that reason.
  const changed = changedFieldNames(e.before, e.after);
  if (changed.length > 0 && changed.every(k => SERVER_PATCH_FIELDS.includes(k))) {
    return sys('punch-integrity');
  }

  if (SERVER_OWNED_ROOTS.includes(segments[0])) return sys('scheduled-job');
  if (SERVER_OWNED_COLLECTIONS.includes(collection)) return sys('nightly-hours');

  // Marker fields persist on the document, so they only count where no client stamped it.
  if (!clientStamp(state)) {
    for (const m of SYSTEM_MARKERS) {
      if (state[m.field] === m.value) return sys(m.job);
    }
  }

  return { origin: 'user', systemJob: null };
}

export function isSystemEntry(e: AuditLike): boolean {
  return classifyEntry(e).origin === 'system';
}

// ── Values ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}

/** "2026-09-09" → "9 Sep 2026". Left alone if it is not a plain IST calendar date. */
export function humanDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

/**
 * Milliseconds for anything Firestore might hand back as a time: a live SDK `Timestamp`,
 * the `{seconds, nanoseconds}` it serialises to, or the `{__type__, value}` shape a REST
 * read produces. Returns null for everything else.
 */
function timestampMillis(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.toDate === 'function') return (o.toDate as () => Date)().getTime();
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  if (o.__type__ === 'Timestamp' && typeof o.value === 'string') return Date.parse(o.value);
  return null;
}

/**
 * A stored value as a person would read it.
 *
 * The distinctions matter in an audit trail: an absent field, a null and an empty string
 * are three different states, and rendering all three as blank hides the change that is
 * being audited.
 */
export function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return '(none)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return v.toLocaleString('en-IN');
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (Array.isArray(v)) return v.length === 0 ? '(none)' : v.map(formatValue).join(', ');

  const ms = timestampMillis(v);
  if (ms !== null) {
    const { date, time } = istParts(ms);
    return `${date}, ${time}`;
  }

  const json = JSON.stringify(v);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

/** Is this a value worth printing inline in a one-line summary? */
function isScalar(v: unknown): boolean {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
}

// ── Field labels ───────────────────────────────────────────────────────────

/** Only where the mechanical split reads badly (initialisms, domain shorthand). */
const FIELD_LABELS: Record<string, string> = {
  otMins: 'OT minutes', shortageMins: 'Shortage minutes', plannedMins: 'Planned minutes',
  actualMins: 'Actual minutes', declaredOtMin: 'Declared OT minutes', approvedMins: 'Approved minutes',
  netMins: 'Net minutes', otAuthorized: 'OT authorised', woDays: 'WO days',
  plBalance: 'PL balance', slBalance: 'SL balance',
  fcmToken: 'Device token', activeSessionToken: 'Session token',
  lastModifiedBy: 'Written by', lastModifiedAt: 'Written at',
  employeeId: 'Employee ID', userId: 'User ID', siteId: 'Site ID', docId: 'Document ID',
  tabAccess: 'Tab access', ratePerKm: 'Rate per km', totalKm: 'Total km',
  isMockLocation: 'Mock location', autoLogout: 'Auto logout', autoFiled: 'Auto filed',
  hra: 'HRA', pf: 'PF', esi: 'ESI', tds: 'TDS',
};

/** "approvedStatus" → "Approved status". Never returns an empty label. */
export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : field;
}

// ── The diff ───────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
  kind: 'added' | 'removed' | 'changed';
}

/**
 * One row per field that actually moved.
 *
 * Computed from the snapshots rather than read from the stored `changedKeys`, so an entry
 * written by an older trigger still diffs correctly.
 */
export function diffFields(e: AuditLike): FieldChange[] {
  return changedFieldNames(e.before, e.after).map(field => {
    const before = e.before?.[field];
    const after = e.after?.[field];
    const kind = before === undefined ? 'added' : after === undefined ? 'removed' : 'changed';
    return { field, label: fieldLabel(field), before: formatValue(before), after: formatValue(after), kind };
  });
}

// ── Actor ──────────────────────────────────────────────────────────────────

const SOURCE_NOTE: Record<ActorSource, string> = {
  lastModifiedBy: 'recorded on the write itself',
  businessField: 'from a field on the record, not the write',
  owner: 'inferred from the record owner',
  system: 'written by a Cloud Function',
  none: 'the write recorded no author',
};

export interface ActorLabel {
  text: string;
  /** True when the name is a reconstruction. Never present one of these as a fact. */
  inferred: boolean;
  system: boolean;
  note: string;
}

/**
 * The narrow rescue for an entry that names nobody — a mirror of `inferOwner` in
 * auditLog.js, and the reason most of the existing "unknown" rows can be read at all.
 *
 * A document CREATED under `users/{uid}/…` carrying that same uid in its own `userId` was
 * created by that employee; the security rules pin both. That covers every write from a
 * device running a build older than the `lastModifiedBy` stamp.
 *
 * ⚠️ CREATE ONLY. An admin approving a leave request UPDATES a document inside the
 * employee's path — inferring the owner there would name the wrong person, and naming the
 * wrong person is the one thing an audit trail must never do.
 */
function inferOwner(e: AuditLike): string | null {
  if (e.changeType !== 'create' || !e.after) return null;
  const segments = (e.path || '').split('/');
  if (segments[0] !== 'users' || segments.length < 3) return null;
  const uid = segments[1];
  return e.after.userId === uid ? uid : null;
}

/**
 * Who an entry should be attributed to, and on what evidence.
 *
 * `actorSource` is absent on entries written before the trigger recorded it, so it is
 * reconstructed here the same way the trigger would have — including the inference.
 */
export function resolvedActor(e: AuditLike): { uid: string; source: ActorSource } {
  const { origin, systemJob } = classifyEntry(e);
  if (origin === 'system') {
    return { uid: `${SYSTEM_STAMP_PREFIX}${systemJob ?? 'job'}`, source: 'system' };
  }

  const source: ActorSource = e.actorSource
    ?? (e.actor === 'unknown' || !e.actor ? 'none'
      : clientStamp(e.after) === e.actor || clientStamp(e.before) === e.actor ? 'lastModifiedBy'
        : 'businessField');

  if (source === 'none') {
    const owner = inferOwner(e);
    if (owner) return { uid: owner, source: 'owner' };
  }
  return { uid: e.actor, source };
}

/** How an entry's actor should be shown, and how much to trust it. */
export function actorLabel(e: AuditLike, nameOf: (uid: string) => string): ActorLabel {
  const { uid, source } = resolvedActor(e);

  if (source === 'system') {
    return {
      text: `System · ${uid.slice(SYSTEM_STAMP_PREFIX.length).replace(/-/g, ' ')}`,
      inferred: false,
      system: true,
      note: SOURCE_NOTE.system,
    };
  }
  if (source === 'none') {
    return { text: 'unknown', inferred: false, system: false, note: SOURCE_NOTE.none };
  }
  return { text: nameOf(uid), inferred: source === 'owner', system: false, note: SOURCE_NOTE[source] };
}

// ── The sentence ───────────────────────────────────────────────────────────

/** What the collection holds, as a noun a person would say out loud. */
const COLLECTION_NOUNS: Record<string, string> = {
  attendance: 'punch',
  attendance_status: 'day status',
  compensation: 'pay',
  daily_hours: 'worked hours',
  planned_hours: 'planned hours',
  leave_requests: 'leave request',
  regularization_requests: 'regularization request',
  settlements: 'OT settlement',
  ot_approvals: 'OT approval',
  users: 'employee profile',
  conveyance: 'conveyance record',
  notifications: 'notification',
  sites: 'site',
  holidays: 'holiday',
  config: 'setting',
  material_requests: 'material request',
  material_purchases: 'material purchase',
  material_transfers: 'material transfer',
  tool_transfers: 'tool transfer',
  work_progress: 'work progress update',
};

/** Bookkeeping fields. Real in the diff table, noise in a one-line summary. */
const NOISE_FIELDS = ['lastModifiedBy', 'lastModifiedAt', 'updatedAt', 'computedAt'];

function collectionNoun(collection: string): string {
  return COLLECTION_NOUNS[collection] ?? (collection || 'record').replace(/[_-]+/g, ' ');
}

/** The IST date the change is about, if the document names one. */
function subjectDate(e: AuditLike): string {
  const d = e.after?.date ?? e.before?.date;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? ` for ${humanDate(d)}` : '';
}

/**
 * One plain sentence per entry — the line the page leads with.
 *
 * The possessive is dropped when the actor IS the owner ("Anshuman added a regularization
 * request", not "Anshuman added Anshuman's"), which is what makes a self-service create
 * read naturally and an edit by someone else read as an intervention.
 */
export function describeEntry(e: AuditLike, nameOf: (uid: string) => string): string {
  const who = actorLabel(e, nameOf);
  const noun = collectionNoun(e.collection);
  // The RESOLVED actor, so a rescued self-service create reads "Anshuman added a
  // regularization request" rather than "Anshuman added Anshuman's".
  const ownerIsActor = !!e.userId && e.userId === resolvedActor(e).uid && !who.system;
  const owner = e.userId && !ownerIsActor ? nameOf(e.userId) : null;
  const when = subjectDate(e);

  if (e.changeType === 'create') {
    return `${who.text} added ${owner ? `${owner}'s ${noun}` : `a ${noun}`}${when}`;
  }
  if (e.changeType === 'delete') {
    return `${who.text} deleted ${owner ? `${owner}'s ${noun}` : `the ${noun}`}${when}`;
  }

  // The date belongs to the record, not to the end of the sentence: trailing it after the
  // field detail reads as though the new VALUE applied to that date.
  const subject = `${owner ? `${owner}'s ${noun}` : `the ${noun}`}${when}`;
  const changes = diffFields(e).filter(c => !NOISE_FIELDS.includes(c.field));

  if (changes.length === 0) return `${who.text} re-saved ${subject} with no change`;
  if (changes.length > 2) return `${who.text} changed ${changes.length} fields on ${subject}`;

  const detail = changes.map(c => {
    const raw = e.after?.[c.field];
    const prev = e.before?.[c.field];
    // An object or an over-long value is unreadable inline; the diff table below shows it.
    if (!isScalar(raw) || !isScalar(prev) || c.after.length > 40 || c.before.length > 40) {
      return c.label;
    }
    return c.kind === 'added' ? `${c.label} ${c.after}`
      : c.kind === 'removed' ? `${c.label} removed`
        : `${c.label} ${c.before} → ${c.after}`;
  }).join(', ');

  return `${who.text} changed ${subject} — ${detail}`;
}
