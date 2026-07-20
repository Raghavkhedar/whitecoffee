#!/usr/bin/env node
"use strict";

/**
 * Migrate pay fields off the user document into users/{uid}/compensation/current.
 *
 * WHY: Firestore rules are DOCUMENT-level. While salaryRate/pfPercent/esiPercent/
 * imprestPercent sat on users/{uid}, every tab that read a user doc merely to resolve an
 * employee name could also enumerate the whole company's pay.
 *
 * ⚠️ THIS SCRIPT IS THE DANGEROUS PART OF THE CHANGE. If the inline fields are removed
 * before every reader is deployed against compensation.js, salaryRate resolves to 0 and
 * employees are paid NOTHING. Run it in three deliberate phases:
 *
 *   1. DEPLOY the new functions + portal first (they read compensation with a per-field
 *      fallback to the inline fields, so they are correct either way).
 *   2. node migrate-compensation.js            → dry run, prints what it WOULD copy
 *      node migrate-compensation.js --commit   → copies inline pay into the subcollection
 *   3. Verify a payroll run looks right, THEN:
 *      node migrate-compensation.js --purge --commit
 *      → removes the now-redundant inline fields. This is the step that actually
 *        closes the exposure; until it runs, the pay is still on the user doc.
 *
 * --purge refuses to run on any user whose compensation doc does not already match the
 * inline values, so a half-finished copy can never be purged into data loss.
 *
 * Auth: uses Application Default Credentials (`gcloud auth application-default login`)
 * or GOOGLE_APPLICATION_CREDENTIALS. The Admin SDK bypasses security rules.
 */

// firebase-admin lives in ../functions/node_modules — these scripts have no package.json
// of their own. Resolve it from there so the script runs from any working directory.
const admin = (() => {
  try { return require("firebase-admin"); }
  catch { return require(require("node:path").join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }
})();

const PAY_FIELDS = ["salaryRate", "pfPercent", "esiPercent", "imprestPercent"];

const COMMIT = process.argv.includes("--commit");
const PURGE = process.argv.includes("--purge");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "white-coffee-92c27" });
const db = admin.firestore();

/** Pay fields present inline on a user doc, as numbers. */
function inlinePay(data) {
  const out = {};
  for (const f of PAY_FIELDS) {
    const v = data[f];
    if (typeof v === "number" && isFinite(v)) out[f] = v;
  }
  return out;
}

async function main() {
  const mode = PURGE ? "PURGE inline fields" : "COPY inline → compensation";
  console.log(`\n${mode} — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);

  const users = await db.collection("users").get();
  let copied = 0, purged = 0, skipped = 0, blocked = 0;

  for (const doc of users.docs) {
    const uid = doc.id;
    const data = doc.data();
    const inline = inlinePay(data);
    const compRef = db.doc(`users/${uid}/compensation/current`);
    const compSnap = await compRef.get();
    const comp = compSnap.exists ? compSnap.data() : null;

    if (PURGE) {
      // Refuse to purge unless the compensation doc already carries the same value for
      // every inline field. Purging ahead of a good copy is unrecoverable pay loss.
      const mismatched = Object.entries(inline).filter(([f, v]) => !comp || comp[f] !== v);
      if (Object.keys(inline).length === 0) { skipped++; continue; }
      if (mismatched.length > 0) {
        blocked++;
        console.log(`  BLOCKED ${uid} (${data.employeeId || "?"}): compensation missing/differs on ${mismatched.map(([f]) => f).join(", ")} — re-run the copy phase first`);
        continue;
      }
      console.log(`  purge  ${uid} (${data.employeeId || "?"}): removing ${Object.keys(inline).join(", ")}`);
      if (COMMIT) {
        const clear = {};
        for (const f of Object.keys(inline)) clear[f] = admin.firestore.FieldValue.delete();
        await doc.ref.update(clear);
      }
      purged++;
      continue;
    }

    if (Object.keys(inline).length === 0) { skipped++; continue; }
    console.log(`  copy   ${uid} (${data.employeeId || "?"}): ${PAY_FIELDS.map((f) => `${f}=${inline[f] ?? "-"}`).join(" ")}`);
    if (COMMIT) {
      await compRef.set({ ...inline, migratedAt: admin.firestore.Timestamp.now() }, { merge: true });
    }
    copied++;
  }

  console.log(
    `\n${PURGE ? `purged ${purged}` : `copied ${copied}`} · skipped ${skipped} (no inline pay)` +
    (blocked ? ` · BLOCKED ${blocked}` : "")
  );
  if (!COMMIT) console.log("Dry run — nothing written. Re-run with --commit.\n");
  if (blocked) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
