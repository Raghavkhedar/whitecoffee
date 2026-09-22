# Superadmin Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `superAdmin` boolean flag to `users/{uid}` that lets `firestore.rules` grant that user read/write on every path in the database except `audit_log`.

**Architecture:** One new helper function (`isSuperAdmin()`) and one new catch-all `match /{document=**}` block in `firebase/firestore.rules`. Firestore ORs every matching rule for a given path, so this is purely additive — none of the ~30 existing per-collection match blocks change. A one-off Admin-SDK script provisions the flag (no portal UI). The `firebase/rules-tests` emulator suite is the only automated proof this works and doesn't leak.

**Tech Stack:** Firestore Security Rules v2, `@firebase/rules-unit-testing` + Node's built-in `node:test` runner (rules-tests), `firebase-admin` (provisioning script), TypeScript (admin portal type).

**Spec:** `docs/superpowers/specs/2026-09-22-superadmin-role-design.md`

## Global Constraints

- `audit_log` must stay `allow write: if false` for every role, superadmin included — no exceptions, ever.
- No admin-portal UI for granting/revoking `superAdmin`. Provisioning is Console or the script in Task 3 only.
- No Android changes. Superadmin is portal-only and never appears in `RoleCapabilities.kt`.
- No change to `roleCapabilities.ts`/`.js`/`.kt` or the `Role` TypeScript union. `superAdmin` is a boolean flag orthogonal to `role`, not a new role value.
- Run the full `firebase/rules-tests` suite (`npm test` in that directory) before and after the rules change, per this repo's standing rule for any `firestore.rules` edit.

---

### Task 1: Write failing rules tests for the superadmin bypass (red)

**Files:**
- Modify: `firebase/rules-tests/helpers.js` (the `seedUsers` function, currently lines 62–76)
- Create: `firebase/rules-tests/superadmin.test.js`

**Interfaces:**
- Consumes: `helpers.js`'s existing exports — `setup`, `teardown`, `seedUsers`, `seedDocs`, `asUser`, `assertSucceeds`, `assertFails` (see `firebase/rules-tests/dailySpend.test.js` for the exact usage pattern this task follows).
- Produces: `seedUsers(env, { uid: { ..., superAdmin: true } })` — a new optional `superAdmin` key that later tasks (and this one) rely on to seed a superadmin fixture user.

- [ ] **Step 1: Confirm the baseline suite passes before touching anything**

Run: `cd firebase/rules-tests && npm test`
Expected: all existing tests pass, zero failures. This is the "before" baseline the project's standing rule requires.

- [ ] **Step 2: Add `superAdmin` passthrough to `seedUsers`**

In `firebase/rules-tests/helpers.js`, the `seedUsers` function currently writes:

```javascript
async function seedUsers(env, users) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, data] of Object.entries(users)) {
      await db.doc(`users/${uid}`).set({
        name: data.name || uid,
        employeeId: data.employeeId || uid.toUpperCase(),
        role: data.role || "operations",
        active: data.active !== false,
        salaryRate: data.salaryRate ?? 1000,
        ...(data.tabAccess ? { tabAccess: data.tabAccess } : {}),
      });
    }
  });
}
```

Change the `.set({...})` payload to also pass through an optional `superAdmin` field:

```javascript
async function seedUsers(env, users) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, data] of Object.entries(users)) {
      await db.doc(`users/${uid}`).set({
        name: data.name || uid,
        employeeId: data.employeeId || uid.toUpperCase(),
        role: data.role || "operations",
        active: data.active !== false,
        salaryRate: data.salaryRate ?? 1000,
        ...(data.tabAccess ? { tabAccess: data.tabAccess } : {}),
        ...(data.superAdmin !== undefined ? { superAdmin: data.superAdmin } : {}),
      });
    }
  });
}
```

- [ ] **Step 3: Write `firebase/rules-tests/superadmin.test.js`**

