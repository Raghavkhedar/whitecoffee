"use strict";

/**
 * Audit log — a before/after record of every write in the database.
 *
 * ⚠️ ACTOR IDENTITY IS BEST-EFFORT, AND THIS IS A REAL LIMITATION.
 * Firestore triggers do NOT carry auth context: the trigger receives the document, not
 * the identity that wrote it, and rules cannot stamp an IP or a uid on their own. So the
 * actor is recovered only from fields the document itself records (approvedBy, markedBy,
 * settledBy, correctedByUid …). Where none is present the entry is marked "unknown".
 *
 * Making this complete requires every write to carry `lastModifiedBy: request.auth.uid`,
 * enforced in security rules — a change across the portal and the Android app. Until then
 * this log answers "what changed, when, from what to what" completely, and "who" only
 * where the write already recorded it.
 *
 * There is NO client IP here and there cannot be: Firestore rules have no `request.ip`,
 * and neither do triggers. IPs for client-SDK writes are only available through GCP Cloud
 * Audit Logs (Data Access), which is console configuration rather than code.
 *
 * Pure and Firestore-free so it can be unit-tested with `node --test`.
 */

/** Collections never audited. audit_log itself MUST be here or the trigger self-triggers. */
const EXCLUDED_COLLECTIONS = ["audit_log"];

/**
 * Fields whose VALUES are replaced with a redaction marker. The audit log is admin-only,
 * but a device push token is a credential and has no forensic value, so it is not copied
 * into a second collection. Pay values are deliberately NOT redacted — "who changed a
 * salary from what to what" is exactly what this log exists to answer.
 */
const REDACTED_FIELDS = ["fcmToken", "activeSessionToken"];

/**
 * Fields that identify who performed a write, in priority order.
 *
 * `lastModifiedBy` is FIRST and authoritative: it is the auth uid stamped by the client on
 * every write, so it identifies the actual writer. The rest are business fields that name
 * whoever a document says approved or marked it — useful, but they describe the decision
 * rather than the write, and a stale one can survive a later edit by someone else.
 */
const ACTOR_FIELDS = [
  "lastModifiedBy",
  "correctedByUid", "correctedBy", "approvedBy", "settledBy",
  "markedBy", "sentByName",
];

/**
 * Is this path auditable? Guards against the self-trigger loop that would otherwise make
 * every audit write produce another audit write, without bound.
 *
 * @param {string} path Firestore document path, e.g. "users/u1/attendance/e1"
 */
function isAuditable(path) {
  if (!path) return false;
  const segments = path.split("/");
  // Collection names sit at every even index (0, 2, 4 …) of a document path.
  for (let i = 0; i < segments.length; i += 2) {
    if (EXCLUDED_COLLECTIONS.includes(segments[i])) return false;
  }
  return true;
}

/** create | update | delete, from the presence of each snapshot. */
function changeType(before, after) {
  if (!before && after) return "create";
  if (before && !after) return "delete";
  return "update";
}

/** Keys whose value differs between before and after (shallow, by JSON identity). */
function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(k);
  }
  return out.sort();
}

/** Copy with credential-bearing values replaced. Returns null for a null input. */
function redact(data) {
  if (!data) return null;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = REDACTED_FIELDS.includes(k) ? "[redacted]" : v;
  }
  return out;
}

/**
 * Best-effort actor. Prefers the AFTER state (the write that just happened) and falls
 * back to before for a delete. Returns "unknown" rather than guessing — a wrong name in
 * an audit log is worse than an honest gap.
 */
function resolveActor(before, after) {
  for (const source of [after, before]) {
    if (!source) continue;
    for (const field of ACTOR_FIELDS) {
      const v = source[field];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "unknown";
}

/**
 * Build the audit entry for a write, or null when the path is excluded.
 *
 * @param {string} path document path
 * @param {object|null} before pre-write data
 * @param {object|null} after post-write data
 * @param {number} atMillis server time of the write
 * @returns {object|null}
 */
function buildEntry(path, before, after, atMillis) {
  if (!isAuditable(path)) return null;
  const segments = path.split("/");
  const keys = changedKeys(before, after);
  // A write that changes nothing (e.g. an idempotent set) is still recorded — knowing a
  // write happened at all is forensically meaningful.
  return {
    path,
    collection: segments[segments.length - 2] || "",
    docId: segments[segments.length - 1] || "",
    userId: segments[0] === "users" && segments.length > 1 ? segments[1] : null,
    changeType: changeType(before, after),
    changedKeys: keys,
    before: redact(before),
    after: redact(after),
    actor: resolveActor(before, after),
    // No IP: Firestore rules and triggers cannot see one. See the module header.
    at: new Date(atMillis).toISOString(),
    atMillis,
  };
}

module.exports = {
  EXCLUDED_COLLECTIONS, REDACTED_FIELDS, ACTOR_FIELDS,
  isAuditable, changeType, changedKeys, redact, resolveActor, buildEntry,
};
