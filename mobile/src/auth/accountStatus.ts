// Pure logic for what the app root watches on users/{uid} — ports of Android's
// data/model/AccountStatus.kt. No Firebase imports, so it is unit-tested directly.

export type AccountStatus =
  | { kind: 'active' }
  | { kind: 'suspended'; reason: string; expectedReturn: string };

/**
 * Suspension fields → status. `active` defaults to TRUE when absent or unreadable, so a doc
 * that predates the field, or a failed read, never locks anyone out (same as Android and as
 * the rules' isActive(), which uses `.get('active', true)`).
 */
export function accountStatusFrom(data: Record<string, unknown> | undefined): AccountStatus {
  if (data?.active !== false) return { kind: 'active' };
  return {
    kind: 'suspended',
    reason: typeof data.suspendedReason === 'string' ? data.suspendedReason : '',
    expectedReturn: typeof data.expectedReturn === 'string' ? data.expectedReturn : '',
  };
}

/**
 * True when the server says some OTHER device now owns this account (single-device session,
 * decision #34a). An absent or empty server token means "no session recorded", not "stale",
 * so it never signs anyone out; nor does a device with no local token (a session from before
 * this feature) — Android doesn't start the check at all in that case.
 */
export function isSessionSuperseded(serverToken: unknown, localToken: string | null): boolean {
  if (!localToken) return false;
  return typeof serverToken === 'string' && serverToken !== '' && serverToken !== localToken;
}

/** A random v4-format id for the session token. Uniqueness, not secrecy, is what matters. */
export function newSessionToken(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
