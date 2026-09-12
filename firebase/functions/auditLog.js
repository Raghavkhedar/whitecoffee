"use strict";

/**
 * Audit log — a before/after record of every write in the database.
 *
 * ⚠️ ACTOR IDENTITY IS BEST-EFFORT, AND THIS IS A REAL LIMITATION.
 * Firestore triggers do NOT carry auth context: the trigger receives the document, not
 * the identity that wrote it, and rules cannot stamp an IP or a uid on their own. So the
 * actor is recovered only from fields the document itself records (lastModifiedBy first,
 * then approvedBy, markedBy, settledBy, correctedByUid …).
 *
 * Every entry therefore says HOW it knows, in `actorSource`:
 *   lastModifiedBy → the account that performed the write stamped itself. Authoritative.
 *   businessField  → the document names a decision-maker. Describes the decision, not
 *                    necessarily the write; a stale one can survive a later edit.
 *   owner          → INFERRED. A self-service create under the employee's own path (see
 *                    `inferOwner`). Never render this as a recorded fact.
 *   system         → a Cloud Function wrote it; `systemJob` names which.
 *   none           → an honest gap. The entry reads "unknown".
 *
 * ⚠️ ORIGIN IS NOT COSMETIC. Before `classifyOrigin` existed, the `integrity` patch that
 * onPunchWritten adds to a punch inherited the EMPLOYEE's `lastModifiedBy` from the punch
 * it was patching, and this log recorded a server write as an act of the employee. A log
 * that names the wrong person is worse than one that says nothing, so origin is decided
 * before the actor is, and a system write never borrows a human identity.
 *
 * Devices running a build older than commit c6fe1d8 ("stamp lastModifiedBy on every
 * client write") record no writer at all; those entries read "unknown" until the fleet
 * updates, except where `inferOwner` can rescue them.
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
 * Fields that ONLY a Cloud Function ever writes. A write that touches nothing but these
 * is a server write no matter whose stamp is sitting on the rest of the document.
 */
const SERVER_PATCH_FIELDS = ["integrity"];

/** Collections no client writes. Anything landing here came from a scheduled job. */
const SERVER_OWNED_COLLECTIONS = ["daily_hours"];

/** Top-level paths that are pure function bookkeeping (run records, accrual markers). */
const SERVER_OWNED_ROOTS = ["system"];

/**
 * Marker fields a system write leaves behind, and the job each one names.
 *
 * ⚠️ These markers PERSIST on the document after the fact — an admin editing an auto-filed
 * request still sees `autoFiled: true` in the after-image. So a marker only counts when the
 * after-state carries no client stamp: every write from either client stamps
 * `lastModifiedBy`, so its absence is what distinguishes "a function wrote this" from
 * "a person edited something a function made".
 */
const SYSTEM_MARKERS = [
  { field: "markedBy", value: "auto", job: "nightly-attendance-status" },
  { field: "autoFiled", value: true, job: "auto-regularization" },
  { field: "autoLogout", value: true, job: "auto-logout" },
];

/** A `system:` stamp written deliberately by a function, e.g. "system:backfill". */
const SYSTEM_STAMP_PREFIX = "system:";

/** The client stamp, if the record carries a real one (a `system:` value is not one). */
function clientStamp(data) {
  const v = data && data.lastModifiedBy;
  if (typeof v !== "string" || !v.trim()) return null;
  return v.startsWith(SYSTEM_STAMP_PREFIX) ? null : v.trim();
}

/**
 * Did a person write this, or did a Cloud Function? Decided from tells the write leaves
 * in the document, because the trigger cannot see who called it.
 *
 * Pure, and deliberately derivable from `before`/`after` alone — the admin portal mirrors
 * this function so entries written before it existed classify correctly too.
 *
 * @returns {{origin: "user"|"system", systemJob: string|null}}
 */
