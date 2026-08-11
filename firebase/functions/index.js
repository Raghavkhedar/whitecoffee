// Deploy stamp: 2026-06-30 — step 6b payroll arrears + step 7 lifetime-counter retirement.
const { setGlobalOptions } = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { google } = require("googleapis");
// Attendance scoring rule — shared with the Android preview (see attendanceRules.js header).
const {
  OFFICE_START_MIN,
  OFFICE_END_MIN,
  classify,
  resolveOpsWindow,
} = require("./attendanceRules");
// Site Manpower Time Utilisation — pure visit builder (see manpowerVisits.js).
const { buildManpowerVisits } = require("./manpowerVisits");
// Month-history helpers for the Employee Dashboard tab (see dashboardHistory.js).
const { bannerFor, parseBlocks, monthLabelToKey, assembleTab } = require("./dashboardHistory");
// PF / ESI / Imprest percentages of Salary Due MTD (see payrollDeductions.js).
const { computeDeductions } = require("./payrollDeductions");
// Per-day OT / shortage / rest-day ledger — single source of truth (see otLedger.js).
const {
  computeDayLedger, DEFAULT_SHIFT_START_MIN, DEFAULT_SHIFT_END_MIN,
} = require("./otLedger");
// Range/month OT/shortage/WO aggregation for the Employee Dashboard's live column (otAggregate.js).
const { computeRangeLedger, settlementCash, dailyOtWoCash } = require("./otAggregate");
// Pure per-day spend decomposition for the Daily Spend Snapshot (see dailySpend.js).
const {
  dailySalary, dailyDeductions, dailyTotal, round2, openWindowMonths, saRowPatch,
} = require("./dailySpend");
// Pure spend categorisation for the Forecasting export (see forecastSpend.js).
const forecast = require("./forecastSpend");
// Per-role behavior axes — single source of truth (see roleCapabilities.js). Routes
// office/operations/sales/admin decisions through predicates instead of `isOps`.
const {
  attendanceInTypes,
  attendanceOutTypes,
  usesFixedWindow,
  usesOtShortageLedger,
  usesConveyance,
  inManpowerReports,
  rolesWith,
} = require("./roleCapabilities");
// Partial leave approval — which dates an approved leave actually grants (see
// leaveCoverage.js). Missing/empty `approvedDates` = the whole range, so legacy
// leaves and the Android approve action keep their current meaning.
const { leaveCoversDate, explicitGrantedDates, grantedDayCount } = require("./leaveCoverage");
// Pay fields resolved from users/{uid}/compensation/current with per-field fallback to
// the legacy inline fields — see compensation.js for why the split exists.
const { withPay } = require("./compensation");
// Server-side verdict on client-written punches — see punchIntegrity.js for why this is
// detection rather than prevention (offline check-in must keep working).
const { assessPunch } = require("./punchIntegrity");
// Is a punch structurally possible given the rest of its day? A punch can be individually
// honest and still impossible in sequence — see punchSequence.js.
const { assessSequence, isDayOpen } = require("./punchSequence");
// Auto-file a regularization for a day that scored LNF because a check-out was forgotten.
const { needsAutoRegularization, buildAutoRegularization } = require("./unclosedDay");
// Before/after audit entry for every write — see auditLog.js on why the actor is
// best-effort and why there is no IP.
const { buildEntry } = require("./auditLog");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

// Verify the caller is a signed-in admin (role === "admin" in their user doc).
// Throws HttpsError so callable clients get a clean permission-denied.
async function assertAdmin(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  return uid;
}

// Operations field-work events: a worked day spans the first arrival and last
// departure across both site and market visits (home events are commute bookends
// and never count toward the working window).
const OPS_IN_TYPES  = new Set(["site_in", "market_in"]);
const OPS_OUT_TYPES = new Set(["site_out", "market_out"]);

const SHEETS_KEY   = defineSecret("ATTENDANCE_SHEETS_KEY");
const MAPS_KEY     = defineSecret("MAPS_API_KEY");
// Sheet1: Employee Dashboard, Leave Requests, Conveyance
const SHEET_ID_1 = "1Qwi1-H13OEAQmVWVf2VRahpG8NiUIDow-QQKQKWh57M";
// Sheet2: Attendance
const SHEET_ID_2 = "1Te3esJocJvBYp9r2yFyB9lp4onKJUSy4Hobe3LkBzYM";
// Sheet3: MT Requests
const SHEET_ID_3 = "10l2g55q_yPrirjD71u70D6K_9seED6NOjCadJ0kgeIU";
// Sheet4: MT Purchases
const SHEET_ID_4 = "1Gc1mRffcjEmZnk6aeOVf3eTcNCk1qfeTdsnkk5-OFdE";
// Sheet5: Material Transfers
const SHEET_ID_5 = "1Hy4GJ57Cn-uln7k3xXtJxI6Ka_VofDbJz1XYGqs2qGY";
// Sheet6: Tool Transfers
const SHEET_ID_6 = "1Ar1d7kNwgOB5w6MSGX40MAXorR9dpzr3oN72Wa-JQE4";
// Sheet7: Work Progress
const SHEET_ID_7 = "1c2JtarmbteClXaADF666WYEGNmx4CozM7EKo7bcteKE";
// Sheet8: Overtime Exception Report (ops OT days, current month)
const SHEET_ID_OT = "1DNJKQfvm238ZmULF7ScJAXRtxzzjYjk87jV4QMR2VjA";
// Sheet9: Site Manpower Time Utilisation (ops per-site visits, current month)
const SHEET_ID_MANPOWER = "1U66-ldSNMm01f3rnJabJe0BxTUFvDglSX5rAFqXDJZ4";
// Forecasting export target + the MDD ledger source (read-only). See forecastSpend.js.
const FORECAST_SHEET_ID = "1ON35PHx0B5vZAUwhvPQ5IYL-3JK_Rqy4dCfMrs11NKo";
const MDD_SHEET_ID = "1rsmpHOeOeVBG8XzIFZlnEAa2pzyxr4S0UYOYGyulFyQ";
// Bank-statement ledger — the ONLY source for the "Rental of Space" category. Read-only.
const BANK_SHEET_ID = "10-8a0KmY7BI21mG5d3LuTPXHL0L-WJ7Zkj6Dfp9kvrA";

// Conveyance rates are now stored in Firestore (config/conveyance) and
// assigned per employee (user.conveyanceRateType = 1 or 2).
// Fallback if config is missing:
const CONVEYANCE_RATE_FALLBACK = 2.5;

const TABS = {
  EMPLOYEE_DASHBOARD: "Employee Dashboard",
  CONVEYANCE:         "Conveyance",
  ATTENDANCE:         "Attendance",
  REQUESTS:           "MT Requests",
  PURCHASES:          "MT Purchases",
  MATERIAL_TRANSFERS: "Material Transfers",
  TOOL_TRANSFERS:     "Tool Transfers",
  WORK_PROGRESS:      "Work Progress",
  LEAVE_REQUESTS:     "Leave Requests",
  OT_EXCEPTION:       "Overtime Exception Report",
  MANPOWER:           "Manpower Utilisation",
};

