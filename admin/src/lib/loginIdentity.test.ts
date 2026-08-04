// Standalone tests for login-identity state and change classification.
// Run: npx tsx src/lib/loginIdentity.test.ts
import {
  idLoginWorks, describeLogin, classifyLoginEmailChange, loginChangeWarning,
  validateContactEmail,
} from './loginIdentity';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

console.log('idLoginWorks — an employee ID signs in only if it IS the Auth address:');
eq('synthetic address matching the id', idLoginWorks('S464', 's464@whitecoffee.internal'), true);
eq('case and padding are irrelevant', idLoginWorks(' s464 ', 'S464@WhiteCoffee.Internal'), true);
// The 2026-07-31 breakage: her Auth login was moved to a personal address, so typing
// S463 resolved to an account that did not exist.
eq('personal address breaks it', idLoginWorks('S463', 'rinki66228@gmail.com'), false);
eq('a DIFFERENT id on a synthetic address', idLoginWorks('S999', 's464@whitecoffee.internal'), false);
eq('no employee id at all', idLoginWorks('', 's464@whitecoffee.internal'), false);
eq('no login address', idLoginWorks('S464', ''), false);

console.log('\ndescribeLogin — the neutral line shown on every employee:');
eq('id login available',
  describeLogin('S464', 's464@whitecoffee.internal'),
  'Signs in with employee ID S464, or the full address s464@whitecoffee.internal.');
// True today for ~8 active staff on legacy real-email logins. Factual, not alarming.
eq('email-only login',
  describeLogin('S351', 'bosenken.taniya@gmail.com'),
  'Signs in with bosenken.taniya@gmail.com only — employee ID S351 will not work.');
eq('no address on file', describeLogin('S464', ''), 'No login address on file.');

console.log('\nclassifyLoginEmailChange:');
eq('identical address', classifyLoginEmailChange('S464', 's464@whitecoffee.internal', 's464@whitecoffee.internal'), { kind: 'unchanged' });
eq('only case/padding differs', classifyLoginEmailChange('S464', 's464@whitecoffee.internal', ' S464@Whitecoffee.Internal '), { kind: 'unchanged' });
eq('not an email address', classifyLoginEmailChange('S464', 's464@whitecoffee.internal', 'S464'), { kind: 'invalid' });
eq('missing the dot', classifyLoginEmailChange('S464', 's464@whitecoffee.internal', 'ravi@senken'), { kind: 'invalid' });
// The exact 2026-07-31 change, which nothing warned about at the time.
eq('synthetic → personal BREAKS id login',
  classifyLoginEmailChange('S463', 's463@whitecoffee.internal', 'rinki66228@gmail.com'),
  { kind: 'breaks-id-login', employeeId: 'S463', next: 'rinki66228@gmail.com' });
// The repair the admin performed on 2026-08-04.
eq('personal → synthetic RESTORES id login',
  classifyLoginEmailChange('S463', 'rinki66228@gmail.com', 's463@whitecoffee.internal'),
  { kind: 'restores-id-login', employeeId: 'S463', next: 's463@whitecoffee.internal' });
eq('one real address to another — no change in id login',
  classifyLoginEmailChange('S351', 'old@senkenindia.in', 'new@senkenindia.in'),
  { kind: 'changed', next: 'new@senkenindia.in' });

console.log('\nloginChangeWarning — confirm ONLY when something is lost:');
const breaks = classifyLoginEmailChange('S463', 's463@whitecoffee.internal', 'rinki66228@gmail.com');
eq('breaking change warns and names both sides',
  loginChangeWarning(breaks),
  'Employee ID S463 will STOP working as a login.\n\n'
  + 'This employee must sign in with rinki66228@gmail.com on both the app and the portal.\n\n'
  + 'Continue?');
eq('restoring change is silent', loginChangeWarning(classifyLoginEmailChange('S463', 'rinki66228@gmail.com', 's463@whitecoffee.internal')), null);
eq('unchanged is silent', loginChangeWarning({ kind: 'unchanged' }), null);
eq('invalid is silent (the form reports it)', loginChangeWarning({ kind: 'invalid' }), null);
eq('real → real is silent', loginChangeWarning({ kind: 'changed', next: 'new@senkenindia.in' }), null);

console.log('\nvalidateContactEmail — must be a mailbox that can actually receive:');
eq('blank is allowed (not every employee has email)', validateContactEmail(''), { ok: true });
eq('whitespace counts as blank', validateContactEmail('   '), { ok: true });
eq('a real address', validateContactEmail('rinki66228@gmail.com'), { ok: true });
eq('a company address', validateContactEmail('nishu.s@senkenindia.in'), { ok: true });
// What the admin actually entered for S463 and S464 on 2026-07-31. It is a login key
// with no mailbox behind it, so a reset link sent there is lost forever.
eq('the synthetic login domain is rejected', validateContactEmail('s464@whitecoffee.internal'), { ok: false, reason: 'not-a-mailbox' });
eq('rejected regardless of case', validateContactEmail('S463@WhiteCoffee.Internal'), { ok: false, reason: 'not-a-mailbox' });
eq('malformed address', validateContactEmail('ravi@senken'), { ok: false, reason: 'invalid' });
eq('an employee id in the contact field', validateContactEmail('S464'), { ok: false, reason: 'invalid' });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
