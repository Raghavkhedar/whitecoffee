// Standalone tests for the audit-entry reader. Run: npx tsx src/lib/auditEntry.test.ts
//
// This module is what turns `audit_log` from a JSON dump into a trail a person can read,
// and it is a MIRROR of firebase/functions/auditLog.js — change the two together. The
// mirroring is not redundancy: entries written before the function learned about origin
// carry no `origin` field, and recomputing it here is what makes the existing history
// readable instead of only everything written from the deploy onwards.
import {
  classifyEntry, diffFields, formatValue, fieldLabel, actorLabel, describeEntry,
  isSystemEntry, resolvedActor, type AuditLike,
} from './auditEntry';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

const NAMES: Record<string, string> = { adminUid: 'Ritu', empUid: 'Pinky', u1: 'Anshuman' };
const nameOf = (uid: string | null | undefined) => (uid ? (NAMES[uid] ?? uid) : '—');

function entry(over: Partial<AuditLike>): AuditLike {
  return {
    id: 'a1', path: 'users/u1/attendance/p1', collection: 'attendance', docId: 'p1',
    userId: 'u1', changeType: 'update', changedKeys: [], before: null, after: null,
    actor: 'unknown', at: '2026-09-09T04:51:23.966Z', atMillis: 1788929483966, ...over,
  } as AuditLike;
}

// ── Origin, recomputed for history ─────────────────────────────────────────

console.log('\nOrigin classification (mirror of auditLog.js):');

// The bug this page existed to hide: onPunchWritten patches `integrity` onto a punch, the
// employee's own lastModifiedBy survives on the document, and the trail credited the
// EMPLOYEE with a server write. Recomputing fixes every entry already in Firestore.
const integrityPatch = entry({
  changedKeys: ['integrity'],
  before: { type: 'office_in', lastModifiedBy: 'empUid' },
  after: { type: 'office_in', lastModifiedBy: 'empUid', integrity: { trusted: true } },
  actor: 'empUid', userId: 'empUid', path: 'users/empUid/attendance/p1',
});
eq('legacy integrity patch reclassifies as system', classifyEntry(integrityPatch).origin, 'system');
eq('...and names the job', classifyEntry(integrityPatch).systemJob, 'punch-integrity');
eq('...and stops crediting the employee', actorLabel(integrityPatch, nameOf).text, 'System · punch integrity');
eq('isSystemEntry agrees', isSystemEntry(integrityPatch), true);

// A stored verdict is authoritative — the function saw the write, we are only guessing.
eq('a stored origin wins over recomputation',
   classifyEntry(entry({ origin: 'user', systemJob: null, changedKeys: ['integrity'] })).origin, 'user');

eq('an ordinary employee punch stays a user write',
   classifyEntry(entry({ changeType: 'create', changedKeys: ['type'], after: { type: 'office_in', lastModifiedBy: 'u1' } })).origin,
   'user');

eq('nightly attendance_status is system',
   classifyEntry(entry({ collection: 'attendance_status', path: 'users/u1/attendance_status/2026-09-09', after: { status: 'Absent', markedBy: 'auto' } })).systemJob,
   'nightly-attendance-status');

eq('an admin override of the same doc is a user write',
   classifyEntry(entry({ collection: 'attendance_status', path: 'users/u1/attendance_status/2026-09-09', after: { status: 'Present', markedBy: 'admin', lastModifiedBy: 'adminUid' } })).origin,
   'user');

// ── Value formatting ───────────────────────────────────────────────────────

console.log('\nValues render as something a person can read:');
eq('booleans',            formatValue(true), 'yes');
eq('false is not blank',  formatValue(false), 'no');
eq('empty string is visible', formatValue(''), '(empty)');
eq('null',                formatValue(null), '(none)');
eq('absent',              formatValue(undefined), '—');
eq('numbers get separators', formatValue(20000), '20,000');
eq('empty array',         formatValue([]), '(none)');
eq('array',               formatValue(['A1', 'E2']), 'A1, E2');
eq('firestore Timestamp renders in IST',
   formatValue({ seconds: 1788929482, nanoseconds: 0 }), '9 Sep 2026, 10:21');
