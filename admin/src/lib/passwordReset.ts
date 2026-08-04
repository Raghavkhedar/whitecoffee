// Admin password-reset input handling, kept pure so it can be unit-tested
// (passwordReset.test.ts) — the Users page holds only the prompt and the callable.
//
// ⚠️ Why this module exists. The reset flow used to be:
//
//     const temp = makeTempPassword();
//     await resetUserPassword(uid, temp);          // password ALREADY set to a random string
//     window.prompt('New password — copy and hand it over:', temp);   // return value DISCARDED
//
// window.prompt renders an EDITABLE box, so admins typed the password they intended to
// give the employee, hit OK, and wrote that down. It was thrown away; the real password
// was the random `temp` set a moment earlier. The employee then got "wrong credentials",
// which — with Firebase email-enumeration protection on — is the same message shown for
// an account that does not exist, so nobody could tell the two apart. On 2026-07-31 this
// burned an hour across two new hires and five reset attempts before the passwords were
// set by hand with firebase/scripts/set-passwords.js.
//
// The rule now: NOTHING is written until the admin's input has been read and validated.

/** Firebase Auth rejects passwords under 6 characters. Fail here, before the call. */
export const MIN_PASSWORD_LENGTH = 6;

export type ResetOutcome =
  | { ok: true; password: string }
  | { ok: false; reason: 'cancelled' | 'too-short' };

/**
 * Turns the raw `window.prompt` result into a decision.
 *
 * @param input exactly what the prompt returned — `null` when the admin cancelled.
 *
 * Edge whitespace is trimmed: a trailing space is invisible both on screen and in a
 * handed-over note, and would lock the employee out in precisely the way this module
 * exists to prevent. Internal spaces and case are preserved untouched — a password is
 * not an email and must never be normalised beyond its edges.
 */
export function resolveResetPassword(input: string | null): ResetOutcome {
  if (input === null) return { ok: false, reason: 'cancelled' };

  const password = input.trim();
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too-short' };

  return { ok: true, password };
}
