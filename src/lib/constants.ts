// Synthetic login domain for new hires. New hires log in with just their employee ID,
// which the Android app (AuthRepository.login) and this portal both map to
// `‹empId›@whitecoffee.internal` — a Firebase Auth login key, NOT a real mailbox.
// This MUST equal the Android app's LOGIN_EMAIL_DOMAIN or new hires can't sign in.
export const LOGIN_EMAIL_DOMAIN = 'whitecoffee.internal';

export const syntheticLoginEmail = (empId: string) =>
  `${empId.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
