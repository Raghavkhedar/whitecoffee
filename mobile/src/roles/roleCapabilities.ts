// Role capabilities — the single source of truth for the axes on which the four
// account roles differ. Nearly every role decision in the portal used to be a
// binary `isOps = role === 'operations' ? … : …`; the `sales` role is a deliberate
// *mix* of office and operations, so those binaries are rerouted through the
// predicates here. office/operations/admin values encode today's behavior exactly
// (behavior-preserving); `sales` is defined by its own column.
//
// This module is mirrored on the other sides of the monorepo (admin portal, firebase functions,
// Android) — there is no shared JS build graph — and unit-tested on each side.
// Keep the table in sync across all FOUR copies (admin, functions, Android, this one).

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
// Unknown/legacy role strings fall back to office behavior for the READ-SIDE predicates below,
// matching the other mirrors. Attendance ROUTING does not — see attendanceRouteFor.
function capsOf(role: string): RoleCapabilities {
  return CAPABILITIES[role as Role] ?? CAPABILITIES.office;
}

export function isKnownRole(role: string): role is Role {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, role);
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

export type AttendanceRoute = 'Attendance' | 'OperationsAttendance' | 'SalesAttendance';

// Which attendance screen a role gets, derived from its check-in types rather than from role
// names — so no `role === 'operations' ? site : office` binary can drop sales into the office
// branch. MOBILE-ONLY DIFFERENCE: an unknown role gets NO attendance screen (fails closed)
// instead of the office fallback, because this decides what gets WRITTEN, and office-shaped
// punches from a role that isn't office are invisible to that role's payroll scoring.
export function attendanceRouteFor(role: string): AttendanceRoute | undefined {
  if (!isKnownRole(role)) return undefined;
  const inTypes: string[] = CAPABILITIES[role].attendanceInTypes;
  const office = inTypes.includes('office_in');
  const field = inTypes.includes('site_in');
  if (office && field) return 'SalesAttendance';
  if (field) return 'OperationsAttendance';
  if (office) return 'Attendance';
  return undefined;
}
