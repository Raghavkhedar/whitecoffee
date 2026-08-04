// Standalone tests for login-identifier resolution.
// Run: npx tsx src/lib/constants.test.ts
//
// ⚠️ MIRROR: these cases must match FirebaseAuthRepository.resolveLoginEmail (Kotlin).
// If you change the rule here, change it there — a divergence means an employee can log
// into the phone but not the portal, or vice versa.
import { resolveLoginEmail, syntheticLoginEmail, LOGIN_EMAIL_DOMAIN } from './constants';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

console.log('Employee IDs (no "@") become synthetic logins:');
eq('lowercase id', resolveLoginEmail('s464'), 's464@whitecoffee.internal');
eq('uppercase id is lowercased', resolveLoginEmail('S464'), 's464@whitecoffee.internal');
eq('surrounding spaces trimmed', resolveLoginEmail('  S464  '), 's464@whitecoffee.internal');
eq('mixed case', resolveLoginEmail('EmP001'), 'emp001@whitecoffee.internal');

console.log('\nAnything containing "@" is already a login email:');
eq('company address passes through', resolveLoginEmail('admin@senken.com'), 'admin@senken.com');
eq('address is lowercased', resolveLoginEmail('Admin@Senken.com'), 'admin@senken.com');
eq('address is trimmed', resolveLoginEmail(' admin@senken.com '), 'admin@senken.com');
// The real case from 2026-07-31: an employee whose Auth login was moved to a personal
// address. She can only sign in with this, never with her employee ID.
eq('personal address passes through', resolveLoginEmail('rinki66228@gmail.com'), 'rinki66228@gmail.com');
eq('a synthetic address typed in full', resolveLoginEmail('S464@whitecoffee.internal'), 's464@whitecoffee.internal');

console.log('\nAgreement with account creation:');
// The portal creates accounts with syntheticLoginEmail(); login must resolve an employee
// ID to exactly the same string or a new hire cannot sign in at all.
eq('resolve(id) === syntheticLoginEmail(id)', resolveLoginEmail('S464'), syntheticLoginEmail('S464'));
eq('same for a padded id', resolveLoginEmail(' s463 '), syntheticLoginEmail(' s463 '));

console.log('\nDomain constant:');
eq('matches the Android LOGIN_EMAIL_DOMAIN', LOGIN_EMAIL_DOMAIN, 'whitecoffee.internal');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
