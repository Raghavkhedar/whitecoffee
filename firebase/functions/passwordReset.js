"use strict";

// Where a password-reset link should be delivered for a given employee.
//
// Firebase generates the link but never sends it (generatePasswordResetLink only mints a
// URL), and the Auth address for most staff is `<empId>@whitecoffee.internal` — a login
// key with no mail server behind it. So delivery is OUR decision, and it must be routed
// to `contactEmail`, never to the Auth address.
//
// ⚠️ MIRROR of `admin/src/lib/loginIdentity.ts` (validateContactEmail) — there is no
// shared JS build graph, so the same rule is written twice. Change both together.

const LOGIN_EMAIL_DOMAIN = "whitecoffee.internal";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const norm = (s) => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** Can mail actually reach this address? Synthetic login keys never can. */
function isDeliverable(email) {
  const value = norm(email);
  if (!EMAIL_RE.test(value)) return false;
  return !value.endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
}

/**
 * Decides how this employee's reset link should reach them.
 *
 *   { channel: "email",  to }        → send it to a real inbox
 *   { channel: "manual", reason }    → no usable address; an admin must hand it over
 *
 * `manual` is a legitimate outcome, not an error: field staff frequently have no email,
 * and the admin passing a link over WhatsApp is a supported path. What must never happen
 * is routing to an address that silently swallows it.
 */
function resolveResetDelivery(user) {
  const contactEmail = norm((user || {}).contactEmail);
  if (!contactEmail) return { channel: "manual", reason: "no-contact-email" };
  if (!EMAIL_RE.test(contactEmail)) return { channel: "manual", reason: "contact-invalid" };
  if (contactEmail.endsWith(`@${LOGIN_EMAIL_DOMAIN}`)) {
    return { channel: "manual", reason: "contact-is-not-a-mailbox" };
  }
  return { channel: "email", to: contactEmail };
}

module.exports = { resolveResetDelivery, isDeliverable, LOGIN_EMAIL_DOMAIN };