async function getRoadKm(lat1, lon1, lat2, lon2, apiKey) {
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat1},${lon1}&destinations=${lat2},${lon2}&key=${apiKey}`;
    const res  = await fetch(url);
    const json = await res.json();
    const el   = json.rows?.[0]?.elements?.[0];
    return el?.status === "OK" ? el.distance.value / 1000 : 0;
  } catch {
    return 0;
  }
}

function ts(timestamp) {
  if (!timestamp) return "";
  return timestamp.toDate().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function timeIST(timestamp) {
  if (!timestamp) return "";
  return timestamp.toDate().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  });
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

// ── OT ledger ─────────────────────────────────────────────────────────────
// computeDayLedger / DEFAULT_SHIFT_* imported from ./otLedger (shared with the
// Android preview via admin/src/lib/otLedger.ts) so the Attendance tab's
// "OT (mins)" column equals the number an admin sees on the Employee
// Dashboard — the portal computes OT live in the browser and never stores it.

function hhmmToMin(s) {
  if (!s) return null;
  const [h, m] = String(s).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Minutes → "HH:MM" (e.g. 80 → "01:20", 0 → "00:00"). Used by the OT report for
// both durations (OVER TIME / TIME APPROVED) and clock times (PRE-LOGIN /
// POST-LOGOUT fallback when there's no raw event, i.e. a regularized override).
function minToHHMM(mins) {
  const n = Math.max(0, Math.round(mins || 0));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

// Resolve the owning user id for an exported doc, whether it's a top-level doc
// (carries a userId field) or a subcollection doc under users/{uid}/...
function uidOf(doc) {
  const d = doc.data();
  if (d.userId) return d.userId;
  const parent = doc.ref.parent.parent;
  return parent ? parent.id : "";
}

async function ensureTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
  }
}

async function writeTab(sheets, spreadsheetId, tabName, rows) {
  await ensureTab(sheets, spreadsheetId, tabName);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName });
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

// ── Monthly PL Accrual — midnight IST on 1st of each month ──────────────────
// ⚠️ IDEMPOTENCY IS LOAD-BEARING HERE. This function does a blind
// `increment(1)` on every user's plBalance, so running it twice for the same month
// silently grants everyone a free paid leave day — real money, and invisible until
// someone audits balances. It therefore claims a per-month marker doc with
// `batch.create()`, which FAILS if the marker already exists. Because a Firestore
// batch is atomic, the claim and the increments land together or not at all: a second
// run (scheduler retry, manual re-trigger, overlapping instance) aborts the entire
// batch and no balance moves. Do not replace `create` with `set` — `set` overwrites
// and re-opens the double-accrual hole.
exports.accrueMonthlyLeave = onSchedule(
  {
    schedule: "0 0 1 * *", timeZone: "Asia/Kolkata", timeoutSeconds: 120,
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();

    // IST month key. The run fires at 00:00 IST on the 1st, which is 18:30 UTC on the
    // *previous* day — a bare `new Date()` here would name the wrong month. Shift +05:30
    // and read UTC parts, per the monorepo's IST rule.
    const nowIST   = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const monthKey = nowIST.toISOString().slice(0, 7); // YYYY-MM

    const usersSnap = await db.collection("users").get();

    // Firestore caps a batch at 500 writes; this one is users + 1 marker. Fail loudly
    // rather than silently truncating payroll if the company ever outgrows that.
    if (usersSnap.size + 1 > 500) {
      throw new Error(
        `accrueMonthlyLeave: ${usersSnap.size} users exceeds the 500-write batch limit — ` +
        `split into chunked batches before this can run safely.`
      );
    }

    const batch = db.batch();
    usersSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { plBalance: admin.firestore.FieldValue.increment(1) });
    });
    // The guard: create() throws ALREADY_EXISTS if this month was already accrued,
    // which aborts the whole atomic batch — including every increment above.
    batch.create(db.doc(`system/accruals/monthly/${monthKey}`), {
      month: monthKey,
      appliedTo: usersSnap.size,
      ranAt: admin.firestore.Timestamp.now(),
    });

    try {
      await batch.commit();
    } catch (err) {
      if (err && (err.code === 6 || err.code === "already-exists")) {
        console.log(`accrueMonthlyLeave: ${monthKey} already accrued — skipping (no balances changed)`);
        return;
      }
      throw err; // transient/infra — let the scheduler retry
    }
    console.log(`accrueMonthlyLeave: +1 PL applied to ${usersSnap.size} users for ${monthKey}`);
  }
);

// ── Daily Attendance Status — 23:59 IST, ALL users ──────────────────────────
exports.computeDailyAttendanceStatus = onSchedule(
  // Retry-safe: status/daily_hours writes are `set` with deterministic doc IDs, and the
  // PL decrement is gated on `priorStatus`, which a retry re-reads — so a re-run cannot
  // double-deduct. Per-user failures are caught below and deliberately do NOT throw
  // (retrying will not fix bad data); only infra failures reach the scheduler.
  {
    schedule: "59 23 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300,
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const today  = nowIST.toISOString().slice(0, 10);

    const usersSnap   = await db.collection("users").get();
    // Offboarded users (active === false) are skipped entirely — no status doc, no
    // Absent penalty. Legacy users have no `active` field (missing = active).
    const allUsers    = usersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.active !== false);

    const attendSnap = await db.collectionGroup("attendance").where("date", "==", today).get();
    const eventsByUser = new Map();
    attendSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (!eventsByUser.has(d.userId)) eventsByUser.set(d.userId, []);
      eventsByUser.get(d.userId).push(d);
    });

    const leavesSnap = await db.collectionGroup("leave_requests").get();
    const leavesToday = new Map();
    leavesSnap.docs.forEach((doc) => {
      const d = doc.data();
      // A partially-approved leave grants only its `approvedDates`. An ungranted
      // date is simply absent from this map, so the day scores as a normal
      // working day (→ Absent when unpunched) through the existing path.
      if (leaveCoversDate(d, today)) leavesToday.set(d.userId, d);
    });

    // Skip users whose attendance_status was manually set by admin (regularization approvals)
    // Read per-user docs directly to avoid needing a collectionGroup index on date.
    const adminOverrides = new Set();
    const priorStatus    = new Map(); // userId → status already recorded for today
    const statusChecks = allUsers.map(async (user) => {
      const statusDoc = await db.doc(`users/${user.id}/attendance_status/${today}`).get();
      if (statusDoc.exists) {
        if (statusDoc.data().markedBy === "admin") adminOverrides.add(user.id);
        priorStatus.set(user.id, statusDoc.data().status);
      }
    });

    // Operations have variable shifts: admin sets a planned start/end per day.
    // Status is evaluated against that window. No plan → day left unmarked.
    const plannedHours = new Map(); // userId → { startTime, endTime }
    const planChecks = allUsers
      .filter((u) => !usesFixedWindow(u.role)) // planned-shift roles (operations) only
      .map(async (user) => {
        const planDoc = await db.doc(`users/${user.id}/planned_hours/${today}`).get();
        if (planDoc.exists) {
          const p = planDoc.data();
          if (p.startTime && p.endTime) plannedHours.set(user.id, p);
        }
      });

    await Promise.all([...statusChecks, ...planChecks]);

    // Skip Sundays — no status written, no penalty.
    // `today` is the IST date string; read the weekday in UTC to avoid the
    // runtime's UTC timezone shifting a "+05:30 midnight" back to the prior day
    // (which made Mondays read as Sundays and vice-versa).
    const todayDate = new Date(today + "T00:00:00Z");
    if (todayDate.getUTCDay() === 0) {
      console.log(`computeDailyAttendanceStatus: skipping Sunday ${today}`);
      return;
    }

    // Skip company-wide holidays the same way — no status, no Absent penalty.
    const holidayDoc = await db.doc(`holidays/${today}`).get();
    if (holidayDoc.exists) {
      console.log(`computeDailyAttendanceStatus: skipping holiday ${today} (${holidayDoc.data().title || ""})`);
      return;
    }

    const batch           = db.batch();
    const plDeductions    = [];
    // Per-user scoring failures. A single malformed user doc must NOT cost every other
    // employee their day: all writes accumulate into ONE batch committed after the loop,
    // so an uncaught throw here used to mean nobody got scored at all — and since this
    // function only ever writes *today*, the following night would not repair it. That is
    // the failure mode behind the 2026-07-17 backfill. Collect and continue instead.
    const failures        = [];
    let   scored          = 0;

    for (const user of allUsers) {
      if (adminOverrides.has(user.id)) continue;
      try {
        const events = (eventsByUser.get(user.id) || []).sort(
          (a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)
        );

        const role        = user.role;
        const fixedWindow = usesFixedWindow(role); // office/admin/sales: fixed 10–18; operations: planned shift
        const plan  = plannedHours.get(user.id);
        const leave = leavesToday.get(user.id);

        // First check-in / last check-out across this role's event types. Operations:
        // site + market. Office/admin: office. Sales (hybrid): office + site + market —
        // scored against the same fixed window as office. Resolved BEFORE the skip below,
        // which needs to know whether the user actually worked.
        const inTypes  = attendanceInTypes(role);
        const outTypes = attendanceOutTypes(role);
        const checkIns  = events.filter((e) => inTypes.includes(e.type));
        const checkOuts = events.filter((e) => outTypes.includes(e.type));
        const worked = checkIns.length > 0 || checkOuts.length > 0;

        // Every active user is scored on every working day, all roles alike. Sundays and
        // holidays never reach this loop (both return above), offboarded users are filtered
        // out of allUsers, and admin-marked days (WO / regularization) are skipped at the top.
        // So an ops day reaching here with no plan, no leave and no punches is a no-show and
        // scores Absent — days off must be marked WO or leave.

        // Working window: fixed-window roles use 10:00–18:00; operations use the planned
        // shift the admin entered (resolveOpsWindow handles the inverted/zero-window
        // fallback). Ops with no plan keeps the 10:00–18:00 default — matching the portal's
        // otLedger DEFAULT_SHIFT_START_MIN/END_MIN, which already scored these days that way.
        let startMin = OFFICE_START_MIN;
        let endMin = OFFICE_END_MIN;
        if (!fixedWindow) {
          const window = resolveOpsWindow(plan?.startTime, plan?.endTime);
          if (window) { startMin = window.startMin; endMin = window.endMin; }
        }

        let status;

        if (checkIns.length > 0 && checkOuts.length > 0) {
          const firstIn  = checkIns[0];
          const lastOut  = checkOuts[checkOuts.length - 1];
          const inMinutes  = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
          const outMinutes = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);

          // The off-minutes formula lives in attendanceRules.classify, not inline here — inline it
          // had no test coverage, since the test suite graded its own copy of the arithmetic.
          status = classify(inMinutes, outMinutes, startMin, endMin);
        } else if (checkIns.length > 0 || checkOuts.length > 0) {
          status = "LNF";
        } else {
          if (leave) {
            const balance = user.plBalance || 0;
            if (balance > 0) {
              status = "PL";
              // Only deduct when today wasn't already counted as PL, so a re-run
              // (manual trigger / retry) doesn't decrement the balance twice.
              if (priorStatus.get(user.id) !== "PL") plDeductions.push(user.id);
            } else {
              status = "LWP";
            }
          } else {
            status = "Absent";
          }
        }

        batch.set(db.doc(`users/${user.id}/attendance_status/${today}`), {
          date: today, userId: user.id, userName: user.name || "",
          employeeId: user.employeeId || "", role: user.role, status,
          markedBy: "auto", updatedAt: admin.firestore.Timestamp.now(),
        });

        // Per-day worked hours → shortage (auto) and overtime (admin-approved later).
        // Only on fully-worked days, and only for roles that run the OT/shortage ledger
        // (operations). Fixed-window roles (office/admin/sales) have no OT/shortage.
        if (usesOtShortageLedger(role) && checkIns.length > 0 && checkOuts.length > 0) {
          const firstIn    = checkIns[0];
          const lastOut     = checkOuts[checkOuts.length - 1];
          const inMin       = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
          const outMin      = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);
          const actualMins  = Math.max(0, outMin - inMin);
          const plannedMins = Math.max(0, endMin - startMin);
          // Shortage = late-in + early-out; OT = late-out only (arriving early never earns OT).
          const shortageMins = Math.max(0, inMin - startMin) + Math.max(0, endMin - outMin);
          const otMins       = Math.max(0, outMin - endMin);

          // Per-day canonical record (the OT/shortage ledger reads this, not a lifetime counter).
          batch.set(db.doc(`users/${user.id}/daily_hours/${today}`), {
            date: today, userId: user.id, role: user.role,
            plannedMins, actualMins, shortageMins, otMins,
            updatedAt: admin.firestore.Timestamp.now(),
          });
        }
        scored++;
      } catch (err) {
        // Deterministic per-user data problem (malformed timestamp, unexpected null).
        // Retrying the whole run will not fix it, so we do NOT rethrow — we record it,
        // finish scoring everyone else, and surface it in the run summary below.
        failures.push({ userId: user.id, employeeId: user.employeeId || "", message: String(err && err.message || err) });
        console.error(`computeDailyAttendanceStatus: FAILED to score user ${user.id} (${user.employeeId || "no empId"}) for ${today}:`, err);
      }
    }

    // Commit and PL deductions stay OUTSIDE the per-user guard: a failure here is
    // infrastructural, not per-user, and SHOULD throw so Cloud Scheduler retries it.
    await batch.commit();

    // PL decrements are individual writes, so one failure must not strand the rest.
    // Re-runs are safe: `priorStatus` is re-read each run and a user already recorded
    // as PL today is never decremented twice.
    const plFailures = [];
    for (const uid of plDeductions) {
      try {
        await db.doc(`users/${uid}`).update({ plBalance: admin.firestore.FieldValue.increment(-1) });
      } catch (err) {
        plFailures.push({ userId: uid, message: String(err && err.message || err) });
        console.error(`computeDailyAttendanceStatus: FAILED PL decrement for ${uid} on ${today}:`, err);
      }
    }

    const expected = allUsers.length - adminOverrides.size;
    console.log(
      `computeDailyAttendanceStatus: ${today} — scored ${scored}/${expected} ` +
      `(${allUsers.length} active, ${adminOverrides.size} admin-marked), ` +
      `PL deducted ${plDeductions.length - plFailures.length}/${plDeductions.length}, ` +
      `failures ${failures.length}`
    );

    // Run summary — makes a partial night DETECTABLE. Without this a silent shortfall
    // only surfaces when an employee queries their payslip. Alert on `ok === false`.
    await db.doc(`system/nightly_runs/computeDailyAttendanceStatus/${today}`).set({
      date: today,
      ranAt: admin.firestore.Timestamp.now(),
      activeUsers: allUsers.length,
      adminMarked: adminOverrides.size,
      expected,
      scored,
      plDeducted: plDeductions.length - plFailures.length,
      plAttempted: plDeductions.length,
      failures,
      plFailures,
      ok: failures.length === 0 && plFailures.length === 0 && scored === expected,
    });
  }
);

// ── Forecasting export — flat SpendData + Daily Snapshot view ─────────────────
// Reads Firestore dailySpend (Manpower, per employee/day) + the MDD ledger (Vendor
// Payment / Office Expense / Communication), buckets into 22 spend
// categories, and writes a flat SpendData tab + a reactive Daily Snapshot view into the
// Forecasting sheet. Runs after snapshotDailySpend (22:30 IST) so Manpower is fresh.
// MDD is READ-ONLY; only the Forecasting sheet is written.
exports.exportForecastSpend = onSchedule(
  // Retry-safe: every tab goes through writeTab(), which clears the range and rewrites
  // it wholesale — a re-run reproduces the same sheet rather than appending.
  {
    schedule: "15 23 * * *", timeZone: "Asia/Kolkata", secrets: ["ATTENDANCE_SHEETS_KEY"],
    timeoutSeconds: 300, memory: "512MiB",
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const keyJson = JSON.parse(SHEETS_KEY.value());
    const auth = new google.auth.GoogleAuth({ credentials: keyJson, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth });
    const db = admin.firestore();
    // Computed once, up front — used for the future-date filter, the bank-ledger FY lower
    // bound, and the FY forecast entry tab name below.
    const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1) Firestore Manpower — all snapshotted months (feeds the overall running total).
    const dsSnap = await db.collection("dailySpend").get();
    const flat = forecast.dailySpendToFlat(dsSnap.docs.map((d) => d.data()));

    // 2) Resolve real MDD tab names, then read each once.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: MDD_SHEET_ID });
    const titles = meta.data.sheets.map((s) => s.properties.title);
    const vendorTab = forecast.pickTabName(titles, "vendor payment") || "Vendor Payment";
    const officeTab = forecast.pickTabName(titles, "office expense") || "Office Expense";
    const commTab = forecast.pickTabName(titles, "communication");

    const readTab = async (name) => {
      if (!name) return [];
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: MDD_SHEET_ID, range: name });
      return res.data.values || [];
    };
    const [vendorVals, officeVals, commVals] = await Promise.all(
      [vendorTab, officeTab, commTab].map(readTab));

    // 3) Per-tab tag resolvers.
    const vendorResolve = (t) => {
      const c = forecast.VENDOR_CATEGORIES[t];
      return c ? { category: c, component: "", perEmployee: false } : null;
    };
    const officeResolve = (t) => {
      const c = forecast.OFFICE_CATEGORIES[t];
      if (c) return { category: c, component: "", perEmployee: false };
      if (t === forecast.normTag("Employee Welfare & Retention")) {
        return { category: "Manpower Expense", component: "Employee Welfare & Retention", perEmployee: false };
      }
      return null;
    };
    // NOTE: the MDD "Employee Payment" tab is deliberately NOT read. Special Allowance used to
    // be scraped from it by tag, but that tag never appeared in a single live row. SA is now a
    // first-class dailySpend component (users/{uid}/specialAllowance/{YYYY-MM}) and arrives
    // through dailySpendToFlat above. Do not re-add an MDD scrape for it.
    const vendor = forecast.bucketMddTab({ values: vendorVals, resolve: vendorResolve });
    const office = forecast.bucketMddTab({ values: officeVals, resolve: officeResolve });
    const comm = forecast.bucketCommunication(commVals);

    // Rental of Space lives in a separate bank-statement ledger, not MDD. Two tabs; the third
    // tab there is a flagged-exceptions sheet and is deliberately not read. Tab titles drift
    // like the MDD tabs do, so resolve them the same way (case-insensitive substring) instead
    // of hardcoding literal names, and give each tab its own read + try/catch — renaming or
    // breaking one tab must not silence the other's contribution. bucketBankRental is pure, so
    // it is called OUTSIDE the try that guards the network read: a bug in it must surface as a
    // real crash/log, not get mislabelled as "bank tab read FAILED".
    let rentalRows = [];
    let bankTitles = [];
    try {
      const bankMeta = await sheets.spreadsheets.get({ spreadsheetId: BANK_SHEET_ID });
      bankTitles = bankMeta.data.sheets.map((s) => s.properties.title);
    } catch (e) {
      console.error(`forecast: bank ledger tab list read FAILED (Rental of Space will be 0): ${e.message}`);
    }
    for (const needle of ["bank", "tbpr"]) {
      const tabName = forecast.pickTabName(bankTitles, needle);
      if (!tabName) {
        console.warn(`forecast: bank tab matching '${needle}' not found among [${bankTitles.join(", ")}]`);
        continue;
      }
      let values;
      try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: BANK_SHEET_ID, range: tabName });
        values = res.data.values || [];
      } catch (e) {
        console.error(`forecast: bank tab '${tabName}' read FAILED (skipped): ${e.message}`);
        continue;
      }
      const b = forecast.bucketBankRental({ values });
      rentalRows = rentalRows.concat(b.rows);
      if (b.matched > 0 && b.rows.length === 0) {
        // matched > 0 but 0 rows means every matched row failed the date/amount parse — most
        // likely a two-digit-year export (dd/mm/yy), which parseDate does not accept.
        console.warn(`forecast: bank tab '${tabName}' matched ${b.matched} rental row(s) but produced 0 rows — ` +
          `likely an unparseable date format (e.g. a two-digit year, dd/mm/yy)`);
      } else {
        console.log(`forecast: bank tab '${tabName}' dateCol=${b.dateCol} amtCol=${b.amtCol} ` +
          `tagCols=[${b.tagCols.join(",")}] matched=${b.matched} rows=${b.rows.length}`);
      }
    }

    // The bank ledger is its own source with its own, potentially much longer history than the
    // MDD tabs — without a lower bound here, the Daily Snapshot's dense per-date grid (and its
    // payload) grows with however far back the bank tabs go, which can take the whole 300s
    // nightly export down. Bound bank rows ONLY to the current fiscal year; no other source's
    // filtering changes.
    const [tYear, tMonth] = todayIST.split("-").map(Number);
    const fyStartISO = `${tMonth >= 4 ? tYear : tYear - 1}-04-01`;
    const rentalBefore = rentalRows.length;
    rentalRows = rentalRows.filter((r) => r[0] >= fyStartISO);
    if (rentalBefore !== rentalRows.length) {
      console.log(`forecast: dropped ${rentalBefore - rentalRows.length} bank row(s) dated before FY start ${fyStartISO}`);
    }

    flat.push(...vendor.rows, ...office.rows, ...comm.rows, ...rentalRows);

    // 4) Typo protection — warn on any catalog tag that never appeared in its tab.
    const missVendor = Object.keys(forecast.VENDOR_CATEGORIES).filter((t) => !vendor.seenTags.has(t));
    const expectOffice = Object.keys(forecast.OFFICE_CATEGORIES).concat([forecast.normTag("Employee Welfare & Retention")]);
    const missOffice = expectOffice.filter((t) => !office.seenTags.has(t));
    if (missVendor.length) console.warn(`forecast: Vendor Payment tags NOT FOUND: ${missVendor.join(" | ")}`);
    if (missOffice.length) console.warn(`forecast: Office Expense tags NOT FOUND: ${missOffice.join(" | ")}`);
    console.log(`forecast: tabs vendor='${vendorTab}' office='${officeTab}' comm='${commTab}'`);
    console.log(`forecast: Communication dateCol=${comm.dateCol} amtCol=${comm.amtCol} rows=${comm.rows.length}`);
    // Diagnostics — real tab list + the actual tag values present in each tab + date span.
    console.log(`forecast[diag]: ALL TABS = ${titles.join(" | ")}`);
    console.log(`forecast[diag]: vendor tags seen = ${[...vendor.seenTags].join(" | ") || "(none)"}`);
    console.log(`forecast[diag]: office tags seen = ${[...office.seenTags].join(" | ") || "(none)"}`);
    const diagDates = flat.map((r) => r[0]).filter(Boolean).sort();
    console.log(`forecast[diag]: firestore manpower rows = ${flat.length - vendor.rows.length - office.rows.length - comm.rows.length - rentalRows.length}`);
    console.log(`forecast[diag]: date span ${diagDates[0]} .. ${diagDates[diagDates.length - 1]}`);
    // Drop future-dated rows (data-entry typos, e.g. a stray 2027 date) before building the grid.
    const before = flat.length;
    for (let i = flat.length - 1; i >= 0; i--) if (flat[i][0] > todayIST) flat.splice(i, 1);
    if (before !== flat.length) console.log(`forecast: dropped ${before - flat.length} future-dated row(s) after ${todayIST}`);

    // 5) Write SpendData (USER_ENTERED so the Date column lands as real dates for QUERY/MIN/MAX).
    flat.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].localeCompare(b[1])));
    const header = ["Date", "Category", "Component", "Employee ID", "Employee Name", "Amount"];
    await ensureTab(sheets, FORECAST_SHEET_ID, "SpendData");
    await sheets.spreadsheets.values.clear({ spreadsheetId: FORECAST_SHEET_ID, range: "SpendData" });
    await sheets.spreadsheets.values.update({
      spreadsheetId: FORECAST_SHEET_ID, range: "SpendData!A1",
      valueInputOption: "USER_ENTERED", requestBody: { values: [header, ...flat] },
    });

    // 6) Daily Snapshot — computed materialized table (dense standalone categories +
    // sparse per-employee×component Manpower, with month-to-date + all-time running totals).
    const snapshot = forecast.buildDailySnapshot(flat);
    const snapHeader = ["Snapshot Date", "Category", "Employee ID", "Employee Name", "Component",
      "Month", "Day Spend", "Month Total", "Running Total"];
    await ensureTab(sheets, FORECAST_SHEET_ID, "Daily Snapshot");
    await sheets.spreadsheets.values.clear({ spreadsheetId: FORECAST_SHEET_ID, range: "Daily Snapshot" });
    await sheets.spreadsheets.values.update({
      spreadsheetId: FORECAST_SHEET_ID, range: "Daily Snapshot!A1",
      valueInputOption: "USER_ENTERED", requestBody: { values: [snapHeader, ...snapshot] },
    });
    console.log(`forecast: wrote ${flat.length} SpendData rows + ${snapshot.length} Daily Snapshot rows`);

    // 7) Forecast entry tab — the manager types his forecast here: a per-employee Manpower grid
    // plus 20 blank line-item rows per category, one block per fiscal month. Created ONCE and
    // never overwritten: if the tab already has content (his entries), we leave it alone.
    const fyTab = `Forecast ${forecast.fiscalYearLabel(todayIST)}`;
    await ensureTab(sheets, FORECAST_SHEET_ID, fyTab);
    const existingForecast = await sheets.spreadsheets.values.get({
      spreadsheetId: FORECAST_SHEET_ID, range: `${fyTab}!A1:L50`,
    });
    // The manager owns every cell in this tab and is expected to restructure it (retype
    // starting below row 1, delete column A, etc.) — a single-cell A1 check would read that
    // as "empty" and overwrite ~6,200 rows of his work. Any non-empty cell anywhere in the
    // checked range counts as "occupied".
    const forecastOccupied = (existingForecast.data.values || [])
      .some((row) => (row || []).some((cell) => String(cell == null ? "" : cell).trim() !== ""));
    if (!forecastOccupied) {
      // Read the roster only when we are actually going to write — on every later run this
      // branch is skipped and the Firestore read never happens.
      const usersSnap = await db.collection("users").get();
      const { employees, duplicates } = forecast.forecastRoster(usersSnap.docs.map((d) => d.data()));
      if (duplicates.length) {
        console.warn(`forecast: duplicate employee ids collapsed to one row: ${duplicates.join(", ")}`);
      }
      const template = forecast.buildForecastTemplate({
        employees, months: forecast.fiscalYearMonths(todayIST),
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: FORECAST_SHEET_ID, range: `${fyTab}!A1`,
        valueInputOption: "USER_ENTERED", requestBody: { values: template },
      });
      console.log(`forecast: created '${fyTab}' — ${template.length} rows, ` +
        `${employees.length} employees × 12 months`);
    } else {
      console.log(`forecast: '${fyTab}' already has content — left untouched`);
    }
  },
);

// ── Daily Sheets Export ───────────────────────────────────────────────────────
exports.exportToSheets = onSchedule(
  // Retry-safe: writeTab() clears and rewrites each tab, and frozen past-month blocks are
  // re-emitted verbatim from what the sheet already holds, so a re-run is reproducible.
  {
    schedule: "0 22 * * *", timeZone: "Asia/Kolkata",
    secrets: ["ATTENDANCE_SHEETS_KEY", "MAPS_API_KEY"],
    timeoutSeconds: 540, memory: "512MiB",
    retryCount: 2, minBackoffSeconds: 120, maxDoublings: 1,
  },
  async () => {
    const keyJson = JSON.parse(SHEETS_KEY.value());
    const auth    = new google.auth.GoogleAuth({ credentials: keyJson, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets  = google.sheets({ version: "v4", auth });
    const db      = admin.firestore();

    // ── Shared date helpers ────────────────────────────────────────────
    // Work in IST explicitly. The runtime clock is UTC, so shift by +05:30 and read the
    // components via getUTC* — using new Date()/getDate()/getDay() directly would read the
    // UTC calendar day and weekday, which drifts from IST near midnight (the same class of
    // bug fixed in computeDailyAttendanceStatus: a UTC weekday made Mondays read as Sundays).
    const nowIST     = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const istYear    = nowIST.getUTCFullYear();
    const istMonth   = nowIST.getUTCMonth(); // 0-based
    const istDay     = nowIST.getUTCDate();
    const pad2       = (n) => String(n).padStart(2, "0");
    const monthStart = `${istYear}-${pad2(istMonth + 1)}-01`;
    const today      = `${istYear}-${pad2(istMonth + 1)}-${pad2(istDay)}`;
    // Company-wide holidays this month — excluded from working-day counts.
    const holidaySnap = await db.collection("holidays")
      .where("date", ">=", monthStart).where("date", "<=", today).get();
    const holidaySet = new Set(holidaySnap.docs.map((h) => h.id));
    // Count working days (Mon–Sat, excluding Sundays and holidays) passed in the month
    let daysPassed = 0;
    for (let d = 1; d <= istDay; d++) {
      const ds = `${istYear}-${pad2(istMonth + 1)}-${pad2(d)}`;
      const dayOfWeek = new Date(ds + "T00:00:00Z").getUTCDay(); // 0 = Sunday, read in UTC
      if (dayOfWeek !== 0 && !holidaySet.has(ds)) daysPassed++;
    }
    const monthLabel = new Date(Date.UTC(istYear, istMonth, 1))
      .toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

    // ── All users (shared across sections) ────────────────────────────
    const allUsersSnap = await db.collection("users").get();
    // Pay fields live in users/{uid}/compensation/current, not on the user doc — Firestore
    // rules are document-level, so leaving salaryRate inline let any tab that resolves
    // employee names also read everyone's pay (see compensation.js). Attached here once so
    // every downstream `user.salaryRate` / `user.pfPercent` reader works unchanged.
    // withPay falls back PER FIELD to the legacy inline value, so this is correct before,
    // during, and after the migration.
    const compSnap = await db.collectionGroup("compensation").get();
    const compByUid = new Map();
    compSnap.docs.forEach((d) => {
      const uid = d.ref.parent.parent && d.ref.parent.parent.id;
      if (uid) compByUid.set(uid, d.data());
    });
    const allUsersData = allUsersSnap.docs.map((d) => withPay({ id: d.id, ...d.data() }, compByUid.get(d.id)));
    const userRoleMap  = new Map(allUsersData.map((u) => [u.id, u.role || ""]));
    const userEmpIdMap = new Map(allUsersData.map((u) => [u.id, u.employeeId || ""]));
    const userNameMap  = new Map(allUsersData.map((u) => [u.id, u.name || ""]));
    const userPlBalMap = new Map(allUsersData.map((u) => [u.id, u.plBalance || 0]));
    const userWoBalMap = new Map(allUsersData.map((u) => [u.id, u.woBalance || 0]));
    const userCategoriesMap = new Map(allUsersData.map((u) => [u.id, Array.isArray(u.categories) ? u.categories : []]));

    // ── userId__date → DailyStatus (for Attendance tab) ───────────────
    const statusSnap = await db.collectionGroup("attendance_status").get();
    const statusMap  = new Map();
    // Regularized-to-Present days carry an admin-set effective in/out (missed-punch
    // fix). These override raw events for OT, matching the admin ledger.
    const otOverrideMap = new Map(); // `${uid}__${date}` → { inMin, outMin } IST min-of-day
    statusSnap.docs.forEach((doc) => {
      const d = doc.data();
      // Legacy docs stored "SLNF"; the status is now "LNF" (Log Not Found).
      const st = d.status === "SLNF" ? "LNF" : (d.status || "");
      statusMap.set(`${d.userId}__${d.date}`, st);
      if (d.status === "Present" && d.inTime && d.outTime) {
        const inMin = hhmmToMin(d.inTime), outMin = hhmmToMin(d.outTime);
        if (inMin != null && outMin != null && outMin > inMin) {
          otOverrideMap.set(`${d.userId}__${d.date}`, { inMin, outMin });
        }
      }
    });

    // ── OT ledger inputs (planned shift / declared OT / rest-day auth / approvals) ──
    // Needed so the Attendance tab's OT column matches the admin portal exactly.
    // All holidays (not just this month) — the Attendance tab spans all history.
    const allHolidaySet = new Set((await db.collection("holidays").get()).docs.map((h) => h.id));
    const plannedMap = new Map(); // `${uid}__${date}` → { startMin, endMin, declared } (valid windows only)
    const otAuthSet  = new Set(); // `${uid}__${date}` where admin authorized rest-day OT
    const plannedSnap = await db.collectionGroup("planned_hours").get();
    plannedSnap.docs.forEach((doc) => {
      const d = doc.data();
      const uid = uidOf(doc);
      const key = `${uid}__${d.date || ""}`;
      const startMin = hhmmToMin(d.startTime), endMin = hhmmToMin(d.endTime);
      // Inverted/mis-entered windows are treated as "no plan" → default 10–18 fallback.
      if (startMin != null && endMin != null && endMin > startMin) {
        plannedMap.set(key, { startMin, endMin, declared: Math.max(0, d.declaredOtMins || 0) });
      }
      if (d.otAuthorized) otAuthSet.add(key);
    });
    const approvalMap = new Map(); // `${uid}__${date}` → granted OT mins (approvedMins; rejected → 0)
    const otDecisionMap = new Map(); // `${uid}__${date}` → { status, reason, approvedBy } (for the OT Exception Report)
    const approvalSnap = await db.collectionGroup("ot_approvals").get();
    approvalSnap.docs.forEach((doc) => {
      const d = doc.data();
      const key = `${uidOf(doc)}__${d.date || ""}`;
      approvalMap.set(key, Number(d.approvedMins) || 0);
      otDecisionMap.set(key, { status: d.status || "", reason: d.reason || "", approvedBy: d.approvedBy || "" });
    });

    // ── MTD attendance summary per user (for Employee Dashboard) ──────
    // Re-use statusSnap (already fetched above) — filter to current month
    const userAttendanceMTD = new Map(); // userId → {present, halfDay, pl, lwp, absent}
    statusSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (d.date < monthStart || d.date > today) return;
      // Skip Sundays — they are not working days (read weekday in UTC; see note
      // at the Sunday-skip in computeDailyAttendanceStatus for why).
      const dayOfWeek = new Date(d.date + "T00:00:00Z").getUTCDay();
      if (dayOfWeek === 0) return;
      if (!userAttendanceMTD.has(d.userId))
        userAttendanceMTD.set(d.userId, { present: 0, halfDay: 0, sl: 0, slnf: 0, pl: 0, lwp: 0, absent: 0});
      const ua = userAttendanceMTD.get(d.userId);
      switch (d.status) {
        case "Present":  ua.present++;  break;
        case "HalfDay":  ua.halfDay++;  break;
        case "SL":       ua.sl++;       break;
        case "LNF":      ua.slnf++;     break; // "Log Not Found"
        case "SLNF":     ua.slnf++;     break; // legacy value, same bucket
        case "PL":       ua.pl++;       break;
        case "LWP":      ua.lwp++;      break;
        case "Absent":   ua.absent++;   break;
      }
    });

    // ── 1. Attendance — one row per employee per day ──────────────────
    // In/Out times: office uses office_in/office_out; operations uses the
    // first site reached (site_in) and the last site left (site_out).
    {
      const snap   = await db.collectionGroup("attendance").get();
      const header = [
        "Date", "Employee Name", "Employee ID", "Role",
        "In Time", "In Location", "Out Time", "Out Location",
        "All Activity", "OT (mins)", "Daily Status", "PL Balance", "WO Balance",
      ];

      // Group all events by employee + date.
      const groups = new Map(); // `${uid}__${date}` → { uid, date, events[] }
      snap.docs.forEach((doc) => {
        const d   = doc.data();
        const uid = uidOf(doc);
        const key = `${uid}__${d.date || ""}`;
        if (!groups.has(key)) groups.set(key, { uid, date: d.date || "", events: [] });
        groups.get(key).events.push(d);
      });

      // Build a row for every employee/day that has EITHER attendance events
      // OR a computed status doc — so Absent / PL / LWP / SLNF days (which have
      // no check-in events) still appear with their status.
      const allKeys = new Set([...groups.keys(), ...statusMap.keys()]);
      const rows = [...allKeys].map((key) => {
        const group = groups.get(key);
        const sep   = key.lastIndexOf("__");
        const uid   = group ? group.uid  : key.slice(0, sep);
        const date  = group ? group.date : key.slice(sep + 2);
        const role  = userRoleMap.get(uid) || "";
        const isOps = role === "operations";
        const inTypes  = attendanceInTypes(role);
        const outTypes = attendanceOutTypes(role);

        const locOf = (e) => {
          if (!e) return "";
          if (isOps) return e.siteName || "Site";
          // Sales is hybrid: name site/market visits like ops, office/home like office.
          if (e.type === "site_in"   || e.type === "site_out")   return e.siteName   || "Site";
          if (e.type === "market_in" || e.type === "market_out") return e.marketName || "Market";
          // Office/admin now log from home too (enforced for BO) — distinguish
          // home_in/home_out from office_in/office_out so the timeline is honest.
          if (e.type === "home_in" || e.type === "home_out") return "Home";
          return e.locationName || "Office";
        };
        // Site ID is filled in per-entry by the admin (Site IDs page) on the attendance doc.
        const siteIdOf = (e) => {
          if (!e) return "";
          if (isOps) return e.siteId || "";
          if (e.type === "site_in" || e.type === "site_out") return e.siteId || ""; // sales site visits
          return "";
        };

        let firstIn, lastOut, allActivity = "";
        if (group) {
          group.events.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
          // In/Out time: ops keeps its site_in/site_out anchors (market excluded, as today);
          // office → office_in/out; sales (hybrid) → first/last across all its in/out types.
          firstIn = group.events.filter((e) => isOps ? e.type === "site_in" : inTypes.includes(e.type))[0];
          const outs = group.events.filter((e) => isOps ? e.type === "site_out" : outTypes.includes(e.type));
          lastOut = outs[outs.length - 1];

          // Full chronological log of every check-in / check-out and site visited,
          // with the resolved Site ID in brackets when one is mapped.
          allActivity = group.events.map((e) => {
            const inOut = (e.type || "").endsWith("_in") ? "In" : "Out";
            const id    = siteIdOf(e);
            return `${inOut} ${timeIST(e.timestamp)} — ${locOf(e)}${id ? ` [${id}]` : ""}`;
          }).join("\n");
        }

        // OT (mins) — credited overtime, replicating the admin portal's Employee
        // Dashboard number: declared auto-approved + authorized rest-day + admin-
        // granted (incl. manual). Pending (un-reviewed) OT is excluded, exactly as
        // the portal shows it. Ops only; office/admin have no OT in the model.
        let otMins = 0;
        if (isOps) {
          // Effective worked window: a regularized-to-Present override wins; otherwise
          // first-in / last-out across site AND market visits (matching the ledger).
          const override = otOverrideMap.get(key);
          let inMin = null, outMin = null;
          if (override) {
            inMin = override.inMin; outMin = override.outMin;
          } else if (group) {
            const ins  = group.events.filter((e) => OPS_IN_TYPES.has(e.type));
            const outsAll = group.events.filter((e) => OPS_OUT_TYPES.has(e.type));
            if (ins.length && outsAll.length) {
              const inEv  = ins.reduce((a, b) => ((a.timestamp?.seconds || 0) <= (b.timestamp?.seconds || 0) ? a : b));
              const outEv = outsAll.reduce((a, b) => ((a.timestamp?.seconds || 0) >= (b.timestamp?.seconds || 0) ? a : b));
              const im = getHourIST(inEv.timestamp) * 60 + getMinuteIST(inEv.timestamp);
              const om = getHourIST(outEv.timestamp) * 60 + getMinuteIST(outEv.timestamp);
              if (om > im) { inMin = im; outMin = om; }
            }
          }
          if (inMin != null && outMin != null) {
            const plan = plannedMap.get(key);
            const restDay = new Date(date + "T00:00:00Z").getUTCDay() === 0 || allHolidaySet.has(date);
            const led = computeDayLedger({
              shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
              shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
              inMin, outMin,
              declaredOtMins: plan ? plan.declared : 0,
              isRestDay: restDay,
              otAuthorized: otAuthSet.has(key),
            });
            otMins += led.autoOtMins + led.restDayOtMins;
          }
          // Admin-granted OT (approvals, incl. manual for missed-punch days) is
          // credited regardless of punches — matches the portal's granted total.
          otMins += approvalMap.get(key) || 0;
        }

        return [
          date,
          userNameMap.get(uid) ?? "",
          userEmpIdMap.get(uid) ?? "",
          role,
          timeIST(firstIn?.timestamp), locOf(firstIn),
          timeIST(lastOut?.timestamp), locOf(lastOut),
          allActivity,
          otMins > 0 ? otMins : "",
          statusMap.get(`${uid}__${date}`) || "",
          userPlBalMap.get(uid) ?? 0,
          userWoBalMap.get(uid) ?? 0,
        ];
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      // Fill every blank cell in the data rows with θ so no attendance cell is
      // left empty in the sheet (header row is left as-is).
      const filledRows = rows.map((r) => r.map((cell) => (cell === "" || cell == null) ? "θ" : cell));
      await writeTab(sheets, SHEET_ID_2, TABS.ATTENDANCE, [header, ...filledRows]);
      console.log(`Attendance: ${rows.length} rows`);
    }

    // ── 1b. Overtime Exception Report — ops OT days, current month ─────
    // One row per ops employee per day they worked past shift end (or worked a
    // rest day, or have an admin OT decision) this month. Mirrors the manual
    // "OVERTIME EXCEPTION REPORT" sheet. OVER TIME = credited OT as H:MM (0 when
    // not approved), from the same ledger the admin portal Employee Dashboard uses.
    {
      const header = [
        "DATE", "NAME", "ESN NO", "PRE-LOGIN TIME", "PRE-LOGIN SITE",
        "POST-LOGOUT TIME", "POST-LOGOUT SITE", "OVER TIME", "TIME APPROVED",
        "APPROVED/NOT APPROVED/Pending", "Reasons", "APPROVED/REJECTED BY", "Remarks",
      ];

      // Ops attendance events for the current month, grouped by employee + day.
      const snap = await db.collectionGroup("attendance")
        .where("date", ">=", monthStart).where("date", "<=", today).get();
      const groups = new Map(); // `${uid}__${date}` → { uid, date, events[] }
      snap.docs.forEach((doc) => {
        const uid = uidOf(doc);
        if (!usesOtShortageLedger(userRoleMap.get(uid))) return; // OT is a ledger-role (operations) concept
        const d = doc.data();
        const key = `${uid}__${d.date || ""}`;
        if (!groups.has(key)) groups.set(key, { uid, date: d.date || "", events: [] });
        groups.get(key).events.push(d);
      });

      // Also surface ops days that only carry an admin OT decision this month
      // (e.g. a manual OT grant for a missed-punch day — no post-shift event).
      otDecisionMap.forEach((_v, key) => {
        const sep = key.lastIndexOf("__");
        const uid = key.slice(0, sep), date = key.slice(sep + 2);
        if (!usesOtShortageLedger(userRoleMap.get(uid))) return;
        if (date < monthStart || date > today) return;
        if (!groups.has(key)) groups.set(key, { uid, date, events: [] });
      });

      const rows = [];
      groups.forEach((group, key) => {
        const { uid, date } = group;

        // Effective worked window: a regularized-to-Present override wins;
        // otherwise first site/market arrival … last site/market departure.
        const override = otOverrideMap.get(key);
        let inMin = null, outMin = null, inEv = null, outEv = null;
        if (override) {
          inMin = override.inMin; outMin = override.outMin;
        } else if (group.events.length) {
          const ins  = group.events.filter((e) => OPS_IN_TYPES.has(e.type));
          const outs = group.events.filter((e) => OPS_OUT_TYPES.has(e.type));
          if (ins.length && outs.length) {
            inEv  = ins.reduce((a, b) => ((a.timestamp?.seconds || 0) <= (b.timestamp?.seconds || 0) ? a : b));
            outEv = outs.reduce((a, b) => ((a.timestamp?.seconds || 0) >= (b.timestamp?.seconds || 0) ? a : b));
            const im = getHourIST(inEv.timestamp) * 60 + getMinuteIST(inEv.timestamp);
            const om = getHourIST(outEv.timestamp) * 60 + getMinuteIST(outEv.timestamp);
            if (om > im) { inMin = im; outMin = om; }
          }
        }

        const restDay = new Date(date + "T00:00:00Z").getUTCDay() === 0 || allHolidaySet.has(date);
        let led = { autoOtMins: 0, pendingExtraMins: 0, restDayOtMins: 0, unauthorizedRestDay: false };
        if (inMin != null && outMin != null) {
          const plan = plannedMap.get(key);
          led = computeDayLedger({
            shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
            shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
            inMin, outMin,
            declaredOtMins: plan ? plan.declared : 0,
            isRestDay: restDay,
            otAuthorized: otAuthSet.has(key),
          });
        }

        // OVER TIME = actual overtime the portal detects (raw, before approval):
        //   normal day → minutes past shift end; rest day → every worked minute.
        // TIME APPROVED = the credited slice: auto-approved (declared) + authorized
        //   rest-day + whatever the admin granted (approvalMap / manual).
        let rawOtMins = 0, approvedOtMins = 0;
        if (inMin != null && outMin != null) {
          if (restDay) {
            rawOtMins = Math.max(0, outMin - inMin);
            approvedOtMins = led.restDayOtMins;
          } else {
            rawOtMins = led.autoOtMins + led.pendingExtraMins;
            approvedOtMins = led.autoOtMins;
          }
        }
        approvedOtMins += (approvalMap.get(key) || 0);

        const decision = otDecisionMap.get(key);
        // Is this day an OT "exception"? Left after shift end, worked a rest day,
        // or an admin recorded an OT decision for it.
        if (rawOtMins <= 0 && !decision) return;

        // Status: an explicit admin decision wins; else auto-approved when credited
        // > 0 (declared/authorized), otherwise still awaiting review.
        let statusLabel;
        if (decision && decision.status === "approved") statusLabel = "APPROVED";
        else if (decision && decision.status === "rejected") statusLabel = "NOT APPROVED";
        else if (approvedOtMins > 0) statusLabel = "APPROVED";
        else statusLabel = "Pending";

        const preLoginTime = inEv ? timeIST(inEv.timestamp)
          : (inMin != null ? minToHHMM(inMin) : "");
        const preLoginSite = inEv ? (inEv.siteName || "") : "";
        const postLogoutTime = outEv ? timeIST(outEv.timestamp)
          : (outMin != null ? minToHHMM(outMin) : "");
        const postLogoutSite = outEv ? (outEv.siteName || "") : "";

        rows.push([
          date,
          userNameMap.get(uid) ?? "",
          userEmpIdMap.get(uid) ?? "",
          preLoginTime, preLoginSite,
          postLogoutTime, postLogoutSite,
          minToHHMM(rawOtMins),            // OVER TIME — actual overtime detected
          minToHHMM(approvedOtMins),       // TIME APPROVED — what the admin approved
          statusLabel,
          decision ? decision.reason : "",
          decision ? decision.approvedBy : "",
          "",                              // Remarks
        ]);
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      await writeTab(sheets, SHEET_ID_OT, TABS.OT_EXCEPTION, [header, ...rows]);
      console.log(`OT Exception Report: ${rows.length} rows`);
    }

    // ── 1c. Site Manpower Time Utilisation — ops per-site visits, current month ──
    // One row per ops site_in→site_out visit this month, written to its own
    // spreadsheet (SHEET_ID_MANPOWER). Reproduces the client's manual "SITE MANPOWER
    // TIME UTILISATION REPORT" (Aug-2024 format). work-done-time = time on site ÷ 8h
    // (may exceed 1). Remarks carries the day's CREDITED OT (H:MM) on the visit with
    // the latest departure. Pairing/fraction is the unit-tested buildManpowerVisits().
    {
      const header = [
        "DATE", "SITE", "Cust ID", "Visit type", "TecH name",
        "Category (as per daily schedule)", "work done-Category", "work done-time", "Remarks",
      ];

      // Ops site events for the current month, grouped by employee + day.
      const snap = await db.collectionGroup("attendance")
        .where("date", ">=", monthStart).where("date", "<=", today).get();
      const groups = new Map(); // `${uid}__${date}` → { uid, date, events[] }
      snap.docs.forEach((doc) => {
        const uid = uidOf(doc);
        if (!inManpowerReports(userRoleMap.get(uid))) return;   // ops-only report (sales excluded)
        const d = doc.data();
        const key = `${uid}__${d.date || ""}`;
        if (!groups.has(key)) groups.set(key, { uid, date: d.date || "", events: [] });
        groups.get(key).events.push(d);
      });

      const rows = [];
      groups.forEach((group, key) => {
        const { uid, date } = group;

        // Chronological site events → the pure builder's shape.
        const sorted = [...group.events].sort(
          (a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
        // Visit rows are site-only — market events carry none of the visit fields.
        const siteEvents = sorted.filter((e) => e.type === "site_in" || e.type === "site_out");
        const visits = buildManpowerVisits(siteEvents.map((e) => ({
          type: e.type,
          min: getHourIST(e.timestamp) * 60 + getMinuteIST(e.timestamp),
          siteName: e.siteName || "",
          siteId: e.siteId || "",
          visitType: e.visitType || "",
          workDone: Array.isArray(e.workDoneCategories) ? e.workDoneCategories : [],
        })));
        if (!visits.length) return;

        // Day's CREDITED OT — same number as the Attendance tab / Employee Dashboard.
        // Effective window: regularized override wins; else first-in…last-out across
        // site AND market events (matches the ledger).
        const override = otOverrideMap.get(key);
        let inMin = null, outMin = null;
        if (override) {
          inMin = override.inMin; outMin = override.outMin;
        } else {
          const ins  = group.events.filter((e) => OPS_IN_TYPES.has(e.type));
          const outs = group.events.filter((e) => OPS_OUT_TYPES.has(e.type));
          if (ins.length && outs.length) {
            const inEv  = ins.reduce((a, b) => ((a.timestamp?.seconds || 0) <= (b.timestamp?.seconds || 0) ? a : b));
            const outEv = outs.reduce((a, b) => ((a.timestamp?.seconds || 0) >= (b.timestamp?.seconds || 0) ? a : b));
            const im = getHourIST(inEv.timestamp) * 60 + getMinuteIST(inEv.timestamp);
            const om = getHourIST(outEv.timestamp) * 60 + getMinuteIST(outEv.timestamp);
            if (om > im) { inMin = im; outMin = om; }
          }
        }
        let creditedOt = 0;
        if (inMin != null && outMin != null) {
          const plan = plannedMap.get(key);
          const restDay = new Date(date + "T00:00:00Z").getUTCDay() === 0 || allHolidaySet.has(date);
          const led = computeDayLedger({
            shiftStartMin: plan ? plan.startMin : DEFAULT_SHIFT_START_MIN,
            shiftEndMin:   plan ? plan.endMin   : DEFAULT_SHIFT_END_MIN,
            inMin, outMin,
            declaredOtMins: plan ? plan.declared : 0,
            isRestDay: restDay,
            otAuthorized: otAuthSet.has(key),
          });
          creditedOt = led.autoOtMins + led.restDayOtMins;
        }
        creditedOt += approvalMap.get(key) || 0;

        const categories = (userCategoriesMap.get(uid) || []).join(" ");
        visits.forEach((v) => {
          rows.push([
            date,
            v.siteName,
            v.siteId,
            v.visitType,
            userNameMap.get(uid) ?? "",
            categories,
            v.workDone.join(" + "),
            v.timeFraction == null ? "" : v.timeFraction,
            (v.otTarget && creditedOt > 0) ? minToHHMM(creditedOt) : "",
          ]);
        });
      });

      rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      await writeTab(sheets, SHEET_ID_MANPOWER, TABS.MANPOWER, [header, ...rows]);
      console.log(`Manpower Utilisation: ${rows.length} rows`);
    }

    // ── 2. MT Requests ────────────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("material_requests").get();
      const header = [
        "Submitted At", "Employee Name", "Employee ID",
        "Site ID", "Site Name", "Item Name", "Quantity", "Unit", "Item Notes", "Overall Notes", "Photo URLs",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || ""];
        if (items.length === 0) rows.push([...base, "", "", "", "", d.notes || "", photos]);
        else items.forEach((item) => rows.push([...base, item.itemName || "", item.quantity || "", item.unit || "", item.notes || "", d.notes || "", photos]));
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      await writeTab(sheets, SHEET_ID_3, TABS.REQUESTS, [header, ...rows]);
      console.log(`MT Requests: ${rows.length} rows`);
    }

    // ── 3. MT Purchases ───────────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("material_purchases").get();
      const header = [
        "Submitted At", "Employee Name", "Employee ID",
        "Site ID", "Site Name", "Item Name", "Quantity", "Unit",
        "Price Per Unit", "Total Price", "Grand Total", "Notes", "Photo URLs",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || ""];
        if (items.length === 0) rows.push([...base, "", "", "", "", "", d.grandTotal || "", d.notes || "", photos]);
        else items.forEach((item) => rows.push([...base, item.itemName || "", item.quantity || "", item.unit || "", item.pricePerUnit || "", item.totalPrice || "", d.grandTotal || "", d.notes || "", photos]));
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      await writeTab(sheets, SHEET_ID_4, TABS.PURCHASES, [header, ...rows]);
      console.log(`MT Purchases: ${rows.length} rows`);
    }

    // ── 4. Material Transfers ─────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("material_transfers").get();
      const header = [
        "Submitted At", "Employee Name", "Employee ID", "Transfer Date",
        "From", "To", "Transferred By", "Received By",
        "Item Name", "Quantity", "Unit", "Condition", "Notes", "Photo URLs",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const base   = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.transferDate || "", d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
        if (items.length === 0) rows.push([...base, "", "", "", "", d.notes || "", photos]);
        else items.forEach((item) => rows.push([...base, item.itemName || "", item.quantity || "", item.unit || "", item.condition || "", d.notes || "", photos]));
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      await writeTab(sheets, SHEET_ID_5, TABS.MATERIAL_TRANSFERS, [header, ...rows]);
      console.log(`Material Transfers: ${rows.length} rows`);
    }

    // ── 5. Tool Transfers ─────────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("tool_transfers").get();
      const header = [
        "Submitted At", "Employee Name", "Employee ID", "Transfer Date",
        "From", "To", "Transferred By", "Received By",
        "Item Name", "Quantity", "Unit", "Condition", "Notes",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d    = doc.data();
        const items = Array.isArray(d.items) ? d.items : [];
        const uid   = uidOf(doc);
        const base  = [ts(d.submittedAt), userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.transferDate || "", d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
        if (items.length === 0) rows.push([...base, "", "", "", "", d.notes || ""]);
        else items.forEach((item) => rows.push([...base, item.itemName || "", item.quantity || "", item.unit || "", item.condition || "", d.notes || ""]));
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      await writeTab(sheets, SHEET_ID_6, TABS.TOOL_TRANSFERS, [header, ...rows]);
      console.log(`Tool Transfers: ${rows.length} rows`);
    }

    // ── 6. Work Progress ──────────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("work_progress").get();
      const header = ["Date", "Employee Name", "Employee ID", "Site ID", "Site Name", "Hours Worked", "Work Description", "Submitted At", "Photo URLs"];
      const rows   = snap.docs.map((doc) => {
        const d   = doc.data();
        const uid = uidOf(doc);
        return [d.date || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || "", d.hoursWorked || "", d.workDescription || "", ts(d.submittedAt), Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : ""];
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      await writeTab(sheets, SHEET_ID_7, TABS.WORK_PROGRESS, [header, ...rows]);
      console.log(`Work Progress: ${rows.length} rows`);
    }

    // ── 7. Leave Requests ─────────────────────────────────────────────
    {
      const snap   = await db.collectionGroup("leave_requests").get();
      // "Days Granted" is the number of days actually APPROVED, not the number
      // requested: a partial approval grants a subset of fromDate…toDate. When no
      // subset was recorded the whole range is granted, so `totalDays` stands.
      // "Granted Dates" is blank in that (full-range / not-yet-approved) case.
      const header = ["Submitted At", "Status", "Employee Name", "Employee ID", "Leave Type", "From Date", "To Date", "Days Granted", "Granted Dates", "Reason", "Approved By", "Approver Comment", "Reviewed At"];
      const rows   = snap.docs.map((doc) => {
        const d   = doc.data();
        const uid = uidOf(doc);
        const granted     = explicitGrantedDates(d);
        const grantedDays = grantedDayCount(d) ?? (d.totalDays || "");
        return [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.leaveType || "", d.fromDate || "", d.toDate || "", grantedDays, granted.join(", "), d.reason || "", d.approvedBy || "", d.approverComment || "", ts(d.reviewedAt)];
      });
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      await writeTab(sheets, SHEET_ID_1, TABS.LEAVE_REQUESTS, [header, ...rows]);
      console.log(`Leave Requests: ${rows.length} rows`);
    }

    // ── 8. Conveyance — also builds conveyanceByUserId for Employee Dashboard
    let conveyanceByUserId = new Map(); // userId → total ₹ conveyance this month
    {
      const mapsKey    = MAPS_KEY.value();

      // Read per-employee conveyance rate config from Firestore
      const convConfigSnap = await db.doc("config/conveyance").get();
      const convConfig     = convConfigSnap.exists ? convConfigSnap.data() : {};
      const rateValues     = { 1: convConfig.rate1 || CONVEYANCE_RATE_FALLBACK, 2: convConfig.rate2 || CONVEYANCE_RATE_FALLBACK };

      // Conveyance-earning roles: operations + sales (see roleCapabilities.usesConveyance).
      const convUsersSnap = await db.collection("users").where("role", "in", rolesWith("usesConveyance")).get();
      const convUsers   = new Map(convUsersSnap.docs.map((d) => [d.id, d.data()]));

      const attendSnap = await db.collectionGroup("attendance")
        .where("date", ">=", monthStart)
        .where("date", "<=", today)
        .get();

      const grouped = new Map();
      attendSnap.docs.forEach((doc) => {
        const d = doc.data();
        const user = convUsers.get(d.userId);
        if (!user) return;
        const hasGPS  = d.latitude && d.longitude;
        const isHome  = d.type === "home_in" || d.type === "home_out";
        const hasHome = user.homeLat && user.homeLng;
        if (!hasGPS && !(isHome && hasHome)) return;
        const key = `${d.userId}__${d.date}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(d);
      });
      grouped.forEach((events) => events.sort((a, b) => a.timestamp.seconds - b.timestamp.seconds));

      function buildRoute(events) {
        const parts = [];
        events.forEach((e) => {
          let loc = "";
          if (e.type === "home_in"   || e.type === "home_out")   loc = "Home";
          if (e.type === "site_in"   || e.type === "site_out")   loc = e.siteName   || "Site";
          if (e.type === "market_in" || e.type === "market_out") loc = e.marketName || "Market";
          if (loc && parts[parts.length - 1] !== loc) parts.push(loc);
        });
        return parts.join(" → ");
      }

      function resolveCoords(event, user) {
        if ((event.type === "home_in" || event.type === "home_out") && user.homeLat && user.homeLng) {
          return { lat: user.homeLat, lng: user.homeLng };
        }
        return { lat: event.latitude, lng: event.longitude };
      }

      const entries = [...grouped.entries()];
      const BATCH   = 20;
      const allRows = [];

      for (let i = 0; i < entries.length; i += BATCH) {
        const batch   = entries.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async ([key, events]) => {
          const userId = key.split("__")[0];
          const user   = convUsers.get(userId) || {};
          const ratePerKm = rateValues[user.conveyanceRateType] || rateValues[1] || CONVEYANCE_RATE_FALLBACK;
          let totalKm  = 0;
          for (let j = 0; j < events.length - 1; j++) {
            const a = resolveCoords(events[j], user);
            const b = resolveCoords(events[j + 1], user);
            totalKm += await getRoadKm(a.lat, a.lng, b.lat, b.lng, mapsKey);
          }
          const conveyance = totalKm * ratePerKm;
          conveyanceByUserId.set(userId, (conveyanceByUserId.get(userId) || 0) + conveyance);
          return [events[0].date, user.name || user.userName || "", user.employeeId || "", buildRoute(events), totalKm.toFixed(2), conveyance.toFixed(2), `₹${ratePerKm}/km`, userId, ratePerKm];
        }));
        allRows.push(...results);
      }

      allRows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

      // Persist daily conveyance records to Firestore
      {
        const BATCH_LIMIT = 500;
        let fbBatch = db.batch();
        let opCount = 0;
        const monthStr = monthStart.slice(0, 7);

        for (const row of allRows) {
          const [date, userName, employeeId, route, totalKmStr, conveyanceStr, , odUserId, ratePerKm] = row;
          const docRef = db.collection("conveyance").doc(`${odUserId}__${date}`);
          fbBatch.set(docRef, {
            userId: odUserId, userName, employeeId, date, month: monthStr,
            route, totalKm: parseFloat(totalKmStr), ratePerKm,
            conveyance: parseFloat(conveyanceStr),
            computedAt: admin.firestore.Timestamp.now(),
          });
          opCount++;
          if (opCount >= BATCH_LIMIT) {
            await fbBatch.commit();
            fbBatch = db.batch();
            opCount = 0;
          }
        }
        if (opCount > 0) await fbBatch.commit();
        console.log(`Conveyance: ${allRows.length} records persisted to Firestore`);
      }

      const header = ["Date", "Employee Name", "Employee ID", "Route", "Total KM", "Conveyance (₹)", "Rate"];
      await writeTab(sheets, SHEET_ID_1, TABS.CONVEYANCE, [header, ...allRows.map(r => r.slice(0, 7))]);
      console.log(`Conveyance: ${allRows.length} rows`);
    }

    // ── 8b. Live OT/WO amount per ops employee (for the Employee Dashboard) ──
    // Authorized OT − shortage − WO, netted for the current month, converted to
    // rupees via settlementCash — the SAME math the OT Settlements page locks, but
    // computed live each night instead of waiting for Settle & Lock. Pending and
    // unauthorized-rest-day OT are excluded (not yet authorized). Non-ledger roles
    // (office/admin/sales) are skipped → 0.
    const monthStatuses = statusSnap.docs
      .map((doc) => ({ ...doc.data(), userId: doc.data().userId }))
      .filter((s) => s.date >= monthStart && s.date <= today);
    const monthPlanned = plannedSnap.docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) }))
      .filter((p) => p.date >= monthStart && p.date <= today);
    const monthApprovals = approvalSnap.docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) }))
      .filter((a) => a.date >= monthStart && a.date <= today);
    const monthAttSnap = await db.collectionGroup("attendance")
      .where("date", ">=", monthStart).where("date", "<=", today).get();
    const monthEvents = monthAttSnap.docs.map((doc) => ({ ...doc.data(), userId: uidOf(doc) }));

    const otWoAmountByUserId = new Map();
    allUsersData.forEach((u) => {
      if (!usesOtShortageLedger(u.role)) return;
      const led = computeRangeLedger(u.id, monthEvents, monthPlanned, monthApprovals, monthStatuses, holidaySet);
      otWoAmountByUserId.set(u.id, settlementCash(u.salaryRate || 0, led.woDates.length, led.netMins));
    });

    // ── 8c. Special Allowance for the current month (for the Employee Dashboard) ──
    // users/{uid}/specialAllowance/{YYYY-MM}, one doc per employee per month. Read LIVE for
    // the current month, exactly like the OT/WO settlement column above — past-month blocks
    // are frozen verbatim by dashboardHistory.js and keep whatever they were exported with.
    // Fetched + client-filtered on the doc id (=== "YYYY-MM") to avoid a collection-group
    // index; the set stays small (one doc per employee per month). All four roles get SA.
    const saMonthKey = `${istYear}-${pad2(istMonth + 1)}`;
    const saSnap = await db.collectionGroup("specialAllowance").get();
    const saByUserId = new Map();
    saSnap.docs.forEach((d) => {
      if (d.id !== saMonthKey) return;
      const uid = d.ref.parent.parent && d.ref.parent.parent.id;
      if (!uid) return;
      const amt = Number(d.data().amount);
      saByUserId.set(uid, Number.isFinite(amt) ? amt : 0);
    });

    // ── 9. Employee Dashboard — MTD summary, one row per employee ─────
    {
      const TAB = TABS.EMPLOYEE_DASHBOARD;

      // Read the existing tab and parse it into month-blocks (see dashboardHistory.js).
      // Past months are frozen (kept verbatim); only the current month is rebuilt.
      const currentKey = `${istYear}-${pad2(istMonth + 1)}`;
      let existingRows = [];
      try {
        const existing = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID_1,
          range: `${TAB}!A:Z`,
        });
        existingRows = existing.data.values || [];
      } catch (_) {
        // Tab doesn't exist yet — start fresh
      }
      const { blocks, legacy } = parseBlocks(existingRows);

      // Legacy = old single-block content from before month-history (no banner).
      // Resolve which month it belongs to from an employee row's Date cell (= monthLabel).
      let legacyKey = null, legacyLabel = null;
      for (const r of legacy) {
        const k = monthLabelToKey(r && r[0]);
        if (k) { legacyKey = k; legacyLabel = String(r[0]).trim(); break; }
      }

      // NOTE: Imprest is no longer carried forward from the Sheet. It is computed from
      // user.imprestPercent (see payrollDeductions.js), which REPLACES the manual column
      // that used to be typed in and preserved across runs. Until the percentages are
      // populated the rebuilt current block shows ₹0 — decided 2026-07-17, not a bug.
      // Frozen past blocks keep their own manual imprest verbatim.

      const header = [
        "Date", "EMP Name", "EMP ID", "Level", "Days Passed in Month",
        "Present (×1)", "SL (×0.75)", "Half Day (×0.5)", "LNF (×0.5)", "PL (×1)", "LWP (×0)", "Absent (×-2)",
        "Leaves", "Days NP",
        "Salary Rate", "Salary Due MTD",
        "Covy Due (approx avg)", "Imprest Due MTD", "OT/WO amount (₹)", "SA",
        "PF (−)", "ESI (−)", "TOTAL DUE",
      ];

      const sortedUsers = [...allUsersData].sort((a, b) => {
        const roleOrder = { office: 0, admin: 1, operations: 2, sales: 3 };
        return (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4) || (a.name || "").localeCompare(b.name || "");
      });

      let grandTotal    = 0;
      let grandCfBal    = 0;
      const empRows     = [];

      sortedUsers.forEach((user) => {
        const empId    = user.employeeId || "";
        const ua       = userAttendanceMTD.get(user.id) || { present: 0, halfDay: 0, sl: 0, slnf: 0, pl: 0, lwp: 0, absent: 0};

        // Absent = 2-day penalty (lose the day + a penalty day) → ×-2. LWP = unpaid, contributes 0.
        const daysNP   = ua.present + ua.sl * 0.75 + ua.halfDay * 0.5 + ua.slnf * 0.5 + ua.pl - ua.absent * 2;
        const leaves   = ua.pl + ua.lwp; // all leave types shown together

        const salaryRate = user.salaryRate || 0;
        const salaryDue  = parseFloat((daysNP * salaryRate).toFixed(2));

        // Conveyance: operations + sales (usesConveyance), from conveyanceByUserId built in section 8
        const covy       = usesConveyance(user.role)
          ? parseFloat((conveyanceByUserId.get(user.id) || 0).toFixed(2))
          : 0;

        const settlement = parseFloat((otWoAmountByUserId.get(user.id) || 0).toFixed(2));

        // Special Allowance — this month's manager-set amount; no doc → ₹0 ("not yet decided").
        // Not prorated by attendance, and NOT part of the PF/ESI/Imprest base (see the spec).
        const sa = parseFloat((saByUserId.get(user.id) || 0).toFixed(2));

        // PF / ESI / Imprest are percentages of Salary Due MTD (payrollDeductions.js).
        // PF and ESI are DEDUCTED from TOTAL DUE; Imprest and SA are added. `efficiency` is
        // not passed — the matrix doesn't exist yet, so it defaults to 1. Do NOT pass 0.
        const { pf, esi, imprest, totalDue } = computeDeductions({
          salaryDue, covy, settlement, sa,
          pfPercent: user.pfPercent,
          esiPercent: user.esiPercent,
          imprestPercent: user.imprestPercent,
        });

        grandTotal += totalDue;
        grandCfBal += user.plBalance || 0;

        empRows.push([
          monthLabel,
          user.name || "",
          empId,
          user.level || "",
          daysPassed,
          ua.present, ua.sl, ua.halfDay, ua.slnf, ua.pl, ua.lwp, ua.absent,
          leaves,
          daysNP,
          salaryRate,
          salaryDue,
          covy,
          imprest,
          settlement,
          sa,
          pf,
          esi,
          totalDue,
        ]);
      });

      // Build a blank summary row of the right width, with a label first and a value in the last column.
      const summaryRow = (label, lastVal) => {
        const row = new Array(header.length).fill("");
        row[0] = label;
        row[header.length - 1] = lastVal;
        return row;
      };

      // CF BAL row — carry-forward leave balance per employee (total in last col)
      const cfBalRow  = summaryRow("CF BAL", grandCfBal);

      // TOTAL row — grand total of all dues
      const totalRow  = summaryRow("TOTAL", grandTotal);

      // Current-month block: banner + header + rows + summaries + a blank spacer.
      const currentBlockRows = [
        [bannerFor(currentKey, monthLabel)],
        header,
        ...empRows,
        cfBalRow,
        totalRow,
        [""],
      ];

      // Freeze every other parsed block; migrate legacy (no-banner) content that
      // belongs to a PAST month into its own frozen block so no snapshot is lost.
      const frozenBlocks = blocks.filter((b) => b.key !== currentKey);
      if (legacyKey && legacyKey !== currentKey) {
        frozenBlocks.push({ key: legacyKey, rows: [[bannerFor(legacyKey, legacyLabel)], ...legacy] });
      }

      // Assemble: current month on top, frozen months newest→oldest below.
      const outRows = assembleTab(currentBlockRows, currentKey, frozenBlocks);
      await writeTab(sheets, SHEET_ID_1, TAB, outRows);
      console.log(`Employee Dashboard: ${empRows.length} employees (current ${currentKey}), ${frozenBlocks.length} frozen month(s), total due ₹${grandTotal}`);
    }

    console.log("Full Sheets export complete.");
  }
);

