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
- Flags: default is a DRY RUN. `--apply` writes. `--project <id>` is REQUIRED and is the project firebase-admin is initialised with, so the script cannot fall back to whichever project the shell happens to be logged in to. It is not cross-checked against anything else: the operator must type the right id. A set `FIRESTORE_EMULATOR_HOST` with a non-`demo-*` project id is refused (exit 2) in every mode. `--user <uid>` limits it to one user. `--out <dir>` chooses where the plan/backup JSONL goes.
- It always writes the plan/backup file first (path, before, after for every doc), and only then, with `--apply`, writes in transactions of at most 400 docs with `merge: true` (and `FieldValue.delete()` for `salaryCredit` when a doc becomes `USCHL`); each transaction re-reads its docs and skips any that no longer exist, are no longer legacy, or differ from what the scan saw. It re-scans afterwards and reports how many `PL`/`LWP` docs remain (expected 0). Every run also prints a status histogram over all attendance docs and flags near-miss statuses (`"pl"`, `"PL "`, `"Lwp"`) that the exact-match migration will not change.
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

**0. Pre-check: make sure you are NOT pointed at an emulator.**

```bash
echo "[$FIRESTORE_EMULATOR_HOST]"     # must print []  (nothing between the brackets)
```

If it prints anything, run `unset FIRESTORE_EMULATOR_HOST`. A stale value silently redirects the SDK to a local emulator whatever `--project` says, and a run against it looks completely green while touching nothing real. The script now refuses to start in that situation (exit 2, no files) unless the project id starts with `demo-`, but check anyway: the first lines of output must not contain an `EMULATOR` banner (and neither must the last line of the summary).

**1. Dry run** (the default; nothing is written to Firestore):

```bash
cd firebase/functions
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27
```

It prints the counts by mapping (`PL`, `LWP` non-admin, `LWP` admin), per-month counts, the path of the plan file (`./migration-out/legacy-leave-migration_<project>_<time>_dry-run.jsonl`) and a **STATUS HISTOGRAM**: the count of every distinct raw `status` across ALL attendance docs (read status-only). Open the plan file: the first line is a meta record (`tool`, `mode`, `project`, `createdAt`, `version`), then one line per doc with `path`, the full original doc as `before`, and the patch as `after`. Check that the counts and a few lines look right.

Read the histogram. Anything outside the known set (`Present`, `HalfDay`, `SL`, `LNF`, `SLNF`, `Absent`, `SCHL`, `USCHL`, `WO`, `Sunday`, `Holiday`, plus the legacy `PL`/`LWP`) is printed under `UNRECOGNISED statuses` with up to 3 example paths. If one of them looks like a legacy status but is not exactly `PL`/`LWP` (`"pl"`, `"PL "`, `"Lwp"`), the script prints a loud WARNING and **exits non-zero, even on a dry run**: it will not change such docs (the match is exact on purpose), and the legacy readers must NOT be deleted until they are dealt with.

