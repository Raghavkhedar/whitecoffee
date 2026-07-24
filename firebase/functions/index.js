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
  dailySalary, dailyDeductions, dailyTotal, round2, openWindowMonths,
} = require("./dailySpend");
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
exports.accrueMonthlyLeave = onSchedule(
  { schedule: "0 0 1 * *", timeZone: "Asia/Kolkata", timeoutSeconds: 120 },
  async () => {
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    const batch = db.batch();
    usersSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { plBalance: admin.firestore.FieldValue.increment(1) });
    });
    await batch.commit();
    console.log(`accrueMonthlyLeave: +1 PL applied to ${usersSnap.size} users`);
  }
);

// ── Daily Attendance Status — 23:59 IST, ALL users ──────────────────────────
exports.computeDailyAttendanceStatus = onSchedule(
  { schedule: "59 23 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300 },
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

    for (const user of allUsers) {
      if (adminOverrides.has(user.id)) continue;
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
    }

    await batch.commit();
    for (const uid of plDeductions) {
      await db.doc(`users/${uid}`).update({ plBalance: admin.firestore.FieldValue.increment(-1) });
    }
    console.log(`computeDailyAttendanceStatus: ${allUsers.length} users for ${today}, PL deducted: ${plDeductions.length}`);
  }
);