// ── FCM Push Notifications ────────────────────────────────────────────────────
// Triggered when admin portal writes a new doc to /sent_notifications/.
// Reads FCM tokens for the target audience and sends push to all their devices,
// even when the app is closed. The in-app notification record is written by the
// admin portal (writeBatch to /users/{uid}/notifications/); this function only
// handles the push delivery layer.
exports.sendPushNotification = onDocumentCreated(
  "sent_notifications/{docId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { title, body, type = "general", recipientType, recipientId } = data;
    if (!title || !body) {
      console.log("sendPushNotification: missing title or body — skipping");
      return;
    }

    const db        = admin.firestore();
    const messaging = admin.messaging();
    let tokens      = [];

    if (recipientType === "specific") {
      if (!recipientId) {
        console.log("sendPushNotification: recipientType=specific but recipientId is missing");
        return;
      }
      const userDoc = await db.collection("users").doc(recipientId).get();
      const token   = userDoc.data()?.fcmToken;
      if (token) tokens = [token];
    } else {
      let query = db.collection("users");
      if (recipientType === "operations") {
        query = query.where("role", "==", "operations");
      } else if (recipientType === "office") {
        // isOffice is true for both office and admin roles
        query = query.where("role", "in", ["office", "admin"]);
      } else if (recipientType === "sales") {
        // Sales is its own group — never folded into "office" despite sharing its window.
        query = query.where("role", "==", "sales");
      }
      // "all" — no role filter
      const snap = await query.get();
      tokens = snap.docs.map((d) => d.data().fcmToken).filter(Boolean);
    }

    if (tokens.length === 0) {
      console.log(`sendPushNotification: no FCM tokens found for recipientType=${recipientType}`);
      return;
    }

    // FCM multicast is capped at 500 tokens per call
    const CHUNK = 500;
    let totalSuccess = 0;
    for (let i = 0; i < tokens.length; i += CHUNK) {
      const chunk    = tokens.slice(i, i + CHUNK);
      const response = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data: { type },
        android: { priority: "high" },
      });
      totalSuccess += response.successCount;
      console.log(`sendPushNotification: chunk ${Math.floor(i / CHUNK) + 1} — ${response.successCount}/${chunk.length} delivered`);
    }
    console.log(`sendPushNotification: done — ${totalSuccess}/${tokens.length} tokens reached`);
  }
);

