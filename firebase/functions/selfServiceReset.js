"use strict";

// Pure decision logic for UNAUTHENTICATED "I forgot my password".
//
// Everything here is deliberately free of Firestore, Auth and the clock so it can be
// tested directly (selfServiceReset.test.js); index.js holds the I/O.
//
// Why this endpoint can exist at all
// ----------------------------------
// generatePasswordResetLink has always been admin-only, with a comment saying an
// unauthenticated version "would hand full account takeover to anyone who can guess an
// ID". That is true of an endpoint that RETURNS the link. This one never returns it —
// it mails the link to the `contactEmail` already on the employee's record, an inbox the
// requester must already control. Guessing S451 gets an attacker nothing except an email
// sent to somebody else. The link itself never crosses the wire back to the caller.
//
// Two properties keep that true, and both are tested:
//   1. The reply is one constant string, identical for "sent", "no such account",
//      "no address on file" and "disabled". Employee IDs are sequential, so a reply that
//      varied would let anyone sweep S001..S999 and map the whole company.
//   2. Requests are rate limited per identifier AND per IP, so the endpoint cannot be
//      used to bomb an employee's inbox or to bury a genuine reset under noise.

const LOGIN_EMAIL_DOMAIN = "whitecoffee.internal";

/** Longest identifier we will accept. It becomes part of a Firestore key downstream. */
const IDENTIFIER_LIMIT = 128;

/**
 * ⚠️ MIRROR of `FirebaseAuthRepository.resolveLoginEmail` (Kotlin) and
 * `resolveLoginEmail` in `admin/src/lib/constants.ts`. Three copies, no shared build
 * graph — change all three together. If this one drifts, "forgot password" starts
 * failing for people who can log in perfectly well, which is a maddening bug to chase.
 */
function resolveLoginEmail(identifier) {
  const trimmed = String(identifier).trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : `${trimmed}@${LOGIN_EMAIL_DOMAIN}`;
}

/** Trim/lowercase a caller-supplied identifier, or null if it is unusable. */
function normalizeIdentifier(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.length > IDENTIFIER_LIMIT) return null;
  return value;
}

// A single account: slow, and only a few links per hour. Someone who genuinely lost
// their password needs one or two; anything past that is noise or malice.
const PER_IDENTIFIER = Object.freeze({
  cooldownMs: 60 * 1000,
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 3,
});

// A whole site office can share one connection, so the IP budget has to absorb several
// unrelated people legitimately resetting on the same afternoon.
const PER_IP = Object.freeze({
  cooldownMs: 5 * 1000,
  windowMs: 60 * 60 * 1000,
  maxPerWindow: 20,
});

/**
 * Should this attempt proceed, given the attempts already recorded?
 *
 *   { allowed: true,  history }                     → history to persist (pruned + now)
 *   { allowed: false, reason, retryAfterMs }        → "cooldown" or "too-many"
 *
 * `history` is a plain array of epoch-ms numbers. Anything else in it is ignored rather
 * than throwing — a half-written doc must not take the endpoint down, and must not read
 * as "no recent attempts" either, which would silently disable the limit.
 */
function classifyAttempt(history, now, limits) {
  const { cooldownMs, windowMs, maxPerWindow } = limits;

  const recent = (Array.isArray(history) ? history : [])
    .filter((t) => typeof t === "number" && Number.isFinite(t))
    .filter((t) => now - t < windowMs)
    .sort((a, b) => a - b);

  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < cooldownMs) {
    return { allowed: false, reason: "cooldown", retryAfterMs: cooldownMs - (now - last) };
  }

  if (recent.length >= maxPerWindow) {
    // Free again when the oldest attempt ages out of the window — not a flat penalty,
    // so the limit relaxes gradually instead of all at once.
    return { allowed: false, reason: "too-many", retryAfterMs: recent[0] + windowMs - now };
  }

  return { allowed: true, history: [...recent, now] };
}

/**
 * The ONLY thing this endpoint ever tells the caller. It deliberately does not confirm
 * that the account exists or that anything was sent, and it names the fallback for the
 * many field staff who have no email address on file at all — for them nothing will
 * arrive, and saying "check your email" alone would strand them.
 */
const SELF_SERVICE_MESSAGE =
  "If we have an email address on file for that ID, a reset link is on its way. "
  + "It expires in an hour. If nothing arrives in a few minutes, contact your "
  + "administrator — you may not have an email address on your record.";

module.exports = {
  resolveLoginEmail, normalizeIdentifier, classifyAttempt,
  IDENTIFIER_LIMIT, SELF_SERVICE_MESSAGE, PER_IDENTIFIER, PER_IP,
  LOGIN_EMAIL_DOMAIN,
};