// ── Daily Sheets Export ───────────────────────────────────────────────────────
exports.exportToSheets = onSchedule(
  { schedule: "0 22 * * *", timeZone: "Asia/Kolkata", secrets: ["ATTENDANCE_SHEETS_KEY", "MAPS_API_KEY"], timeoutSeconds: 540, memory: "512MiB" },
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
        "In Time", "In Location", "In Site ID", "Out Time", "Out Location", "Out Site ID",
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
          timeIST(firstIn?.timestamp), locOf(firstIn), siteIdOf(firstIn),
          timeIST(lastOut?.timestamp), locOf(lastOut), siteIdOf(lastOut),
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
        "Submitted At", "Status", "Employee Name", "Employee ID",
        "Site ID", "Site Name", "Item Name", "Quantity", "Unit", "Item Notes", "Overall Notes", "Photo URLs",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const base   = [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || ""];
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
        "Submitted At", "Status", "Employee Name", "Employee ID",
        "Site ID", "Site Name", "Item Name", "Quantity", "Unit",
        "Price Per Unit", "Total Price", "Grand Total", "Notes", "Photo URLs",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const base   = [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || ""];
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
        "Submitted At", "Status", "Employee Name", "Employee ID", "Transfer Date",
        "From", "To", "Transferred By", "Received By",
        "Item Name", "Quantity", "Unit", "Condition", "Notes", "Photo URLs",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d      = doc.data();
        const items  = Array.isArray(d.items) ? d.items : [];
        const photos = Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : "";
        const uid    = uidOf(doc);
        const base   = [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.transferDate || "", d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
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
        "Submitted At", "Status", "Employee Name", "Employee ID", "Transfer Date",
        "From", "To", "Transferred By", "Received By",
        "Item Name", "Quantity", "Unit", "Condition", "Notes",
      ];
      const rows = [];
      snap.docs.forEach((doc) => {
        const d    = doc.data();
        const items = Array.isArray(d.items) ? d.items : [];
        const uid   = uidOf(doc);
        const base  = [ts(d.submittedAt), d.status || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.transferDate || "", d.fromLocation || "", d.toLocation || "", d.transferredBy || "", d.receivedBy || ""];
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
      const header = ["Date", "Employee Name", "Employee ID", "Site ID", "Site Name", "Hours Worked", "Work Description", "Status", "Submitted At", "Photo URLs"];
      const rows   = snap.docs.map((doc) => {
        const d   = doc.data();
        const uid = uidOf(doc);
        return [d.date || "", userNameMap.get(uid) ?? d.userName ?? "", userEmpIdMap.get(uid) ?? d.employeeId ?? "", d.siteId || "", d.siteName || "", d.hoursWorked || "", d.workDescription || "", d.status || "", ts(d.submittedAt), Array.isArray(d.photoUrls) ? d.photoUrls.join("\n") : ""];
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
        "Covy Due (approx avg)", "Imprest Due MTD", "OT/WO amount (₹)",
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

        // PF / ESI / Imprest are percentages of Salary Due MTD (payrollDeductions.js).
        // PF and ESI are DEDUCTED from TOTAL DUE; Imprest is added. `efficiency` is not
        // passed — the matrix doesn't exist yet, so it defaults to 1. Do NOT pass 0.
        const { pf, esi, imprest, totalDue } = computeDeductions({
          salaryDue, covy, settlement,
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

// ── Monthly Regularization Reminder — 25th of each month, 10 AM IST ─────────
exports.regularizationReminder = onSchedule(
  { schedule: "0 10 25 * *", timeZone: "Asia/Kolkata", timeoutSeconds: 120 },
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

    const notifBatch = db.batch();
    adminsSnap.docs.forEach((adminDoc) => {
      const notifRef = db.collection("users").doc(adminDoc.id)
        .collection("notifications").doc();
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
  { schedule: "30 22 * * *", timeZone: "Asia/Kolkata", timeoutSeconds: 300, memory: "512MiB" },
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

    // Locked months (company-wide freeze signal): any settlement doc with locked == true.
    // Fetched + client-filtered (like getSettlementsForMonth) to avoid a collection-group
    // index; the set stays small (one doc per ops employee per settled month). Settlement
    // doc id === "YYYY-MM".
    const settleSnap = await db.collectionGroup("settlements").get();
    const lockedSet = new Set(
      settleSnap.docs.filter((d) => d.data().locked === true).map((d) => d.id),
    );

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
      if (probe.empty) continue; // already finalized on a previous run (or no rows at all)
      const monthSnap = await db.collection("dailySpend").where("month", "==", M).get();
      let fBatch = db.batch();
      let fOps = 0;
      for (const doc of monthSnap.docs) {
        fBatch.update(doc.ref, { frozen: true }); // relabel only — values untouched
        fOps++;
        if (fOps >= 400) { await fBatch.commit(); fBatch = db.batch(); fOps = 0; }
      }
      if (fOps > 0) await fBatch.commit();
      console.log(`dailySpend: finalized (frozen:true) ${monthSnap.size} rows for ${M}`);
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

    const monthOf = (dateStr) => dateStr.slice(0, 7);
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
      // status doc), and conveyance days (can be Sundays). Iterating only statuses skipped
      // those, breaking the Σ dailySpend == settlementCash / conveyance reconciliation.
      const userStatuses = statusesByUser.get(user.id) || [];
      const statusByDate = new Map(userStatuses.map((s) => [s.date, s]));
      const candidateDates = new Set(userStatuses.map((s) => s.date));
      for (const d of otMap.keys()) candidateDates.add(d);
      for (const d of (convDatesByUser.get(user.id) || [])) candidateDates.add(d);

      for (const date of candidateDates) {
        if (!windowMonths.includes(monthOf(date))) continue; // locked/out-of-window → never written

        const status = statusByDate.get(date); // may be undefined (OT/conveyance-only day)
        const sunday = isSunday(date);
        // Sundays are not paid working days — matches the MTD summary, which skips only
        // Sundays for salary (NOT holidays); an OT/conveyance-only day has no status → 0.
        const salary = (status && !sunday) ? dailySalary(rate, status.status) : 0;
        const conveyance = usesConveyance(user.role) ? (convByKey.get(`${user.id}__${date}`) || 0) : 0;
        const otWo = round2(otMap.get(date) || 0);
        const { pf, esi, imprest } = dailyDeductions({
          salary, pfPercent: user.pfPercent, esiPercent: user.esiPercent, imprestPercent: user.imprestPercent,
        });
        const totalSpend = dailyTotal({ salary, conveyance, imprest, otWo, pf, esi });

        // Emit if the day carries any economic value OR is a tracked non-Sunday attendance
        // day; drops empty unworked-WO-Sundays and no-activity days.
        const hasValue = salary !== 0 || conveyance !== 0 || otWo !== 0;
        if (!hasValue && !(status && !sunday)) continue;

        const id = `${user.id}__${date}`;
        batch.set(db.collection("dailySpend").doc(id), {
          userId: user.id, employeeId: user.employeeId || "", name: user.name || "", role: user.role || "",
          date, month: monthOf(date),
          salary, conveyance, pf, esi, otWo, imprest, totalSpend,
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

// ── Admin password reset (Admin SDK) ──────────────────────────────────────────
// Synthetic-email logins can't receive reset links, so the admin sets a new password
// directly and reads it back to hand over to the employee.
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
