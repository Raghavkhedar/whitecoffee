#!/usr/bin/env node
"use strict";

/**
 * ONE-OFF migration: relabel legacy `PL` / `LWP` attendance docs as `SCHL` / `USCHL`.
 *
 *   users/{uid}/attendance_status/{yyyy-MM-dd}
 *
 * Design + rationale: docs/superpowers/specs/2026-09-19-legacy-leave-status-migration-design.md
 *
 * SAFETY MODEL (this rewrites pay history, so read this before changing anything):
 *   - Default is a DRY RUN. Nothing is written to Firestore unless --apply is passed.
 *   - A plan/backup JSONL (path, full `before` doc, `after` patch) is ALWAYS written to disk
 *     and fsync'd BEFORE the first Firestore write. It is the restore source.
 *   - The mapping is pay-neutral (the readers already price legacy PL like SCHL credit 1 and
 *     LWP like credit 0) and touches ONLY docs whose status is exactly "PL" or "LWP".
 *   - The scan is not a lock. Every write chunk is a Firestore TRANSACTION that re-reads its docs and
 *     writes one only if it still exists, is still legacy and is deep-equal to what the scan saw;
 *     otherwise it is skipped, counted in `skippedChanged`, and picked up by the next run.
 *   - --restore <backup.jsonl> puts docs back to their backed-up `before` state, but only those
 *     still exactly as the migration left them (a later edit is never reverted; it is listed).
 *   - --project <id> is REQUIRED and is what firebase-admin is initialised with, so the script
 *     cannot silently run against whatever project the shell happens to be logged into.
 *
 * Auth: Application Default Credentials (`gcloud auth application-default login`) or
 * GOOGLE_APPLICATION_CREDENTIALS=<service-account key>. Never commit a key.
 *
 * Nothing here is required by index.js and firebase.json excludes scripts/ from the deploy.
 */

const fs = require("node:fs");
const path = require("node:path");

const ACTOR = "system:migrateLegacyLeaveStatuses";
const LEGACY_STATUSES = ["PL", "LWP"];
const BATCH_LIMIT = 400; // Firestore allows 500 ops per batch; stay well inside it.
const ATTENDANCE_PATH = /^users\/[^/]+\/attendance_status\/[^/]+$/;

// ───────────────────────────────── the mapping ─────────────────────────────────

/**
 * PURE function of the doc data only. Returns null (leave the doc alone) or
 *   { patch: { status, salaryCredit } | { status, deleteSalaryCredit: true }, migratedFrom }
 *
 *   PL                    -> SCHL, salaryCredit 1   (any markedBy)
 *   LWP, markedBy admin   -> USCHL, salaryCredit removed (USCHL never carries it)
 *   LWP, anything else    -> SCHL, salaryCredit 0   (auto / backfill / missing)
 *   every other status    -> null
 *
 * The match is exact and case-sensitive on purpose: "pl" or "PL " is not a status we wrote.
 */
function planLegacyStatusMigration(docData) {
  if (!docData || typeof docData !== "object") return null;
  if (docData.status === "PL") {
    return { patch: { status: "SCHL", salaryCredit: 1 }, migratedFrom: "PL" };
  }
  if (docData.status === "LWP") {
    if (docData.markedBy === "admin") {
      return { patch: { status: "USCHL", deleteSalaryCredit: true }, migratedFrom: "LWP" };
    }
    return { patch: { status: "SCHL", salaryCredit: 0 }, migratedFrom: "LWP" };
  }
  return null;
}

// ─────────────────── faithful (de)serialisation of doc data ───────────────────

const isTimestamp = (v) =>
  v !== null && typeof v === "object" &&
  typeof v.toDate === "function" &&
  Number.isInteger(v.seconds) && Number.isInteger(v.nanoseconds);

