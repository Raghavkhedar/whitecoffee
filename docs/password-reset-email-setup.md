# Self-service password reset — turning on email delivery

**Status: the code is deployed-ready and sends nothing.** `requestPasswordReset` runs end
to end, rate-limits correctly, and records every request — but with no API key and no
verified domain, every send fails and is logged as `outcome: "send-failed"`. Employees see
the same message they always see, which ends "contact your administrator". So the feature
degrades to today's behaviour rather than breaking anything; it just does not yet help.

Two things below are outside this repo. Until both are done, **do not tell staff the
feature exists** — a "Forgot password?" button that silently mails nothing is worse than
no button.

## Why this endpoint is allowed to be unauthenticated

`generatePasswordResetLink` (the admin-only one) carries a comment saying an
unauthenticated version would hand account takeover to anyone who can guess an employee
ID. That is true of an endpoint that **returns** the link. `requestPasswordReset` never
returns it — it mails the link to the `contactEmail` already on the employee's record, an
inbox the caller must already control. Guessing `S451` achieves nothing except sending
that person an email.

Three invariants keep that true. All three are unit-tested; breaking any one reopens the
hole:

1. **One reply for every outcome.** Not "no such user", not "no email on file", not
   "sent" — one constant string. Employee IDs are sequential, so a reply that varied by
   outcome would let anyone map the company by sweeping `S001`..`S999`.
2. **Attempts are recorded for every identifier, real or not.** Recording only for real
   accounts would make the throttle itself an oracle: getting rate-limited would prove the
   account exists.
3. **The link is never returned, never logged, never put in an error message.** It is a
   bearer credential — whoever holds it sets the password.

## Rate limits

| Scope | Cooldown | Window | Max |
|---|---|---|---|
| Per identifier | 60 s | 1 h | 3 |
| Per IP | 5 s | 1 h | 20 |

The IP budget is looser on purpose: a whole site office can share one connection, and it
must not lock itself out. Both live in `firebase/functions/selfServiceReset.js`.

## Step 1 — Verify a sending domain

Pick a provider. The code is written against **Resend** (plain HTTPS, no SDK), and the
entire provider surface is `postToProvider` in `firebase/functions/mailer.js` — swapping
to Brevo/SendGrid/Mailgun means rewriting that one function.

1. Create the account and add `senkenindia.in` as a sending domain.
2. Add the SPF and DKIM records the provider gives you to the `senkenindia.in` DNS zone.
3. Wait for the provider to report the domain **verified**.

⚠️ **This step is the one that silently ruins testing.** Before the domain is verified,
Resend accepts mail only to the account owner's own address. So it will appear to work
when you try it on yourself, and fail for every employee. Do not skip to step 3 and
conclude it works.

If the `From` address changes, update `DEFAULT_FROM` in `mailer.js` — it must be on the
verified domain or the provider rejects the send outright.

## Step 2 — Store the API key

```bash
firebase functions:secrets:set RESEND_API_KEY
# paste the key at the prompt; it is never written to a file or to shell history
firebase deploy --only functions:requestPasswordReset
```

The redeploy is required — a secret added after deploy is not visible to the running
function.

## Step 3 — Verify end to end

Use an employee who has a **real** `contactEmail`, not your own admin account, or step 1's
trap will fool you.

```bash
firebase functions:log --only requestPasswordReset
```

Expected: `requestPasswordReset: s### → sent`. Anything else is diagnostic:

| Log outcome | Meaning |
|---|---|
| `sent` | Handed to the provider successfully |
| `send-failed` | Key missing/wrong, or domain not verified — check the error line above it |
| `no-such-account` | The identifier does not resolve to an Auth account |
| `account-disabled` | Offboarded employee; deliberately not sent |
| `undeliverable:no-contact-email` | No address on record — admin must hand the link over |
| `undeliverable:contact-is-not-a-mailbox` | `contactEmail` is a `@whitecoffee.internal` login key |
| `undeliverable:contact-invalid` | `contactEmail` is not a valid address |

The `passwordResetRequests` collection carries the same outcomes with the identifier **as
typed**, which is how you find someone stuck on `S45O` with a letter O.

## Step 4 — Clean up contact addresses first

Delivery is only as good as `contactEmail`, and several records are wrong today. The
`/users` form now blocks new bad values, but it does not retro-fix existing rows. Known
bad at the time of writing:

- **S450** — `s450@whitecoffee.in` (a typo of the login domain; nobody owns `whitecoffee.in`)
- **S463, S464** — their `@whitecoffee.internal` login keys pasted into the contact field

Note the limit of the validation: it rejects addresses that are *provably* not mailboxes
(the synthetic login domain) and ones that are syntactically broken. It cannot reject an
address that is merely **wrong**, like `s450@whitecoffee.in`. Only a delivery attempt
proves an address works.

## Not yet done: the Android app

The "Forgot password?" entry point exists on the **admin portal only**. The app has no
Functions SDK dependency, and the people who actually get locked out are field staff on
phones — so this is a real gap, not a finished feature.

It was deliberately left out of **1.9**: until steps 1–2 are done the button would mail
nothing, and shipping a dead button to every phone for weeks is worse than shipping
nothing. Add it once delivery is verified — `implementation(libs.firebase.functions)`,
then call `requestPasswordReset` from `LoginViewModel` and show the returned message
verbatim (it is the same constant string for every outcome; do not reword it per-case, or
the app becomes the enumeration oracle the server refuses to be).
