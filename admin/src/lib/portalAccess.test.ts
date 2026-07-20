// Standalone tests for portal tab access. Run: npx tsx src/lib/portalAccess.test.ts
import {
  allowedPaths, canAccess, hasPortalAccess, landingPath,
  TABS,
} from './portalAccess';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

const ALL       = TABS.map(t => t.path);
const GRANTABLE  = TABS.filter(t => !t.adminOnly).map(t => t.path);

const admin    = { role: 'admin' as const };
// A scoped manager granted a subset of grantable tabs (order deliberately scrambled).
const managerGrants = ['/ot-shortage', '/attendance', '/working-hours-shortage-excess'];
const manager  = { role: 'operations' as const, tabAccess: managerGrants };
const noAccess = { role: 'office' as const };                       // no tabAccess field
const emptyArr = { role: 'office' as const, tabAccess: [] };
// tabAccess containing a stray admin-only path + an unknown path (both ignored).
const strayAcc = { role: 'office' as const, tabAccess: ['/users', '/access', '/made-up', '/leaves'] };

console.log('Admin (superuser):');
eq('sees every tab (incl. admin-only)', allowedPaths(admin), ALL);
eq('has portal access', hasPortalAccess(admin), true);
eq('can access a random tab', canAccess(admin, '/notifications'), true);
eq('can access /access', canAccess(admin, '/access'), true);
eq('lands on /dashboard', landingPath(admin), '/dashboard');

console.log('Scoped manager (granted subset):');
// allowedPaths returns TABS order regardless of tabAccess order.
eq('sees exactly its granted tabs, in TABS order', allowedPaths(manager),
  GRANTABLE.filter(p => managerGrants.includes(p)));
eq('has portal access', hasPortalAccess(manager), true);
eq('can access /attendance', canAccess(manager, '/attendance'), true);
eq('can access nested /attendance/2026-01', canAccess(manager, '/attendance/2026-01'), true);
eq('cannot access /users (admin-only)', canAccess(manager, '/users'), false);
eq('cannot access /leaves (not granted)', canAccess(manager, '/leaves'), false);
eq('lands on its first allowed tab', landingPath(manager),
  GRANTABLE.filter(p => managerGrants.includes(p))[0]);

console.log('No access (absent / empty tabAccess):');
eq('absent → no allowed paths', allowedPaths(noAccess), []);
eq('absent → no portal access', hasPortalAccess(noAccess), false);
eq('absent → cannot access /dashboard', canAccess(noAccess, '/dashboard'), false);
eq('absent → lands on /login', landingPath(noAccess), '/login');
eq('empty array → no allowed paths', allowedPaths(emptyArr), []);
eq('empty array → no portal access', hasPortalAccess(emptyArr), false);

console.log('Stray admin-only / unknown paths are ignored:');
eq('admin-only & unknown paths dropped, real grant kept', allowedPaths(strayAcc), ['/leaves']);
eq('has access from the one real grant', hasPortalAccess(strayAcc), true);
eq('still cannot access /users', canAccess(strayAcc, '/users'), false);
eq('still cannot access /access', canAccess(strayAcc, '/access'), false);

console.log('Config integrity:');
// /audit is admin-only because firestore.rules grants audit_log reads to admin ONLY —
// entries carry full document snapshots including pay. If this list and the rules ever
// disagree, a manager gets a tab that renders nothing.
eq('exactly 5 admin-only tabs', TABS.filter(t => t.adminOnly).map(t => t.path),
  ['/dashboard', '/users', '/access', '/daily-activity', '/audit']);
eq('10 grantable tabs', GRANTABLE.length, 10);
eq('/audit is never grantable', GRANTABLE.includes('/audit'), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