eq('a Timestamp-shaped object from the REST read too',
   formatValue({ __type__: 'Timestamp', value: '2026-09-09T04:51:22.325Z' }), '9 Sep 2026, 10:21');
eq('an object falls back to compact JSON',
   formatValue({ trusted: true }), '{"trusted":true}');
eq('a redaction marker survives', formatValue('[redacted]'), '[redacted]');

console.log('\nField names read as labels:');
eq('known field',      fieldLabel('basicPay'), 'Basic pay');
eq('camelCase split',  fieldLabel('approvedStatus'), 'Approved status');
eq('acronym-ish',      fieldLabel('otMins'), 'OT minutes');
eq('unknown field degrades readably', fieldLabel('someNewField'), 'Some new field');

// ── The diff, which is the whole point ─────────────────────────────────────

console.log('\nDiff is per-field, not two document dumps:');
const payRaise = entry({
  collection: 'compensation', path: 'users/empUid/compensation/current', docId: 'current',
  userId: 'empUid', changedKeys: ['basicPay', 'lastModifiedBy'],
  before: { basicPay: 18000, hra: 5000 },
  after: { basicPay: 20000, hra: 5000, lastModifiedBy: 'adminUid' },
  actor: 'adminUid', actorSource: 'lastModifiedBy',
});
const d = diffFields(payRaise);
eq('only changed fields appear', d.map(c => c.field), ['basicPay', 'lastModifiedBy']);
eq('unchanged fields are dropped', d.some(c => c.field === 'hra'), false);
eq('before/after are formatted', [d[0].before, d[0].after], ['18,000', '20,000']);
eq('a newly set field is an addition', d[1].kind, 'added');
eq('a changed field says so', d[0].kind, 'changed');

eq('a create diffs against nothing',
   diffFields(entry({ changeType: 'create', changedKeys: ['type'], after: { type: 'office_in' } }))
     .map(c => [c.field, c.before, c.after, c.kind]),
   [['type', '—', 'office_in', 'added']]);

eq('a delete reports removals',
   diffFields(entry({ changeType: 'delete', changedKeys: ['type'], before: { type: 'office_in' }, after: null }))
     .map(c => [c.field, c.before, c.after, c.kind]),
   [['type', 'office_in', '—', 'removed']]);

// changedKeys is what the trigger recorded; recomputing from the snapshots keeps the page
// honest if an entry was written before a field was added to the comparison.
eq('the diff is computed from the snapshots, not trusted from changedKeys',
   diffFields(entry({ changedKeys: [], before: { a: 1 }, after: { a: 2 } })).map(c => c.field), ['a']);

// ── Actor, with its provenance ─────────────────────────────────────────────

console.log('\nActor is named, and says how it knows:');
eq('a stamped uid resolves to a name', actorLabel(payRaise, nameOf).text, 'Ritu');
eq('...and is not flagged as a guess', actorLabel(payRaise, nameOf).inferred, false);

const inferred = entry({ actor: 'u1', actorSource: 'owner', changeType: 'create' });
eq('an inferred actor is named but flagged', actorLabel(inferred, nameOf), 
   { text: 'Anshuman', inferred: true, system: false, note: 'inferred from the record owner' });

const gap = entry({ actor: 'unknown', actorSource: 'none' });
eq('an honest gap stays unknown', actorLabel(gap, nameOf).text, 'unknown');

// The case that made the page look broken: a real entry written by an Android build older
// than the lastModifiedBy stamp. The trigger could not name the writer, but the request
// sits under u1's own path and carries u1's own userId, so the writer is not in doubt.
// The rescue has to run HERE as well as in the trigger, or history stays unreadable.
const legacyCreate = entry({
  collection: 'regularization_requests', path: 'users/u1/regularization_requests/r1',
  changeType: 'create', actor: 'unknown',
  after: { userId: 'u1', status: 'pending', approvedBy: '', date: '2026-09-09' },
});
eq('a legacy self-service create is rescued on read', actorLabel(legacyCreate, nameOf).text, 'Anshuman');
eq('...and is flagged as an inference', actorLabel(legacyCreate, nameOf).inferred, true);
eq('...and resolves to the owning uid', resolvedActor(legacyCreate).uid, 'u1');

