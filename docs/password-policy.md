# Password policy — one path, on purpose

**Decided 2026-08-05.** A password on this system is set in exactly one place: an admin,
signed in to the portal, on `/users` → edit an employee → **Set a new password**.

There is no self-service reset, no emailed reset link, and no CLI script. All three
existed in the tree at one point and were **deliberately removed**, not lost. This
document is here so that nobody — including a future Claude session — reads their absence
as an unfinished feature and helpfully rebuilds one.

## Why there is no emailed reset

Staff sign in with their employee ID. Firebase Auth requires an email as the account key,
so the ID is expanded to `<empId>@whitecoffee.internal` (`resolveLoginEmail`, mirrored in
`admin/src/lib/constants.ts` and the Android app).

That domain **has no mail server behind it**. It is a login key, not a mailbox.

This matters because Firebase's built-in `sendPasswordResetEmail()` delivers to *the
account's Auth address* and offers no way to redirect. For most of the company it would
send mail into the void, silently and successfully.

The synthetic address is not an accident to be undone. Company email addresses get
recycled between employees, so email cannot be a stable identity — that is the whole
reason ID login exists. And an Auth account has one email with no aliases, so pointing it
at a real inbox costs you the ID login: on 2026-07-31, changing one employee's Auth email
to a personal Gmail address silently killed `S463` as a login, and Firebase's
email-enumeration protection made the failure indistinguishable from a wrong password.

## Why the alternatives were dropped

| Removed | Why it was built | Why it is gone |
|---|---|---|
| `generatePasswordResetLink` callable + "Send a reset link" button | Admin mints a link, employee redeems it and picks their own password — no password is ever transcribed | Real improvement, but it is a *second* way to set a password. Two paths means an admin has to know which is authoritative, and a half-remembered flow is how the 2026-07-31 lockouts happened in the first place. |
| `requestPasswordReset` (unauthenticated) + "Forgot password?" on `/login` | Employee resets with no admin in the loop | Needs email delivery to a `contactEmail`, which needs a paid provider and SPF/DKIM on `senkenindia.in`. **Not one active employee had a usable `contactEmail`** when this was audited, so it would have delivered nothing for everyone. |
| `firebase/scripts/set-passwords.js` | Emergency terminal reset | A second privileged path, usable outside the audit log, requiring ADC on someone's laptop. |
| `mailer.js` (Resend) | Transport for the above | Nothing left to transport. |

## If you are about to add one back

Fine — but know what you are taking on.

- **An unauthenticated endpoint is account takeover unless the link is delivered
  out-of-band to an address the requester already controls.** Employee IDs are sequential
  (`S001`…`S999`). "Type an ID, get a link" hands over every account in the company.
- If it returns a different message for "no such account" than for "sent", it is an
  enumeration oracle — one constant reply for every outcome, or it is not safe.
- Rate limits must record attempts for **every** identifier, real or not. Throttling only
  real accounts makes the throttle itself the oracle.
- It needs a `contactEmail` backfill first. As of 2026-08-05 the field is empty for every
  active employee, so the feature would be dead on arrival regardless of the code.

The removed implementation handled all of this and is recoverable from git history —
`d04bac4 feat(auth): self-service password reset, with nobody in the loop`. Start there
rather than from scratch.

## The one path that exists

`admin/src/app/(admin)/users/page.tsx` → `handleResetPassword`
→ `admin/src/lib/passwordReset.ts` (`resolveResetPassword`, unit-tested)
→ `resetUserPassword` in `admin/src/lib/firestore.ts`
→ `exports.resetUserPassword` in `firebase/functions/index.js` (admin-gated, Admin SDK).

⚠️ **Ask first, write second.** `window.prompt` renders an *editable* box, so the password
the admin types is the one that must land on the account. The original flow set a random
password and then discarded the prompt's return value, which meant the password handed to
the employee was never the one on the account. That cost an hour across two new hires on
2026-07-31. `passwordReset.ts` exists solely to keep that ordering testable — read its
header before touching this flow.

**Pair with "Sign out of all devices"** (`revokeUserSessions`) when a password may be
known to someone else. Resetting the password alone does not end existing sessions.