**1.5. One employee first.** Before the full run, do a real apply for a single employee who has `PL`/`LWP` days (pick a uid from step 1's `users/<uid>: N legacy doc(s)` lines):

```bash
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --apply --user <one employee uid>
```

Then open that employee in the portal for a month that had `PL`/`LWP` days and confirm their Days NP and Salary Due are unchanged. Only then run the full apply.

**2. Apply:**

```bash
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --apply
```

It writes a fresh backup (`..._apply.jsonl`) to disk and flushes it BEFORE the first write, then rewrites in transactions of at most 400 docs (`merge: true`), then re-scans. The scan is not a lock, so each transaction first re-reads its docs and writes a doc only if it still exists, is still `PL`/`LWP` and is identical to what the scan saw. A doc that was edited or deleted while the script ran is NOT written (and a deleted one is not re-created): it is counted as `Skipped (changed since the scan)`, its path is printed, and the run carries on. Its backup line stays in the file but is harmless.

The run ends with `Legacy docs REMAINING: 0`. The exit code is non-zero if any transaction failed, any legacy doc remains (which includes a skipped doc that is still `PL`/`LWP`), or the histogram shows a near-miss status. **If `Skipped` is not 0, just re-run the same `--apply` command**: the next run re-scans, backs the skipped docs up as they now are, and maps them correctly (for example a doc an admin flipped from auto to admin `LWP` in the meantime becomes `USCHL`, not `SCHL`). A failed transaction stops the run; docs already written stay written, and re-running `--apply` picks up what is left.

The apply run prints the status histogram twice, before and after the writes, so you see the final distribution.

**3. Post-run checklist.**
- Re-run the dry run from step 1: it must report `Legacy docs found: 0`.
- Read the **STATUS HISTOGRAM** and confirm there are no `UNRECOGNISED statuses`. This, not `Legacy docs REMAINING: 0`, is what proves nothing was missed: `REMAINING` only counts docs whose status is exactly `PL`/`LWP` and cannot see a `"pl"` or `"PL "`.
- Keep the `_apply.jsonl` backup private (it is written mode 0600 and holds full employee attendance docs): off shared drives and out of the repo, until the next payroll has been signed off.
- Audit log: expect one `audit_log` entry per migrated doc with actor `system:migrateLegacyLeaveStatuses`. The audit trigger swallows its own failures, so a count mismatch is a logging gap, not a data problem.
- Compare the current month's Sheets "Leaves" total before and after: it must be identical. Only the SCHL-unpaid / USCHL split moves (an admin-set `LWP` counts as USCHL now).
- If `Skipped (changed since the scan)` was above 0, re-run the same `--apply` command.

**4. Undo (if ever needed).** Restoring is a dry run unless `--apply` is given:

```bash
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --restore migration-out/<the ..._apply.jsonl file>
node scripts/migrateLegacyLeaveStatuses.js --project white-coffee-92c27 --restore migration-out/<the ..._apply.jsonl file> --apply
```

Restore puts each doc back to its backed-up `before` state with a full `set()` (the added `migratedFrom`, `migratedAt` and `lastModifiedBy` disappear, a removed `salaryCredit` returns, Timestamps are restored exactly). Only docs still exactly as the migration left them are restored (each transaction re-checks). A doc that was edited, regularized or deleted since the migration is left alone and listed as `SKIPPED (changed since the migration)`, so a later legitimate change is never silently reverted. **The restore then exits 1 and says so**, because it is incomplete: read the list. Docs already in their original state are skipped too, and that alone keeps exit 0, so it is safe to repeat. Restore only accepts the `_apply.jsonl` file of a real `--apply` run: it refuses a `_dry-run.jsonl` file (nothing was ever written under it), a file with no meta line or from another tool, and a backup whose recorded project differs from `--project`.

**Safety notes**
- Every doc the script writes triggers the existing `auditUserSubcollection` trigger, so the audit trail gets one `audit_log` entry per changed doc (a restore adds one per restored doc too). `lastModifiedBy` is `system:migrateLegacyLeaveStatuses`.
- It is safe to run while the app is live: the mapping is pay-neutral, it only touches docs whose status is exactly `PL` or `LWP`, and the transactional re-check means it never overwrites a doc that changed after the scan. It reads each user's `attendance_status` with a per-user collection query and never touches `plBalance` or any other collection.
- `--project` is required and is the project firebase-admin is initialised with, so the script cannot fall back to whichever project the shell is logged in to. It does not cross-check the id against anything else, so type it carefully. With `FIRESTORE_EMULATOR_HOST` set it refuses a non-`demo-*` project (exit 2, in every mode, no files); with a `demo-*` project it prints a loud EMULATOR banner at the top and again as the last line, and the summary says the data came from an emulator.
- The plan/backup files contain employee attendance data. Keep them somewhere private, do not commit or share them (`migration-out/` is git-ignored, and files are created readable by the owner only). Keep the `--apply` backup until the change has been verified and restore needs it, so do not delete it after a successful run until you are sure you will not need to undo.

**Things to know**
- `migratedAt` is the time the scan started, the same for every doc in a run.
- Each migrated doc causes one `audit_log` write plus an audit-trigger invocation for that `audit_log` write, which is a no-op. Expect a trigger backlog proportional to the number of docs.
- `Sunday`- and `Holiday`-dated legacy `PL`/`LWP` docs ARE migrated: the Admin SDK bypasses the rest-day rule, the same way the nightly function does.
- A restore can turn a number that was stored as a double into an integer. That is harmless: every writer and reader already uses integers or `=== 1`.
- The histogram reads every user's whole `attendance_status` collection once (status field only) before the writes, and once more after them, so the reads are proportional to the total number of attendance docs, not just the legacy ones.
