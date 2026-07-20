# Security Audit & Hardening — 2026-07-20

**Branch:** `fix/security-hardening` · **Threat model:** an employee (or a scoped manager)
with legitimate credentials trying to pay themselves more, see what they shouldn't, or
forge a record.

## Why the rules are the whole boundary

Both clients — the Android app and the admin portal — talk to Firestore through the
**client SDK**. There is no API server in between. `firebase/firestore.rules` is therefore
not one layer of defence among several; **it is the defence**. Anything the rules permit,
an employee can do directly against the Firestore API with their own login, in about
twenty lines of JavaScript, bypassing every check in both applications.

Corollary that drove several decisions below: **Firestore rules are document-level.** There
is no field-level read control. If a rule lets you read a document, you read *every field*
in it.

## What was found

Rated by what an attacker actually gains, not by how exotic the bug is.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | 🔴 Critical | **Attendance forgery.** `allow create` on attendance events had zero field validation; timestamps are client-supplied (`AttendanceRepository.kt:114`); no mock-location detection anywhere. Any employee can write punches with any time, any GPS, any date, backdated. | **OPEN** — task #8 |
| 2 | 🔴 High | **No self-approval guard anywhere.** A scoped manager approved their own leave, own OT, own settlement cash, own attendance status. | Fixed |
| 3 | 🟠 High | **`attendance_status` collection-group write.** A second door that could not enforce the self-approval guard, silently reopening #2. | Fixed |
| 4 | 🟠 Medium | **Salary readable company-wide.** Nine of ten grantable tabs read user docs to resolve names; pay sat on the same document. | Fixed |
| 5 | 🟠 Medium | **Holidays writable from `/attendance`.** One write makes the scorer skip a day for *every* employee. | Fixed |
| 6 | 🟠 Medium | **Conveyance self-dealing.** Money-bearing, no owner check. | Fixed |
| 7 | 🟡 Low | **Leave payload unvalidated.** Inverted ranges, 500-day claims, malformed dates all accepted. | Fixed |
| 8 | 🟡 Low | **Notification self-injection.** A user could forge company-looking messages into their own feed and rewrite delivered ones. | Fixed |
| 9 | 🟡 Low | **No audit on manual status overwrites.** Punch deletion snapshots to `attendance_corrections`; status overwrites have no equivalent. | **OPEN** — task #9 |

### Verified clean — do not "fix" these

- **All four callable functions** (`onEmployeeLogout`, `setUserActive`, `resetUserPassword`,
  `updateUserEmail`) are gated by `assertAdmin`, which reads the role **from Firestore
  server-side** rather than trusting a client-supplied claim. Correct as written.
- **No committed secrets.** Keystores are gitignored. `google-services.json` is a *client
  config*, not a secret — it is meant to ship inside the app. (Do restrict the API key in
  the Firebase console, which is a separate control.)
- **Self-promotion was already airtight** — `changedKeysWithin(['activeSessionToken','fcmToken'])`
  on the user doc.
- **`sites` stays world-readable to signed-in users.** The app needs geofence coordinates
  to check in at all. This does hand an attacker the coordinates to spoof to, but hiding
  them is not the fix — location is client-supplied regardless. The real fix is #1.
- **`activeSessionToken` stays self-writable.** `AuthRepository` writes it on login. The
  worst a user achieves by tampering is failing to log *themselves* out.

## What changed

### Separation of duties (`notSelf`)

A scoped manager may no longer action their own record on any of: `leave_requests`,
`regularization_requests`, `attendance_status`, `planned_hours`, `ot_approvals`,
`settlements`, the five submission collections, and `conveyance`.

**Admin is deliberately exempt** (your decision). An admin can edit `salaryRate` directly,
so the guard buys nothing against them, and a single-admin company could otherwise never
approve the admin's own leave.

Collection-group paths use `notSelfDoc()`, which reads the owner from `resource.data.userId`
because `{userId}` is not bound by a `{path=**}` match.

> **The lesson worth keeping:** a `{path=**}` rule is a *second door* onto the same
> documents. `attendance_status` granted write there, could not enforce `notSelf`, and
> silently reopened the hole the per-doc rule closed. The test suite caught it. Whenever a
> per-doc rule is tightened, check whether a collection-group rule bypasses it.

### Pay split out of the user document

Because rules are document-level, narrowing `canReadUsers()` could not work — those nine
tabs genuinely need names and employee IDs. Pay therefore moved:

```
users/{uid}/compensation/current     admin + /ot-settlements read · admin write
```

The employee is **not** granted read on their own pay: `isOwner` would hand every employee
a live salary endpoint. Pay reaches them through the payroll exports.

