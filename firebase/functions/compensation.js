"use strict";

/**
 * Compensation fields — pay data split off the user document.
 *
 * WHY THIS EXISTS: Firestore security rules are DOCUMENT-level. There is no field-level
 * read control, so any tab permitted to read `users/{uid}` reads `salaryRate` with it.
 * Nine of the ten grantable portal tabs read user docs purely to resolve names and
 * employee IDs, which meant a Conveyance-only or Notifications-only manager could
 * enumerate the entire company's pay. The only real fix is to move the pay fields to a
 * separate document that those tabs cannot read at all:
 *
 *     users/{uid}/compensation/current   ← admin + /ot-settlements only
 *
 * MIGRATION SAFETY: reads fall back PER FIELD to the legacy inline value on the user
 * doc. During the rollout a user may have the subcollection doc, the inline fields, or
 * both, and every combination must resolve to the same numbers — a missed fallback here
 * means salaryRate reads 0 and the employee is paid nothing. The inline fields are only
 * removed once every reader is deployed against this module.
 *
 * Pure and Firestore-free so it can be unit-tested with `node --test`.
 */

/** The four pay fields, in the order the Sheets export and the settlement math expect. */
const PAY_FIELDS = ["salaryRate", "pfPercent", "esiPercent", "imprestPercent"];

/**
 * Resolve a user's pay fields from the compensation doc, falling back to the legacy
 * inline fields on the user doc, then to 0.
 *
 * Per-field (not whole-document) fallback is deliberate: a partially-migrated
 * compensation doc must not blank out the fields it happens to be missing.
 *
 * A field is "present" only when it is a finite number. A null/undefined/NaN/string
 * value falls through to the next source, so a half-written migration cannot poison pay.
 *
 * @param {object|null} userData user document data (may carry legacy inline pay fields)
 * @param {object|null} compData users/{uid}/compensation/current data, if it exists
 * @returns {{salaryRate:number, pfPercent:number, esiPercent:number, imprestPercent:number}}
 */
function resolvePay(userData, compData) {
  const out = {};
  for (const field of PAY_FIELDS) {
    out[field] = pick(compData, field, pick(userData, field, 0));
  }
  return out;
}

/** Return obj[field] when it is a finite number, else `fallback`. */
function pick(obj, field, fallback) {
  if (!obj) return fallback;
  const v = obj[field];
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

/**
 * Merge resolved pay onto a user object, so existing call sites that read
 * `user.salaryRate` keep working unchanged once the loader has attached it.
 *
 * @param {object} user user object (with or without legacy inline pay)
 * @param {object|null} compData compensation doc data, if any
 * @returns {object} a NEW object — the input is not mutated
 */
function withPay(user, compData) {
  return { ...user, ...resolvePay(user, compData) };
}

module.exports = { PAY_FIELDS, resolvePay, withPay };
