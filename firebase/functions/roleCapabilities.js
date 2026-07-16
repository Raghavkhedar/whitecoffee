"use strict";

/**
 * Single source of truth for the axes on which user roles differ (spec:
 * docs/superpowers/specs/2026-07-16-sales-role-design.md). Firestore-free so it
 * can be unit-tested with node --test.
 *
 * ⚠️ MIRRORED on the other two sides — keep these tables in lockstep or a role
 * silently behaves differently in one product than another:
 *   - admin/src/lib/roleCapabilities.ts   (+ roleCapabilities.test.ts)
 *   - android …/data/model/RoleCapabilities.kt
 *
 * Most role decisions in the codebase were historically written as a binary
 * `isOps = role === "operations" ? (site) : (office)`. `sales` is a deliberate
 * MIX of the two (hybrid check-ins + conveyance, but office-style fixed-window
 * status and NO OT/shortage/manpower), so it cannot ride either branch. Route
 * decision points through these predicates instead of hand-patching each branch.
 *
 * Axes (see the design table):
 *   attendanceInTypes / attendanceOutTypes — event types that open/close a worked day
 *   usesFixedWindow      — status scored against the fixed 10:00–18:00 office window
 *                          (false ⇒ operations' per-day planned shift)
 *   usesOtShortageLedger — OT/shortage machinery: daily_hours, ot_approvals, the
 *                          OT Exception report
 *   tracksShortage       — has a shortage/OT concept AT ALL. Distinct from the ledger:
 *                          office/admin run no ledger yet still show shortage on the
 *                          portal's Working Hours page (measured live vs the fixed
 *                          window). Sales is the one fixed-window role scored for
 *                          STATUS ONLY, so it is the only non-tracking role.
 *   usesConveyance       — earns conveyance from GPS travel
 *   getsCategories       — admin-assigned labor-code categories
 *   inManpowerReports    — appears in the Site Manpower Utilisation report
 *
 * Unknown roles fall back to `office` — the safe, most-restrictive default (fixed
 * window, office-only check-ins, no conveyance/OT/manpower).
 */

const CAPS = {
  office: {
    attendanceInTypes:  ["office_in"],
    attendanceOutTypes: ["office_out"],
    usesFixedWindow:      true,
    usesOtShortageLedger: false,
    tracksShortage:       true,
    usesConveyance:       false,
    getsCategories:       false,
    inManpowerReports:    false,
  },
  operations: {
    attendanceInTypes:  ["site_in", "market_in"],
    attendanceOutTypes: ["site_out", "market_out"],
    usesFixedWindow:      false,
    usesOtShortageLedger: true,
    tracksShortage:       true,
    usesConveyance:       true,
    getsCategories:       true,
    inManpowerReports:    true,
  },
  sales: {
    attendanceInTypes:  ["office_in", "site_in", "market_in"],
    attendanceOutTypes: ["office_out", "site_out", "market_out"],
    usesFixedWindow:      true,
    usesOtShortageLedger: false,
    tracksShortage:       false,
    usesConveyance:       true,
    getsCategories:       false,
    inManpowerReports:    false,
  },
  admin: {
    attendanceInTypes:  ["office_in"],
    attendanceOutTypes: ["office_out"],
    usesFixedWindow:      true,
    usesOtShortageLedger: false,
    tracksShortage:       true,
    usesConveyance:       false,
    getsCategories:       false,
    inManpowerReports:    false,
  },
};

function capsFor(role) {
  return CAPS[role] || CAPS.office;
}

// Event types that OPEN a worked day for this role (copy — callers must not mutate).
function attendanceInTypes(role) {
  return capsFor(role).attendanceInTypes.slice();
}
// Event types that CLOSE a worked day for this role (copy — callers must not mutate).
function attendanceOutTypes(role) {
  return capsFor(role).attendanceOutTypes.slice();
}
// Status scored against the fixed 10:00–18:00 office window (false ⇒ ops planned shift).
function usesFixedWindow(role) {
  return capsFor(role).usesFixedWindow;
}
// Runs the OT/shortage ledger (daily_hours, ot_approvals, OT Exception report).
function usesOtShortageLedger(role) {
  return capsFor(role).usesOtShortageLedger;
}
// Has a shortage/OT concept at all (office/admin track it without a ledger; sales never).
function tracksShortage(role) {
  return capsFor(role).tracksShortage;
}
// Earns conveyance from GPS travel.
function usesConveyance(role) {
  return capsFor(role).usesConveyance;
}
// Gets admin-assigned labor-code categories.
function getsCategories(role) {
  return capsFor(role).getsCategories;
}
// Appears in the Site Manpower Utilisation report.
function inManpowerReports(role) {
  return capsFor(role).inManpowerReports;
}

// Known roles for which a boolean capability is true — handy for Firestore
// `where("role", "in", …)` queries (e.g. the conveyance rollup).
function rolesWith(capability) {
  return Object.keys(CAPS).filter((r) => CAPS[r][capability] === true);
}

module.exports = {
  attendanceInTypes,
  attendanceOutTypes,
  usesFixedWindow,
  usesOtShortageLedger,
  tracksShortage,
  usesConveyance,
  getsCategories,
  inManpowerReports,
  rolesWith,
};