Reads resolve through a pure resolver, mirrored per language (no shared JS build graph) and
unit-tested on both sides — `firebase/functions/compensation.js` and
`admin/src/lib/compensation.ts`. Fallback is **per field** to the legacy inline value, and
`0` is treated as a real value rather than as absent.

## Data-safety review

The user's explicit requirement was **no data loss**. Every destructive path was re-audited.

### Two data-loss bugs were found in this work and fixed before commit

Both were introduced by the compensation split, and both would have destroyed real payroll
data silently:

1. **`setCompensation` wrote all four pay fields with `|| 0` on every call.** Updating just
   `pfPercent` would have written `salaryRate: 0`, wiping the salary. `merge: true` does
   **not** protect against this — the field is present in the payload, explicitly set to 0.
   *Fixed:* only fields actually supplied are written.
2. **`updateUserProfile` coerced any non-number pay value to `0`.** A caller passing
   `salaryRate: undefined` would have zeroed it.
   *Fixed:* non-finite values are dropped, never coerced.

### Why the rest is non-destructive

- **Rule changes cannot delete data.** Tightening a rule denies a write; it never removes
  an existing document. The residual risk is a *blocked* legitimate write, which is why
  every change is covered by the emulator suite and why the two behaviour changes are
  called out below.
- **`setCompensation` uses `merge: true`** and never clears unlisted fields.
- **The migration copies before it removes**, in separately-invoked phases.
- **Leave validation was checked against the real client**: `ApplyLeaveViewModel` formats
  dates `yyyy-MM-dd` zero-padded and sends `totalDays` as an `Int`, so genuine submissions
  pass. A request longer than 366 days is now rejected.

### The migration is the only destructive operation

`firebase/scripts/migrate-compensation.js` is the sole thing in this branch that deletes
anything. Its guards:

- **Dry run by default.** Nothing is written without `--commit`.
- **Copy and purge are separate invocations.** Purge is never implied by copy.
- **Purge refuses per user** when the compensation doc does not already match the inline
  value for every field, and exits non-zero. A half-finished copy cannot be purged into
  data loss.
- Users with no inline pay are skipped, not zeroed.

## Deployment runbook

**Order is not optional. The failure mode of getting it wrong is employees paid ₹0.**

```bash
# 1. Functions FIRST — they must understand the new pay location before the portal
#    starts writing there. A new hire created by the new portal has pay ONLY in the
#    subcollection; an old function would read salaryRate as 0.
firebase deploy --only functions

# 2. Rules
firebase deploy --only firestore:rules     # from the REPO ROOT — the Firebase MCP tool
                                           # runs from the wrong cwd and silently
                                           # deploys nothing

# 3. Portal
cd admin && npm run deploy

# 4. Migrate pay — dry run first, read the output
node firebase/scripts/migrate-compensation.js
node firebase/scripts/migrate-compensation.js --commit

# 5. VERIFY a payroll run looks correct. Until step 6, pay is still on the user doc,
#    so the exposure is NOT yet closed — but nothing is lost either.

# 6. Only then remove the inline fields. This is the step that closes the exposure.
node firebase/scripts/migrate-compensation.js --purge --commit
```

Rollback: before step 6 the inline fields are still authoritative-capable, and the
resolver reads either location, so reverting the deploy restores previous behaviour with
no data work. **After step 6 the inline fields are gone** — that is the point of no easy
return, which is why step 5 exists.

## Two deliberate behaviour changes

1. **Marking a holiday is now admin-only.** If a non-admin currently does this, they will
   lose the ability. Revert to `canWriteHolidays()` if that does not match how you operate.
2. **A Leaves manager can now create notifications.** Required by partial leave approval,
   which tells the employee which days they are still expected at work.

## Test coverage

The boundary had **zero** automated coverage before this work. The existing `*Rules*.test.*`
files are attendance *business* logic, not security rules.

```bash
cd firebase/rules-tests && npm test    # 49 tests, boots the Firestore emulator
cd firebase/functions   && npm test    # 102
cd admin && npx tsx src/lib/compensation.test.ts   # 14
```

`firebase/rules-tests/` contains: `baseline.test.js` (guarantees that already held, so
hardening cannot lock out a legitimate user), `self-approval.test.js`,
`compensation.test.js`, `hardening.test.js`.

## Still open

- **#8 — attendance forgery (critical).** Needs a callable that stamps `request.time` and
  validates the geofence server-side, then `allow create: if false` on the client path.
  Requires an Android change and its own design pass. **This is the finding that most
  directly matches "an employee should not be able to hack the system"; everything else
  shipped here is real, but this one is still open.**
- **#9 — audit trail for manual `attendance_status` overwrites.** A manager can still
  overwrite another employee's computed payroll status with no record of who or why.
