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
