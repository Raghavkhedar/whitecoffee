/**
 * Run: npx tsx src/lib/holidayGuard.test.ts
 */

import { holidayEditError, HOLIDAY_PAST_MESSAGE } from './holidayGuard';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log('holidayEditError:');
check('a past date is refused with the Regularization message', holidayEditError('2026-09-18', '2026-09-19') === HOLIDAY_PAST_MESSAGE);
check('today is allowed', holidayEditError('2026-09-19', '2026-09-19') === null);
check('a future date is allowed', holidayEditError('2026-10-02', '2026-09-19') === null);
check('a date across a month/year boundary is compared as a date, not a number', holidayEditError('2025-12-31', '2026-01-01') === HOLIDAY_PAST_MESSAGE);
check('the message points at Regularization', /Regularization/.test(HOLIDAY_PAST_MESSAGE));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