function classifyOrigin(path, before, after, keys) {
  const state = after || before || {};
  const segments = (path || "").split("/");
  const collection = segments[segments.length - 2] || "";
  const sys = (job) => ({ origin: "system", systemJob: job });

  // A function that stamps itself is believed outright.
  const stamp = state.lastModifiedBy;
  if (typeof stamp === "string" && stamp.startsWith(SYSTEM_STAMP_PREFIX)) {
    return sys(stamp.slice(SYSTEM_STAMP_PREFIX.length) || "job");
  }

  // The integrity patch: `integrity` is the ONLY thing that moved. This is checked before
  // any stamp because the punch's own employee stamp is exactly what misled the old code.
  const changed = keys || [];
  if (changed.length > 0 && changed.every((k) => SERVER_PATCH_FIELDS.includes(k))) {
    return sys("punch-integrity");
  }

  if (SERVER_OWNED_ROOTS.includes(segments[0])) return sys("scheduled-job");
  if (SERVER_OWNED_COLLECTIONS.includes(collection)) return sys("nightly-hours");

  // Marker fields, but only on a record no client has stamped. See SYSTEM_MARKERS.
  if (!clientStamp(state)) {
    for (const m of SYSTEM_MARKERS) {
      if (state[m.field] === m.value) return sys(m.job);
    }
  }

  return { origin: "user", systemJob: null };
}

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
 * Best-effort actor, with the provenance of that answer. Prefers the AFTER state (the
 * write that just happened) and falls back to before for a delete. Returns "unknown"
 * rather than guessing — a wrong name in an audit log is worse than an honest gap.
 *
 * @returns {{actor: string, actorSource: "lastModifiedBy"|"businessField"|"none"}}
 */
function resolveActor(before, after) {
  for (const source of [after, before]) {
    if (!source) continue;
    for (const field of ACTOR_FIELDS) {
      const v = source[field];
      if (typeof v === "string" && v.trim()) {
        return {
          actor: v.trim(),
          actorSource: field === "lastModifiedBy" ? "lastModifiedBy" : "businessField",
        };
      }
    }
  }
  return { actor: "unknown", actorSource: "none" };
}

/**
 * The narrow rescue for a write that names nobody: a SELF-SERVICE CREATE.
 *
 * A document created under `users/{uid}/…` that carries that same uid in its own `userId`
 * field was created by that employee — the security rules pin both. That covers punches
 * and requests from devices too old to stamp themselves.
 *
 * ⚠️ CREATE ONLY, deliberately. An admin approving a leave request UPDATES a document
 * inside the employee's path; inferring the owner there would name the wrong person, which
 * is the one failure mode this whole module exists to avoid. The caller marks the result
 * `actorSource: "owner"` so the portal can show it as an inference, never as a fact.
 *
 * @returns {string|null} the owning uid, or null when nothing can be safely inferred
 */
function inferOwner(path, after, type) {
  if (type !== "create" || !after) return null;
  const segments = (path || "").split("/");
  if (segments[0] !== "users" || segments.length < 3) return null;
  const uid = segments[1];
  return after.userId === uid ? uid : null;
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
  const type = changeType(before, after);
  const { origin, systemJob } = classifyOrigin(path, before, after, keys);

  // Origin decides identity first: a system write never borrows the human stamp that
  // happened to be sitting on the document it patched.
  let { actor, actorSource } = origin === "system"
    ? { actor: `${SYSTEM_STAMP_PREFIX}${systemJob}`, actorSource: "system" }
    : resolveActor(before, after);

  if (actorSource === "none") {
    const owner = inferOwner(path, after, type);
    if (owner) { actor = owner; actorSource = "owner"; }
  }

  // A write that changes nothing (e.g. an idempotent set) is still recorded — knowing a
  // write happened at all is forensically meaningful.
  return {
    path,
    collection: segments[segments.length - 2] || "",
    docId: segments[segments.length - 1] || "",
    userId: segments[0] === "users" && segments.length > 1 ? segments[1] : null,
    changeType: type,
    changedKeys: keys,
    before: redact(before),
    after: redact(after),
    origin,
    systemJob,
    actor,
    actorSource,
    // No IP: Firestore rules and triggers cannot see one. See the module header.
    at: new Date(atMillis).toISOString(),
    atMillis,
  };
}

module.exports = {
  EXCLUDED_COLLECTIONS, REDACTED_FIELDS, ACTOR_FIELDS,
  SERVER_PATCH_FIELDS, SERVER_OWNED_COLLECTIONS, SERVER_OWNED_ROOTS, SYSTEM_MARKERS,
  isAuditable, changeType, changedKeys, redact,
  resolveActor, classifyOrigin, inferOwner, buildEntry,
};
