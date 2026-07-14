// Single source of truth for admin-portal tabs and per-user access.
//
// The Sidebar renders from TABS (no duplicate nav list), the layout gates entry and
// guards hand-typed URLs, and the /access matrix (plus the /users modal) grant tabs.
// All the access logic below is pure so it can be unit-tested (portalAccess.test.ts).
//
// Access model: role==='admin' → superuser (every tab, including admin-only ones).
// Otherwise a user may access exactly the tab PATHS listed in their `tabAccess` array
// that are real, non-admin-only tabs (stray/unknown/admin-only entries are ignored).
// No tabAccess → no portal access. Firestore rules read the same `tabAccess` field
// (see firebase/firestore.rules).
import type { IconName } from '@/components/Icon';
import type { User } from '@/types';

export interface TabDef {
  path: string;
  label: string;
  icon: IconName;
  group?: string;        // sidebar section header; undefined = top (Dashboard)
  badgeKey?: 'pending';  // shows the pending-leaves count badge
  adminOnly?: boolean;   // only admins ever see it; never a grantable matrix column
}

// Every portal tab, in sidebar order. This is the ONLY place the nav list lives.
// adminOnly tabs (/dashboard, /users, /access) are excluded from matrix columns and
// never granted to non-admins.
export const TABS: TabDef[] = [
  { path: '/dashboard',          label: 'Dashboard',      icon: 'grid',                          adminOnly: true },
  { path: '/users',              label: 'Employees',      icon: 'users',      group: 'People',    adminOnly: true },
  { path: '/access',             label: 'Access Control', icon: 'list',       group: 'People',    adminOnly: true },
  { path: '/working-hours-shortage-excess', label: 'Working Hours-Shortage/Excess',  icon: 'userCircle', group: 'People' },
  { path: '/leaves',             label: 'Leave Requests', icon: 'leave',      group: 'People', badgeKey: 'pending' },
  { path: '/regularization',     label: 'Regularization', icon: 'clock',      group: 'People' },
  { path: '/attendance',         label: 'Attendance',     icon: 'calendar',   group: 'Time & Sites' },
  { path: '/ot-shortage',        label: 'OT & Shortage',  icon: 'clock',      group: 'Time & Sites' },
  { path: '/ot-settlements',     label: 'OT Settlements', icon: 'doc',        group: 'Time & Sites' },
  { path: '/manpower-utilisation-input', label: 'Manpower Utilisation Input', icon: 'pin', group: 'Time & Sites' },
  { path: '/submissions',        label: 'Submissions',    icon: 'doc',        group: 'Records' },
  { path: '/conveyance',         label: 'Conveyance',     icon: 'car',        group: 'Records' },
  { path: '/notifications',      label: 'Notifications',  icon: 'bell',       group: 'Records' },
];

// Set of tab paths a non-admin can be granted (everything not adminOnly).
const GRANTABLE_PATHS = new Set(TABS.filter((t) => !t.adminOnly).map((t) => t.path));

type AccessUser = Pick<User, 'role' | 'tabAccess'>;

export function isAdminUser(user: AccessUser | null | undefined): boolean {
  return user?.role === 'admin';
}

// Tab paths this user may access. Admin → every tab (including admin-only); otherwise
// their tabAccess entries intersected with the grantable tabs, returned in TABS order.
// Stray admin-only or unknown paths are ignored (defensive). No tabAccess → [].
export function allowedPaths(user: AccessUser | null | undefined): string[] {
  if (isAdminUser(user)) return TABS.map((t) => t.path);
  const granted = new Set((user?.tabAccess ?? []).filter((p) => GRANTABLE_PATHS.has(p)));
  return TABS.map((t) => t.path).filter((p) => granted.has(p));
}

// May this user enter the portal at all?
export function hasPortalAccess(user: AccessUser | null | undefined): boolean {
  return isAdminUser(user) || allowedPaths(user).length > 0;
}

// Is a given pathname allowed? Handles nested routes (e.g. /attendance/2026-01).
export function canAccess(user: AccessUser | null | undefined, pathname: string): boolean {
  return allowedPaths(user).some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Where to send the user by default, and when they hit a disallowed page. Always an
// allowed path (or /login if none), so redirect guards can't loop.
export function landingPath(user: AccessUser | null | undefined): string {
  return allowedPaths(user)[0] ?? '/login';
}