```javascript
"use strict";

/**
 * SUPERADMIN — users/{uid}.superAdmin === true
 * (docs/superpowers/specs/2026-09-22-superadmin-role-design.md)
 *
 * A superadmin bypasses every wall in firestore.rules EXCEPT audit_log. The 5 walls
 * exercised here are the only ones that block even isAdmin() today: attendance_corrections
 * update/delete, wo_ledger/{date}/settlements update/delete, dailySpend write, system/**
 * write (including the PL-accrual idempotency marker), and the Sunday/holiday rest-day
 * guard on attendance_status. This file also proves the bypass does NOT leak to an
 * ordinary admin (no flag) or to a non-admin employee — the catch-all's isSuperAdmin()
 * check must be doing real work, not accidentally always-true.
 *
 * SUNDAY = 2026-09-20, a Sunday distinct from the one rest-day.test.js already uses
 * (2026-09-13), so this file's fixtures never collide with another file's.
 */

const { test, before, after } = require("node:test");
const {
  setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

const SUNDAY = "2026-09-20";

before(async () => {
  env = await setup();
  await seedUsers(env, {
    superadmin: { role: "admin", name: "Superadmin", superAdmin: true },
    plainAdmin: { role: "admin", name: "Plain Admin" },
    plainEmp:   { role: "operations", name: "Plain Employee" },
  });
  await seedDocs(env, {
    "users/saEmp/attendance_corrections/c1": { reason: "test correction" },
    "users/saEmp/wo_ledger/2026-09-16": {
      date: "2026-09-16", userId: "saEmp", debitMins: 480, remainingMins: 480, status: "outstanding",
    },
    "users/saEmp/wo_ledger/2026-09-16/settlements/s1": {
      otDate: "2026-09-17", minsApplied: 50, appliedBy: "Admin",
    },
    "dailySpend/saEmp__2026-07-30": {
      userId: "saEmp", employeeId: "SAEMP", name: "SA Employee", role: "operations",
      date: "2026-07-30", month: "2026-07",
      salary: 1000, conveyance: 0, pf: 120, esi: 0, otWo: 0, imprest: 50,
      totalSpend: 830, frozen: false, computedAt: new Date().toISOString(),
    },
    "system/nightly_runs/computeDailyAttendanceStatus/2026-08-09": {
      date: "2026-08-09", activeUsers: 5, adminMarked: 0,
      expected: 5, scored: 5, plDeducted: 0, plAttempted: 0,
      failures: [], plFailures: [], ok: true,
    },
    "system/accruals/monthly/2026-08": { month: "2026-08", appliedTo: 5 },
    "audit_log/a1": { path: "users/saEmp", changeType: "update", actor: "saEmp" },
  });
});

after(async () => { await teardown(); });

// ── The 5 walls, bypassed for superadmin ────────────────────────────────

test("superadmin can update AND delete an attendance_corrections entry (immutable log for everyone else)", async () => {
  const db = asUser(env, "superadmin");
  await assertSucceeds(db.doc("users/saEmp/attendance_corrections/c1").update({ reason: "edited" }));
  await assertSucceeds(db.doc("users/saEmp/attendance_corrections/c1").delete());
});

test("superadmin can update AND delete a wo_ledger settlement entry (immutable log for everyone else)", async () => {
  const db = asUser(env, "superadmin");
  const ref = db.doc("users/saEmp/wo_ledger/2026-09-16/settlements/s1");
  await assertSucceeds(ref.update({ minsApplied: 999 }));
  await assertSucceeds(ref.delete());
});

test("superadmin can write dailySpend (Cloud-Function-only for everyone else)", async () => {
  await assertSucceeds(
    asUser(env, "superadmin").doc("dailySpend/saEmp__2026-07-30").set({ salary: 1 }, { merge: true })
  );
});

test("superadmin can write system/** including the PL-accrual idempotency marker", async () => {
  const db = asUser(env, "superadmin");
  await assertSucceeds(
    db.doc("system/nightly_runs/computeDailyAttendanceStatus/2026-08-09").set({ ok: false }, { merge: true })
  );
  // Deleting the accrual marker is exactly the double-pay hole this doc's immutability
  // exists to close — superadmin can open it, per the explicit design decision.
  await assertSucceeds(db.doc("system/accruals/monthly/2026-08").delete());
});

test("superadmin can write attendance_status on a Sunday (Protocol 1 rest-day guard, immutable for everyone else)", async () => {
  await assertSucceeds(
    asUser(env, "superadmin").doc(`users/saEmp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "saEmp", status: "Present", markedBy: "admin" })
  );
});