const isPlainObject = (v) => {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Doc data -> JSON-safe value. Timestamps become { __timestamp: true, seconds, nanoseconds }.
 * Anything that JSON would silently corrupt (NaN, Dates, GeoPoints, references, bytes, ...) THROWS:
 * a backup that cannot restore a doc exactly must stop the run before anything is written.
 */
function encodeValue(v, where = "$") {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`cannot back up a non-finite number at ${where}`);
    return v;
  }
  if (isTimestamp(v)) return { __timestamp: true, seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (Array.isArray(v)) return v.map((x, i) => encodeValue(x, `${where}[${i}]`));
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "__timestamp") throw new Error(`cannot back up a field named "__timestamp" at ${where} (reserved by the backup format)`);
      out[k] = encodeValue(x, `${where}.${k}`);
    }
    return out;
  }
  throw new Error(`cannot back up an unsupported value type at ${where} (${v === undefined ? "undefined" : (v.constructor && v.constructor.name) || typeof v})`);
}

/** Inverse of encodeValue. `Timestamp` is the Firestore Timestamp class. */
function decodeValue(v, Timestamp) {
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, Timestamp));
  if (v !== null && typeof v === "object") {
    if (v.__timestamp === true) {
      if (!Number.isInteger(v.seconds) || !Number.isInteger(v.nanoseconds)) throw new Error("malformed __timestamp in backup");
      return new Timestamp(v.seconds, v.nanoseconds);
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x, Timestamp);
    return out;
  }
  return v;
}

/** Key-order-independent string for comparing two encoded values. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// ─────────────────────────────────── helpers ───────────────────────────────────

const firstLine = (err) => String((err && err.message) || err).split("\n")[0];
const monthOf = (docId) => (/^\d{4}-\d{2}/.test(docId) ? docId.slice(0, 7) : "unknown");

function loadAdmin() {
  return require("firebase-admin");
}

/** Write `content` to a NEW file (never overwrites), 0600, and fsync it before returning. */
function writeFileDurably(file, content) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

async function listUserRefs(db, userId) {
  if (userId !== undefined && userId !== null) {
    if (typeof userId !== "string" || userId === "" || userId.includes("/")) throw new Error(`invalid --user: ${JSON.stringify(userId)}`);
    return [db.collection("users").doc(userId)];
  }
  // listDocuments (not .get()) so a users/{uid} that has attendance docs but no user doc of its
  // own is still visited — a plain .get() would silently skip it and leave it un-migrated.
  return db.collection("users").listDocuments();
}

/**
 * True only if `snap` (a fresh read) still exists, is still legacy AND is deep-equal (via the same
 * faithful encoding the backup uses, so ANY changed field counts) to what the scan captured.
 * Data the encoder cannot represent cannot equal the scan, so it counts as changed.
 */
function unchangedSinceScan(snap, beforeKey) {
  if (!snap || !snap.exists) return false;
  const data = snap.data();
  if (planLegacyStatusMigration(data) === null) return false;
  try {
    return canonical(encodeValue(data)) === beforeKey;
  } catch {
    return false;
  }
}

/** One PER-USER COLLECTION query (a collection-group query would need a guarded index override). */
async function scanUser(userRef) {
  const snap = await userRef.collection("attendance_status").where("status", "in", LEGACY_STATUSES).get();
  return snap.docs;
}

// ─────────────────────────────────── migration ───────────────────────────────────

/**
 * runMigration({ db, FieldValue, Timestamp, now, projectId, apply, outDir, userId, log })
 *   -> { apply, projectId, users, found:{PL,LWP_auto,LWP_admin}, byMonth, planned, written,
 *        remaining, backupFile, errors }
 *
 * `db`, `FieldValue` and `Timestamp` are injected so the runner can be tested with a fake and
 * pointed at the emulator. A failed batch commit does not throw: it stops the run and lands in
 * `errors` (with `remaining` counting what is still legacy) so the caller can exit non-zero.
 */
