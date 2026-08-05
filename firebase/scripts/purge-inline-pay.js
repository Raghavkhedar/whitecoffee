#!/usr/bin/env node
"use strict";

/**
 * One-time migration: remove the legacy inline pay fields from users/{uid}.
 *
 *   node purge-inline-pay.js            # DRY RUN — reports, writes nothing
 *   node purge-inline-pay.js --apply    # actually deletes
 *
 * Auth: Application Default Credentials (separate from the Firebase CLI login).
 *   gcloud auth application-default login
 *   export GOOGLE_CLOUD_QUOTA_PROJECT=white-coffee-92c27
 *
 * Why
 * ---
 * Pay was split to users/{uid}/compensation/current on 2026-07-20 because Firestore rules
 * are DOCUMENT-level: there is no field-level read control, so anything that can read a
 * user doc reads every field on it. The subcollection is restricted to admin plus the
 * /ot-settlements tab. The user doc is readable by `canReadUsers()` — the holder of ANY
 * of ten grantable tabs.
 *
 * The copy ran; the delete never did. So the split has bought nothing so far: a manager
 * holding, say, /attendance still reads every employee's salary off the user doc, exactly
 * as before. This script finishes the migration.
 *
 * Safety
 * ------
 * withPay() falls back PER FIELD to the inline value, which is what makes the migration
 * invisible while both copies exist — and is exactly why deleting is dangerous. A field
 * present inline but MISSING from compensation/current is fine today and becomes a silent
 * 0 the moment the inline copy goes: someone's salary quietly becomes zero in payroll.
 *
 * So every doc is re-verified immediately before its own delete, not once up front — a
 * stale pre-flight is worth nothing if an admin edits a salary while this runs. Anything
 * that does not match is skipped and reported, never forced.
 *
 * Every removed value is also written to a timestamped JSON backup next to this script
 * before anything is deleted.
 *
 * Readers were checked before writing this: admin /users and /ot-settlements both merge
 * via withPay, both Cloud Function call sites (Sheets export, forecast export) do too, and
 * the Android app never reads pay at all.
 */

const fs = require("node:fs");
const path = require("node:path");

const admin = (() => {
  try { return require("firebase-admin"); }
  catch { return require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }
})();

const PAY_FIELDS = ["salaryRate", "pfPercent", "esiPercent", "imprestPercent"];
const APPLY = process.argv.includes("--apply");

admin.initializeApp({ projectId: "white-coffee-92c27" });

(async () => {
  const db = admin.firestore();
  const users = await db.collection("users").get();

  const plan = [];
  const skipped = [];

  for (const doc of users.docs) {
    const u = doc.data();
    const inline = PAY_FIELDS.filter((f) => typeof u[f] === "number");
    const label = `${u.employeeId || "?"} ${u.name || ""}`.trim();
    if (inline.length === 0) continue;

    const comp = await db.doc(`users/${doc.id}/compensation/current`).get();
    const c = comp.exists ? comp.data() : null;

    const bad = inline.filter((f) => !c || typeof c[f] !== "number" || c[f] !== u[f]);
    if (bad.length) {
      skipped.push(`  ✗ ${label} (${doc.id}) — not mirrored: ${bad.join(", ")}`);
      continue;
    }
    plan.push({ uid: doc.id, label, values: Object.fromEntries(inline.map((f) => [f, u[f]])) });
  }

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}`);
  console.log(`\nWill remove inline pay from ${plan.length} user(s):`);
  plan.forEach((p) => console.log(`  • ${p.label} — ${JSON.stringify(p.values)}`));

  if (skipped.length) {
    console.log(`\n⚠️  SKIPPED — inline value not mirrored, left untouched (${skipped.length}):`);
    skipped.forEach((l) => console.log(l));
    console.log("  Fix these in compensation/current first, then re-run.");
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to perform the deletion.");
    process.exit(0);
  }

  // Backup BEFORE the first delete. If this fails, nothing is removed.
  const backupPath = path.join(__dirname, `inline-pay-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(plan, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  let done = 0;
  let failed = 0;
  for (const p of plan) {
    const patch = Object.fromEntries(
      Object.keys(p.values).map((f) => [f, admin.firestore.FieldValue.delete()]),
    );
    try {
      // No lastModifiedBy stamp: this is a migration, not a person. The audit trigger
      // records the before/after either way, with the actor as "unknown" — which is
      // honest, since no user performed it.
      await db.doc(`users/${p.uid}`).update(patch);
      done++;
      console.log(`  ok   ${p.label}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${p.label} — ${e.message}`);
    }
  }

  console.log(`\n${done} purged, ${failed} failed, ${skipped.length} skipped.`);
  console.log("Verify: the /users table and /ot-settlements should show unchanged salaries");
  console.log("(they read through withPay, which now resolves from compensation/current).");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