// ── audit_log — the one wall that stays closed, even for superadmin ─────

test("superadmin CANNOT write audit_log — the one exception", async () => {
  const db = asUser(env, "superadmin");
  await assertFails(db.doc("audit_log/a2").set({ path: "forged" }));
  await assertFails(db.doc("audit_log/a1").update({ actor: "someone else" }));
  await assertFails(db.doc("audit_log/a1").delete());
});

// ── Regression: the bypass must not leak to non-superadmin roles ────────

test("an ordinary admin (no superAdmin flag) is still blocked from all 5 walls, exactly as before", async () => {
  const db = asUser(env, "plainAdmin");
  await assertFails(db.doc("users/saEmp/attendance_corrections/c1").update({ reason: "x" }));
  await assertFails(db.doc("users/saEmp/wo_ledger/2026-09-16/settlements/s1").update({ minsApplied: 1 }));
  await assertFails(db.doc("dailySpend/saEmp__2026-07-30").set({ salary: 1 }, { merge: true }));
  await assertFails(db.doc("system/accruals/monthly/2026-08").delete());
  await assertFails(
    db.doc(`users/saEmp/attendance_status/${SUNDAY}`)
      .set({ date: SUNDAY, userId: "saEmp", status: "WO", markedBy: "admin" })
  );
});

test("a non-admin, non-superadmin employee is still blocked from an arbitrary path they never had access to", async () => {
  // compensation/current is the pay document — normally admin/settlements-manager only.
  await seedDocs(env, {
    "users/saEmp/compensation/current": { salaryRate: 5000, pfPercent: 12, esiPercent: 0, imprestPercent: 0 },
  });
  await assertFails(asUser(env, "plainEmp").doc("users/saEmp/compensation/current").get());
  await assertFails(
    asUser(env, "plainEmp").doc("users/saEmp/compensation/current").set({ salaryRate: 1 }, { merge: true })
  );
});
```

- [ ] **Step 4: Run the suite and confirm the RED state**

Run: `cd firebase/rules-tests && npm test`
Expected: the 6 "superadmin can ..." tests in `superadmin.test.js` FAIL (the rules don't know about `isSuperAdmin()` yet, so the seeded `superAdmin: true` flag has no effect and every one of those writes is still denied by the existing per-collection rules). The `audit_log` denial test and both regression tests PASS already — they describe behavior that's already true without any rules change. Every pre-existing test file's tests still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add firebase/rules-tests/helpers.js firebase/rules-tests/superadmin.test.js
git commit -m "$(cat <<'EOF'
test(rules): add failing superadmin bypass tests

Red phase for the superAdmin flag: seeds a superadmin user and proves
the 5 walls that block even isAdmin() today aren't bypassed yet, while
the audit_log denial and non-superadmin regression cases already pass.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Implement the `firestore.rules` change (green)

**Files:**
- Modify: `firebase/firestore.rules:19-21` (add `isSuperAdmin()` right after `isAdmin()`)
- Modify: `firebase/firestore.rules` (add the catch-all match block immediately before the `── /audit_log/{docId}` comment, currently starting at line 672)

**Interfaces:**
- Consumes: nothing new — reads the `superAdmin` field `seedUsers` (Task 1) now writes onto `users/{uid}`.
- Produces: `isSuperAdmin()`, a rules helper function other rules could reference later (none do in this plan — the catch-all is the only consumer).

- [ ] **Step 1: Add the `isSuperAdmin()` helper**

In `firebase/firestore.rules`, immediately after the existing `isAdmin()` function:

```
    function isAdmin() {
      return userRole() == 'admin';
    }
