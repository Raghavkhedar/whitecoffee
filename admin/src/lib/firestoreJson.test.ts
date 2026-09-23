// Standalone tests for firestoreJson. Run: npx tsx src/lib/firestoreJson.test.ts
import { Timestamp } from 'firebase/firestore';
import { docToEditableJson, editableJsonToDoc } from './firestoreJson';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

function throws(name: string, fn: () => unknown) {
  try {
    fn();
    failed++; console.log(`  ✗ ${name}: expected to throw, did not`);
  } catch {
    passed++; console.log(`  ✓ ${name}`);
  }
}

console.log('No Timestamps:');
eq(
  'plain document round-trips',
  editableJsonToDoc(docToEditableJson({ a: 1, b: 'x', c: true, d: null })),
  { a: 1, b: 'x', c: true, d: null },
);

console.log('Top-level Timestamp:');
{
  const ts = Timestamp.fromDate(new Date('2026-09-07T10:00:00.000Z'));
  const json = docToEditableJson({ lastModifiedAt: ts });
  eq('shows the __timestamp__ marker', JSON.parse(json), { lastModifiedAt: { __timestamp__: '2026-09-07T10:00:00.000Z' } });
  const back = editableJsonToDoc(json) as { lastModifiedAt: Timestamp };
  eq('round-trips to an equal Timestamp', back.lastModifiedAt.isEqual(ts), true);
}

console.log('Timestamp nested inside an array of maps (suspensionHistory[].at shape):');
{
  const ts = Timestamp.fromDate(new Date('2026-07-14T09:30:00.000Z'));
  const doc = { suspensionHistory: [{ action: 'suspend', at: ts, reason: 'test' }] };
  const back = editableJsonToDoc(docToEditableJson(doc)) as {
    suspensionHistory: { action: string; at: Timestamp; reason: string }[];
  };
  eq('array survives', Array.isArray(back.suspensionHistory), true);
  eq('nested Timestamp round-trips', back.suspensionHistory[0].at.isEqual(ts), true);
  eq('sibling field round-trips', back.suspensionHistory[0].reason, 'test');
}

console.log('Malformed input:');
throws('invalid JSON throws', () => editableJsonToDoc('{not json'));
throws('a JSON array at the top level throws', () => editableJsonToDoc('[1,2,3]'));
throws('a malformed __timestamp__ value throws', () => editableJsonToDoc(JSON.stringify({ x: { __timestamp__: 'not-a-date' } })));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