// The same guard rails as the trigger: an UPDATE inside someone's path is very often an
// admin acting on them, and naming the owner there would accuse the wrong person.
eq('a legacy update is NOT rescued',
   actorLabel(entry({
     collection: 'leave_requests', path: 'users/u1/leave_requests/l1', actor: 'unknown',
     before: { userId: 'u1', status: 'pending' }, after: { userId: 'u1', status: 'approved' },
   }), nameOf).text, 'unknown');

eq('a legacy create whose userId does not match the path is NOT rescued',
   actorLabel(entry({ path: 'users/u1/leave_requests/l1', changeType: 'create', actor: 'unknown',
     after: { userId: 'u2', status: 'pending' } }), nameOf).text, 'unknown');

// A uid with no matching user doc (a deleted employee) must not render as a blank cell.
eq('an unmatched uid falls back to the uid itself',
   actorLabel(entry({ actor: 'ghostUid', actorSource: 'lastModifiedBy' }), nameOf).text, 'ghostUid');

// ── The sentence ───────────────────────────────────────────────────────────

console.log('\nEvery entry reads as a sentence:');
eq('a pay change names the field and both values',
   describeEntry(payRaise, nameOf), "Ritu changed Pinky's pay — Basic pay 18,000 → 20,000");

eq('a self-service create needs no possessive',
   describeEntry(entry({
     collection: 'regularization_requests', path: 'users/u1/regularization_requests/r1',
     changeType: 'create', actor: 'u1', actorSource: 'owner',
     after: { userId: 'u1', status: 'pending', date: '2026-09-09' },
   }), nameOf),
   'Anshuman added a regularization request for 9 Sep 2026');

eq('a system write says so plainly',
   describeEntry(integrityPatch, nameOf), "System · punch integrity changed Pinky's punch — Integrity");

eq('a rescued create reads as the employee\'s own action',
   describeEntry(legacyCreate, nameOf), 'Anshuman added a regularization request for 9 Sep 2026');

// The date belongs to the record, not to the last field in the list — putting it after the
// detail made the sentence read as though the VALUE applied to that date.
eq('the date sits with the record, before the field detail',
   describeEntry(entry({
     collection: 'attendance_status', path: 'users/empUid/attendance_status/2026-09-09',
     userId: 'empUid', actor: 'adminUid', actorSource: 'lastModifiedBy',
     before: { status: 'Absent', date: '2026-09-09', markedBy: 'admin' },
     after: { status: 'Present', date: '2026-09-09', markedBy: 'admin' },
   }), nameOf),
   "Ritu changed Pinky's day status for 9 Sep 2026 — Status Absent → Present");

eq('many fields collapse to a count',
   describeEntry(entry({
     collection: 'users', path: 'users/empUid', userId: 'empUid', actor: 'adminUid',
     actorSource: 'lastModifiedBy',
     before: { a: 1, b: 1, c: 1, d: 1 }, after: { a: 2, b: 2, c: 2, d: 2 },
   }), nameOf),
   "Ritu changed 4 fields on Pinky's employee profile");

eq('a delete is a delete',
   describeEntry(entry({
     collection: 'attendance', changeType: 'delete', actor: 'adminUid', actorSource: 'lastModifiedBy',
     before: { type: 'site_out', date: '2026-09-09' }, after: null,
   }), nameOf),
   "Ritu deleted Anshuman's punch for 9 Sep 2026");

eq('a no-op write is still described',
   describeEntry(entry({ actor: 'adminUid', actorSource: 'lastModifiedBy', before: { a: 1 }, after: { a: 1 } }), nameOf),
   "Ritu re-saved Anshuman's punch with no change");

// An unmapped collection must degrade to something readable, never to "undefined".
eq('an unknown collection degrades readably',
   describeEntry(entry({
     collection: 'brand_new_thing', path: 'brand_new_thing/x1', userId: null,
     changeType: 'create', actor: 'adminUid', actorSource: 'lastModifiedBy', after: { z: 1 },
   }), nameOf),
   'Ritu added a brand new thing');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