```

insert:

```
    // Superadmin — the single top privilege tier, bypasses every wall below except
    // audit_log (docs/superpowers/specs/2026-09-22-superadmin-role-design.md). Provisioned
    // ONLY via Firebase Console or firebase/functions/scripts/setSuperAdmin.js — never
    // exposed in the portal UI, because isAdmin() already has unrestricted field-level
    // write on users/{uid} (no notSelf guard there), so a UI toggle would let any admin
    // one-click promote themselves.
    function isSuperAdmin() {
      return isLoggedIn()
        && get(/databases/$(database)/documents/users/$(request.auth.uid))
             .data.get('superAdmin', false) == true;
    }
```

- [ ] **Step 2: Add the catch-all match block**

In `firebase/firestore.rules`, find the comment block that starts the audit_log section:

```
    // ── /audit_log/{docId} — before/after record of every write ─────────
```

Insert this new block immediately BEFORE that comment (i.e. as the last thing inside `match /databases/{database}/documents { ... }` before the audit_log section, right after the closing `}` of the `regularization_requests` collectionGroup match):

```
    // ── Superadmin bypass — must stay physically adjacent to audit_log below ─────
    // Firestore ORs every matching rule for a given path, so this is purely additive: it
    // does not touch any of the ~30 per-collection match blocks above, and a superadmin
    // gets extra access without any of them changing. audit_log is excluded by path so
    // `allow write: if false` on it (immediately below) still applies to superadmin —
    // every other write a superadmin makes is still recorded there as evidence. A typo
    // here (e.g. dropping the `!=`) would silently open audit_log writes to superadmin —
    // see superadmin.test.js's audit_log-denial case, which exists specifically to catch
    // that.
    match /{document=**} {
      allow read, write: if isSuperAdmin() && document[0] != 'audit_log';
    }

```

(The blank line before the pre-existing `// ── /audit_log/{docId} ...` comment keeps the visual section spacing consistent with the rest of the file.)

- [ ] **Step 3: Run the full suite and confirm GREEN**

Run: `cd firebase/rules-tests && npm test`
Expected: every test passes — all pre-existing tests (unchanged) AND every test in `superadmin.test.js` from Task 1, including the audit_log denial and both regression tests.

- [ ] **Step 4: Deploy-verify the rules are syntactically valid (does not deploy)**

Run: `cd firebase && firebase deploy --only firestore:rules --dry-run` if the installed CLI version supports `--dry-run`; otherwise skip this step — the emulator run in Step 3 already compiles and loads the same rules file, which is the real correctness check. Do NOT run a real `firebase deploy` as part of this task — deployment is a separate, explicit action for the human operator to trigger.

- [ ] **Step 5: Commit**

```bash
git add firebase/firestore.rules
git commit -m "$(cat <<'EOF'
feat(rules): add superadmin bypass, audit_log excepted

isSuperAdmin() + a catch-all match block grant users/{uid}.superAdmin
read/write on every path except audit_log. Additive only — no existing
match block changes, since Firestore ORs every matching rule for a
path. See docs/superpowers/specs/2026-09-22-superadmin-role-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Provisioning script

**Files:**
- Create: `firebase/functions/scripts/setSuperAdmin.js`
- Create: `firebase/functions/scripts/setSuperAdmin.test.js`

**Interfaces:**
- Consumes: `firebase-admin` (already a dependency of `firebase/functions`, per its `package.json`).
- Produces: `parseArgs(argv)` and `describeUser(uid, userData)`, both pure functions, exported for the test file and reused by nothing else in this plan.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `firebase/functions/scripts/setSuperAdmin.test.js`:

```javascript
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { parseArgs, describeUser } = require("./setSuperAdmin");