async function runMigration({ db, FieldValue, Timestamp, now = new Date(), projectId, apply = false, outDir, userId, log = console.log }) {
  if (!db || !FieldValue) throw new Error("runMigration needs db and FieldValue");
  if (!outDir) throw new Error("runMigration needs outDir");
  if (!Timestamp) Timestamp = loadAdmin().firestore.Timestamp;

  // 1. SCAN (read-only). Any failure here aborts before anything exists on disk or in Firestore.
  const userRefs = await listUserRefs(db, userId);
  const found = { PL: 0, LWP_auto: 0, LWP_admin: 0 };
  const byMonth = {};
  const entries = [];
  const migratedAt = Timestamp.fromDate(now);
  for (const userRef of userRefs) {
    const docs = await scanUser(userRef);
    let n = 0;
    for (const doc of docs) {
      const before = doc.data();
      const plan = planLegacyStatusMigration(before);
      if (!plan) continue;
      n += 1;
      if (plan.migratedFrom === "PL") found.PL += 1;
      else if (plan.patch.status === "USCHL") found.LWP_admin += 1;
      else found.LWP_auto += 1;
      const month = (byMonth[monthOf(doc.id)] = byMonth[monthOf(doc.id)] || { PL: 0, LWP: 0 });
      month[plan.migratedFrom] += 1;

      const fields = { status: plan.patch.status, migratedFrom: plan.migratedFrom, migratedAt, lastModifiedBy: ACTOR };
      if (plan.patch.salaryCredit !== undefined) fields.salaryCredit = plan.patch.salaryCredit;
      const write = { ...fields };
      const after = encodeValue(fields);
      if (plan.patch.deleteSalaryCredit) {
        write.salaryCredit = FieldValue.delete();
        after.salaryCredit = { __delete: true };
      }
      // encodeValue throws on anything it cannot restore exactly -> abort before any write.
      const encodedBefore = encodeValue(before);
      entries.push({
        ref: doc.ref, write, beforeKey: canonical(encodedBefore),
        line: JSON.stringify({ path: doc.ref.path, before: encodedBefore, after }),
      });
    }
    if (n > 0) log(`  users/${userRef.id}: ${n} legacy doc(s)`);
  }

  const summary = {
    apply: !!apply, projectId, users: userRefs.length, found, byMonth,
    planned: entries.length, written: 0, skippedChanged: [], remaining: entries.length, backupFile: null, errors: [],
  };

  // 2. PLAN / BACKUP FILE — always, and durably on disk before any write.
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const safeProject = String(projectId || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  summary.backupFile = path.join(outDir, `legacy-leave-migration_${safeProject}_${stamp}_${apply ? "apply" : "dry-run"}.jsonl`);
  writeFileDurably(summary.backupFile, entries.map((e) => `${e.line}\n`).join(""));

  if (!apply) return summary;

  // 3. WRITE, one TRANSACTION per chunk of at most BATCH_LIMIT. The scan above is not a lock, so
  // each chunk re-reads its docs first and writes a doc only if it still exists, is still legacy
  // and is exactly what the scan saw; anything else is skipped (a re-run will pick it up and
  // back it up properly). The callback can be re-executed by Firestore on contention, so it has
  // no outside side effects: what it did is returned, and counted from the return value.
  // First chunk that throws stops the run.
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const chunk = entries.slice(i, i + BATCH_LIMIT);
    try {
      const outcome = await db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...chunk.map((e) => e.ref)); // every read before any write
        const fresh = new Map(snaps.map((s) => [s.ref.path, s]));
        let written = 0;
        const skipped = [];
        for (const e of chunk) {
          if (unchangedSinceScan(fresh.get(e.ref.path), e.beforeKey)) {
            tx.set(e.ref, e.write, { merge: true });
            written += 1;
          } else {
            skipped.push(e.ref.path);
          }
        }
        return { written, skipped };
      });
      summary.written += outcome.written;
      summary.skippedChanged.push(...outcome.skipped);
      outcome.skipped.forEach((p) => log(`  SKIPPED (changed since the scan): ${p}`));
      log(`  committed ${summary.written}/${entries.length}`);
    } catch (err) {
      summary.errors.push(`docs ${i + 1}-${i + chunk.length} failed, stopping: ${firstLine(err)}`);
      break;
    }
  }

  // 4. RE-SCAN: how many legacy docs are still there? (expected 0)
  try {
    let remaining = 0;
    for (const userRef of userRefs) remaining += (await scanUser(userRef)).length;
    summary.remaining = remaining;
  } catch (err) {
    summary.remaining = null;
    summary.errors.push(`re-scan failed: ${firstLine(err)}`);
  }
  return summary;
}

// ───────────────────────────────────── restore ─────────────────────────────────────

