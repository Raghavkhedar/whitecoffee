/**
 * Mirror of firebase/functions/compensation.test.js — the two implementations must agree.
 * Run: npx tsx src/lib/compensation.test.ts
 */

import { resolvePay, withPay, PAY_FIELDS, type Pay } from './compensation';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const legacyUser = { name: 'A', salaryRate: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 };
const compDoc: Pay = { salaryRate: 1000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 };

console.log('Migration source combinations:');
check('pre-migration: inline only', eq(resolvePay(legacyUser, null), compDoc));
check('post-migration: compensation only', eq(resolvePay({ name: 'A' }, compDoc), compDoc));
check('mid-migration: both present, compensation wins',
  resolvePay({ ...legacyUser, salaryRate: 1 }, compDoc).salaryRate === 1000);

console.log('Fallback safety:');
// The dangerous case: a partial compensation doc must not blank PF/ESI to 0, which would
// silently stop the deductions.
check('partial compensation doc falls back PER FIELD', eq(
  resolvePay(legacyUser, { salaryRate: 2000 }),
  { salaryRate: 2000, pfPercent: 12, esiPercent: 0.75, imprestPercent: 5 },
));
check('neither source → zeros, never undefined', eq(
  resolvePay(null, null), { salaryRate: 0, pfPercent: 0, esiPercent: 0, imprestPercent: 0 },
));
check('non-numeric never wins', resolvePay(legacyUser, { salaryRate: '9999' }).salaryRate === 1000);
check('null never wins', resolvePay(legacyUser, { salaryRate: null }).salaryRate === 1000);
check('NaN never wins', resolvePay(legacyUser, { salaryRate: NaN }).salaryRate === 1000);

console.log('Zero is a real value:');
check('explicit 0 salaryRate sticks', resolvePay(legacyUser, { ...compDoc, salaryRate: 0 }).salaryRate === 0);
check('explicit 0 imprestPercent sticks', resolvePay(legacyUser, { ...compDoc, imprestPercent: 0 }).imprestPercent === 0);

console.log('withPay:');
const user = { id: 'u1', name: 'A' };
const merged = withPay(user, compDoc);
check('merges pay onto user', merged.salaryRate === 1000 && merged.name === 'A');
check('does not mutate input', !('salaryRate' in user));
check('preserves legacy inline pay with no comp doc', withPay(legacyUser, null).salaryRate === 1000);
check('PAY_FIELDS covers the four fields',
  eq(PAY_FIELDS, ['salaryRate', 'pfPercent', 'esiPercent', 'imprestPercent']));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
