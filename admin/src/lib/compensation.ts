/**
 * Compensation fields — pay data split off the user document.
 *
 * Port of `firebase/functions/compensation.js`. There is no shared JS build graph in this
 * monorepo, so the logic is mirrored per language and unit-tested on each side — keep the
 * two in lockstep.
 *
 * WHY THE SPLIT EXISTS: Firestore security rules are DOCUMENT-level. There is no
 * field-level read control, so any tab permitted to read `users/{uid}` reads `salaryRate`
 * with it. Nine of the ten grantable tabs read user docs purely to resolve names and
 * employee IDs, which let a Conveyance-only or Notifications-only manager enumerate the
 * whole company's pay. Pay therefore lives in its own document:
 *
 *     users/{uid}/compensation/current   ← admin + /ot-settlements only
 *
 * MIGRATION SAFETY: reads fall back PER FIELD to the legacy inline value on the user doc,
 * so a user with the subcollection doc, the inline fields, or both resolves identically.
 * A missed fallback means salaryRate reads 0 and the employee is paid nothing.
 */

export interface Pay {
  salaryRate: number;
  pfPercent: number;
  esiPercent: number;
  imprestPercent: number;
}

export const PAY_FIELDS: (keyof Pay)[] = ['salaryRate', 'pfPercent', 'esiPercent', 'imprestPercent'];

type Source = Partial<Record<keyof Pay, unknown>> | null | undefined;

/** Return obj[field] when it is a finite number, else `fallback`. */
function pick(obj: Source, field: keyof Pay, fallback: number): number {
  if (!obj) return fallback;
  const v = obj[field];
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/**
 * Resolve pay from the compensation doc, falling back per field to the legacy inline
 * fields on the user doc, then to 0.
 *
 * Per-field (not whole-document) fallback is deliberate: a partially-written compensation
 * doc must not blank out the fields it happens to be missing. Note 0 is a REAL value and
 * must stick — treating it as absent would resurrect the old inline number.
 */
export function resolvePay(userData: Source, compData: Source): Pay {
  return {
    salaryRate:     pick(compData, 'salaryRate',     pick(userData, 'salaryRate', 0)),
    pfPercent:      pick(compData, 'pfPercent',      pick(userData, 'pfPercent', 0)),
    esiPercent:     pick(compData, 'esiPercent',     pick(userData, 'esiPercent', 0)),
    imprestPercent: pick(compData, 'imprestPercent', pick(userData, 'imprestPercent', 0)),
  };
}

/** Merge resolved pay onto a user object. Returns a NEW object; the input is not mutated. */
export function withPay<T extends object>(user: T, compData: Source): T & Pay {
  return { ...user, ...resolvePay(user as Source, compData) };
}
