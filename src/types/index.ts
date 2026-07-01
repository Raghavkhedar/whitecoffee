import { Timestamp } from 'firebase/firestore';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'operations' | 'office' | 'admin';
  employeeId: string;
  salaryRate?: number;
  plBalance?: number;
  woBalance?: number;
  /** @deprecated Retired in the OT redesign (step 7). OT/shortage now net per-month in the
   *  ledger (otLedger/otAggregate) and settle via users/{uid}/settlements/{month}; these
   *  lifetime counters are no longer written or read. Kept only so historical docs still type. */
  approvedOtMins?: number;
  /** @deprecated See approvedOtMins — retired in step 7. */
  shortageMins?: number;
  homeLat?: number;
  homeLng?: number;
  conveyanceRateType?: 1 | 2;
  createdAt?: Timestamp;
}

// Per-day overtime approval (admin grants an adjusted amount of the detected OT).
// Stored at users/{uid}/ot_approvals/{date}.
export interface OtApproval {
  id: string;            // = date (YYYY-MM-DD)
  date: string;
  userId: string;
  userName: string;
  employeeId: string;
  role: string;
  requestedMins: number; // OT minutes the system detected for that day
  approvedMins: number;  // minutes the admin actually granted (0 when rejected)
  status?: 'approved' | 'rejected'; // decision outcome (older docs without this are 'approved')
  manual?: boolean;      // admin-entered OT for a day with no auto-detected surplus (e.g. missed-punch anomaly)
  reason: string;
  approvedBy: string;
  approvedAt?: Timestamp;
}

export interface AttendanceStatus {
  id: string;
  date: string;
  userId: string;
  userName: string;
  employeeId: string;
  role: string;
  status: 'Present' | 'HalfDay' | 'SL' | 'SLNF' | 'Absent' | 'PL' | 'LWP' | 'WO';
  markedBy: 'auto' | 'admin';
  // Effective worked window captured when an admin regularizes a day to Present (missed-punch
  // fix). When present on a Present day, the OT/shortage ledger uses these instead of raw
  // events so the corrected day can carry shortage/OT. "HH:MM" 24h, ops only.
  inTime?: string;
  outTime?: string;
  updatedAt?: Timestamp;
}

// SITE MANAGEMENT — NOT IN USE (no geofencing, no daily assignments).
// Re-enable by uncommenting this interface and the site functions in firestore.ts,
// sites/page.tsx, and the Sidebar.tsx nav entry.
//
// export interface Site {
//   id: string;
//   name: string;
//   latitude: number;
//   longitude: number;
//   geofenceRadius: number;
// }

// DAILY ASSIGNMENT SYSTEM — NOT IN USE.
// Re-enable by uncommenting these interfaces and the matching code in firestore.ts,
// Sidebar.tsx, and daily-assignments/page.tsx.
//
// export interface SiteAssignmentItem {
//   siteId: string;
//   siteName: string;
//   workDescription: string;
//   toolsRequired: string;
// }
//
// export interface DailyAssignment {
//   id: string;          // "{date}_{userId}"
//   date: string;        // "yyyy-MM-dd"
//   userId: string;
//   userName: string;
//   sites: SiteAssignmentItem[];
//   assignedAt?: Timestamp;
// }

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string;
  approverComment: string;
  submittedAt?: Timestamp;
  reviewedAt?: Timestamp;
}

export interface RegularizationRequest {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  date: string;
  originalStatus: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy: string;
  approverComment: string;
  approvedStatus?: string;
  submittedAt?: Timestamp;
  reviewedAt?: Timestamp;
}

export interface PlannedHours {
  id: string;
  userId: string;
  date: string;       // "yyyy-MM-dd"
  startTime: string;  // "HH:MM" 24h
  endTime: string;    // "HH:MM" 24h
  declaredOtMins?: number; // admin pre-declared overtime for the day (minutes); worked OT up to this is auto-approved
  otAuthorized?: boolean;  // Sunday/holiday only: admin authorized this person's rest-day work → all worked minutes count as auto-approved OT
  updatedAt?: Timestamp;
}

// Frozen monthly OT/shortage/WO settlement for one ops employee. Doc id = month "YYYY-MM",
// stored at users/{uid}/settlements/{month}. Written when admin "Settle & Locks" the month;
// the Cloud Function reads locked settlements and adds settlementCash to payroll TOTAL DUE.
export interface Settlement {
  id: string;            // = month "YYYY-MM"
  month: string;         // "YYYY-MM"
  userId: string;
  userName: string;
  employeeId: string;
  role: string;
  autoOtMins: number;    // pre-declared OT worked (auto-approved)
  restDayOtMins: number; // authorized Sunday/holiday OT
  grantedOtMins: number; // admin-granted OT (beyond-declared)
  shortageMins: number;
  woDays: number;        // count of WO days that month
  woDebitMins: number;   // woDays × 480
  netMins: number;       // (auto + restDay + granted) − shortage − woDebit
  salaryRate: number;    // per-day rate at settlement time
  settlementCash: number;// woDays×rate + netMins/480×rate  (± rupees added to TOTAL DUE)
  locked: boolean;
  settledBy: string;
  settledAt?: Timestamp;
}

// Company-wide holiday. Doc id is the date ("yyyy-MM-dd"). A marked holiday is
// skipped like a Sunday: no attendance status is written, no Absent penalty, and
// it is excluded from expected working days (unpaid, no payroll effect).
export interface Holiday {
  id: string;
  date: string;        // "yyyy-MM-dd"
  title: string;
  description?: string;
  createdBy?: string;
  createdAt?: Timestamp;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  date: string;
  type: string;
  timestamp?: Timestamp;
  latitude: number;
  longitude: number;
  siteId: string;
  siteName: string;
  marketName: string;
  autoLogout?: boolean;
}

export interface SentNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  recipientType: 'all' | 'operations' | 'office' | 'specific';
  recipientCount: number;
  sentByName: string;
  sentAt?: Timestamp;
}

export interface ConveyanceRecord {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  date: string;
  month: string;
  route: string;
  totalKm: number;
  ratePerKm: number;
  conveyance: number;
  computedAt?: Timestamp;
}
