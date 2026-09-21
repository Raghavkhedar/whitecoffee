"use strict";

/**
 * Pure per-user scoring for computeDailyAttendanceStatus (index.js). Extracted VERBATIM from
 * the nightly loop body so it can be unit-tested and, later, called from a per-user
 * transaction as well as from the fast batch (spec:
 * docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-design.md §3.1, §4.1).
 *
 * No Firestore, no firebase-admin, no wall clock: every input is an argument, and the one
 * timestamp the status doc carries (`updatedAt`) is produced by a `now` factory the caller
 * passes in. The caller keeps everything with a side effect — the priorStatus/PL-decrement
 * decision (`shouldDecrementPlBalance`), the batch/transaction writes, the failure list.
 *
 * ZERO BEHAVIOUR CHANGE is the contract of this file. nightlyScoring.test.js pins today's
 * behaviour case by case; the arithmetic below is a straight move of the old loop body.
 *
 * ── scoreUserDay({ role, events, plan, leave, plBalance }) ──
 *   role       `user.role`, raw (unknown/undefined falls back to office via roleCapabilities).
 *   events     the user's attendance docs for the day, in ANY order (the raw
 *              `eventsByUser.get(id) || []`). Each needs `type` and `timestamp`
 *              (a Firestore Timestamp: `.seconds` and `.toDate()`). Not mutated — sorted on a copy.
 *   plan       `{ startTime, endTime }` ("HH:MM") from planned_hours/{today}, or undefined.
 *              Only consulted for planned-shift roles (operations); ignored for fixed-window roles.
 *   leave      the approved leave covering today, or undefined. ONLY its truthiness matters, and
 *              the caller has already resolved coverage (`leaveCoversDate`) — a leave that does not
 *              cover today must be passed as undefined.
 *   plBalance  `user.plBalance`, RAW. The `|| 0` (null/undefined/NaN/0 → 0) is applied here,
 *              exactly as the loop did, then `resolveLeaveStatus` does its own Number() coercion.
 *   →  { status, salaryCredit?, dailyHours? }
 *        salaryCredit  key present ONLY for SCHL (1 paid / 0 unpaid); absent otherwise.
 *        dailyHours    key present ONLY when the role runs the OT/shortage ledger AND the day has
 *                      both a check-in and a check-out. Just the four computed numbers
 *                      `{ plannedMins, actualMins, shortageMins, otMins }`; the caller wraps them
 *                      with `date`, `userId`, `role` and `updatedAt` (see index.js) so field order
 *                      and the Timestamp stay exactly what they were.
 *
 * ── buildStatusDoc({ user, today, status, salaryCredit, now }) ──
 *   The EXACT users/{uid}/attendance_status/{today} document the main scoring branch writes.
 *   `now` is a factory (`() => Timestamp.now()`), called exactly once for `updatedAt`. This is
 *   NOT serverTimestamp(): the rest-day branch in index.js uses serverTimestamp() and stays as is.
 *   `salaryCredit` is spread in only when defined, so the key is absent — never undefined/null —
 *   for every non-SCHL day (a full `set` therefore also clears a stale credit on a re-run).
 *
 * ── partitionUsers(scored) ──
 *   Splits scored items (anything with a `.status`) into `fast` (batch) and `txn` (per-user
 *   transaction): Absent and SCHL → txn, everything else → fast. Order preserved, items passed
 *   through untouched. Not wired to a transaction yet.
 */

const {
  OFFICE_START_MIN,
  OFFICE_END_MIN,
  classify,
  resolveOpsWindow,
  resolveLeaveStatus,
} = require("./attendanceRules");
const {
  attendanceInTypes,
  attendanceOutTypes,
  usesFixedWindow,
  usesOtShortageLedger,
} = require("./roleCapabilities");

// Byte-identical copies of getHourIST / getMinuteIST in index.js (which still uses them for the
// Sheets export). Copied rather than imported: index.js pulls in firebase-admin, and this module
// must stay pure. A missing timestamp reads as hour -1 / minute 0, as it always has.
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

function scoreUserDay({ role, events, plan, leave, plBalance }) {
  const sorted = [...(events || [])].sort(
    (a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0)
  );

  const fixedWindow = usesFixedWindow(role); // office/admin/sales: fixed 10–18; operations: planned shift

  // First check-in / last check-out across this role's event types. Operations:
  // site + market. Office/admin: office. Sales (hybrid): office + site + market —
  // scored against the same fixed window as office.
  const inTypes  = attendanceInTypes(role);
  const outTypes = attendanceOutTypes(role);
  const checkIns  = sorted.filter((e) => inTypes.includes(e.type));
  const checkOuts = sorted.filter((e) => outTypes.includes(e.type));

  // Every active user is scored on every working day, all roles alike. Sundays and
  // holidays never reach the scoring loop (both return earlier), offboarded users are filtered
  // out, and admin-marked days (WO / regularization) are skipped. So an ops day with no plan,
  // no leave and no punches is a no-show and scores Absent — days off must be marked WO or leave.

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
  let salaryCredit; // only set for SCHL

  if (checkIns.length > 0 && checkOuts.length > 0) {
    const firstIn  = checkIns[0];
    const lastOut  = checkOuts[checkOuts.length - 1];
    const inMinutes  = getHourIST(firstIn.timestamp) * 60 + getMinuteIST(firstIn.timestamp);
    const outMinutes = getHourIST(lastOut.timestamp) * 60 + getMinuteIST(lastOut.timestamp);

    // The off-minutes formula lives in attendanceRules.classify, not inline here.
    status = classify(inMinutes, outMinutes, startMin, endMin);
  } else if (checkIns.length > 0 || checkOuts.length > 0) {
    status = "LNF";
  } else {
    if (leave) {
      const balance = plBalance || 0;
      const resolved = resolveLeaveStatus(balance);
      status = resolved.status;
      salaryCredit = resolved.salaryCredit;
    } else {
      status = "Absent";
    }
  }

  const result = { status };
  if (salaryCredit !== undefined) result.salaryCredit = salaryCredit;

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
    result.dailyHours = { plannedMins, actualMins, shortageMins, otMins };
  }

  return result;
}

function buildStatusDoc({ user, today, status, salaryCredit, now }) {
  return {
    date: today, userId: user.id, userName: user.name || "",
    employeeId: user.employeeId || "", role: user.role, status,
    ...(salaryCredit !== undefined ? { salaryCredit } : {}),
    markedBy: "auto", updatedAt: now(),
  };
}

// Statuses whose write depends on state outside the punches (a leave lookup and the plBalance),
// so they need a per-user transaction; every other status is decided by punches alone.
const TXN_STATUSES = new Set(["Absent", "SCHL"]);

function partitionUsers(scored) {
  const fast = [];
  const txn = [];
  for (const item of scored) {
    (TXN_STATUSES.has(item.status) ? txn : fast).push(item);
  }
  return { fast, txn };
}

module.exports = { scoreUserDay, buildStatusDoc, partitionUsers };
