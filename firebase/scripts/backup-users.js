#!/usr/bin/env node
"use strict";

/**
 * Back up every user document to a local JSON file BEFORE the compensation migration.
 *
 * The migration's `--purge` phase deletes the inline pay fields (salaryRate, pfPercent,
 * esiPercent, imprestPercent) from users/{uid}. That is the one irreversible step in the
 * security-hardening work. This snapshot is the undo.
 *
 * It captures the FULL user document, not just pay — a restore is only trustworthy if you
 * can see exactly what the document looked like, and pay fields are meaningless without
 * knowing which employee they belonged to. It also captures any existing
 * users/{uid}/compensation/current so a re-run is comparable.
 *
 * Usage:
 *   node backup-users.js                       → writes ./backups/users-<timestamp>.json
 *   node backup-users.js --out /path/file.json → explicit destination
 *
 * Read-only. This script never writes to Firestore.
 *
 * Auth: Application Default Credentials (`gcloud auth application-default login`) or
 * GOOGLE_APPLICATION_CREDENTIALS. The Admin SDK bypasses security rules.
 */

const fs = require("node:fs");
const path = require("node:path");
// firebase-admin lives in ../functions/node_modules — these scripts have no package.json
// of their own. Resolve it from there so the script runs from any working directory.
const admin = (() => {
  try { return require("firebase-admin"); }
  catch { return require(require("node:path").join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }
})();

const argv = process.argv.slice(2);
const outFlag = argv.indexOf("--out");
const PROJECT = process.env.GCLOUD_PROJECT || "white-coffee-92c27";

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const PAY_FIELDS = ["salaryRate", "pfPercent", "esiPercent", "imprestPercent"];

function outPath() {
  if (outFlag !== -1 && argv[outFlag + 1]) return path.resolve(argv[outFlag + 1]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(__dirname, "backups", `users-${stamp}.json`);
}

async function main() {
  console.log(`\nBacking up users from project "${PROJECT}" (read-only)\n`);

  const users = await db.collection("users").get();
  const records = [];
  let withInlinePay = 0;

  for (const doc of users.docs) {
    const data = doc.data();
    let compensation = null;
    try {
      const comp = await db.doc(`users/${doc.id}/compensation/current`).get();
      if (comp.exists) compensation = comp.data();
    } catch (e) {
      console.warn(`  warn: could not read compensation for ${doc.id}: ${e.message}`);
    }
    const hasInline = PAY_FIELDS.some((f) => typeof data[f] === "number");
    if (hasInline) withInlinePay++;
    records.push({ uid: doc.id, employeeId: data.employeeId || null, user: data, compensation });
  }

  const payload = {
    project: PROJECT,
    takenAt: new Date().toISOString(),
    userCount: records.length,
    usersWithInlinePay: withInlinePay,
    // The exact fields --purge will delete, recorded so a restore knows its own scope.
    inlinePayFields: PAY_FIELDS,
    users: records,
  };

  const dest = outPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");

  const sizeKb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`  ${records.length} users · ${withInlinePay} carrying inline pay`);
  console.log(`\nWritten: ${dest} (${sizeKb} KB)`);
  console.log("\nKeep this file until a payroll run has been verified after the purge.");
  console.log("Restore with: node restore-users-pay.js <file>\n");

  if (records.length === 0) {
    console.error("REFUSING TO CONTINUE: zero users read. Check credentials/project — an");
    console.error("empty backup would give false confidence before an irreversible purge.");
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