// ── Auto-file regularizations for unclosed days — 00:30 IST, day after ──────
//
// An employee who checks in and forgets to check out leaves one punch, which the 23:59
// scorer reads as LNF — half a day's pay — silently. Regularization already fixes a
// wrongly-scored day, but it begins with the employee NOTICING, and they do not: the
// deduction surfaces weeks later on a payslip. This files the request for them so the day
// reaches an admin the next morning, while it can still be remembered.
//
// It DECIDES NOTHING about pay. It opens a question; the admin's approval is what rewrites
// `attendance_status`, exactly as for an employee-filed request.
//
// DELIBERATELY A SEPARATE FUNCTION, not a tail on computeDailyAttendanceStatus. That job
// writes pay and has just been hardened so one bad user cannot poison the run; bolting an
// extra write pass onto it would put this feature inside the blast radius of payroll for no
// benefit. Failing to file a request must never be able to cost anyone their status doc.
//
// Idempotent two ways: the document ID is deterministic (`auto-{date}`), so a retry
// overwrites rather than duplicating, and needsAutoRegularization refuses to file over a
// pending/approved request — including the one a previous run created.
exports.autoFileUnclosedDays = onSchedule(
  {
    schedule: "30 0 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300,
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();

    // Yesterday in IST — the day the 23:59 scorer just finished. Cloud functions run on a
    // UTC clock, so shift +05:30 before reading the parts; at 00:30 IST a bare new Date()
    // is still on the previous UTC day and would name the wrong target.
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const date = new Date(nowIST.getTime() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    // PER-USER READS, NOT A FILTERED collectionGroup. A collection-group query with a
    // `where` needs a COLLECTION_GROUP-scoped index declared in firestore.indexes.json, and
    // declaring a fieldOverride on `attendance*.date` REPLACES the automatic single-field
    // indexes — including the collection-scoped one the Android app's own
    // `attendance.whereEqualTo("date", today)` depends on. Getting that wrong breaks live
    // check-ins to save a few reads on a nightly job. The status doc is keyed BY date, so
    // this is a direct get rather than a query anyway — cheaper than the collectionGroup.
    const usersSnap = await db.collection("users").get();
    const perUser = await Promise.all(usersSnap.docs.map(async (userDoc) => {
      const userRef = db.collection("users").doc(userDoc.id);
      const [statusDoc, requestSnap] = await Promise.all([
        userRef.collection("attendance_status").doc(date).get(),
        userRef.collection("regularization_requests").where("date", "==", date).get(),
      ]);
      return {
        userId: userDoc.id,
        status: statusDoc.exists ? statusDoc.data() : null,
        requests: requestSnap.docs.map((d) => d.data()),
      };
    }));

    const batch = db.batch();
    const filed = [];
    let scanned = 0;
    for (const { userId, status, requests } of perUser) {
      if (!status) continue;
      scanned++;
      if (!needsAutoRegularization(status, requests)) continue;

      const request = buildAutoRegularization({
        user: { userId, name: status.userName, employeeId: status.employeeId },
        date,
        status,
        nowMillis: Date.now(),
      });
      batch.set(
        db.collection("users").doc(userId)
          .collection("regularization_requests").doc(`auto-${date}`),
        {
          ...request,
          // The pure module returns an ISO string so it stays clock-free and testable; the
          // stored field must be a Timestamp like every other submittedAt in the schema.
          submittedAt: admin.firestore.Timestamp.fromDate(new Date(request.submittedAt)),
        }
      );
      filed.push(status.employeeId || userId);
    }

    if (filed.length > 0) await batch.commit();

    // Run record, same contract as the nightly summary: a silent no-op and a silent failure
    // look identical without one. `ok:false` is what an alert should fire on.
    await db.doc(`system/auto_regularization/daily/${date}`).set({
      date,
      ranAt: admin.firestore.Timestamp.now(),
      scanned,
      filed: filed.length,
      employees: filed,
      ok: true,
    });

    console.log(`autoFileUnclosedDays: ${date} — scanned ${scanned}, filed ${filed.length}`);
  }
);

// ── Open-session reminder — 18:30 IST, "you are still checked in" ───────────
//
// Attacks the CAUSE of an unclosed day rather than its consequence: a nudge while the
// employee can still act beats a regularization the next morning. autoFileUnclosedDays is
// the safety net for when this is missed or ignored — both exist on purpose.
//
// Sends ONLY a `sent_notifications` doc, which sendPushNotification fans out to FCM. It
// deliberately does NOT also write users/{uid}/notifications: FcmService.onMessageReceived
// already saves an in-app copy when it receives one, so writing our own would give every
// foregrounded employee two identical rows.
//
// Idempotent by deterministic doc ID: sendPushNotification triggers on document CREATION,
// so a re-run `set`s the same path, which is an update and does not fire the trigger again.
// A retry therefore cannot push the same reminder twice.
//
// No Sunday/holiday calendar logic, deliberately: someone with no punches has an unopened
// day, isDayOpen returns false, and they are never messaged. The data already says who is
// working.
exports.openSessionReminder = onSchedule(
  {
    schedule: "30 18 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 120,
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();

    // Today in IST. 18:30 IST is 13:00 UTC, so the UTC date happens to agree today — but
    // shift anyway, because the rule is the rule and a schedule change must not silently
    // reintroduce the bug.
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const today = nowIST.toISOString().slice(0, 10);

    // Per-user reads rather than a filtered collectionGroup — same reason as
    // autoFileUnclosedDays: the index a filtered collection-group query needs would override
    // the automatic one the app's own attendance query relies on. This is the identical
    // query the Android client already runs for its own day, at collection scope.
    const usersSnap = await db.collection("users").get();
    const perUser = await Promise.all(usersSnap.docs.map(async (userDoc) => {
      const punchSnap = await db.collection("users").doc(userDoc.id)
        .collection("attendance").where("date", "==", today).get();
      return {
        userId: userDoc.id,
        user: userDoc.data(),
        punches: punchSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    }));

    const batch = db.batch();
    const nudged = [];
    for (const { userId, user, punches } of perUser) {
      if (!isDayOpen(punches, user.role)) continue;

      batch.set(db.collection("sent_notifications").doc(`open-session-${userId}-${today}`), {
        title: "You are still checked in",
        body: "Your day has no check-out yet. Please check out in the app — an unclosed day is recorded as a half day.",
        type: "attendance",
        recipientType: "specific",
        recipientId: userId,
        sentAt: admin.firestore.Timestamp.now(),
        sentBy: "openSessionReminder",
      });
      nudged.push(user.employeeId || userId);
    }

    if (nudged.length > 0) await batch.commit();

    console.log(`openSessionReminder: ${today} — ${nudged.length} open session(s): ${nudged.join(", ") || "none"}`);
  }
);

// ── Monthly Regularization Reminder — 25th of each month, 10 AM IST ─────────
exports.regularizationReminder = onSchedule(
  // Retry-safe only because the notification doc ID is now deterministic per month
  // (see below) — a re-run overwrites the same reminder instead of duplicating it.
  {
    schedule: "0 10 25 * *", timeZone: "Asia/Kolkata", timeoutSeconds: 120,
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();

    const snap = await db.collectionGroup("regularization_requests").get();
    const pending = snap.docs
      .map((d) => d.data())
      .filter((r) => r.status === "pending");

    if (pending.length === 0) {
      console.log("regularizationReminder: no pending requests, skipping");
      return;
    }

    const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
    if (adminsSnap.empty) {
      console.log("regularizationReminder: no admin users found");
      return;
    }

    // Deterministic notification ID, keyed to the IST month this reminder is for.
    // An auto-ID `.doc()` here meant every re-run (scheduler retry, manual trigger)
    // pushed ANOTHER copy of the same reminder at every admin. With a fixed ID the
    // re-run overwrites the existing notification instead of duplicating it.
    const nowIST    = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const monthKey  = nowIST.toISOString().slice(0, 7); // YYYY-MM
    const notifId   = `regularization-reminder-${monthKey}`;

    const notifBatch = db.batch();
    adminsSnap.docs.forEach((adminDoc) => {
      const notifRef = db.collection("users").doc(adminDoc.id)
        .collection("notifications").doc(notifId);
      notifBatch.set(notifRef, {
        title: "Regularization Review Pending",
        body: `${pending.length} attendance regularization request(s) need your review.`,
        type: "work_reminder",
        isRead: false,
        createdAt: admin.firestore.Timestamp.now(),
      });
    });
    await notifBatch.commit();

    console.log(`regularizationReminder: notified ${adminsSnap.size} admin(s) about ${pending.length} pending requests`);
  }
);

// ── Daily Spend Snapshot ────────────────────────────────────────────────
// One dailySpend/{uid}__{date} doc per employee per working day. Runs on the
// 22:30 IST cycle (same slot as exportToSheets), so at run time TODAY'S statuses
// are NOT yet final — computeDailyAttendanceStatus lands later at 23:59 IST. The
// window therefore processes through the prior day authoritatively; the current
// day self-heals on the next cycle once its statuses exist. Two passes:
//   1. Freeze-finalization: a locked month keeps the frozen:false its last unlocked
//      run left behind — relabel those rows frozen:true ONCE, without recomputing.
//      State-driven over lockedSet: finalizes any locked month with surviving
//      unfrozen rows regardless of how far behind the admin locked it.
//   2. Recompute: rewrite the current month + any still-unlocked priors (frozen:false),
//      and DELETE orphaned rows in those unlocked window months (a day whose only
//      driver — e.g. rest-day OT — was removed drops to zero instead of over-counting).
// A locked month is never recomputed (openWindowMonths stops at the first locked month).
// See docs/superpowers/specs/2026-07-24-daily-spend-snapshot-design.md.
exports.snapshotDailySpend = onSchedule(
  // Retry-safe: dailySpend rows use deterministic `{uid}__{date}` IDs and the pass is a
  // recompute-and-overwrite (locked months are never rewritten), so a re-run converges.
  {
    schedule: "30 22 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300, memory: "512MiB",
    retryCount: 3, minBackoffSeconds: 60, maxDoublings: 2,
  },
  async () => {
    const db = admin.firestore();

    // IST date components. The runtime clock is UTC, so shift by +05:30 and read via
    // getUTC* — using new Date()/getDate()/getDay() would read the UTC calendar day and
    // weekday, which drifts from IST near midnight (same bug class as computeDailyAttendanceStatus).
    const nowIST   = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const istYear  = nowIST.getUTCFullYear();
    const istMonth = nowIST.getUTCMonth(); // 0-based
    const istDay   = nowIST.getUTCDate();
    const pad2 = (n) => String(n).padStart(2, "0");
    const currentKey = `${istYear}-${pad2(istMonth + 1)}`;
    const today = `${istYear}-${pad2(istMonth + 1)}-${pad2(istDay)}`;

    // Users + pay (same pattern as exportToSheets — pay lives in the compensation
    // subcollection; withPay falls back PER FIELD to the legacy inline value).
    const allUsersSnap = await db.collection("users").get();
    const compSnap = await db.collectionGroup("compensation").get();
    const compByUid = new Map();
    compSnap.docs.forEach((d) => {
      const uid = d.ref.parent.parent && d.ref.parent.parent.id;
      if (uid) compByUid.set(uid, d.data());
    });
    const users = allUsersSnap.docs.map((d) => withPay({ id: d.id, ...d.data() }, compByUid.get(d.id)));
    const usersById = new Map(users.map((u) => [u.id, u]));

    const monthOf = (dateStr) => dateStr.slice(0, 7);

    // Special Allowance — users/{uid}/specialAllowance/{YYYY-MM}, one doc per employee per
    // month, doc id === "YYYY-MM". Fetched + client-filtered exactly like lockedSet below to
    // avoid a collection-group index; the set stays small. uid comes from the subcollection
    // parent, as in the compByUid loop.
    const saSnap = await db.collectionGroup("specialAllowance").get();
    const saByUid = new Map(); // uid → Map(month → { date, amount })
    const saLockedMonths = new Set(); // months frozen by the SA half of Settle & Lock
    saSnap.docs.forEach((d) => {
      const uid = d.ref.parent.parent && d.ref.parent.parent.id;
      if (!uid) return;
      const s = d.data();
      const amount = Number(s.amount);
      const entry = { date: typeof s.date === "string" ? s.date : "", amount: Number.isFinite(amount) ? amount : 0 };
      if (!saByUid.has(uid)) saByUid.set(uid, new Map());
      saByUid.get(uid).set(d.id, entry); // d.id === "YYYY-MM"
      if (s.locked === true) saLockedMonths.add(d.id); // d.id === "YYYY-MM"
    });

    // Locked months (company-wide freeze signal) — the UNION of BOTH halves of Settle & Lock:
    // any locked settlement doc OR any locked specialAllowance doc. The SA half counts on its
    // own because the OT Settlements page renders "🔒 settled & locked" when EITHER half is
    // locked, and it will happily lock a month with no operations employees at all (no
    // settlement docs, but real SA). Building lockedSet from settlements alone would leave
    // such a month outside lockedSet forever: recomputed nightly, never freeze-finalized, its
    // rows stuck at frozen:false — i.e. the UI's lock claim would be a lie to the backend.
    // Both collections are fetched + client-filtered (like getSettlementsForMonth) to avoid
    // collection-group indexes; both stay small (one doc per employee per settled month) and
    // both use doc id === "YYYY-MM".
    const settleSnap = await db.collectionGroup("settlements").get();
    const lockedSet = new Set([
      ...settleSnap.docs.filter((d) => d.data().locked === true).map((d) => d.id),
      ...saLockedMonths,
    ]);

    // ── Pass 1: freeze-finalization ───────────────────────────────────
    // The recompute pass below only writes unlocked months, so a month that locked since
    // the last run still carries frozen:false on its rows. Relabel them frozen:true ONCE,
    // WITHOUT recomputing values. STATE-DRIVEN: iterate the actual lockedSet, not a fixed
    // -1/-2 offset — a month can be locked while the admin is ≥3 months behind (past the
    // recompute cap), and such a month would otherwise never be probed and stay frozen:false
    // forever. Already-finalized months return empty from the indexed limit-1 probe (cheap),
    // so re-probing them nightly is fine. Needs a (month, frozen) composite index.
    for (const M of lockedSet) {
      const probe = await db.collection("dailySpend")
        .where("month", "==", M).where("frozen", "==", false).limit(1).get();
      // Already finalized on a previous run (or the month has no rows at all). Deliberately
      // also skips the SA reconciliation below: repairing an ALREADY-frozen month is exactly
      // the "recompute a locked month" this pass exists to avoid. An SA that arrives after
      // the freeze (only reachable by a direct API write — the admin UI renders a locked
      // month read-only) is left alone and reported nightly by the backstop at the end.
      if (probe.empty) continue;
      const monthSnap = await db.collection("dailySpend").where("month", "==", M).get();
      const rowById = new Map(monthSnap.docs.map((d) => [d.id, d]));

      // ── SA reconciliation: the ONE exception to "a locked month is never recomputed" ──
      // WHY SA AND NOTHING ELSE. Every other component (salary / OT-WO / conveyance /
      // PF / ESI / imprest) is derived from attendance that is complete and settled before
      // the admin locks, so recomputing it after the lock could only ever move a settled
      // figure — which is exactly what freezing exists to prevent. SA is different: it is a
      // number a human types, and the NORMAL workflow lets it be typed after the last
      // snapshot run and before the lock (manager enters 31 Jul's allowance at 23:10 on
      // 31 Jul, after that night's 22:30 run; admin Settle & Locks July at 14:00 on 1 Aug).
      // Pass 2 below only ever writes UNLOCKED months, so by the 1 Aug run July is already
      // locked and that SA would never reach dailySpend at all — silently absent from
      // payroll and from the Forecasting Daily Snapshot, with no self-heal.
      // Pass 1 fires exactly ONCE per newly-locked month (the frozen:false probe above gates
      // it), which is precisely the "this month is being frozen — take its final picture"
      // hook. So: fold `sa` in here, and NOTHING else. The patch below sets only `sa` and
      // re-derives `totalSpend` from the row's OWN already-stored components (saRowPatch in
      // dailySpend.js) — no component is ever recomputed from source data.
      const saUpdates = new Map(); // existing row id → extra fields folded into its freeze update
      const saCreates = [];        // rows that don't exist yet, created already-frozen
      for (const [uid, months] of saByUid) {
        const entry = months.get(M);
        if (!entry || !entry.date) continue; // a dateless doc has no row to land on
        // A doc whose date lands in a DIFFERENT month is not ours to place: if that month is
        // open Pass 2 emits it there, and if it is not the backstop below warns.
        if (monthOf(entry.date) !== M) continue;
        const id = `${uid}__${entry.date}`;
        const existing = rowById.get(id);
        // ⚠️ Deliberately NOT gated on `entry.amount` being truthy. ₹0 is a real amount the
        // Users page accepts, so "corrected to ₹0" and "nothing entered" are different facts,
        // and a truthiness guard here would drop the correction: a row already carrying
        // sa: 5000 from an earlier open-month run would freeze with the stale ₹5000 forever,
        // overstating payroll and the Forecasting snapshot with no self-heal. Pass 2 gets this
        // right for an unlocked month (it recomputes `sa` unconditionally per candidate date);
        // this is the locked-month equivalent. saRowPatch answers both questions on its own —
        // null means "already correct" OR "₹0 with no row to correct" (which must not conjure
        // an all-zero row); non-null means a write is genuinely needed.
        const patch = saRowPatch(existing ? existing.data() : null, entry.amount);
        if (!patch) continue;
        if (existing) {
          saUpdates.set(id, patch);
        } else {
          // No row for the SA's date — an allowance dated on a Sunday, a leave day, or any
          // day with no economic activity. Create it carrying ONLY the SA (every other
          // component 0, totalSpend consistent), already frozen.
          const u = usersById.get(uid);
          saCreates.push({
            id,
            data: {
              userId: uid, employeeId: (u && u.employeeId) || "", name: (u && u.name) || "", role: (u && u.role) || "",
              date: entry.date, month: M,
              salary: 0, conveyance: 0, pf: 0, esi: 0, otWo: 0, imprest: 0,
              sa: patch.sa, totalSpend: patch.totalSpend,
              frozen: true,
              computedAt: admin.firestore.Timestamp.now(),
            },
          });
        }
      }

      let fBatch = db.batch();
      let fOps = 0;
      for (const doc of monthSnap.docs) {
        const extra = saUpdates.get(doc.id); // SA only — see the block above
        fBatch.update(doc.ref, extra ? { frozen: true, ...extra } : { frozen: true });
        fOps++;
        if (fOps >= 400) { await fBatch.commit(); fBatch = db.batch(); fOps = 0; }
      }
      for (const c of saCreates) {
        fBatch.set(db.collection("dailySpend").doc(c.id), c.data, { merge: false });
        fOps++;
        if (fOps >= 400) { await fBatch.commit(); fBatch = db.batch(); fOps = 0; }
      }
      if (fOps > 0) await fBatch.commit();
      const saNote = (saUpdates.size || saCreates.length)
        ? ` (SA reconciled: ${saUpdates.size} updated, ${saCreates.length} created)` : "";
      console.log(`dailySpend: finalized (frozen:true) ${monthSnap.size} rows for ${M}${saNote}`);
    }

    // ── Pass 2: recompute the open window ─────────────────────────────
    // Months to recompute this run, and the earliest for range-scoped source loads.
    const windowMonths = openWindowMonths(currentKey, lockedSet);
    const earliest = windowMonths[0];
    const rangeStart = `${earliest}-01`;

    // Per-day sources scoped to [rangeStart, today]. Module-scope uidOf resolves the owner
    // (userId field if present, else the subcollection parent).
    const inRange = (d) => d.date >= rangeStart && d.date <= today;

    const statusDocs = (await db.collectionGroup("attendance_status").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);
    const eventDocs = (await db.collectionGroup("attendance").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);
    const plannedDocs = (await db.collectionGroup("planned_hours").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);
    const approvalDocs = (await db.collectionGroup("ot_approvals").get()).docs
      .map((doc) => ({ ...doc.data(), userId: uidOf(doc) })).filter(inRange);

    const holidaySnap = await db.collection("holidays")
      .where("date", ">=", rangeStart).where("date", "<=", today).get();
    const holidaySet = new Set(holidaySnap.docs.map((h) => h.id));

    const convSnap = await db.collection("conveyance")
      .where("date", ">=", rangeStart).where("date", "<=", today).get();
    const convByKey = new Map(); // `${uid}__${date}` → ₹
    const convDatesByUser = new Map(); // uid → Set<date> (conveyance can fall on Sundays)
    convSnap.docs.forEach((d) => {
      const c = d.data();
      convByKey.set(`${c.userId}__${c.date}`, Number(c.conveyance) || 0);
      if (!convDatesByUser.has(c.userId)) convDatesByUser.set(c.userId, new Set());
      convDatesByUser.get(c.userId).add(c.date);
    });

    // Statuses grouped by user for salary; the ledger helper filters internally.
    const statusesByUser = new Map();
    statusDocs.forEach((s) => {
      if (!statusesByUser.has(s.userId)) statusesByUser.set(s.userId, []);
      statusesByUser.get(s.userId).push(s);
    });

    // UTC-safe weekday: read getUTCDay() on a Z-anchored string (functions run on UTC).
    const isSunday = (dateStr) => new Date(dateStr + "T00:00:00Z").getUTCDay() === 0;

    // Existing dailySpend row ids in the UNLOCKED window months, so we can drop-to-zero any
    // row we no longer write this run (an orphan: e.g. an authorized rest-day OT day whose OT
    // was later de-authorized before lock — its date leaves candidateDates, so a pure upsert
    // would leave the stale row behind and the month would over-count with no self-heal).
    // windowMonths has ≤4 entries (all unlocked — locked months are excluded), safe for `in`.
    const existingSnap = await db.collection("dailySpend").where("month", "in", windowMonths).get();
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));
    const writtenIds = new Set(); // ids we (re)write this run

    let batch = db.batch();
    let ops = 0;
    const commitIfFull = async () => { if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; } };

    for (const user of users) {
      const rate = user.salaryRate || 0;
      // Role gating via capabilities, never inline role branching.
      const otMap = usesOtShortageLedger(user.role)
        ? dailyOtWoCash(user.id, rate, eventDocs, plannedDocs, approvalDocs, statusesByUser.get(user.id) || [], holidaySet)
        : new Map();

      // Union of every date that can carry economic value for this employee: status-doc
      // days, OT/WO-cash days (rest-day OT & worked-WO fall on Sundays/holidays with no
      // status doc), conveyance days (can be Sundays), and Special Allowance dates. Iterating
      // only statuses skipped those, breaking the Σ dailySpend == settlementCash / conveyance
      // reconciliation. The SA date is load-bearing for the SAME reason: a manager can date SA
      // on a Sunday or on a day with no attendance status, and that day would otherwise never
      // be a candidate, so the SA would silently never be emitted at all.
      const userStatuses = statusesByUser.get(user.id) || [];
      const statusByDate = new Map(userStatuses.map((s) => [s.date, s]));
      const candidateDates = new Set(userStatuses.map((s) => s.date));
      for (const d of otMap.keys()) candidateDates.add(d);
      for (const d of (convDatesByUser.get(user.id) || [])) candidateDates.add(d);
      // uid → Map(month → {date, amount}); one SA date per month, keyed by date for the lookup.
      const userSa = saByUid.get(user.id) || new Map();
      const saByDate = new Map();
      for (const entry of userSa.values()) {
        if (!entry.date) continue;
        saByDate.set(entry.date, (saByDate.get(entry.date) || 0) + entry.amount);
        candidateDates.add(entry.date);
      }

      for (const date of candidateDates) {
        if (!windowMonths.includes(monthOf(date))) continue; // locked/out-of-window → never written

        const status = statusByDate.get(date); // may be undefined (OT/conveyance-only day)
        const sunday = isSunday(date);
        // Sundays are not paid working days — matches the MTD summary, which skips only
        // Sundays for salary (NOT holidays); an OT/conveyance-only day has no status → 0.
        const salary = (status && !sunday) ? dailySalary(rate, status.status) : 0;
        const conveyance = usesConveyance(user.role) ? (convByKey.get(`${user.id}__${date}`) || 0) : 0;
        const otWo = round2(otMap.get(date) || 0);
        // SA lands entirely on its one manager-picked date; every other day of the month is 0.
        // Not prorated, and not part of the PF/ESI/Imprest base (dailyDeductions ignores it).
        const sa = round2(saByDate.get(date) || 0);
        const { pf, esi, imprest } = dailyDeductions({
          salary, pfPercent: user.pfPercent, esiPercent: user.esiPercent, imprestPercent: user.imprestPercent,
        });
        const totalSpend = dailyTotal({ salary, conveyance, imprest, otWo, pf, esi, sa });

        // Emit if the day carries any economic value OR is a tracked non-Sunday attendance
        // day; drops empty unworked-WO-Sundays and no-activity days. SA counts as economic
        // value — an SA-only Sunday must still be emitted.
        const hasValue = salary !== 0 || conveyance !== 0 || otWo !== 0 || sa !== 0;
        if (!hasValue && !(status && !sunday)) continue;

        const id = `${user.id}__${date}`;
        batch.set(db.collection("dailySpend").doc(id), {
          userId: user.id, employeeId: user.employeeId || "", name: user.name || "", role: user.role || "",
          date, month: monthOf(date),
          salary, conveyance, pf, esi, otWo, imprest, sa, totalSpend,
          frozen: false,
          computedAt: admin.firestore.Timestamp.now(),
        }, { merge: false });
        writtenIds.add(id);
        ops++;
        await commitIfFull();
      }
    }
    if (ops > 0) await batch.commit();
    console.log(`dailySpend: recomputed months [${windowMonths.join(", ")}] up to ${today}`);

    // Backstop: an SA that genuinely never reached dailySpend. Pass 2 above writes only the
    // open window and Pass 1 reconciles a locked month's SA exactly ONCE (the run that
    // freezes it), so an SA written into an ALREADY-frozen month has no path in at all. The
    // admin UI prevents that (a locked month renders read-only), so this should stay silent.
    //
    // ⚠️ It must warn only when the SA is ACTUALLY MISSING, never merely because its month is
    // outside the recompute window: openWindowMonths returns the current month plus at most 3
    // unlocked priors, so "outside the window" describes every correctly-processed SA in every
    // settled month, forever — a warning that grows by one line per employee per month and
    // buries the one real alarm. So we PROBE the row instead: one getAll over the handful of
    // SA docs whose date month sits outside the window, warning only if the row is absent or
    // its `sa` disagrees with the doc's amount.
    //
    // NOTE: this deliberately does NOT catch an SA whose `date` was mis-typed into a
    // different, still-OPEN month (a July doc dated 2026-08-15 while August is open): such a
    // doc IS emitted, just onto the August row, so the probe finds it and stays quiet. That
    // is reachable only by a direct API write — the UI pins the date input's min/max to the
    // doc's own month — and the place to close it is the UI/rules, not a nightly log line.
    const describeUser = (uid) => {
      const u = usersById.get(uid);
      return u ? `${u.name || "(no name)"} (${u.employeeId || uid})` : uid;
    };
    const saSuspects = []; // SA docs Pass 2 did not just write — worth probing
    for (const [uid, months] of saByUid) {
      for (const [m, entry] of months) {
        if (!entry.date) {
          // A dateless doc can never be placed on a row. ₹0 has nothing to place, so it is
          // only worth naming when there is actual money stranded.
          if (entry.amount) {
            console.warn(
              `dailySpend: SA for ${describeUser(uid)} in ${m} (₹${entry.amount}) is NOT reflected in dailySpend — it has no date`,
            );
          }
          continue;
        }
        // A dated SA inside the window was (re)written by Pass 2 moments ago — nothing to check.
        if (windowMonths.includes(monthOf(entry.date))) continue;
        // ⚠️ ₹0 docs are probed too, and for the reason the whole backstop exists: a
        // correction to ₹0 that never reached its row leaves a stale NONZERO `sa` frozen in
        // place. Skipping ₹0 here would make exactly that failure invisible. saRowPatch keeps
        // the harmless case quiet — ₹0 with no row is null, i.e. nothing to report.
        saSuspects.push({ uid, month: m, entry });
      }
    }
    for (let i = 0; i < saSuspects.length; i += 300) { // chunked: getAll takes one RPC per call
      const chunk = saSuspects.slice(i, i + 300);
      const snaps = await db.getAll(
        ...chunk.map((p) => db.collection("dailySpend").doc(`${p.uid}__${p.entry.date}`)),
      );
      chunk.forEach((p, k) => {
        const snap = snaps[k];
        const row = snap && snap.exists ? snap.data() : null;
        // Same question Pass 1 asks: would a write be needed? null = correctly carried, or
        // ₹0 with no row (nothing to carry). Either way there is nothing to report.
        if (!saRowPatch(row, p.entry.amount)) return;
        const why = row
          ? `the dailySpend row for ${p.entry.date} carries ₹${round2(row.sa)} instead`
          : `there is no dailySpend row for ${p.entry.date}`;
        console.warn(
          `dailySpend: SA for ${describeUser(p.uid)} in ${p.month} (₹${p.entry.amount}) is NOT reflected in dailySpend — ${why}`,
        );
      });
    }

    // Orphan cleanup: any pre-existing row in an unlocked window month that we did NOT rewrite
    // this run has lost its economic driver — delete it so the day drops to zero. Only unlocked
    // window months are in existingIds (locked/finalized months are never in windowMonths), so
    // frozen/settled data is never touched.
    let dBatch = db.batch();
    let dOps = 0;
    let deleted = 0;
    for (const id of existingIds) {
      if (writtenIds.has(id)) continue;
      dBatch.delete(db.collection("dailySpend").doc(id));
      dOps++;
      deleted++;
      if (dOps >= 400) { await dBatch.commit(); dBatch = db.batch(); dOps = 0; }
    }
    if (dOps > 0) await dBatch.commit();
    if (deleted > 0) {
      console.log(`dailySpend: deleted ${deleted} orphaned row(s) in [${windowMonths.join(", ")}]`);
    }
  },
);

