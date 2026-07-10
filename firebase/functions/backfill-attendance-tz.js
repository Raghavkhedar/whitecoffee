/**
 * One-off remediation for the UTC/IST weekday off-by-one bug in
 * computeDailyAttendanceStatus (fixed in index.js: getUTCDay on a UTC-parsed date).
 *
 * The bug made the nightly job:
 *   - treat every Monday (IST) as Sunday  -> SKIPPED   (no status/daily_hours written)
 *   - treat every Sunday (IST) as a workday -> WROTE docs (office/admin got "Absent" -2)
 *
 * This script does two things over a date range:
 *   PHASE 1 (cleanup):  delete auto-written attendance_status docs that fall on a Sunday.
 *                       Admin-marked docs (markedBy !== "auto") are NEVER touched.
 *   PHASE 2 (backfill): for each working day (Mon-Sat, non-holiday) with NO status doc,
 *                       recompute status + daily_hours using the SAME logic as the
 *                       cloud function, and (optionally) apply PL deductions.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN and only prints what it *would* do.
 * Set DRY_RUN=false to actually write/delete.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   Uses Application Default Credentials. Before running once:
 *     gcloud auth application-default login
 *   (or export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json)
 *
 * ── Run ───────────────────────────────────────────────────────────────────────
 *   cd firebase/functions
 *   node backfill-attendance-tz.js                 # dry run, default range
 *   START=2026-07-01 END=2026-07-09 node backfill-attendance-tz.js
 *   DRY_RUN=false APPLY_PL=true node backfill-attendance-tz.js   # commit changes
 */

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "white-coffee-92c27" });
const db = admin.firestore();

// ── Config (env-overridable) ─────────────────────────────────────────────────
const DRY_RUN   = process.env.DRY_RUN !== "false";      // default: dry run
const APPLY_PL  = process.env.APPLY_PL === "true";       // default: do NOT touch plBalance
// Real data only began in early July (the function crashed on a missing index
// through mid/late June and wrote nothing). Default the backfill window to July.
const START     = process.env.START || "2026-07-01";
const END        = process.env.END   || istYesterday();  // never backfill "today"

// ── Helpers copied verbatim from functions/index.js so behaviour matches ──────
const OPS_IN_TYPES  = new Set(["site_in", "market_in"]);
const OPS_OUT_TYPES = new Set(["site_out", "market_out"]);

function toMinutes(hhmm, fallback) {
  if (!hhmm || typeof hhmm !== "string") return fallback;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return h * 60 + m;
}
function getHourIST(timestamp) {
  if (!timestamp) return -1;
  const istMs = timestamp.toDate().getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).getUTCHours();
}
function getMinuteIST(timestamp) {
  if (!timestamp) return 0;
  const istMs = timestamp.toDate().getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).getUTCMinutes();
}
// Weekday read in UTC on a UTC-parsed date string — the CORRECT way (matches the fix).
function isSunday(dateStr) { return new Date(dateStr + "T00:00:00Z").getUTCDay() === 0; }