/**
 * runRestore({ db, Timestamp, file, apply, log })
 *   -> { apply, file, entries, toRestore, alreadyOriginal, skippedChanged, restored, errors }
 *
 * Puts docs in the backup back to their `before` state with a FULL set() (no merge), so fields the
 * migration added (migratedFrom, ...) disappear. Default is a dry run. The whole file is validated
 * before anything is written.
 *
 * A doc is restored ONLY if it is still exactly in the state the migration left it in (`before`
 * with `after` applied). Already in its `before` state -> nothing to do (so running it twice is a
 * no-op). Anything else — edited, regularized or deleted since the migration — is NOT touched and
 * is listed in `skippedChanged`: restore must never silently revert a later legitimate change.
 * Each write chunk is a transaction that re-reads and re-checks, like the migration itself.
 */
async function runRestore({ db, Timestamp, file, apply = false, log = console.log }) {
  if (!Timestamp) Timestamp = loadAdmin().firestore.Timestamp;
  const raw = fs.readFileSync(file, "utf8");
  const items = [];
  const seen = new Set();
  raw.split("\n").forEach((text, idx) => {
    if (text.trim() === "") return;
    let row;
    try { row = JSON.parse(text); } catch { throw new Error(`backup line ${idx + 1} is not valid JSON`); }
    const p = row && row.path;
    const segments = typeof p === "string" ? p.split("/") : [];
    if (typeof p !== "string" || !ATTENDANCE_PATH.test(p) || segments.some((s) => s === "." || s === "..")) {
      throw new Error(`backup line ${idx + 1} has a path outside users/{uid}/attendance_status/{date}: ${JSON.stringify(p)}`);
    }
    if (seen.has(p)) throw new Error(`backup line ${idx + 1} repeats path ${p}; refusing (ambiguous which state to restore)`);
    seen.add(p);
    if (!isPlainObject(row.before)) throw new Error(`backup line ${idx + 1} has no "before" object`);
    if (!isPlainObject(row.after)) throw new Error(`backup line ${idx + 1} has no "after" object`);
    // The state the migration left the doc in: `before` with the `after` patch merged on top.
    const migratedEnc = { ...row.before };
    for (const [k, v] of Object.entries(row.after)) {
      if (isPlainObject(v) && v.__delete === true) delete migratedEnc[k];
      else migratedEnc[k] = v;
    }
    items.push({
      path: p, before: decodeValue(row.before, Timestamp),
      beforeKey: canonical(row.before), migratedKey: canonical(migratedEnc),
    });
  });

  // Where is this doc now? "original" | "migrated" | "changed" (edited, or deleted, or unencodable).
  const classify = (snap, it) => {
    if (!snap || !snap.exists) return "changed";
    let key;
    try { key = canonical(encodeValue(snap.data())); } catch { return "changed"; }
    if (key === it.beforeKey) return "original";
    if (key === it.migratedKey) return "migrated";
    return "changed";
  };

  const todo = [];
  const skippedChanged = [];
  let alreadyOriginal = 0;
  for (const it of items) {
    const ref = db.doc(it.path);
    const state = classify(await ref.get(), it);
    if (state === "original") alreadyOriginal += 1;
    else if (state === "changed") skippedChanged.push(it.path);
    else todo.push({ ref, it });
  }

  const result = { apply: !!apply, file, entries: items.length, toRestore: todo.length, alreadyOriginal, skippedChanged, restored: 0, errors: [] };
  log(`  backup has ${items.length} doc(s): ${todo.length} to restore, ${alreadyOriginal} already in their original state, ${skippedChanged.length} changed since the migration (left alone)`);
  skippedChanged.forEach((p) => log(`    SKIPPED (changed since the migration): ${p}`));
  if (!apply) {
    todo.slice(0, 20).forEach((t) => log(`    would restore ${t.it.path}`));
    if (todo.length > 20) log(`    ... and ${todo.length - 20} more`);
    return result;
  }

  for (let i = 0; i < todo.length; i += BATCH_LIMIT) {
    const chunk = todo.slice(i, i + BATCH_LIMIT);
    try {
      // Re-read and re-check inside the transaction; no outside side effects (it may be re-executed).
      const outcome = await db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...chunk.map((t) => t.ref));
        const fresh = new Map(snaps.map((s) => [s.ref.path, s]));
        let restored = 0;
        let already = 0;
        const skipped = [];
        for (const t of chunk) {
          const state = classify(fresh.get(t.it.path), t.it);
          if (state === "migrated") {
            tx.set(t.ref, t.it.before); // full replace, deliberately NOT merge
            restored += 1;
          } else if (state === "original") {
            already += 1;
          } else {
            skipped.push(t.it.path);
          }
        }
        return { restored, already, skipped };
      });
      result.restored += outcome.restored;
      result.alreadyOriginal += outcome.already;
      result.skippedChanged.push(...outcome.skipped);
      outcome.skipped.forEach((p) => log(`    SKIPPED (changed since the migration): ${p}`));
      log(`  restored ${result.restored}/${todo.length}`);
    } catch (err) {
      result.errors.push(`docs ${i + 1}-${i + chunk.length} failed, stopping: ${firstLine(err)}`);
      break;
    }
  }
  return result;
}