// ── Employee Logout — auto check-out from everywhere + home_out ──────────────
exports.onEmployeeLogout = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

  const db  = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const today  = nowIST.toISOString().slice(0, 10);

  const userDoc = await db.doc(`users/${uid}`).get();
  if (!userDoc.exists) throw new HttpsError("not-found", "User profile not found.");
  const user = userDoc.data();

  const attendSnap = await db.collection(`users/${uid}/attendance`)
    .where("date", "==", today).get();
  const events = attendSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const inTypes  = new Set(events.filter((e) => e.type.endsWith("_in")).map((e) => e.type));
  const outTypes = new Set(events.filter((e) => e.type.endsWith("_out")).map((e) => e.type));

  const batch = db.batch();
  let wrote = 0;

  for (const inType of inTypes) {
    const outType = inType.replace("_in", "_out");
    if (outTypes.has(outType)) continue;

    const lastIn = events
      .filter((e) => e.type === inType)
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))[0];

    const ref = db.collection(`users/${uid}/attendance`).doc();
    batch.set(ref, {
      userId: uid,
      userName: user.name || "",
      employeeId: user.employeeId || "",
      date: today,
      type: outType,
      timestamp: now,
      latitude: lastIn?.latitude || 0,
      longitude: lastIn?.longitude || 0,
      siteId: lastIn?.siteId || "",
      siteName: lastIn?.siteName || "",
      marketName: lastIn?.marketName || "",
      autoLogout: true,
    });
    wrote++;
  }

  if (!outTypes.has("home_out") && !inTypes.has("home_out")) {
    const homeIn = events.find((e) => e.type === "home_in");
    const ref = db.collection(`users/${uid}/attendance`).doc();
    batch.set(ref, {
      userId: uid,
      userName: user.name || "",
      employeeId: user.employeeId || "",
      date: today,
      type: "home_out",
      timestamp: now,
      latitude: user.homeLat || homeIn?.latitude || 0,
      longitude: user.homeLng || homeIn?.longitude || 0,
      siteId: "",
      siteName: "",
      marketName: "",
      autoLogout: true,
    });
    wrote++;
  }

  if (wrote > 0) await batch.commit();
  console.log(`onEmployeeLogout: ${uid} — ${wrote} auto-checkout event(s) for ${today}`);
  return { success: true, eventsCreated: wrote };
});

