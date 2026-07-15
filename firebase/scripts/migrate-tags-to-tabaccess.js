#!/usr/bin/env node
/**
 * One-off migration: preset `tags` → explicit `tabAccess`
 * =======================================================
 *
 * WHAT THIS DOES
 *   The portal is replacing the preset-tag access system with an explicit
 *   per-user list of allowed tab paths (`tabAccess: string[]`). This script
 *   converts every existing `attendance-manager` user (a `users/{uid}.tags`
 *   array containing the string 'attendance-manager') to the equivalent
 *   explicit tab list, then removes the `tags` field entirely.
 *
 *   Target tab list for an attendance-manager (see Section 4 of
 *   docs/superpowers/specs/2026-07-14-portal-access-matrix-design.md):
 *     /working-hours-shortage-excess
 *     /attendance
 *     /ot-shortage
 *     /ot-settlements
 *     /manpower-utilisation-input
 *
 *   ⚠️  RUN THIS ONCE, BEFORE deploying the new per-tab firestore.rules.
 *       The clean rules do not read `tags` at all — any user still on the old
 *       tag system would silently lose scoped access once the new rules ship.
 *
 * IDEMPOTENT
 *   Safe to re-run. A user that has already been migrated (no `tags` field, or
 *   `tags` no longer contains 'attendance-manager') is skipped and never
 *   rewritten. Re-running against a fully-migrated database changes nothing.
 *   Any tab paths already present in a user's `tabAccess` are preserved and
 *   unioned with the target list (deduped).
 *
 * AUTHENTICATION
 *   Uses the Firebase Admin SDK with Application Default Credentials — the same
 *   idiomatic `admin.initializeApp()` the Cloud Functions use. Provide creds via
 *   ONE of:
 *     • `gcloud auth application-default login`   (interactive, easiest locally)
 *     • export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
 *   The service account / user must have Firestore read+write on project
 *   `white-coffee-92c27`. No secrets are hardcoded in this file.
 *
 * WHERE TO RUN IT FROM
 *   `firebase-admin` is NOT installed in this `scripts/` folder. It IS already
 *   installed at `firebase/functions/node_modules`. Easiest: run this file with
 *   that folder on the module path, e.g. from the repo `firebase/` directory:
 *
 *     NODE_PATH=functions/node_modules node scripts/migrate-tags-to-tabaccess.js
 *
 *   …or run it from inside `firebase/functions/` so Node resolves the local
 *   `node_modules`:
 *
 *     cd firebase/functions
 *     node ../scripts/migrate-tags-to-tabaccess.js            # dry run
 *     node ../scripts/migrate-tags-to-tabaccess.js --commit   # apply
 *
 *   Alternatively `npm i firebase-admin` inside `scripts/` first.
 *
 * USAGE
 *   node scripts/migrate-tags-to-tabaccess.js            # DRY RUN (default) — no writes
 *   node scripts/migrate-tags-to-tabaccess.js --commit   # APPLY the migration
 *
 *   The default is a DRY RUN: it prints exactly what WOULD change and writes
 *   nothing. You must pass `--commit` to actually persist changes.
 */

'use strict';

const admin = require('firebase-admin');

const PROJECT_ID = 'white-coffee-92c27';
const TAG = 'attendance-manager';

// EXACT target tab list for an attendance-manager (order preserved).
const ATTENDANCE_MANAGER_TABS = [
  '/working-hours-shortage-excess',
  '/attendance',
  '/ot-shortage',
  '/ot-settlements',
  '/manpower-utilisation-input',
];

const COMMIT = process.argv.includes('--commit');

// Union two path lists preserving order: target list first, then any extra
// pre-existing tabAccess entries not already covered. Deduped.
function unionTabs(existing, target) {
  const out = [];
  const seen = new Set();
  for (const p of [...target, ...(Array.isArray(existing) ? existing : [])]) {
    if (typeof p === 'string' && p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  console.log('='.repeat(70));
  console.log('Migration: tags → tabAccess   (project: ' + PROJECT_ID + ')');
  console.log('Mode: ' + (COMMIT ? 'COMMIT — changes WILL be written' : 'DRY RUN — no writes (pass --commit to apply)'));
  console.log('='.repeat(70));

  const snap = await db.collection('users').get();

  let scanned = 0;
  let toMigrate = 0;
  let written = 0;

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data() || {};
    const tags = data.tags;

    // Skip anyone who is not (or no longer) an attendance-manager. Already-
    // migrated users have no `tags` field → skipped. Idempotent.
    if (!Array.isArray(tags) || !tags.includes(TAG)) continue;

    toMigrate += 1;

    const before = {
      tabAccess: Array.isArray(data.tabAccess) ? data.tabAccess : undefined,
      tags,
    };
    const nextTabAccess = unionTabs(data.tabAccess, ATTENDANCE_MANAGER_TABS);

    const label = (data.name || data.displayName || data.email || '(no name)') + '  [' + doc.id + ']';
    console.log('\n• ' + label);
    console.log('    BEFORE: tags=' + JSON.stringify(before.tags) +
      '  tabAccess=' + JSON.stringify(before.tabAccess));
    console.log('    AFTER : tags=<deleted>  tabAccess=' + JSON.stringify(nextTabAccess));

    if (sameSet(before.tabAccess, nextTabAccess)) {
      console.log('    (tabAccess unchanged; only removing legacy `tags`)');
    }

    if (COMMIT) {
      await doc.ref.update({
        tabAccess: nextTabAccess,
        tags: admin.firestore.FieldValue.delete(),
      });
      written += 1;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('Summary');
  console.log('  users scanned          : ' + scanned);
  console.log('  attendance-managers    : ' + toMigrate);
  if (COMMIT) {
    console.log('  documents written      : ' + written);
    console.log('\nDone. Migration applied. You may now deploy the new firestore.rules.');
  } else {
    console.log('  documents that WOULD be written : ' + toMigrate);
    console.log('\nDRY RUN complete — nothing written. Re-run with --commit to apply.');
  }
  console.log('='.repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nMigration FAILED:', err);
    process.exit(1);
  });
