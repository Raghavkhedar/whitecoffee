# Handoff → whitecoffee-admin session

Paste this whole file into the Claude Code session running in the `whitecoffee-admin` repo,
or run: **"Read ADMIN_HANDOFF.md and implement the admin-portal changes against the real files."**
It is self-contained — you do not need any context from the Android-app session.

---

## Background

The White Coffee Android app (Senken Engineering field-ops app; Firebase Auth + Firestore) had a
problem: company email addresses get recycled between employees (one mailbox per phone number), and
login was keyed on email, so a new hire given a recycled address inherited the previous person's
data. All app data is keyed on the Firebase Auth **UID** (`users/{uid}/...`), so isolation is fine —
the only issue is identity being tied to a reusable email.

**Decision:** switch new hires to **synthetic employee-ID logins**. A new hire logs in with just
their employee ID, which becomes a synthetic Firebase Auth email `‹empId›@whitecoffee.internal`
(never a real mailbox — a login key only). New hire = new employee ID = new synthetic email = new
UID = clean data. **Scope: new hires only** — existing users keep logging in with their real email,
no migration.

## Already DONE on the Android side (the contract you must match)

`AuthRepository.login()` now resolves the typed identifier before `signInWithEmailAndPassword`:
- input contains `@` → used as-is (existing real-email users)
- otherwise → `‹id›@whitecoffee.internal` (lowercased, trimmed)

Constant on the Android side: `LOGIN_EMAIL_DOMAIN = "whitecoffee.internal"`. **You must use the exact
same domain** when creating accounts, or new hires can't log in.

---

## YOUR TASKS (whitecoffee-admin)

> This portal creates users **client-side via a secondary Firebase app** (admin stays logged in).
> The client SDK **cannot** disable another user's account or set someone else's password — those are
> Admin SDK only. So offboarding + password reset must be **Cloud Functions**. Everything else is
> frontend. Adapt the file paths / function names below to what actually exists in this repo — read
> the real Users page, `types`, `firestore` helper, and `functions/` first.

### 1. Shared constant
```ts
// e.g. src/lib/constants.ts — MUST equal the Android app's LOGIN_EMAIL_DOMAIN
export const LOGIN_EMAIL_DOMAIN = "whitecoffee.internal";
export const syntheticLoginEmail = (empId: string) =>
  `${empId.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
```

### 2. User type
Add to the `User` interface (e.g. `src/types/index.ts`):
```ts
email: string;          // now the SYNTHETIC login email for new hires
contactEmail?: string;  // real email/phone — notifications only, NOT login
active?: boolean;       // default true; MISSING must be treated as active
```

### 3. User-creation change (Users page add-modal)
- Make **Employee ID required**; add an optional **Contact email** field; the real email is no
  longer a login credential.
- Block reusing an employee ID an ACTIVE user still holds.
```ts
const loginEmail = syntheticLoginEmail(employeeId);
const dupe = await getDocs(query(collection(db, "users"),
  where("employeeId", "==", employeeId.trim()),
  where("active", "==", true)));
if (!dupe.empty) throw new Error("An active user already has this Employee ID");

const cred = await createUserWithEmailAndPassword(secondaryAuth, loginEmail, tempPassword);
await setDoc(doc(db, "users", cred.user.uid), {
  employeeId: employeeId.trim(),
  name, role, salaryRate,
  email: loginEmail,                 // synthetic
  contactEmail: contactEmail ?? "",  // real, optional
  active: true,
  createdAt: serverTimestamp(),
});
await secondaryAuth.signOut();
```

### 4. Offboarding — Cloud Function (Admin SDK)
```ts
// functions/src/index.ts
export const setUserActive = onCall(async (req) => {
  assertAdmin(req);                                          // verify caller is admin
  const { uid, active } = req.data;
  await admin.auth().updateUser(uid, { disabled: !active }); // blocks login server-side
  await admin.firestore().doc(`users/${uid}`).update({ active });
});
```
Frontend "Deactivate" button → `httpsCallable(fns, "setUserActive")({ uid, active: false })`.
**Never delete** a user or their data — attendance/salary history must be retained. New hires get a
new employee ID → new UID, so the old email never needs freeing.

### 5. Admin password reset — Cloud Function (Admin SDK)
```ts
export const resetUserPassword = onCall(async (req) => {
  assertAdmin(req);
  const { uid, newPassword } = req.data;
  await admin.auth().updateUser(uid, { password: newPassword });
});
```
Synthetic emails can't receive reset links, so a "Reset password" button calls this and shows the
admin a new temp password to hand over.

### 6. Filter out inactive users — "new hires only" gotcha
Existing users have **no `active` field**, so `where("active","==",true)` would wrongly hide them all.
Filter in code with `u.active !== false` (missing = active) in: Users list, dashboards,
Submissions/Attendance views, and the `computeDailyAttendanceStatus` Cloud Function (skip
`user.active === false`).

---

## Shared contracts (keep both repos in sync)
- Synthetic domain: **`whitecoffee.internal`** (matches Android `AuthRepository.LOGIN_EMAIL_DOMAIN`).
- New user-doc fields: **`contactEmail`**, **`active`**.
- If you change any of these, tell the Android-app session so it stays matched.

## Net deliverables
2 new Cloud Functions (`setUserActive`, `resetUserPassword`) + Users-page frontend edits + the type
change + the constant. The user-creation change alone is enough to onboard new hires under the
scheme; offboarding + reset can follow.
