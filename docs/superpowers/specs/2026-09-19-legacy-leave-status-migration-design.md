# Legacy PL/LWP → SCHL/USCHL attendance migration — Design

**Date:** 2026-09-19
**Status:** Approved by the requester in chat, pending implementation
**Builds on:** `2026-09-18-schl-uschl-leave-status-design.md` (which originally chose "no migration"; the requester has now reversed that for the relabel case)

## Decisions the requester made

1. **Scope: relabel only.** Existing `attendance_status` docs written as `PL` or `LWP` become `SCHL` / `USCHL`. Nothing that moves pay is included: past `Holiday` credits for operations staff and past `Absent` days now covered by approved leave are deliberately NOT touched (each would change pay and needs its own reviewed step).
2. **Range: all history.** Every `PL`/`LWP` doc since launch, so the legacy handling code can be removed afterwards.
3. **How it runs: a local script the requester runs.** Nothing is deployed. It defaults to a dry run, writes a backup of every doc before touching it, and rewrites only with an explicit `--apply`, using the requester's own credentials. (The earlier backfills used a temporary deployed HTTP function; that leaves a pay-rewriting endpoint live and was declined.)
4. **Admin-set LWP becomes `USCHL`.** An admin who chose unpaid leave through Regularization is exactly what `USCHL` now means.

## Mapping (pure, unit-tested)

| Existing doc | Becomes | Pay effect |
|---|---|---|
| `PL`, any `markedBy` | `SCHL`, `salaryCredit: 1` | none (weight 1 → weight 1) |
| `LWP`, `markedBy` = `auto`, `backfill`, or missing | `SCHL`, `salaryCredit: 0` | none (0 → 0) |
| `LWP`, `markedBy` = `admin` | `USCHL` (no `salaryCredit`) | none (0 → 0) |
| anything else | untouched | — |

`markedBy` is preserved. Each migrated doc also gets `migratedFrom` (`"PL"` or `"LWP"`), `migratedAt`, and `lastModifiedBy: "system:migrateLegacyLeaveStatuses"` (the audit trigger takes its actor from `lastModifiedBy`). Nothing else on the doc changes, and `plBalance` is never touched (a PL day's decrement already happened when it was scored).

Why the pay is unchanged: `tallyAttendanceStatus`, `dayWeight` and `cancelLeave` already treat legacy `PL` exactly like `SCHL` with `salaryCredit: 1` and `LWP` like `salaryCredit: 0`. `cancelLeave` skips admin-marked docs either way, so an admin-set doc behaves the same after migration. The only visible difference is in the current-month Sheets block, where an admin-set LWP moves from the "SCHL (Unpaid)" count to the "USCHL" count (the `Leaves` total is unchanged).

## Mechanism

- One script, `firebase/functions/scripts/migrateLegacyLeaveStatuses.js`, exporting a pure `planLegacyStatusMigration(doc)` and a runner that takes a Firestore handle so it can be tested with a fake and run against the emulator.
- It lists `users`, and for each user queries that user's own `attendance_status` subcollection for `status in ["PL","LWP"]`. A per-user collection query needs no extra index; a collection-group query would need a `fieldOverride` in `firestore.indexes.json` (a known trap in this repo).
- Flags: default is a DRY RUN. `--apply` writes. `--project <id>` is REQUIRED and must equal the project the SDK resolved, so it cannot hit the wrong project. `--user <uid>` limits it to one user. `--out <dir>` chooses where the plan/backup JSONL goes.
- It always writes the plan/backup file first (path, before, after for every doc), and only then, with `--apply`, writes in batches of at most 400 with `merge: true` (and `FieldValue.delete()` for `salaryCredit` when a doc becomes `USCHL`). It re-scans afterwards and reports how many `PL`/`LWP` docs remain (expected 0).
- Idempotent: a second run finds nothing.
- Each written doc triggers the existing `auditUserSubcollection` trigger, so the audit trail records every change (one `audit_log` entry per doc).

## After it has been run

Once the requester confirms a clean run (0 remaining), the legacy handling can be deleted in a separate change: the `PL`/`LWP` cases in `tallyAttendanceStatus`, `dayWeight` and `cancelLeave`, and the legacy badges and type members in the admin portal. Until then it must stay. `regularization_requests.approvedStatus` values of `PL`/`LWP` are historical request records, not attendance days, and are left as they are.

## Not covered

- Frozen past-month Sheets blocks are never recomputed by design and keep their old columns.
- The script cannot be run by the assistant (no production credentials, and writing pay history needs the owner's go-ahead).

## How to run it

The script is `firebase/functions/scripts/migrateLegacyLeaveStatuses.js`. It is excluded from the functions deploy (`scripts` is in the `functions.ignore` list of `firebase.json`) and `index.js` never requires it.

**Prerequisites.** Credentials that can read and write Firestore in `white-coffee-92c27`, either of:
- `gcloud auth application-default login`, or
- `export GOOGLE_APPLICATION_CREDENTIALS=<path to a service-account key with Firestore access>`. Keep that key out of the repo (it is never committed).

**1. Dry run** (the default; nothing is written to Firestore):

```bash
cd firebase/functions
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27
```

It prints the counts by mapping (`PL`, `LWP` non-admin, `LWP` admin), per-month counts, and the path of the plan file (`./migration-out/legacy-leave-migration_<project>_<time>_dry-run.jsonl`). Open the file: one line per doc, with `path`, the full original doc as `before`, and the patch as `after`. Check that the counts and a few lines look right. Use `--user <uid>` to try a single employee first.

**2. Apply:**

```bash
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --apply
```

It writes a fresh backup (`..._apply.jsonl`) to disk and flushes it BEFORE the first write, then rewrites in batches of at most 400 with `merge: true`, then re-scans. The run ends with `Legacy docs REMAINING: 0`; the exit code is non-zero if any batch failed or any legacy doc remains. A failed batch stops the run; docs already written stay written, and re-running `--apply` simply picks up what is left.

**3. Confirm** by re-running the dry run from step 1: it should report `Legacy docs found: 0`.

**4. Undo (if ever needed).** Restoring is a dry run unless `--apply` is given:

```bash
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --restore migration-out/<the ..._apply.jsonl file>
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --restore migration-out/<the ..._apply.jsonl file> --apply
```

Restore puts each doc back to its backed-up `before` state with a full `set()` (the added `migratedFrom`, `migratedAt` and `lastModifiedBy` disappear, a removed `salaryCredit` returns, Timestamps are restored exactly). Docs already in that state are skipped, so it is safe to repeat. Use the backup from the `--apply` run, not a dry-run file. Restore overwrites any change made to those docs since the migration.

**Safety notes**
- Every doc the script writes triggers the existing `auditUserSubcollection` trigger, so the audit trail gets one `audit_log` entry per changed doc (a restore adds one per restored doc too). `lastModifiedBy` is `system:migrateLegacyLeaveStatuses`.
- It is safe to run while the app is live: the mapping is pay-neutral and it only touches docs whose status is exactly `PL` or `LWP`. It reads each user's `attendance_status` with a per-user collection query and never touches `plBalance` or any other collection.
- `--project` is required and is the project firebase-admin is initialised with, so the script cannot fall back to whichever project the shell is logged in to. If `FIRESTORE_EMULATOR_HOST` is set it prints a loud EMULATOR banner instead.
- The plan/backup files contain employee attendance data. Keep them somewhere private, do not commit or share them (`migration-out/` is git-ignored, and files are created readable by the owner only). Keep the `--apply` backup until the change has been verified.
- Restore needs the `--apply` backup file, so do not delete it after a successful run until you are sure you will not need to undo.
