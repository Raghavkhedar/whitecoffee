// Synthetic login domain for new hires. New hires log in with just their employee ID,
// which the Android app (AuthRepository.login) and this portal both map to
// `‹empId›@whitecoffee.internal` — a Firebase Auth login key, NOT a real mailbox.
// This MUST equal the Android app's LOGIN_EMAIL_DOMAIN or new hires can't sign in.
export const LOGIN_EMAIL_DOMAIN = 'whitecoffee.internal';

export const syntheticLoginEmail = (empId: string) =>
  `${empId.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

/**
 * Resolves whatever a person typed on a login screen into the email Firebase Auth wants.
 *   - contains "@"  → already a login email (legacy real addresses) → used as-is
 *   - otherwise     → an employee ID → `‹id›@LOGIN_EMAIL_DOMAIN`
 * Always trimmed + lowercased, so "S464", " s464 " and "s464" all resolve identically.
 *
 * ⚠️ MIRROR of `FirebaseAuthRepository.resolveLoginEmail` (Kotlin) — the app and the
 * portal must accept exactly the same identifiers. Change both together, and keep
 * constants.test.ts in step. Until this existed, the phone took an employee ID while the
 * portal demanded the full `‹id›@whitecoffee.internal`, which no employee ever knew.
 */
export const resolveLoginEmail = (identifier: string) => {
  const trimmed = identifier.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : `${trimmed}@${LOGIN_EMAIL_DOMAIN}`;
};
