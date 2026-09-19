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
