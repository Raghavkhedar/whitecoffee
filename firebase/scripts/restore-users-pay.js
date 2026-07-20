#!/usr/bin/env node
"use strict";

/**
 * Restore inline pay fields onto users/{uid} from a backup-users.js snapshot.
 *
 * This is the undo for `migrate-compensation.js --purge --commit`, the one irreversible
 * step in the security-hardening work. A backup nobody can restore from is not a backup,
 * so this exists and is meant to be dry-run BEFORE the purge, not discovered after it.
 *
 * Usage:
 *   node restore-users-pay.js <backup.json>            → dry run, prints what it WOULD write
 *   node restore-users-pay.js <backup.json> --commit   → writes the pay fields back
 *
 * Restores ONLY the four inline pay fields. It deliberately does not rewrite whole user
 * documents: anything else that changed since the backup (plBalance, tabAccess, active,
 * suspensionHistory) is legitimate newer data, and blanket-restoring would destroy it —
 * turning a recovery into a second, larger incident.
 *
 * Auth: Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.
 */

const fs = require("node:fs");
// firebase-admin lives in ../functions/node_modules — these scripts have no package.json
// of their own. Resolve it from there so the script runs from any working directory.
const admin = (() => {
  try { return require("firebase-admin"); }
  catch { return require(require("node:path").join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }
})();

const file = process.argv[2];
const COMMIT = process.argv.includes("--commit");

if (!file || file.startsWith("--")) {
  console.error("Usage: node restore-users-pay.js <backup.json> [--commit]");
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
const PAY_FIELDS = snapshot.inlinePayFields || ["salaryRate", "pfPercent", "esiPercent", "imprestPercent"];

admin.initializeApp({ projectId: snapshot.project || process.env.GCLOUD_PROJECT || "white-coffee-92c27" });
const db = admin.firestore();

async function main() {
  console.log(`\nRestore inline pay from ${file}`);
  console.log(`  taken ${snapshot.takenAt} · project ${snapshot.project} · ${snapshot.userCount} users`);
  console.log(`  mode: ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);

  let restored = 0, skipped = 0, missing = 0;

  for (const rec of snapshot.users || []) {
    const pay = {};
    for (const f of PAY_FIELDS) {
      const v = rec.user ? rec.user[f] : undefined;
      if (typeof v === "number" && isFinite(v)) pay[f] = v;
    }
    if (Object.keys(pay).length === 0) { skipped++; continue; }

    const ref = db.doc(`users/${rec.uid}`);
    const live = await ref.get();
    if (!live.exists) {
      // A user deleted since the backup is NOT recreated — resurrecting an offboarded
      // employee would be its own data problem.
      console.log(`  MISSING ${rec.uid} (${rec.employeeId || "?"}): user no longer exists — skipped`);
      missing++;
      continue;
    }

    console.log(`  restore ${rec.uid} (${rec.employeeId || "?"}): ${PAY_FIELDS.map((f) => `${f}=${pay[f] ?? "-"}`).join(" ")}`);
    if (COMMIT) await ref.update(pay);
    restored++;
  }

  console.log(`\n${COMMIT ? "restored" : "would restore"} ${restored} · skipped ${skipped} (no pay in backup)` +
    (missing ? ` · MISSING ${missing}` : ""));
  if (!COMMIT) console.log("Dry run — nothing written. Re-run with --commit.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
