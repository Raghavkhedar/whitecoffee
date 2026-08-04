// How an employee actually signs in, and what a login-email change costs them.
// Pure so it can be unit-tested (loginIdentity.test.ts); the Users page holds only the
// form wiring and the confirm dialog.
//
// A Firebase Auth account has exactly ONE email — there are no aliases. So an employee
// ID works as a login if and only if the account's Auth address IS the synthetic form of
// that ID. Point the account at a personal address and the ID silently stops resolving:
// the app maps "S463" to s463@whitecoffee.internal, finds no such account, and (with
// email-enumeration protection on) reports the same generic failure it gives for a wrong
// password. That is exactly what happened on 2026-07-31 — the change was one click in
// the edit modal, nothing warned, and the employee simply could not log in.
import { syntheticLoginEmail, LOGIN_EMAIL_DOMAIN } from './constants';

// Same shape the Users page has always validated against.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const norm = (s: string) => s.trim().toLowerCase();

/** Can this employee sign in by typing their employee ID? */
export function idLoginWorks(employeeId: string, loginEmail: string): boolean {
  if (!employeeId.trim() || !loginEmail.trim()) return false;
  return norm(loginEmail) === syntheticLoginEmail(employeeId);
}

/**
 * One neutral sentence describing how this person signs in, shown on every employee.
 * Deliberately not a warning: ~8 active staff are on legacy real-email logins that have
 * always worked, and flagging them red would train admins to ignore the message.
 */
export function describeLogin(employeeId: string, loginEmail: string): string {
  if (!loginEmail.trim()) return 'No login address on file.';
  if (idLoginWorks(employeeId, loginEmail)) {
    return `Signs in with employee ID ${employeeId.trim()}, or the full address ${norm(loginEmail)}.`;
  }
  if (!employeeId.trim()) return `Signs in with ${norm(loginEmail)}.`;
  return `Signs in with ${norm(loginEmail)} only — employee ID ${employeeId.trim()} will not work.`;
}

/**
 * `contactEmail` is where a human is actually reachable — password-reset links and
 * notifications go here, never to the Auth address. It is optional (not every employee
 * has email), but if present it must be a mailbox that can RECEIVE.
 *
 * The one case we can prove is bad: an address on the synthetic login domain. Those are
 * Firebase Auth keys with no mail server behind them, so anything sent there is lost
 * silently. Admins filled exactly this in for S463 and S464 on 2026-07-31 — the field
 * looked like it wanted the login address, so they pasted it.
 */
export function validateContactEmail(contactEmail: string):
  { ok: true } | { ok: false; reason: 'invalid' | 'not-a-mailbox' } {
  const value = norm(contactEmail);
  if (!value) return { ok: true };
  if (!EMAIL_RE.test(value)) return { ok: false, reason: 'invalid' };
  if (value.endsWith(`@${LOGIN_EMAIL_DOMAIN}`)) return { ok: false, reason: 'not-a-mailbox' };
  return { ok: true };
}

export type LoginEmailChange =
  | { kind: 'unchanged' }
  | { kind: 'invalid' }
  | { kind: 'breaks-id-login'; employeeId: string; next: string }
  | { kind: 'restores-id-login'; employeeId: string; next: string }
  | { kind: 'changed'; next: string };

/** What a pending login-email edit would do to this employee's ability to sign in. */
export function classifyLoginEmailChange(
  employeeId: string,
  currentEmail: string,
  nextEmail: string,
): LoginEmailChange {
  const next = norm(nextEmail);
  if (next === norm(currentEmail)) return { kind: 'unchanged' };
  if (!EMAIL_RE.test(next)) return { kind: 'invalid' };

  const worked = idLoginWorks(employeeId, currentEmail);
  const willWork = idLoginWorks(employeeId, next);
  if (worked && !willWork) return { kind: 'breaks-id-login', employeeId: employeeId.trim(), next };
  if (!worked && willWork) return { kind: 'restores-id-login', employeeId: employeeId.trim(), next };
  return { kind: 'changed', next };
}

/**
 * Text to confirm before committing the change — `null` when nothing is lost.
 * Only a change that TAKES AWAY ID login asks; restoring it, or swapping one real
 * address for another, proceeds silently.
 */
export function loginChangeWarning(change: LoginEmailChange): string | null {
  if (change.kind !== 'breaks-id-login') return null;
  return `Employee ID ${change.employeeId} will STOP working as a login.\n\n`
    + `This employee must sign in with ${change.next} on both the app and the portal.\n\n`
    + `Continue?`;
}
