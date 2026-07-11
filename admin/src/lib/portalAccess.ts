// Single source of truth for admin-portal tabs and tag-based access.
//
// The Sidebar renders from TABS (no duplicate nav list), the layout gates entry and
// guards hand-typed URLs, and the /users page assigns tags from TAG_LABELS. All the
// access logic below is pure so it can be unit-tested (portalAccess.test.ts).
//
// Access model: role==='admin' → superuser (every tab). Otherwise a user sees the
// UNION of the tabs granted by their recognized tags. Untagged non-admin → no access.
// Firestore rules read the same `tags` field (see firebase/firestore.rules).
import type { IconName } from '@/components/Icon';
import type { User } from '@/types';

export interface TabDef {
  path: string;
  label: string;
  icon: IconName;
  group?: string;        // sidebar section header; undefined = top (Dashboard)
  badgeKey?: 'pending';  // shows the pending-leaves count badge
}

// Every portal tab, in sidebar order. This is the ONLY place the nav list lives.
export const TABS: TabDef[] = [
  { path: '/dashboard',          label: 'Dashboard',      icon: 'grid' },
  { path: '/users',              label: 'Employees',      icon: 'users',      group: 'People' },
  { path: '/employee-dashboard', label: 'Emp Dashboard',  icon: 'userCircle', group: 'People' },
  { path: '/leaves',             label: 'Leave Requests', icon: 'leave',      group: 'People', badgeKey: 'pending' },
  { path: '/regularization',     label: 'Regularization', icon: 'clock',      group: 'People' },
  { path: '/attendance',         label: 'Attendance',     icon: 'calendar',   group: 'Time & Sites' },
  { path: '/ot-shortage',        label: 'OT & Shortage',  icon: 'clock',      group: 'Time & Sites' },
  { path: '/settlements',        label: 'Settlements',    icon: 'doc',        group: 'Time & Sites' },
  { path: '/site-ids',           label: 'Site IDs',       icon: 'pin',        group: 'Time & Sites' },
  { path: '/submissions',        label: 'Submissions',    icon: 'doc',        group: 'Records' },
  { path: '/conveyance',         label: 'Conveyance',     icon: 'car',        group: 'Records' },
  { path: '/notifications',      label: 'Notifications',  icon: 'bell',       group: 'Records' },
];

// Preset tag → allowed tab paths. Adding a new preset = one entry here (+ a label).
export const TAG_TABS: Record<string, string[]> = {
  'attendance-manager': ['/employee-dashboard', '/attendance', '/ot-shortage', '/settlements', '/site-ids'],
};

// Human-readable names for the /users assignment UI.
export const TAG_LABELS: Record<string, string> = {
  'attendance-manager': 'Attendance Manager',
};

export const ALL_TAGS: string[] = Object.keys(TAG_TABS);

type AccessUser = Pick<User, 'role' | 'tags'>;

export function isAdminUser(user: AccessUser | null | undefined): boolean {
  return user?.role === 'admin';
}

// Tags the user actually holds that map to a known preset (ignores unknown/removed ones).
export function recognizedTags(user: AccessUser | null | undefined): string[] {
  return (user?.tags ?? []).filter((t) => t in TAG_TABS);
}

// Tab paths this user may access. Admin → every tab; otherwise the union of their
// recognized tags' tabs, returned in TABS order. Untagged non-admin → [].
export function allowedPaths(user: AccessUser | null | undefined): string[] {
  if (isAdminUser(user)) return TABS.map((t) => t.path);
  const granted = new Set<string>();
  for (const tag of recognizedTags(user)) {
    for (const p of TAG_TABS[tag]) granted.add(p);
  }
  return TABS.map((t) => t.path).filter((p) => granted.has(p));
}

// May this user enter the portal at all?
export function hasPortalAccess(user: AccessUser | null | undefined): boolean {
  return isAdminUser(user) || recognizedTags(user).length > 0;
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
