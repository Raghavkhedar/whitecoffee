// Standalone tests for admin password-reset input handling.
// Run: npx tsx src/lib/passwordReset.test.ts
import { resolveResetPassword, MIN_PASSWORD_LENGTH } from './passwordReset';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

console.log('Cancelling:');
// The whole point of this module: a cancelled prompt must leave the account ALONE.
// The old code set a random password BEFORE prompting, so Cancel still changed it.
eq('null (Cancel) changes nothing', resolveResetPassword(null), { ok: false, reason: 'cancelled' });

console.log('\nWhat the admin typed is what gets used:');
// The bug this file exists to prevent: the typed value was discarded and a random
// temp password was set instead, so the password the admin handed over never worked.
eq('a typed password is returned verbatim', resolveResetPassword('rinki123'), { ok: true, password: 'rinki123' });
eq('the pre-filled suggestion is accepted as-is', resolveResetPassword('Wc4f9x2k57'), { ok: true, password: 'Wc4f9x2k57' });
eq('internal spaces are preserved', resolveResetPassword('two words here'), { ok: true, password: 'two words here' });
eq('case is preserved (passwords are not emails)', resolveResetPassword('RinKi123'), { ok: true, password: 'RinKi123' });

console.log('\nWhitespace:');
// A trailing space is invisible on screen and in a handover note, and would lock the
// employee out exactly like the original bug. Deliberate edge whitespace is not a real
// use case; an accidental one is.
eq('trailing space is trimmed', resolveResetPassword('rinki123 '), { ok: true, password: 'rinki123' });
eq('leading space is trimmed', resolveResetPassword(' rinki123'), { ok: true, password: 'rinki123' });
eq('both ends trimmed', resolveResetPassword('  rinki123  '), { ok: true, password: 'rinki123' });

console.log('\nToo short (Firebase rejects under 6 — fail before the call, not after):');
eq('empty string', resolveResetPassword(''), { ok: false, reason: 'too-short' });
eq('whitespace only', resolveResetPassword('     '), { ok: false, reason: 'too-short' });
eq('five characters', resolveResetPassword('abcde'), { ok: false, reason: 'too-short' });
eq('five after trimming', resolveResetPassword('  abcde  '), { ok: false, reason: 'too-short' });
eq('exactly six is allowed', resolveResetPassword('abcdef'), { ok: true, password: 'abcdef' });

console.log('\nConstant:');
eq('minimum length matches Firebase', MIN_PASSWORD_LENGTH, 6);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
