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
| 1 | 🔴 Critical | **Attendance forgery.** `allow create` on attendance events had zero field validation; timestamps are client-supplied; no mock-location detection anywhere. Any employee could write punches with any time, any GPS, any date, backdated. | Fixed (bounded + scored) |
| 2 | 🔴 High | **No self-approval guard anywhere.** A scoped manager approved their own leave, own OT, own settlement cash, own attendance status. | Fixed |
| 3 | 🟠 High | **`attendance_status` collection-group write.** A second door that could not enforce the self-approval guard, silently reopening #2. | Fixed |
| 4 | 🟠 Medium | **Salary readable company-wide.** Nine of ten grantable tabs read user docs to resolve names; pay sat on the same document. | Fixed |
| 5 | 🟠 Medium | **Holidays writable from `/attendance`.** One write makes the scorer skip a day for *every* employee. | Fixed |
| 6 | 🟠 Medium | **Conveyance self-dealing.** Money-bearing, no owner check. | Fixed |
| 7 | 🟡 Low | **Leave payload unvalidated.** Inverted ranges, 500-day claims, malformed dates all accepted. | Fixed |
| 8 | 🟡 Low | **Notification self-injection.** A user could forge company-looking messages into their own feed and rewrite delivered ones. | Fixed |
| 9 | 🟡 Low | **No audit on manual status overwrites.** Punch deletion snapshots to `attendance_corrections`; status overwrites had no equivalent. | Fixed (global audit log) |

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
cd firebase/rules-tests && npm test    # 63 tests, boots the Firestore emulator
cd firebase/functions   && npm test    # 128
cd android && ./gradlew :app:testDebugUnitTest --rerun-tasks   # 60
cd admin && npx tsx src/lib/compensation.test.ts   # 14
```

`firebase/rules-tests/` contains: `baseline.test.js` (guarantees that already held, so
hardening cannot lock out a legitimate user), `self-approval.test.js`,
`compensation.test.js`, `hardening.test.js`, `punch.test.js`.

## Attendance punches (finding #1)

**Punches stay a CLIENT write, deliberately.** `AttendanceRepository.recordEvent` calls
`ref.set(...)` *without awaiting it* — the Firestore SDK persists locally and syncs on
reconnect, which is what makes check-in work offline at a site with no signal. Routing
punches through a callable would require connectivity and would **lose** those punches.
So the write is bounded in rules and scored on arrival instead.

**Rules bound what can be written:** the eight real punch types only; the timestamp must
be no more than 5 minutes in the future (clock skew) and no more than **12 hours** in the
past (the offline window); `date` must be well-formed and coordinates numeric. Backdating
a month of attendance is now impossible.

A genuine punch that misses the 12-hour window is **not lost** — Regularization is the
existing recovery path for a missed punch.

**The `onPunchWritten` trigger records a verdict, never a rejection.** It corrects `date`
from the trusted timestamp (rules have no timezone arithmetic, and the scorer queries by
`date`, so a forged `date` would reassign a punch to another day), measures distance from
the site geofence, reports client/server clock skew, and flags mock locations. A punch
outside a geofence is still recorded: GPS drifts indoors and a site's stored coordinates
may be wrong, so refusing it would cost a real employee a real day's pay.

**This is detection, not prevention — by necessity.** Offline support and hard prevention
are mutually exclusive here. The bounds remove the high-value forgery (backdating); the
verdict makes the rest visible and attributable.

## Audit log

Two triggers cover the database, because Firestore path patterns match a **fixed depth**:
`{collection}/{docId}` catches every top-level document (`users/{uid}` included) and
`users/{userId}/{collection}/{docId}` catches every subcollection document. A third
`users/{userId}` trigger would double-audit every user write.

Each `audit_log` entry carries path, collection, owning user, change type, changed keys,
and full **before/after** snapshots.

- **`audit_log` excludes itself** (`auditLog.js`). Without that guard the trigger audits
  its own writes and recurses without bound, billing every cycle.
- **Nobody can write it, including admin** (`allow write: if false`). An audit log a
  suspect can edit is not evidence. Only the Admin SDK triggers write there. Read is
  admin-only, because entries contain full snapshots including pay.
- **Credentials are redacted** (`fcmToken`, `activeSessionToken`); **pay is not** — "who
  changed a salary from what to what" is the question this log exists to answer.

### Who made the change

Firestore triggers carry **no auth context** — a trigger sees the document, not the
identity that wrote it. So both clients now stamp `lastModifiedBy` (the auth uid) and
`lastModifiedAt` on every write: 21 call sites in the portal, 14 in the Android app.

Six call sites sit under rules that pin the write to an exact key set via
`changedKeysWithin`, which is ANDed onto **both** branches — even admin does not escape
it. A third key would have made those writes `PERMISSION_DENIED`, silently breaking login,
push delivery, the notification badge, photo uploads, and Site ID entry. Those rules were
therefore widened to admit the two stamp fields, guarded by `stampIsTruthful()`: a client
writing **someone else's** uid is denied, so the self-reported actor cannot be forged.

**Enforcement is staged.** Requiring the stamp database-wide today would deny any write
path that misses it. Clients stamp first → the audit log confirms coverage → enforcement
follows. Same discipline as the pay migration, for the same reason.

### There is no IP address, and no code can add one

Firestore security rules have **no `request.ip`**, and neither do triggers. Both clients
write through the client SDK, so no server sees the connection. `lastModifiedBy` tells you
*which user account* made every change; it cannot tell you from which network.

The only mechanism that captures caller IP for client-SDK writes is **GCP Cloud Audit Logs
(Data Access) for Firestore** — console configuration, not code, billed by volume with a
default 30-day retention. Not enabled; deliberately deferred.

### Cost note

The audit log records **every** write, so it roughly **doubles write volume**. That was a
deliberate choice ("everything writable" scope) over auditing only money-and-approvals.
Worth revisiting if the Firestore bill moves noticeably.

## Still open

- **Database-wide enforcement of `lastModifiedBy`** — the stamp is written everywhere but
  only *enforced* on the six widened rules. Turn it on globally once the audit log shows
  full coverage.
- **GCP Cloud Audit Logs** for real IP capture, if you want network-level forensics.
- **Mock-location flags are recorded but nothing surfaces them** — no portal view lists
  flagged punches yet, so today they are only visible in Firestore or the function logs.
