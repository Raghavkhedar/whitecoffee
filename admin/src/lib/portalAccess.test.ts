// Standalone tests for portal tab access. Run: npx tsx src/lib/portalAccess.test.ts
import {
  allowedPaths, canAccess, hasPortalAccess, landingPath, recognizedTags,
  TABS, TAG_TABS,
} from './portalAccess';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

const admin      = { role: 'admin' as const };
const attMgr     = { role: 'operations' as const, tags: ['attendance-manager'] };
const untagged   = { role: 'office' as const };
const unknownTag = { role: 'office' as const, tags: ['made-up-tag'] };
const mixed      = { role: 'operations' as const, tags: ['attendance-manager', 'made-up-tag'] };

const ALL = TABS.map(t => t.path);
const AM  = TAG_TABS['attendance-manager'];

console.log('Admin (superuser):');
eq('sees every tab', allowedPaths(admin), ALL);
eq('has portal access', hasPortalAccess(admin), true);
eq('can access a random tab', canAccess(admin, '/notifications'), true);
eq('lands on /dashboard', landingPath(admin), '/dashboard');

console.log('Attendance manager (tagged non-admin):');
// allowedPaths returns TABS order, so compare as a set-ish ordered projection.
eq('sees only its tabs', allowedPaths(attMgr), ALL.filter(p => AM.includes(p)));
eq('has portal access', hasPortalAccess(attMgr), true);
eq('can access /attendance', canAccess(attMgr, '/attendance'), true);
eq('can access nested /attendance/2026-01', canAccess(attMgr, '/attendance/2026-01'), true);
eq('cannot access /users', canAccess(attMgr, '/users'), false);
eq('cannot access /leaves', canAccess(attMgr, '/leaves'), false);
eq('lands on its first allowed tab', landingPath(attMgr), ALL.filter(p => AM.includes(p))[0]);

console.log('Untagged non-admin:');
eq('no allowed paths', allowedPaths(untagged), []);
eq('no portal access', hasPortalAccess(untagged), false);
eq('cannot access /dashboard', canAccess(untagged, '/dashboard'), false);
eq('lands on /login', landingPath(untagged), '/login');

console.log('Unknown / removed tag is ignored:');
eq('recognizedTags drops unknown', recognizedTags(unknownTag), []);
eq('no access from unknown tag alone', hasPortalAccess(unknownTag), false);
eq('mixed tags → only known ones count', allowedPaths(mixed), ALL.filter(p => AM.includes(p)));

console.log('Config integrity:');
eq('every tag path is a real tab', Object.values(TAG_TABS).flat().every(p => ALL.includes(p)), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
