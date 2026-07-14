// Employee category codes — multi-select, assigned by admins to operations-role
// staff on the Users page and stored on users/{uid}.categories (string[]).
// This is the single source of truth for the valid set; the (future) category
// report reads the same list. Order here is the display order in the UI.
export const EMPLOYEE_CATEGORIES = [
  'A1', 'A2', 'E1', 'E2', 'E3', 'M1', 'M2', 'M3', 'HHE', 'H', 'W',
] as const;

export type EmployeeCategory = typeof EMPLOYEE_CATEGORIES[number];

// Set for O(1) validation when filtering out unknown/legacy codes on read.
export const EMPLOYEE_CATEGORY_SET: ReadonlySet<string> = new Set(EMPLOYEE_CATEGORIES);

// Work-done trade categories — multi-select, admin-assigned per site attendance
// event on the Manpower Utilisation Input page and stored on the attendance doc as
// workDoneCategories (string[]). 'NA' is exclusive (see the Manpower Utilisation Input page).
export const WORK_DONE_CATEGORIES = [
  'Helper', 'Mech', 'Elec', 'Civil', 'Welder', 'NA',
] as const;

export type WorkDoneCategory = typeof WORK_DONE_CATEGORIES[number];

export const WORK_DONE_CATEGORY_SET: ReadonlySet<string> = new Set(WORK_DONE_CATEGORIES);
export const WORK_DONE_NA = 'NA';
