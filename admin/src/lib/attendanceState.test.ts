// Standalone tests for the deriveState port. Run: npx tsx src/lib/attendanceState.test.ts
import { deriveState } from './attendanceState';
import type { AttendanceRecord } from '@/types';

let passed = 0;
let failed = 0;

// Minimal event builder: sequential timestamps in insertion order so sort is stable.
let seq = 0;
function ev(type: string, extra: Partial<AttendanceRecord> = {}): AttendanceRecord {
  seq += 1;
  return {
    id: `e${seq}`, userId: 'u', userName: '', employeeId: '', date: '2026-07-14',
    type, timestamp: { seconds: seq } as unknown as AttendanceRecord['timestamp'],
    latitude: 0, longitude: 0, siteId: '', siteName: '', marketName: '',
    ...extra,
  } as AttendanceRecord;
}

function label(name: string, events: AttendanceRecord[], want: string) {
  const got = deriveState(events).label;
  if (got === want) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got "${got}", want "${want}"`); }
}

console.log('deriveState (last event decides):');
label('empty → not checked in', [], 'Not checked in');
label('home_in → At Home', [ev('home_in')], 'At Home');
label('site_in → At Site: name', [ev('home_in'), ev('site_in', { siteName: 'Acme' })], 'At Site: Acme');
label('site_out → At Home', [ev('home_in'), ev('site_in', { siteName: 'Acme' }), ev('site_out', { siteName: 'Acme' })], 'At Home');
label('market_in → At Market', [ev('home_in'), ev('market_in', { marketName: 'Bazaar' })], 'At Market: Bazaar');
label('home_out → Day complete', [ev('home_in'), ev('site_in', { siteName: 'Acme' }), ev('site_out', { siteName: 'Acme' }), ev('home_out')], 'Day complete');
label('office_out → Day complete', [ev('office_in'), ev('office_out')], 'Day complete');

// The core rewind case: end-of-day-from-site is site_out THEN home_out. Removing only
// home_out lands "At Home"; removing home_out + site_out lands back "At Site".
console.log('\nRewind preview (what a restore point derives to):');
const full = [ev('home_in'), ev('site_in', { siteName: 'Acme' }), ev('site_out', { siteName: 'Acme' }), ev('home_out')];
label('keep through site_out → At Home', full.slice(0, 3), 'At Home');
label('keep through site_in → At Site: Acme', full.slice(0, 2), 'At Site: Acme');

// Out-of-order timestamps must still resolve by time, not array order.
console.log('\nUnordered input:');
const a = ev('site_in', { siteName: 'Z', timestamp: { seconds: 100 } as unknown as AttendanceRecord['timestamp'] });
const b = ev('home_in', { timestamp: { seconds: 50 } as unknown as AttendanceRecord['timestamp'] });
label('later site_in wins over earlier home_in', [a, b], 'At Site: Z');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