// ───────────────────────────────────────── CLI ─────────────────────────────────────────

const USAGE = `Usage:
  node scripts/migrateLegacyLeaveStatuses.js --project <id> [--apply] [--user <uid>] [--out <dir>]
  node scripts/migrateLegacyLeaveStatuses.js --project <id> --restore <backup.jsonl> [--apply]

  --project <id>       REQUIRED. Firebase project to run against (e.g. white-coffee-92c27).
  --apply              Actually write. Without it this is a DRY RUN and NOTHING is written to Firestore.
  --user <uid>         Only migrate this user.
  --out <dir>          Where the plan/backup JSONL goes (default ./migration-out). It holds employee data.
  --restore <file>     Put the docs in a backup file back the way they were (dry run unless --apply).
  --help               Show this text.`;

const VALUE_FLAGS = new Set(["--project", "--user", "--out", "--restore"]);

/** Pure. -> { options } | { error } | { help: true } */
function parseArgs(argv) {
  const values = {};
  let apply = false;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (name !== "--apply" && !VALUE_FLAGS.has(name)) {
      return { error: name.startsWith("-") ? `unknown flag ${name}` : `unexpected argument ${JSON.stringify(arg)}` };
    }
    if (seen.has(name)) return { error: `${name} given more than once` };
    seen.add(name);
    if (name === "--apply") {
      if (inline !== undefined) return { error: "--apply takes no value" };
      apply = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: `${name} requires a value` };
      i += 1;
    }
    if (value === "") return { error: `${name} requires a value` };
    values[name.slice(2)] = value;
  }
  if (!values.project) return { error: "--project <id> is required (the script will not guess which Firebase project to touch)" };
  if (values.user !== undefined && values.user.includes("/")) return { error: "--user must be a user id, not a path" };
  if (values.restore !== undefined) {
    if (values.user !== undefined) return { error: "--user cannot be combined with --restore" };
    if (values.out !== undefined) return { error: "--out cannot be combined with --restore" };
  }
  return {
    options: {
      project: values.project,
      apply,
      user: values.user === undefined ? null : values.user,
      out: values.out === undefined ? "./migration-out" : values.out,
      restore: values.restore === undefined ? null : values.restore,
    },
  };
}

function bannerLines({ apply, emulator, projectId, restore }) {
  const lines = [];
  const bar = "=".repeat(72);
  if (emulator) {
    lines.push(bar, "*** EMULATOR *** FIRESTORE_EMULATOR_HOST is set: this talks to a local emulator, NOT production.", bar);
  }
  const what = restore ? "RESTORE" : "MIGRATE legacy PL/LWP -> SCHL/USCHL";
  lines.push(`${what} — project: ${projectId}`);
  if (apply) {
    lines.push(restore
      ? "APPLY: docs in the backup file WILL be overwritten in Firestore."
      : "APPLY: legacy docs WILL be rewritten in Firestore (a backup is written to disk first).");
  } else {
    lines.push(restore
      ? "DRY RUN: NOTHING will be written to Firestore. Add --apply to restore."
      : "DRY RUN: NOTHING will be written to Firestore (only a plan file is written to disk). Add --apply to write.");
  }
  return lines;
}