function istYesterday() {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  nowIST.setUTCDate(nowIST.getUTCDate() - 1);
  return nowIST.toISOString().slice(0, 10);
}
function* dateRange(start, end) {
  const cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur <= last) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== Attendance TZ backfill ===`);
  console.log(`Mode:   ${DRY_RUN ? "DRY RUN (no writes)" : "!!! LIVE — WILL WRITE/DELETE !!!"}`);
  console.log(`Range:  ${START} .. ${END}   |  APPLY_PL=${APPLY_PL}\n`);

  // Preload users (active only — same filter as the function) and holidays.
  const usersSnap = await db.collection("users").get();
  const allUsers  = usersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.active !== false);

  const holidaySnap = await db.collection("holidays").get();
  const holidaySet  = new Set(holidaySnap.docs.map((h) => h.id));

  // ── PHASE 1: delete auto-written Sunday status docs ─────────────────────────
  console.log(`--- PHASE 1: false Sunday status docs ---`);
  const statusSnap = await db.collectionGroup("attendance_status").get();
  let sundayDel = 0, sundaySkippedAdmin = 0;
  const delBatch = db.batch();
  for (const doc of statusSnap.docs) {
    const d = doc.data();
    const date = d.date || doc.id;
    if (!isSunday(date)) continue;
    if (date < START || date > END) continue;            // stay within range
    if (d.markedBy && d.markedBy !== "auto") {            // protect admin overrides
      sundaySkippedAdmin++;
      console.log(`  KEEP  ${date}  ${d.employeeId || d.userId}  (markedBy=${d.markedBy})`);
      continue;
    }
    sundayDel++;
    console.log(`  DELETE ${date}  ${d.employeeId || d.userId}  status=${d.status}`);
    if (!DRY_RUN) delBatch.delete(doc.ref);
    // Also drop any daily_hours the same day would have produced (Sundays shouldn't have them,
    // but delete defensively so nothing dangles).
    if (!DRY_RUN) delBatch.delete(db.doc(`users/${d.userId || doc.ref.parent.parent.id}/daily_hours/${date}`));
  }
  if (!DRY_RUN && sundayDel) await delBatch.commit();
  console.log(`  -> ${sundayDel} deleted, ${sundaySkippedAdmin} admin-marked kept\n`);

  // ── PHASE 2: backfill missing working days ──────────────────────────────────
  console.log(`--- PHASE 2: backfill missing working days ---`);
  let written = 0, plDeductions = 0;

  for (const date of dateRange(START, END)) {
    if (isSunday(date)) continue;
    if (holidaySet.has(date)) { continue; }

    // Events for this date, grouped by user.
    const attendSnap = await db.collectionGroup("attendance").where("date", "==", date).get();
    const eventsByUser = new Map();
    attendSnap.docs.forEach((doc) => {
      const e = doc.data();
      if (!eventsByUser.has(e.userId)) eventsByUser.set(e.userId, []);
      eventsByUser.get(e.userId).push(e);
    });

    // Approved leaves covering this date.
    const leavesSnap = await db.collectionGroup("leave_requests").get();
    const leavesOnDate = new Map();
    leavesSnap.docs.forEach((doc) => {
      const l = doc.data();
      if (l.status === "approved" && l.fromDate <= date && l.toDate >= date) leavesOnDate.set(l.userId, l);
    });

    const dayBatch = db.batch();
    const dayPlDeducts = [];

    for (const user of allUsers) {
      // Skip users who already have a status doc for this day (incl. admin overrides).
      const existing = await db.doc(`users/${user.id}/attendance_status/${date}`).get();
      if (existing.exists) continue;

      const events = (eventsByUser.get(user.id) || []).sort(
        (a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)
      );
      const isOps = user.role === "operations";
      const leave = leavesOnDate.get(user.id);

      let plan = null;
      if (isOps) {
        const planDoc = await db.doc(`users/${user.id}/planned_hours/${date}`).get();
        if (planDoc.exists) {
          const p = planDoc.data();
          if (p.startTime && p.endTime) plan = p;
        }
      }

      // Ops with neither plan nor leave -> day left unmarked (same as the function).
      if (isOps && !plan && !leave) continue;

      let startMin = isOps ? toMinutes(plan?.startTime, 10 * 60) : 10 * 60;
      let endMin   = isOps ? toMinutes(plan?.endTime,   18 * 60) : 18 * 60;
      if (endMin <= startMin) { startMin = 10 * 60; endMin = 18 * 60; }

      const checkIns  = events.filter((e) => isOps ? OPS_IN_TYPES.has(e.type)  : e.type === "office_in");
      const checkOuts = events.filter((e) => isOps ? OPS_OUT_TYPES.has(e.type) : e.type === "office_out");
      let status;

      if (checkIns.length > 0 && checkOuts.length > 0) {
        const firstIn  = checkIns[0];
        const lastOut  = checkOuts[checkOuts.length - 1];
        const inMinutes  = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
        const outMinutes = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);
        const offMinutes = Math.max(0, inMinutes - startMin) + Math.max(0, endMin - outMinutes);
        if (offMinutes === 0) status = "Present";
        else if (offMinutes <= 120) status = "SL";
        else status = "HalfDay";
      } else if (checkIns.length > 0 || checkOuts.length > 0) {
        status = "LNF";
      } else if (leave) {
        const balance = user.plBalance || 0;
        if (balance > 0) { status = "PL"; dayPlDeducts.push(user.id); }
        else status = "LWP";
      } else {
        status = "Absent";
      }

      console.log(`  WRITE ${date}  ${user.employeeId || user.id}  ${user.role}  -> ${status}`);
      written++;

      if (!DRY_RUN) {
        dayBatch.set(db.doc(`users/${user.id}/attendance_status/${date}`), {
          date, userId: user.id, userName: user.name || "",
          employeeId: user.employeeId || "", role: user.role, status,
          markedBy: "auto", updatedAt: admin.firestore.Timestamp.now(),
        });
      }

      // daily_hours only on fully-worked days.
      if (checkIns.length > 0 && checkOuts.length > 0) {
        const firstIn = checkIns[0];
        const lastOut = checkOuts[checkOuts.length - 1];
        const inMin   = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
        const outMin  = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);
        const plannedMins  = Math.max(0, endMin - startMin);
        const actualMins   = Math.max(0, outMin - inMin);
        const shortageMins = Math.max(0, inMin - startMin) + Math.max(0, endMin - outMin);
        const otMins       = Math.max(0, outMin - endMin);
        if (!DRY_RUN) {
          dayBatch.set(db.doc(`users/${user.id}/daily_hours/${date}`), {
            date, userId: user.id, role: user.role,
            plannedMins, actualMins, shortageMins, otMins,
            updatedAt: admin.firestore.Timestamp.now(),
          });
        }
      }
    }

    if (!DRY_RUN) await dayBatch.commit();
    if (APPLY_PL && !DRY_RUN) {
      for (const uid of dayPlDeducts) {
        await db.doc(`users/${uid}`).update({ plBalance: admin.firestore.FieldValue.increment(-1) });
      }
    }
    plDeductions += dayPlDeducts.length;
  }

  console.log(`  -> ${written} status docs ${DRY_RUN ? "would be" : ""} written`);
  console.log(`  -> ${plDeductions} PL deduction(s) ${APPLY_PL ? (DRY_RUN ? "would apply" : "applied") : "NOT applied (APPLY_PL=false)"}\n`);

  console.log(`=== ${DRY_RUN ? "DRY RUN complete — re-run with DRY_RUN=false to commit" : "DONE"} ===\n`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