// ── Offboarding / reactivation (Admin SDK) ────────────────────────────────────
// Disables (or re-enables) the user's Auth account — blocks login server-side — and
// mirrors it on the user doc. Never deletes data: attendance/salary history is retained.
// Suspend / reactivate an employee. Same mechanic in both directions (Auth `disabled`
// + doc `active` toggle together; NO data is ever deleted) but a suspension also records
// a required reason, the acting admin, a server timestamp, an optional expected-return
// date, and appends to an on-doc `suspensionHistory` log. Reactivating clears the
// current-state fields and logs a `reactivate` event.
exports.setUserActive = onCall(async (request) => {
  const callerUid = await assertAdmin(request);
  const { uid, active, reason, expectedReturn } = request.data || {};
  if (!uid || typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "uid and active (boolean) are required.");
  }

  const FieldValue = admin.firestore.FieldValue;
  const Timestamp = admin.firestore.Timestamp;
  const userRef = admin.firestore().doc(`users/${uid}`);

  // Acting admin's display name (server-resolved, so who/when can't be spoofed by the client).
  const callerSnap = await admin.firestore().doc(`users/${callerUid}`).get();
  const byName = (callerSnap.exists && callerSnap.data().name) || request.auth?.token?.email || "admin";

  if (active === false) {
    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (!reasonText) {
      throw new HttpsError("invalid-argument", "A reason is required to suspend an employee.");
    }
    const ret = typeof expectedReturn === "string" && expectedReturn.trim() ? expectedReturn.trim() : null;

    await admin.auth().updateUser(uid, { disabled: true });
    await userRef.update({
      active: false,
      suspendedReason: reasonText,
      suspendedBy: byName,
      suspendedAt: FieldValue.serverTimestamp(),
      expectedReturn: ret,
      // serverTimestamp() sentinels are rejected inside arrayUnion elements — use a concrete
      // server-clock Timestamp for the history entry.
      suspensionHistory: FieldValue.arrayUnion({
        action: "suspend",
        reason: reasonText,
        by: byName,
        at: Timestamp.now(),
        ...(ret ? { expectedReturn: ret } : {}),
      }),
    });
    console.log(`setUserActive: ${uid} → suspended by ${byName}`);
  } else {
    await admin.auth().updateUser(uid, { disabled: false });
    await userRef.update({
      active: true,
      suspendedReason: FieldValue.delete(),
      suspendedBy: FieldValue.delete(),
      suspendedAt: FieldValue.delete(),
      expectedReturn: FieldValue.delete(),
      suspensionHistory: FieldValue.arrayUnion({
        action: "reactivate",
        by: byName,
        at: Timestamp.now(),
      }),
    });
    console.log(`setUserActive: ${uid} → reactivated by ${byName}`);
  }
  return { success: true };
});