function exitCodeForMigration(summary) {
  if (summary.errors && summary.errors.length > 0) return 1;
  if (summary.apply && summary.remaining !== 0) return 1;
  return 0;
}

function exitCodeForRestore(result) {
  return result.errors && result.errors.length > 0 ? 1 : 0;
}

function printMigrationSummary(s, log) {
  log("");
  log(`Users scanned:        ${s.users}`);
  log(`Legacy docs found:    ${s.planned}`);
  log(`  PL   -> SCHL (credit 1):             ${s.found.PL}`);
  log(`  LWP  -> SCHL (credit 0, non-admin):  ${s.found.LWP_auto}`);
  log(`  LWP  -> USCHL (admin-marked):        ${s.found.LWP_admin}`);
  const months = Object.keys(s.byMonth).sort();
  if (months.length) {
    log("Per month (PL / LWP):");
    months.forEach((m) => log(`  ${m}: ${s.byMonth[m].PL} / ${s.byMonth[m].LWP}`));
  }
  log(`Plan/backup file:     ${s.backupFile}`);
  if (s.apply) {
    log(`Written:              ${s.written} of ${s.planned}`);
    log(`Skipped (changed since the scan): ${s.skippedChanged.length}`);
    s.skippedChanged.forEach((p) => log(`  ${p}`));
    if (s.skippedChanged.length) log("  These docs were edited or deleted while the script ran and were NOT written. Re-run --apply to pick them up.");
    log(`Legacy docs REMAINING: ${s.remaining === null ? "unknown (re-scan failed)" : s.remaining}   (expected 0)`);
  } else {
    log("");
    log("DRY RUN complete — NOTHING was written to Firestore. Inspect the file above, then re-run with --apply.");
  }
  (s.errors || []).forEach((e) => log(`ERROR: ${e}`));
}

async function main(argv, env = process.env, log = console.log) {
  const parsed = parseArgs(argv);
  if (parsed.help) { log(USAGE); return 0; }
  if (parsed.error) { console.error(`error: ${parsed.error}\n\n${USAGE}`); return 2; }
  const { project, apply, user, out, restore } = parsed.options;

  const admin = loadAdmin();
  bannerLines({ apply, emulator: !!env.FIRESTORE_EMULATOR_HOST, projectId: project, restore: !!restore }).forEach((l) => log(l));
  admin.initializeApp({ projectId: project });
  try {
    const db = admin.firestore();
    if (restore) {
      const result = await runRestore({ db, Timestamp: admin.firestore.Timestamp, file: path.resolve(process.cwd(), restore), apply, log });
      log(apply ? `Restored ${result.restored} of ${result.toRestore} doc(s).` : "DRY RUN complete — NOTHING was written to Firestore.");
      if (result.skippedChanged.length) log(`${result.skippedChanged.length} doc(s) were edited or deleted since the migration and were LEFT ALONE (listed above).`);
      result.errors.forEach((e) => log(`ERROR: ${e}`));
      return exitCodeForRestore(result);
    }
    const summary = await runMigration({
      db, FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp, now: new Date(),
      projectId: project, apply, outDir: path.resolve(process.cwd(), out), userId: user || undefined, log,
    });
    printMigrationSummary(summary, log);
    return exitCodeForMigration(summary);
  } finally {
    await admin.app().delete().catch(() => {});
  }
}

if (require.main === module) {
  // Message only — no stack, so nothing sensitive from a credentials failure is dumped.
  // (The Firestore gRPC client can throw a missing-credentials error from inside its own async
  // machinery, outside any promise we hold, so the process-level handlers are needed too.)
  const fail = (err) => {
    console.error(`\nFAILED: ${firstLine(err)}`);
    console.error("Nothing was written to Firestore unless a 'committed' or 'restored' line appeared above.");
    console.error("Auth: run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file.");
    process.exit(1);
  };
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, fail);
}

module.exports = {
  planLegacyStatusMigration, runMigration, runRestore, parseArgs, exitCodeForMigration, exitCodeForRestore,
  bannerLines, encodeValue, decodeValue,
};
