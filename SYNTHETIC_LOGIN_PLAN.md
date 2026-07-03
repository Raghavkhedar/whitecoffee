# Synthetic Employee-ID Login — Implementation Plan

**Problem:** Company email addresses are recycled between employees (only one mailbox per phone
number). Because login was keyed on email, a new hire given a recycled address inherited the
previous person's app data.

**Decision (Session 31):**
- **Approach:** Synthetic employee-ID logins. New hires log in with their **employee ID**, which
  the app turns into a synthetic Firebase Auth email `‹empId›@whitecoffee.internal`. These are
  login keys only — never real mailboxes — so they never run out and a recycled real email can
  never collide with an account.
- **Scope:** **New hires only.** Existing users keep logging in with their real email. No migration.
- Data isolation is already correct: everything is keyed on the Firebase Auth **UID**
  (`users/{uid}/...`). A new person = new employee ID = new synthetic email = new Auth account =
  new UID = clean data. Nothing to migrate or clean.

---

## ✅ DONE — Android app (`WhiteCoffee01`, this repo)

- **`AuthRepository`** — added:
  - `const val LOGIN_EMAIL_DOMAIN = "whitecoffee.internal"` (companion object).
  - `fun resolveLoginEmail(identifier)` — if the input contains `@` it's used as-is (existing
    real-email users); otherwise it's treated as an employee ID → `‹id›@whitecoffee.internal`.
    Always lowercased + trimmed.
  - `login()` now calls `resolveLoginEmail(email)` before `signInWithEmailAndPassword`.
- **`LoginScreen`** — field label → "Email or Employee ID"; placeholder → "EMP001 or you@senken.in".
- **`LoginViewModel`** — blank-input message → "Please enter your email or employee ID."

> ⚠️ Not yet compiled/tested — build + smoke-test on the Windows setup (this Linux box has no JVM).
> Verify: an existing user logs in with their real email, and a test account created as
> `emp999@whitecoffee.internal` logs in when you type just `EMP999`.

---

## ⏳ TODO — Admin portal (`whitecoffee-admin`, separate repo — NOT on this machine)

This is where accounts are created/offboarded, so it's the substantive half.

### 1. User creation — mint the synthetic login email
When admin adds a new user (Users page → add modal):
- Require **Employee ID**. Normalize: `employeeId.trim().toLowerCase()`.
- **Reject** if any **active** user already has that employee ID (uniqueness = collision safety).
- Login email = `` `${normalizedEmpId}@whitecoffee.internal` `` — **MUST exactly match**
  `AuthRepository.LOGIN_EMAIL_DOMAIN` in the Android app. Keep it as a single shared constant.
- Create the Auth account with that synthetic email + an admin-set (or temporary) password.
- Write to `/users/{uid}`: `email` = synthetic login email (**lowercased** — the Android
  `User.fromDocument` lowercases it), `employeeId`, `name`, `role`, `active: true`, and
  `contactEmail` = the person's real email/phone if you want to reach them (see below).

### 2. New user-doc fields
- `contactEmail: string` (optional) — the real address for any human notifications. **Never used
  for login.** Keeps identity (synthetic email) separate from contact.
- `active: boolean` (default `true`).

### 3. Offboarding (when someone leaves)
- Set `active: false` on their user doc.
- **Disable** their Auth account via Admin SDK: `auth().updateUser(uid, { disabled: true })`.
  This blocks login server-side with **no Android change** — cleaner than an app-side check.
- **Do NOT delete** the account or data — attendance/salary/leave history must be retained. The
  old data stays under the old UID, untouched, because the next hire gets a brand-new UID.
- You never need to "free" the old email: new hires get a new employee ID → new synthetic email.

### 4. Password reset
- Synthetic emails can't receive reset links. Add a **"Reset password"** action on the Users page
  that calls Admin SDK `auth().updateUser(uid, { password: newTemp })` and shows the admin the
  temp password to hand over.

### 5. Filter out inactive users (recommended)
- Add `.where('active', '==', true)` (or filter in code) to active-user listings, dashboards, and
  the nightly `computeDailyAttendanceStatus` Cloud Function, so ex-employees stop appearing.

---

## Rules to never break
- **Employee IDs are permanent per human — never reuse them.** (Same principle that bit us with
  emails; reusing an ID would recreate the collision.)
- Keep employee IDs email-local-part-safe (alphanumeric, no spaces/`@`). `EMP001` is fine.
- The synthetic domain (`whitecoffee.internal`) must be identical in the Android app and the
  admin portal. Change one → change both, or new hires can't log in.