test("parseArgs: requires --project", () => {
  assert.throws(() => parseArgs([]), /--project/);
});

test("parseArgs: requires --uid", () => {
  assert.throws(() => parseArgs(["--project", "p1"]), /--uid/);
});

test("parseArgs: reads --project and --uid, apply defaults to false", () => {
  const args = parseArgs(["--project", "white-coffee-92c27", "--uid", "u1"]);
  assert.deepStrictEqual(args, { project: "white-coffee-92c27", uid: "u1", apply: false });
});

test("parseArgs: --apply flips apply to true regardless of position", () => {
  const args = parseArgs(["--apply", "--project", "p1", "--uid", "u1"]);
  assert.strictEqual(args.apply, true);
});

test("parseArgs: rejects an unrecognized flag", () => {
  assert.throws(() => parseArgs(["--project", "p1", "--uid", "u1", "--bogus"]), /unrecognized argument/);
});

test("describeUser: refuses a nonexistent user", () => {
  const out = describeUser("ghost", null);
  assert.match(out, /No users\/ghost document exists/);
});

test("describeUser: reports a normal admin as not yet superAdmin", () => {
  const out = describeUser("u1", { name: "Raghav", role: "admin", employeeId: "E1" });
  assert.match(out, /role:\s+admin/);
  assert.match(out, /superAdmin: not set/);
  assert.match(out, /would set superAdmin: true/);
});

