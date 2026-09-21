"use strict";

/**
 * One-off repair: re-score ONE past IST date with the real nightly body (nightlyRunner.js).
 *
 * Why it exists: on 2026-09-07 the nightly failed on a missing collection-group index and the job
 * only ever scored "today", so that date was never scored for anyone (0 status docs, 12 employees
 * had punched). This runs `runNightlyScoring` with `today` pinned to the missed date so the repair
 * is decided by exactly the code that decides every other night — no second copy of the rules.
 *
 *   node scripts/backfillNightlyDate.js --project white-coffee-92c27 --date 2026-09-07           (dry run)
 *   node scripts/backfillNightlyDate.js --project white-coffee-92c27 --date 2026-09-07 --apply
 *
 * Dry run (the default) reads production but writes NOTHING: every batch set / transaction write /
 * summary write is recorded and printed instead.
 *
 * Differences from a normal night, both deliberate:
 *  - Employees whose `createdAt` (IST date) is AFTER the target date are hidden from the run. The
 *    runner scores every user that exists NOW, so without this a user hired on 09-15 would be
 *    handed an Absent (-2 days) for 09-07, before they worked here.
 *  - Refuses today's date and any future date (the real nightly owns those).
 * Known and accepted: a leave day scored SCHL draws from the user's CURRENT plBalance, and the
 * runner's own rules skip an admin-marked day and rewrite an auto day deterministically, so
 * re-running this for the same date is idempotent.
 */

const IST_MS = 5.5 * 3600 * 1000;

/** IST "yyyy-mm-dd" of a Date (never bare getDate(): cloud/dev machines are not on IST). */
function istDateOf(date) {
  return new Date(date.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** True when a user record was created after `date` (IST) and so must not be scored for it. */
function createdAfter(user, date) {
  const c = user.createdAt;
  if (!c) return false; // no createdAt: a legacy user, treat as existing
  const d = typeof c.toDate === "function" ? c.toDate() : new Date(c);
  if (Number.isNaN(d.getTime())) return false;
  return istDateOf(d) > date;
}

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--date") out.date = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function validateDate(date, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("--date yyyy-mm-dd is required");
  const t = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date) throw new Error(`not a calendar date: ${date}`);
  const today = istDateOf(new Date(nowMs));
  if (date >= today) throw new Error(`refusing ${date}: only PAST dates (today IST is ${today}); the real nightly owns today`);
}

/**
 * Wrap `db` so the runner sees only users that existed on `date`. In dry-run mode it also swaps
 * batch / runTransaction / doc().set for recorders, so nothing reaches Firestore.
 * `sink` receives { op, path, data }.
 */
function makeBackfillDb(db, { date, dryRun, sink, skipped }) {
  const wrapped = Object.create(db);

  wrapped.collection = (name) => {
    const ref = db.collection(name);
    if (name !== "users") return ref;
    const view = Object.create(ref);
    view.get = async () => {
      const snap = await ref.get();
      const docs = snap.docs.filter((d) => {
        const hide = createdAfter(d.data(), date);
        if (hide) skipped.push({ id: d.id, name: d.data().name, employeeId: d.data().employeeId });
        return !hide;
      });
      return { docs, size: docs.length, empty: docs.length === 0 };
    };
    return view;
  };

  if (!dryRun) return wrapped;

  wrapped.doc = (path) => {
    const ref = db.doc(path);
    const view = Object.create(ref);
    view.set = async (data) => { sink({ op: "set", path, data }); };
    view.update = async (data) => { sink({ op: "update", path, data }); };
    return view;
  };
  wrapped.batch = () => ({
    set(ref, data) { sink({ op: "set", path: ref.path, data }); },
    async commit() {},
  });
  wrapped.runTransaction = async (fn) => fn({
    get: (target) => target.get(),
    getAll: (...refs) => db.getAll(...refs),
    set: (ref, data) => sink({ op: "tx.set", path: ref.path, data }),
    update: (ref, data) => sink({ op: "tx.update", path: ref.path, data }),
    create: (ref, data) => sink({ op: "tx.create", path: ref.path, data }),
    delete: (ref) => sink({ op: "tx.delete", path: ref.path }),
  });
  return wrapped;
}

function describe(value) {
  return JSON.stringify(value, (k, v) => {
    if (v && typeof v.toDate === "function") return `<ts ${istDateOf(v.toDate())}>`;
    if (v && v.constructor && /FieldValue|Increment|Delete/.test(v.constructor.name)) return `<${v.constructor.name}>`;
    return v;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) throw new Error("--project is required");
  validateDate(args.date, Date.now());

  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: args.project });
  const { runNightlyScoring } = require("../nightlyRunner");

  const dryRun = !args.apply;
  const writes = [];
  const skipped = [];
  const db = makeBackfillDb(admin.firestore(), { date: args.date, dryRun, sink: (w) => writes.push(w), skipped });

  console.log(`${dryRun ? "DRY RUN (nothing is written)" : "APPLY (writes to production)"} — re-scoring ${args.date} on ${args.project}`);
  await runNightlyScoring({
    db,
    Timestamp: admin.firestore.Timestamp,
    FieldValue: admin.firestore.FieldValue,
    today: args.date,
    startedAt: admin.firestore.Timestamp.now(),
    clockSource: "backfill",
    log: console,
  });

  console.log(`\nEmployees hidden (created after ${args.date}): ${skipped.length}`);
  skipped.forEach((u) => console.log(`  ${u.name} | ${u.employeeId} | ${u.id}`));
  if (dryRun) {
    const byStatus = {};
    writes.filter((w) => /attendance_status\//.test(w.path)).forEach((w) => {
      const k = `${w.data.status}${w.data.salaryCredit !== undefined ? `/credit ${w.data.salaryCredit}` : ""}`;
      byStatus[k] = (byStatus[k] || 0) + 1;
    });
    console.log(`\nPlanned writes: ${writes.length}`);
    console.log("Status docs by outcome:", JSON.stringify(byStatus));
    writes.forEach((w) => console.log(`  ${w.op} ${w.path} ${describe(w.data).slice(0, 220)}`));
    console.log("\nDRY RUN complete — nothing was written. Re-run with --apply.");
  } else {
    console.log("\nAPPLY complete. See the summary doc system/nightly_runs/computeDailyAttendanceStatus/" + args.date);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0), (err) => { console.error("FAILED:", err.message); process.exit(1); });
}

module.exports = { istDateOf, createdAfter, parseArgs, validateDate, makeBackfillDb };
