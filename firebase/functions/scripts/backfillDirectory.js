#!/usr/bin/env node
"use strict";

/**
 * One-off: create `directory/{uid}` for users that existed before syncDirectory was deployed.
 * Safe to re-run. Dry run unless --apply.
 *
 *   node scripts/backfillDirectory.js --project white-coffee-92c27 [--apply]
 */
const admin = require("firebase-admin");
const { directoryEntry } = require("../transferReceipt");

async function main() {
  const args = process.argv.slice(2);
  const projectId = args[args.indexOf("--project") + 1];
  if (!args.includes("--project") || !projectId) throw new Error("--project <id> is required");
  const apply = args.includes("--apply");

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const users = await db.collection("users").get();
  // shortcut: one batch holds 500 writes; chunk this if the company ever outgrows it.
  const batch = db.batch();
  users.docs.forEach((u) => batch.set(db.doc(`directory/${u.id}`), directoryEntry(null, u.data())));
  if (apply) await batch.commit();
  console.log(`${apply ? "Wrote" : "Would write"} ${users.size} directory entries`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