test("describeUser: reports a user who already has the flag as a no-op", () => {
  const out = describeUser("u1", { name: "Raghav", role: "admin", employeeId: "E1", superAdmin: true });
  assert.match(out, /already set/);
  assert.match(out, /no change needed/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd firebase/functions && node --test scripts/setSuperAdmin.test.js`
Expected: FAIL — `Cannot find module './setSuperAdmin'` (the file doesn't exist yet).

- [ ] **Step 3: Write `firebase/functions/scripts/setSuperAdmin.js`**

```javascript
"use strict";

/**
 * One-off: grant the superAdmin flag to a single user
 * (docs/superpowers/specs/2026-09-22-superadmin-role-design.md).
 *
 * Deliberately NOT wired into any menu, cron, or the admin portal UI — isAdmin() already
 * has unrestricted field-level write on users/{uid} (no notSelf guard on that branch of
 * the update rule), so a UI toggle would let any existing admin one-click promote
 * themselves. Run by hand, once per grant, by whoever holds Firebase project IAM access.
 *
 *   node scripts/setSuperAdmin.js --project white-coffee-92c27 --uid <uid>            (dry run)
 *   node scripts/setSuperAdmin.js --project white-coffee-92c27 --uid <uid> --apply
 *
 * Dry run (the default) reads the target user and prints what would change, but writes
 * NOTHING — the same safety convention as backfillNightlyDate.js and
 * migrateLegacyLeaveStatuses.js in this directory.
 */

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") args.project = argv[++i];
    else if (a === "--uid") args.uid = argv[++i];
    else if (a === "--apply") args.apply = true;
    else throw new Error(`unrecognized argument: ${a}`);
  }
  if (!args.project) throw new Error("--project <id> is required");
  if (!args.uid) throw new Error("--uid <uid> is required");
  return args;
}

/**
 * Pure formatter for the pre-write confirmation printout. No Firestore/Admin SDK here,
 * so this is unit-testable without the emulator or a live project.
 */
function describeUser(uid, userData) {
  if (!userData) {
    return `No users/${uid} document exists — refusing (cannot grant superAdmin to a nonexistent user).`;
  }
  const already = userData.superAdmin === true;
  return [
    `users/${uid}`,
    `  name:       ${userData.name ?? "(unset)"}`,
    `  role:       ${userData.role ?? "(unset)"}`,
    `  employeeId: ${userData.employeeId ?? "(unset)"}`,
    `  superAdmin: ${already ? "true (already set)" : "not set"}`,
    already ? "  -> no change needed, already superAdmin." : "  -> would set superAdmin: true",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: args.project });
  const db = admin.firestore();

  const ref = db.doc(`users/${args.uid}`);
  const snap = await ref.get();
  const userData = snap.exists ? snap.data() : null;

  console.log(describeUser(args.uid, userData));

  if (!userData) process.exit(1);
  if (userData.superAdmin === true) return;

  if (!args.apply) {
    console.log("\nDry run only — rerun with --apply to write this change.");
    return;
  }

  await ref.set({ superAdmin: true }, { merge: true });
  console.log(`\nWrote users/${args.uid}.superAdmin = true.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseArgs, describeUser };
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `cd firebase/functions && node --test scripts/setSuperAdmin.test.js`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Run the full functions test suite to confirm no regressions**

Run: `cd firebase/functions && npm test`
Expected: PASS — the pre-existing suite plus the new `setSuperAdmin.test.js` file (Node's test runner auto-discovers `*.test.js` under `scripts/`, matching how `backfillNightlyDate.test.js` and `migrateLegacyLeaveStatuses.test.js` are already picked up).

- [ ] **Step 6: Commit**

```bash
git add firebase/functions/scripts/setSuperAdmin.js firebase/functions/scripts/setSuperAdmin.test.js
git commit -m "$(cat <<'EOF'
feat(functions): add setSuperAdmin provisioning script

One-off, dry-run-by-default script to grant users/{uid}.superAdmin,
matching the backfillNightlyDate.js / migrateLegacyLeaveStatuses.js
convention. Deliberately not wired into any UI — see the design spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Document the field on the admin portal's `User` type

**Files:**
- Modify: `admin/src/types/index.ts` (the `User` interface, currently starting at line 12)

**Interfaces:**
- Consumes: nothing.
- Produces: `User.superAdmin?: boolean` — a type-level acknowledgment of the field. Nothing in the admin portal reads or writes it (per the design's non-goals), so this is documentation-as-types, not new behavior.

- [ ] **Step 1: Add the field**

In `admin/src/types/index.ts`, the `User` interface has this line:

```typescript
  role: 'operations' | 'office' | 'admin' | 'sales';
```

Immediately after it (before the `tabAccess` comment/field that currently follows), add:

```typescript
  /** Top privilege tier, orthogonal to `role`. Bypasses every firestore.rules wall except
   *  audit_log. Console/script-provisioned ONLY (firebase/functions/scripts/
   *  setSuperAdmin.js) — there is deliberately no portal UI to grant or revoke this.
   *  See docs/superpowers/specs/2026-09-22-superadmin-role-design.md. Nothing in the
   *  portal currently reads this field. */
  superAdmin?: boolean;
```

- [ ] **Step 2: Type-check the admin portal**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors (this is an additive optional field on an existing interface — nothing consumes it yet, so nothing can break).

- [ ] **Step 3: Commit**

```bash
git add admin/src/types/index.ts
git commit -m "$(cat <<'EOF'
chore(admin): document superAdmin on the User type

Type-level acknowledgment of users/{uid}.superAdmin — no portal code
reads or writes it; see docs/superpowers/specs/2026-09-22-superadmin-role-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After all tasks

Run both full suites one last time from the repo root to confirm nothing drifted across tasks:

```bash
(cd firebase/rules-tests && npm test) && (cd firebase/functions && npm test) && (cd admin && npx tsc --noEmit)
```

Deploying the rules change (`firebase deploy --only firestore:rules` from the repo root) and running `setSuperAdmin.js --apply` against production are separate, explicit actions for you to trigger when ready — neither is part of this plan.