// ── Admin password reset (Admin SDK) — THE ONLY WAY A PASSWORD IS EVER SET ────
// Staff sign in as `<empId>@whitecoffee.internal`, a login key with no mailbox, so no
// emailed reset can reach them. An admin sets the password on /users and hands it over.
//
// ⚠️ A reset-link callable (generatePasswordResetLink) and an unauthenticated
// self-service endpoint both existed and were REMOVED on 2026-08-05 by decision, not by
// accident — one path means there is never a question of which one is authoritative.
// Read docs/password-policy.md before adding a second; an unauthenticated variant in
// particular is account takeover for anyone who can guess a sequential employee ID.
exports.resetUserPassword = onCall(async (request) => {
  await assertAdmin(request);
  const { uid, newPassword } = request.data || {};
  if (!uid || typeof newPassword !== "string" || newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "uid and newPassword (min 6 chars) are required.");
  }
  await admin.auth().updateUser(uid, { password: newPassword });
  console.log(`resetUserPassword: ${uid}`);
  return { success: true };
});

// ── Force sign-out everywhere (Admin SDK) ─────────────────────────────────────
// "This person's password may be compromised — get them out of everything, now."
//
// This is the answer to the portal having no session enforcement, and it is deliberately
// NOT a mirror of the app's single-device rule. Mirroring would mean the portal writing
// `activeSessionToken` on login, which would eject an admin's own phone every time they
// opened the portal — the two surfaces are meant to be used at the same time.
//
// Two mechanisms, because the surfaces revoke differently:
//
//   1. revokeRefreshTokens invalidates every refresh token, which is what actually ends a
//      portal session. ⚠️ Already-issued ID tokens stay valid until they expire, so the
//      portal can survive up to an hour unless firestore.rules starts checking
//      `request.auth.token.auth_time` against a revocation timestamp. Accepted for now:
//      this is a "someone may have my password" tool, not a containment boundary.
//
//   2. A FRESH RANDOM activeSessionToken ejects the phones immediately, since the app
//      watches the field live. ⚠️ It must be non-empty and different — NOT cleared.
//      `isSessionSuperseded` treats an empty/absent token as "no session recorded" and
//      never signs anyone out (a doc predating the field would otherwise eject its owner
//      on every snapshot). Writing "" here would look like it worked and do nothing.
exports.revokeUserSessions = onCall(async (request) => {
  const actor = await assertAdmin(request);
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  const userRecord = await admin.auth().getUser(uid).catch(() => null);
  if (!userRecord) throw new HttpsError("not-found", "No Auth account for that user.");

  await admin.auth().revokeRefreshTokens(uid);

  // A token no device can be holding. Stamped for the audit log like any other write;
  // auditLog.js redacts the VALUE, so the trail records that sessions were revoked and by
  // whom without publishing a live session token.
  await admin.firestore().doc(`users/${uid}`).update({
    activeSessionToken: require("node:crypto").randomUUID(),
    lastModifiedBy: actor,
    lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`revokeUserSessions: ${uid} by ${actor}`);
  return { success: true };
});

// ── Admin login-email change (Admin SDK) ──────────────────────────────────────
// Changes the employee's sign-in credential in Auth AND mirrors it on the user doc
// so the two never drift. The employee logs in with the new email afterwards.
exports.updateUserEmail = onCall(async (request) => {
  await assertAdmin(request);
  const { uid, email } = request.data || {};
  const next = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!uid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
    throw new HttpsError("invalid-argument", "uid and a valid email are required.");
  }
  try {
    await admin.auth().updateUser(uid, { email: next });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "That email is already used by another login.");
    }
    if (e.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "That email is not valid.");
    }
    throw new HttpsError("internal", e.message || "Failed to update email.");
  }
  await admin.firestore().doc(`users/${uid}`).update({ email: next });
  console.log(`updateUserEmail: ${uid} → ${next}`);
  return { success: true };
});

