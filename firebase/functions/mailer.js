"use strict";

// Outbound transactional email.
//
// There is exactly one kind of mail today: a password-reset link. Keep it that way
// unless there is a real need — every address we send to is a deliverability liability,
// and a reset link is the one message an employee genuinely cannot work without.
//
// Provider: Resend, called over plain HTTPS. No SDK, so nothing to keep upgraded, and
// the whole provider surface is the single fetch in `postToProvider` — swapping to
// Brevo/SendGrid/Mailgun means rewriting that function and nothing else.
//
// ⚠️ Requires TWO things that live outside this repo, and silently sends nothing until
// both exist:
//   1. RESEND_API_KEY in Secret Manager:
//        firebase functions:secrets:set RESEND_API_KEY
//   2. A verified sending domain with SPF + DKIM records on senkenindia.in.
//      Until the domain is verified, Resend only accepts mail to the account owner's own
//      address — so this will appear to work in testing and fail for every employee.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Default From. Must be on the verified domain or the provider rejects the send. */
const DEFAULT_FROM = "Senken Engineering <no-reply@senkenindia.in>";

/** Firebase's reset links are valid for one hour; the copy says so, so keep them in step. */
const LINK_VALID_HOURS = 1;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Employee names come from Firestore and are typed by admins, so they are not trusted
 * markup. Without this, a name containing "<" silently breaks the email body — and the
 * link sits right below it.
 */
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Builds the reset email. Pure, so the wording and — more importantly — the escaping
 * are testable without touching the network.
 *
 * The plain-text part is not a courtesy: a good share of the workforce reads mail on
 * low-end Android clients, and a link that only exists inside an HTML <a> is a link they
 * cannot use. It appears as a bare URL in both parts.
 */
function renderResetEmail({ name, link }) {
  const who = String(name || "").trim();
  const greeting = who ? `Hello ${who},` : "Hello,";

  const subject = "Reset your WhiteCoffee password";

  const text = [
    greeting,
    "",
    "Someone asked to reset the password for your WhiteCoffee account.",
    "Open this link to choose a new one:",
    "",
    link,
    "",
    `The link stops working in ${LINK_VALID_HOURS} hour.`,
    "",
    "If this wasn't you, ignore this email — your password has not changed.",
    "",
    "— Senken Engineering",
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    "<p>Someone asked to reset the password for your WhiteCoffee account.</p>",
    `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
    "<p>If the button above does not work, copy this address into your browser:<br>",
    `<span>${escapeHtml(link)}</span></p>`,
    `<p>The link stops working in ${LINK_VALID_HOURS} hour.</p>`,
    "<p>If this wasn't you, ignore this email — your password has not changed.</p>",
    "<p>— Senken Engineering</p>",
  ].join("\n");

  return { subject, text, html };
}

/**
 * The entire provider-specific surface. Replace this one function to change providers.
 * Throws on a non-2xx so the caller can log a failure; the thrown message deliberately
 * carries the provider's status text only — never the body we sent, which contains the
 * reset link.
 */
async function postToProvider({ apiKey, from, to, subject, text, html }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });

  if (!res.ok) {
    // Read the provider's error for the log, but cap it — a runaway body should not
    // become a runaway log entry.
    const detail = await res.text().catch(() => "");
    throw new Error(`Email provider returned ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * Sends one password-reset email. Returns nothing on success and throws on failure;
 * callers must decide whether a failure is worth surfacing (for the self-service
 * endpoint it is NOT — see requestPasswordReset).
 */
async function sendPasswordResetEmail({ apiKey, to, name, link, from = DEFAULT_FROM }) {
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured; no email was sent.");
  const { subject, text, html } = renderResetEmail({ name, link });
  await postToProvider({ apiKey, from, to, subject, text, html });
}

module.exports = {
  renderResetEmail, sendPasswordResetEmail, escapeHtml,
  DEFAULT_FROM, LINK_VALID_HOURS, RESEND_ENDPOINT,
};
