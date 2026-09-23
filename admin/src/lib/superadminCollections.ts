// Static registry of every collection this app's firestore.rules recognize, for the
// /superadmin editor's collection picker (docs/superpowers/specs/
// 2026-09-22-superadmin-portal-editor-design.md). Enumerated directly from
// firebase/firestore.rules, not from prose docs — keep in sync if the schema changes.
//
// audit_log is intentionally EXCLUDED from TOP_LEVEL_COLLECTIONS: firestore.rules blocks
// writes to it even for a superadmin, and it already has its own dedicated /audit page.

export interface TopLevelCollection {
  path: string;
  label: string;
}

export const TOP_LEVEL_COLLECTIONS: TopLevelCollection[] = [
  { path: 'users', label: 'Users' },
  { path: 'sites', label: 'Sites' },
  { path: 'holidays', label: 'Holidays' },
  { path: 'config', label: 'Config' },
  { path: 'conveyance', label: 'Conveyance' },
  { path: 'sent_notifications', label: 'Sent Notifications' },
  { path: 'submission_edits', label: 'Submission Edits' },
  { path: 'dailySpend', label: 'Daily Spend' },
  { path: 'system', label: 'System' },
];

export interface UserSubcollection {
  name: string;
  label: string;
}

// Every subcollection nested under users/{uid} that firestore.rules defines. Selecting
// one of these requires an employee to be chosen first — the page builds the full path
// as `users/${uid}/${name}`. wo_ledger additionally has its own nested settlements
// subcollection (users/{uid}/wo_ledger/{date}/settlements) — reached from an open
// wo_ledger document via the page's generic "browse a subcollection of this document"
// control, not listed separately here.
export const USER_SUBCOLLECTIONS: UserSubcollection[] = [
  { name: 'attendance', label: 'Attendance' },
  { name: 'attendance_status', label: 'Attendance Status' },
  { name: 'attendance_corrections', label: 'Attendance Corrections' },
  { name: 'compensation', label: 'Compensation' },
  { name: 'leave_requests', label: 'Leave Requests' },
  { name: 'regularization_requests', label: 'Regularization Requests' },
  { name: 'planned_hours', label: 'Planned Hours' },
  { name: 'daily_hours', label: 'Daily Hours' },
  { name: 'ot_approvals', label: 'OT Approvals' },
  { name: 'wo_ledger', label: 'WO Ledger' },
  { name: 'settlements', label: 'Settlements' },
  { name: 'specialAllowance', label: 'Special Allowance' },
  { name: 'material_requests', label: 'Material Requests' },
  { name: 'material_purchases', label: 'Material Purchases' },
  { name: 'material_transfers', label: 'Material Transfers' },
  { name: 'tool_transfers', label: 'Tool Transfers' },
  { name: 'work_progress', label: 'Work Progress' },
  { name: 'notifications', label: 'Notifications' },
];
