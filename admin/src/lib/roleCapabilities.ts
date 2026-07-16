// Role capabilities — the single source of truth for the axes on which the four
// account roles differ. Nearly every role decision in the portal used to be a
// binary `isOps = role === 'operations' ? … : …`; the `sales` role is a deliberate
// *mix* of office and operations, so those binaries are rerouted through the
// predicates here. office/operations/admin values encode today's behavior exactly
// (behavior-preserving); `sales` is defined by its own column.
//
// This module is mirrored on the other sides of the monorepo (firebase functions,
// Android) — there is no shared JS build graph — and unit-tested on each side.
// Keep the table in sync across all three.

export type Role = 'admin' | 'office' | 'operations' | 'sales';

export type AttendanceInType = 'office_in' | 'site_in' | 'market_in';
export type AttendanceOutType = 'office_out' | 'site_out' | 'market_out';

interface RoleCapabilities {
  attendanceInTypes: AttendanceInType[];
  attendanceOutTypes: AttendanceOutType[];
  usesFixedWindow: boolean;      // status scored against the fixed 10:00–18:00 window
  usesOtShortageLedger: boolean; // OT/shortage ledger (daily_hours, ot_approvals, settlements)
  tracksShortage: boolean;       // has a shortage/OT concept at all (see below)
  usesConveyance: boolean;       // conveyance/commute allowance
  getsCategories: boolean;       // operations labor-code categories
  inManpowerReports: boolean;    // Manpower Utilisation Input + Site Manpower report
}

// `tracksShortage` is deliberately separate from `usesOtShortageLedger`: office/admin have
// no ledger (no daily_hours/ot_approvals/settlements) yet still show shortage on the Working
// Hours page, measured live against the fixed window. Sales is the one role with a fixed
// window that is scored for STATUS ONLY — it has no shortage/OT concept anywhere.

const CAPABILITIES: Record<Role, RoleCapabilities> = {
  office: {
    attendanceInTypes: ['office_in'],
    attendanceOutTypes: ['office_out'],
    usesFixedWindow: true,
    usesOtShortageLedger: false,
    tracksShortage: true,
    usesConveyance: false,
    getsCategories: false,
    inManpowerReports: false,
  },
  operations: {
    attendanceInTypes: ['site_in', 'market_in'],
    attendanceOutTypes: ['site_out', 'market_out'],
    usesFixedWindow: false,
    usesOtShortageLedger: true,
    tracksShortage: true,
    usesConveyance: true,
    getsCategories: true,
    inManpowerReports: true,
  },
  sales: {
    attendanceInTypes: ['office_in', 'site_in', 'market_in'],
    attendanceOutTypes: ['office_out', 'site_out', 'market_out'],
    usesFixedWindow: true,
    usesOtShortageLedger: false,
    tracksShortage: false,
    usesConveyance: true,
    getsCategories: false,
    inManpowerReports: false,
  },
  admin: {
    attendanceInTypes: ['office_in'],
    attendanceOutTypes: ['office_out'],
    usesFixedWindow: true,
    usesOtShortageLedger: false,
    tracksShortage: true,
    usesConveyance: false,
    getsCategories: false,
    inManpowerReports: false,
  },
};

// Unknown/legacy role strings fall back to office behavior (the conservative default,
// matching the old `RoleBadge`/`isOps ? … : office` handling).
function capsOf(role: string): RoleCapabilities {
  return CAPABILITIES[role as Role] ?? CAPABILITIES.office;
}

export function attendanceInTypes(role: string): AttendanceInType[] {
  return capsOf(role).attendanceInTypes;
}

export function attendanceOutTypes(role: string): AttendanceOutType[] {
  return capsOf(role).attendanceOutTypes;
}

export function usesFixedWindow(role: string): boolean {
  return capsOf(role).usesFixedWindow;
}

export function usesOtShortageLedger(role: string): boolean {
  return capsOf(role).usesOtShortageLedger;
}

export function tracksShortage(role: string): boolean {
  return capsOf(role).tracksShortage;
}

export function usesConveyance(role: string): boolean {
  return capsOf(role).usesConveyance;
}

export function getsCategories(role: string): boolean {
  return capsOf(role).getsCategories;
}

export function inManpowerReports(role: string): boolean {
  return capsOf(role).inManpowerReports;
}