// ── Punch integrity — server verdict on every attendance event ───────────────
// Attendance punches are written CLIENT-SIDE and must stay that way: the Android app
// writes through the Firestore SDK without awaiting, so a punch made at a site with no
// signal is cached locally and synced later. Routing punches through a callable would
// require connectivity and would lose those punches outright.
//
// Security rules bound what the client may write (type allowlist, timestamp window,
// shape). This trigger scores what actually landed and — crucially — corrects the `date`
// field, which rules cannot do (no timezone arithmetic) and which the nightly scorer
// queries by, making a forged `date` a way to reassign a punch to another day.
//
// It NEVER deletes or rejects a punch. Everything is recorded and flagged; a punch outside
// a geofence is still a punch, because GPS drifts indoors and a site's stored coordinates
// may simply be wrong. Refusing it would cost a real employee a real day's pay.
exports.onPunchWritten = onDocumentCreated(
  "users/{userId}/attendance/{docId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const punch = snap.data();
    // The server clock is the trusted one; the client timestamp is only ever evidence.
    const receivedAt = Date.now();

    const patch = assessPunch(punch, receivedAt);

    // Sequence check — is this punch possible given the rest of its day? assessPunch judges
    // the punch ALONE (clock, date, mock GPS) and cannot see that an `office_out` arrived
    // with nothing open, which is exactly how a stale client wrote one as the first event of
    // a day. That needs the day, so it costs two reads and lives here rather than in the
    // pure module.
    //
    // Read the day against the date assessPunch SETTLED ON, not the one the client sent: a
    // corrected `date` means the client named the wrong day, and querying the original would
    // assess this punch against a day it does not belong to.
    const day = patch.date || punch.date;
    try {
      const userRef = admin.firestore().collection("users").doc(event.params.userId);
      const [userDoc, daySnap] = await Promise.all([
        userRef.get(),
        userRef.collection("attendance").where("date", "==", day).get(),
      ]);
      const dayPunches = daySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const { flags } = assessSequence(
        { id: snap.id, ...punch },
        dayPunches,
        userDoc.data() && userDoc.data().role
      );
      if (flags.length > 0) {
        patch.integrity.flags = patch.integrity.flags.concat(flags);
        // `trusted` was decided by assessPunch before these flags existed — restate it over
        // the full set, or a sequence-flagged punch would still claim to be trusted.
        patch.integrity.trusted = false;
      }
    } catch (e) {
      // A sequence check that cannot read the day must not cost the punch its annotation:
      // the clock/date/mock verdict is independently useful and is already computed. Degrade
      // to that rather than losing both.
      console.error(`onPunchWritten: sequence check failed for ${snap.ref.path}: ${e.message}`);
    }

    try {
      await snap.ref.update(patch);
    } catch (e) {
      // Never rethrow into a retry loop over an audit annotation — the punch itself is
      // already safely recorded, which is the part that matters.
      console.error(`onPunchWritten: could not annotate ${snap.ref.path}: ${e.message}`);
      return;
    }

    if (patch.integrity.flags.length > 0) {
      console.warn(
        `onPunchWritten: ${event.params.userId} ${punch.type} flagged ` +
        `[${patch.integrity.flags.join(", ")}] skew=${patch.integrity.clockSkewMinutes}m`
      );
    }
  }
);

// ── Audit log — before/after record of every write ───────────────────────────
// Firestore triggers do NOT carry auth context, so the actor is recovered from the
// document's own `lastModifiedBy` (stamped by both clients on every write) and falls back
// to business fields like approvedBy/markedBy. There is NO client IP and there cannot be:
// rules have no `request.ip` and neither do triggers. IPs for client-SDK writes are only
// available via GCP Cloud Audit Logs (Data Access), which is console configuration.
//
// Two triggers cover the database, because Firestore path patterns match a FIXED depth:
// "{collection}/{docId}" catches every top-level document (including users/{uid}), and
// "users/{userId}/{collection}/{docId}" catches every user subcollection document. A
// separate users/{userId} trigger would double-audit every user write.
//
// ⚠️ audit_log is excluded in auditLog.js — auditing our own writes would recurse without
// bound and bill for every cycle.
async function writeAuditEntry(path, before, after) {
  const entry = buildEntry(path, before, after, Date.now());
  if (!entry) return; // excluded path (audit_log itself)
  try {
    await admin.firestore().collection("audit_log").add(entry);
  } catch (e) {
    // An audit failure must never roll back or retry the business write that caused it —
    // the write already happened and is the thing that matters.
    console.error(`audit: failed to record ${path}: ${e.message}`);
  }
}

exports.auditTopLevel = onDocumentWritten("{collection}/{docId}", async (event) => {
  await writeAuditEntry(
    event.data.after.ref.path,
    event.data.before.exists ? event.data.before.data() : null,
    event.data.after.exists ? event.data.after.data() : null,
  );
});

exports.auditUserSubcollection = onDocumentWritten("users/{userId}/{collection}/{docId}", async (event) => {
  await writeAuditEntry(
    event.data.after.ref.path,
    event.data.before.exists ? event.data.before.data() : null,
    event.data.after.exists ? event.data.after.data() : null,
  );
});
