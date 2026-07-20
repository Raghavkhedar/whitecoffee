'use client';

import {
  collection, collectionGroup, doc, getDocs, getDoc,
  setDoc, updateDoc, deleteDoc, deleteField, writeBatch,
  Timestamp, where, query, orderBy, limit,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { istTodayStr } from './date';
import { PAY_FIELDS, type Pay } from './compensation';
// Site removed from import — site management not in use
// DailyAssignment, SiteAssignmentItem removed from import — daily assignment system not in use
import type { User, LeaveRequest, AttendanceRecord, SentNotification, AttendanceStatus, RegularizationRequest, ConveyanceRecord, PlannedHours, OtApproval, Holiday, Settlement, AttendanceCorrection } from '@/types';

// ── Users ─────────────────────────────────────────────────────────────────

// Offboarded users (`active === false`) are excluded by default so they drop out of
// every dashboard/attendance/notification view. Legacy users have no `active` field —
// missing must count as active. Pass `includeInactive` (Users page) to see everyone.
export async function getAllUsers(includeInactive = false): Promise<User[]> {
  const snap = await getDocs(collection(db, 'users'));
  const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
  return includeInactive ? all : all.filter(u => u.active !== false);
}

/**
 * Pay lives in users/{uid}/compensation/current, NOT on the user doc — Firestore rules are
 * document-level, so any tab that reads a user doc to resolve a name would otherwise read
 * salaryRate too. Readable by admin and /ot-settlements only; written by admin only.
 */
export async function setCompensation(uid: string, pay: Partial<Pay>) {
  await setDoc(doc(db, 'users', uid, 'compensation', 'current'), {
    salaryRate: pay.salaryRate || 0,
    pfPercent: pay.pfPercent || 0,
    esiPercent: pay.esiPercent || 0,
    imprestPercent: pay.imprestPercent || 0,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

/**
 * uid → compensation doc, for the two surfaces allowed to see pay (Users, OT Settlements).
 * Callers merge it with `withPay`, which falls back per field to any legacy inline value.
 * Do NOT call this from a tab that lacks pay access — the read will be denied by rules.
 */
export async function getCompensationMap(): Promise<Map<string, Partial<Pay>>> {
  const snap = await getDocs(collectionGroup(db, 'compensation'));
  const out = new Map<string, Partial<Pay>>();
  for (const d of snap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (uid) out.set(uid, d.data() as Partial<Pay>);
  }
  return out;
}

export async function createUserProfile(uid: string, data: Omit<User, 'id'>) {
  const { salaryRate, pfPercent, esiPercent, imprestPercent, homeLat, homeLng, conveyanceRateType, ...rest } = data;
  await setDoc(doc(db, 'users', uid), {
    ...rest,
    homeLat: homeLat || null,
    homeLng: homeLng || null,
    conveyanceRateType: conveyanceRateType || null,
    plBalance: 0,
    active: true,
    createdAt: Timestamp.now(),
  });
  // Pay goes to the restricted subcollection, never inline on the user doc.
  await setCompensation(uid, { salaryRate, pfPercent, esiPercent, imprestPercent });
}

// True if an ACTIVE user already holds this employee ID (blocks reuse of a live ID).
// Offboarded holders don't count — a new hire reuses the freed ID with a new UID.
export async function employeeIdInUse(employeeId: string): Promise<boolean> {
  const snap = await getDocs(query(
    collection(db, 'users'),
    where('employeeId', '==', employeeId.trim()),
  ));
  // Legacy users have no `active` field (missing = active), so filter in code
  // rather than a compound `active == true` query that would skip them.
  return snap.docs.some(d => (d.data() as User).active !== false);
}

export async function updateUserProfile(uid: string, data: Partial<Omit<User, 'id'>>) {
  // Pay fields are split out to users/{uid}/compensation/current and must never be
  // written back onto the user doc — doing so would re-expose salary to every tab that
  // reads a user doc to resolve a name.
  const payload: Record<string, unknown> = {};
  const pay: Partial<Pay> = {};
  let hasPay = false;
  for (const [k, v] of Object.entries(data)) {
    if ((PAY_FIELDS as string[]).includes(k)) {
      pay[k as keyof Pay] = (typeof v === 'number' ? v : 0);
      hasPay = true;
      continue;
    }
    payload[k] = v === undefined ? null : v;
  }
  if (Object.keys(payload).length > 0) {
    await updateDoc(doc(db, 'users', uid), payload);
  }
  if (hasPay) await setCompensation(uid, pay);
}

export async function deleteUserProfile(uid: string) {
  await deleteDoc(doc(db, 'users', uid));
}

// Suspend / reactivate. The client SDK can't disable another user's Auth account, so this
// goes through the Admin-SDK Cloud Function, which sets `disabled` in Auth AND `active` on the
// user doc. Data is never deleted — attendance/salary history is retained. Suspending requires
// a reason (opts.reason) and may carry an optional expected-return date; the function records
// who/when server-side and appends to suspensionHistory.
export async function setUserActive(
  uid: string,
  active: boolean,
  opts?: { reason?: string; expectedReturn?: string | null },
) {
  await httpsCallable(functions, 'setUserActive')({ uid, active, ...opts });
}

// Admin sets a new password directly (synthetic-email users can't receive reset links).
// Returns nothing; the caller shows the temp password it passed in to hand to the employee.
export async function resetUserPassword(uid: string, newPassword: string) {
  await httpsCallable(functions, 'resetUserPassword')({ uid, newPassword });
}

// Admin changes the employee's login email. Updates Firebase Auth AND the user doc
// (Admin SDK) so the sign-in credential and the mirrored `email` field stay in sync.
export async function updateUserEmail(uid: string, email: string) {
  await httpsCallable(functions, 'updateUserEmail')({ uid, email });
}

// ── Sites — NOT IN USE ────────────────────────────────────────────────────
//
// Re-enable by:
//   1. Uncommenting these four functions
//   2. Uncommenting addDoc in the firebase/firestore import above
//   3. Adding Site back to the @/types import
//   4. Uncommenting the Site interface in src/types/index.ts
//   5. Uncommenting sites/page.tsx and the Sidebar.tsx nav entry
//
// export async function getAllSites(): Promise<Site[]> {
//   const snap = await getDocs(collection(db, 'sites'));
//   return snap.docs.map(d => ({ id: d.id, ...d.data() } as Site));
// }
//
// export async function createSite(data: Omit<Site, 'id'>): Promise<string> {
//   const ref = await addDoc(collection(db, 'sites'), data);
//   return ref.id;
// }
//
// export async function updateSite(siteId: string, data: Partial<Omit<Site, 'id'>>) {
//   await updateDoc(doc(db, 'sites', siteId), data as Record<string, unknown>);
// }
//
// export async function deleteSite(siteId: string) {
//   await deleteDoc(doc(db, 'sites', siteId));
// }

// ── Daily Assignments — NOT IN USE ────────────────────────────────────────
//
// Re-enable by:
//   1. Uncommenting these three functions
//   2. Uncommenting getDoc in the firebase/firestore import above
//   3. Adding DailyAssignment, SiteAssignmentItem back to the @/types import
//   4. Uncommenting SiteAssignmentItem + DailyAssignment in src/types/index.ts
//   5. Uncommenting daily-assignments/page.tsx and Sidebar.tsx nav entry
//   6. Uncommenting SiteTask + getTodayAssignedSites in the Android app
//
// export async function getDailyAssignments(date: string, users?: User[]): Promise<DailyAssignment[]> {
//   // Read documents directly by ID ({date}_{userId}) to avoid collection queries
//   // which can hang on new/empty collections in some Firestore configurations.
//   const allUsers = users ?? (await getDocs(collection(db, 'users'))).docs.map(d => ({ id: d.id, ...d.data() } as User));
//   const opUsers  = allUsers.filter(u => u.role === 'operations');
//   const results = await Promise.all(
//     opUsers.map(u => getDoc(doc(db, 'daily_assignments', `${date}_${u.id}`)))
//   );
//   return results
//     .filter(d => d.exists())
//     .map(d => {
//       const data = d.data()!;
//       const sites: SiteAssignmentItem[] = data.sites ??
//         (data.siteIds ?? []).map((id: string) => ({
//           siteId: id, siteName: id, workDescription: '', toolsRequired: '',
//         }));
//       return { id: d.id, ...data, sites } as DailyAssignment;
//     });
// }
//
// export async function setDailyAssignment(
//   date: string,
//   userId: string,
//   userName: string,
//   sites: SiteAssignmentItem[]
// ): Promise<void> {
//   const docId = `${date}_${userId}`;
//   await setDoc(doc(db, 'daily_assignments', docId), {
//     date, userId, userName, sites, assignedAt: Timestamp.now(),
//   });
// }
//
// export async function clearDailyAssignment(date: string, userId: string): Promise<void> {
//   await deleteDoc(doc(db, 'daily_assignments', `${date}_${userId}`));
// }

// ── Leave Requests ────────────────────────────────────────────────────────

export async function getAllLeaveRequests(status?: string): Promise<LeaveRequest[]> {
  const snap = await getDocs(collectionGroup(db, 'leave_requests'));
  const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
  const filtered = status ? all.filter(r => r.status === status) : all;
  return filtered.sort((a, b) => {
    const ta = (a.submittedAt as unknown as { seconds: number })?.seconds ?? 0;
    const tb = (b.submittedAt as unknown as { seconds: number })?.seconds ?? 0;
    return status === 'pending' ? ta - tb : tb - ta;
  });
}

/**
 * Approve a leave request, granting exactly `approvedDates` ("yyyy-MM-dd", a subset of
 * fromDate…toDate). `fromDate`/`toDate`/`totalDays` are deliberately left alone — they stay
 * the record of what was requested. Ungranted dates are normal working days, not leave.
 * Passing every requested date is a full approval; the field is still written so the doc is
 * explicit. Omitting it entirely falls back to the compatibility rule (whole range granted).
 */
export async function approveLeave(
  userId: string, requestId: string, approverName: string,
  approvedDates?: string[], comment?: string,
) {
  const payload: Record<string, unknown> = {
    status: 'approved', approvedBy: approverName, reviewedAt: Timestamp.now(),
  };
  // An EMPTY array must never reach Firestore: the compatibility rule reads a missing
  // *or empty* `approvedDates` as "whole range granted", so writing [] would silently
  // grant every requested day — the opposite of what a zero-date selection means. The
  // approve modal already disables submit at zero; this is the load-bearing backstop.
  if (approvedDates && approvedDates.length === 0) {
    throw new Error('approveLeave: approvedDates is empty — granting no dates is a decline, not an approval.');
  }
  if (approvedDates) payload.approvedDates = [...approvedDates].sort();
  if (comment !== undefined) payload.approverComment = comment;
  await updateDoc(doc(db, 'users', userId, 'leave_requests', requestId), payload);
}

export async function rejectLeave(
  userId: string, requestId: string, approverName: string, comment: string
) {
  await updateDoc(
    doc(db, 'users', userId, 'leave_requests', requestId),
    { status: 'rejected', approvedBy: approverName, approverComment: comment, reviewedAt: Timestamp.now() }
  );
}

// ── Regularization Requests ───────────────────────────────────────────────

export async function getAllRegularizationRequests(status?: string): Promise<RegularizationRequest[]> {
  const snap = await getDocs(collectionGroup(db, 'regularization_requests'));
  const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as RegularizationRequest));
  const filtered = status ? all.filter(r => r.status === status) : all;
  return filtered.sort((a, b) => {
    const ta = (a.submittedAt as unknown as { seconds: number })?.seconds ?? 0;
    const tb = (b.submittedAt as unknown as { seconds: number })?.seconds ?? 0;
    return status === 'pending' ? ta - tb : tb - ta;
  });
}

// Approve a regularization request → write the admin attendance_status. When approving to a
// worked status (Present) the admin may pass effective in/out times ("HH:MM"), captured on the
// status doc so the OT/shortage ledger can carry that day's shortage/OT (missed-punch fix).
export async function approveRegularization(
  userId: string, requestId: string, date: string, approverName: string,
  comment: string, approvedStatus: string, userName = '', employeeId = '',
  inTime?: string, outTime?: string,
) {
  const batch = writeBatch(db);
  batch.update(
    doc(db, 'users', userId, 'regularization_requests', requestId),
    { status: 'approved', approvedBy: approverName, approverComment: comment, approvedStatus, reviewedAt: Timestamp.now() }
  );
  // Set in/out only for a Present outcome with both times given; otherwise clear any stale pair
  // so a re-approval to a non-worked status doesn't leave orphan times on the doc.
  const carryHours = approvedStatus === 'Present' && !!inTime && !!outTime;
  batch.set(
    doc(db, 'users', userId, 'attendance_status', date),
    {
      date, userId, userName, employeeId, status: approvedStatus, markedBy: 'admin',
      inTime: carryHours ? inTime : deleteField(),
      outTime: carryHours ? outTime : deleteField(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
  await batch.commit();
}

export async function rejectRegularization(
  userId: string, requestId: string, approverName: string, comment: string
) {
  await updateDoc(
    doc(db, 'users', userId, 'regularization_requests', requestId),
    { status: 'rejected', approvedBy: approverName, approverComment: comment, reviewedAt: Timestamp.now() }
  );
}

// ── Attendance ────────────────────────────────────────────────────────────

export async function getAttendanceForDate(date: string): Promise<AttendanceRecord[]> {
  const snap = await getDocs(collectionGroup(db, 'attendance'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as AttendanceRecord))
    .filter(r => r.date === date)
    .sort((a, b) => {
      const ta = (a.timestamp as unknown as { seconds: number })?.seconds ?? 0;
      const tb = (b.timestamp as unknown as { seconds: number })?.seconds ?? 0;
      return ta - tb;
    });
}

// Same-day punch correction (Daily Activity page, admin-only). Rewinds one employee's
// timeline to `keepEventId`: hard-deletes every punch recorded AFTER it and snapshots
// those punches verbatim into users/{uid}/attendance_corrections/{autoId} with the
// admin, reason, and kept event. One atomic batch. Re-reads today's events inside the
// call so a stale client list can't delete the wrong punches. Returns the removed count.
//
// Callers MUST restrict this to the current IST day and enforce a non-empty reason;
// past-day corrections belong to the Regularization flow.
export async function restoreAttendanceToEvent(
  uid: string,
  date: string,
  keepEventId: string,
  reason: string,
  adminName: string,
  adminUid: string,
): Promise<number> {
  // Authoritative re-read of this employee's punches for the date, oldest first.
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'attendance'), where('date', '==', date)),
  );
  const events = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as AttendanceRecord))
    .sort((a, b) => {
      const ta = (a.timestamp as unknown as { seconds: number })?.seconds ?? 0;
      const tb = (b.timestamp as unknown as { seconds: number })?.seconds ?? 0;
      return ta - tb;
    });

  const keepIdx = events.findIndex(e => e.id === keepEventId);
  if (keepIdx === -1) throw new Error('The punch to restore to no longer exists — reload and try again.');

  const removed = events.slice(keepIdx + 1);
  if (removed.length === 0) return 0; // already the last punch — nothing to undo

  const batch = writeBatch(db);
  removed.forEach(e => batch.delete(doc(db, 'users', uid, 'attendance', e.id)));

  const logRef = doc(collection(db, 'users', uid, 'attendance_corrections'));
  batch.set(logRef, {
    date,
    removedEvents: removed,
    reason,
    correctedBy: adminName,
    correctedByUid: adminUid,
    correctedAt: Timestamp.now(),
    keptEventId: keepEventId,
  } satisfies Omit<AttendanceCorrection, 'id'>);

  await batch.commit();
  return removed.length;
}

// All punch corrections made for a given date, across every employee (Daily Activity
// history). Mirrors getAttendanceForDate: collectionGroup scan + client-side date
// filter (no composite index needed). Newest first.
export async function getAttendanceCorrectionsForDate(date: string): Promise<AttendanceCorrection[]> {
  const snap = await getDocs(collectionGroup(db, 'attendance_corrections'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as AttendanceCorrection))
    .filter(c => c.date === date)
    .sort((a, b) => {
      const ta = (a.correctedAt as unknown as { seconds: number })?.seconds ?? 0;
      const tb = (b.correctedAt as unknown as { seconds: number })?.seconds ?? 0;
      return tb - ta;
    });
}

// ── Notifications ─────────────────────────────────────────────────────────

/**
 * Writes a notification document to each target user's sub-collection and logs
 * the send event in /sent_notifications for history.
 * Firestore batch limit is 500 ops — safe for teams up to ~200 users.
 */
export async function sendNotification(
  userIds: string[],
  title: string,
  body: string,
  type: string,
  senderName: string,
  recipientType: SentNotification['recipientType']
): Promise<void> {
  const batch  = writeBatch(db);
  const sentAt = Timestamp.now();

  for (const userId of userIds) {
    const notifRef = doc(collection(db, 'users', userId, 'notifications'));
    batch.set(notifRef, { title, body, type, isRead: false, createdAt: sentAt });
  }

  const logRef = doc(collection(db, 'sent_notifications'));
  const logData: Record<string, unknown> = {
    title,
    body,
    type,
    recipientType,
    recipientCount: userIds.length,
    sentByName: senderName,
    sentAt,
  };
  if (recipientType === 'specific' && userIds.length === 1) {
    logData.recipientId = userIds[0];
  }
  batch.set(logRef, logData);

  await batch.commit();
}

export async function getSentNotifications(count = 20): Promise<SentNotification[]> {
  const q    = query(collection(db, 'sent_notifications'), orderBy('sentAt', 'desc'), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as SentNotification));
}

// ── Attendance Status ─────────────────────────────────────────────────────

// month is 1-indexed (1 = January)
export async function getAttendanceStatusForMonth(year: number, month: number): Promise<AttendanceStatus[]> {
  const monthStr  = `${year}-${String(month).padStart(2, '0')}`;
  const startDate = `${monthStr}-01`;
  const endDate   = `${monthStr}-31`; // safe upper bound for any month
  const q = query(
    collectionGroup(db, 'attendance_status'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceStatus));
}

export async function setAttendanceStatus(
  userId: string,
  date: string,
  data: Omit<AttendanceStatus, 'id' | 'updatedAt'>
): Promise<void> {
  await setDoc(
    doc(db, 'users', userId, 'attendance_status', date),
    { ...data, updatedAt: Timestamp.now() },
    { merge: true }
  );
}

// Remove an admin-set status doc (e.g. clearing a WO) so the nightly function can recompute.
export async function deleteAttendanceStatus(userId: string, date: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, 'attendance_status', date));
}

export async function getAttendanceStatusForDateRange(start: string, end: string): Promise<AttendanceStatus[]> {
  const q = query(
    collectionGroup(db, 'attendance_status'),
    where('date', '>=', start),
    where('date', '<=', end)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceStatus));
}

// ── Planned Hours (operations shift windows) ──────────────────────────────

// month is 1-indexed (1 = January)
export async function getPlannedHoursForMonth(year: number, month: number): Promise<PlannedHours[]> {
  const monthStr  = `${year}-${String(month).padStart(2, '0')}`;
  const startDate = `${monthStr}-01`;
  const endDate   = `${monthStr}-31`; // safe upper bound for any month
  const q = query(
    collectionGroup(db, 'planned_hours'),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as PlannedHours));
}

export async function getPlannedHoursForDateRange(start: string, end: string): Promise<PlannedHours[]> {
  const q = query(
    collectionGroup(db, 'planned_hours'),
    where('date', '>=', start),
    where('date', '<=', end)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as PlannedHours));
}

export async function getAttendanceForDateRange(start: string, end: string): Promise<AttendanceRecord[]> {
  const snap = await getDocs(collectionGroup(db, 'attendance'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as AttendanceRecord))
    .filter(r => r.date >= start && r.date <= end)
    .sort((a, b) => {
      const ta = (a.timestamp as unknown as { seconds: number })?.seconds ?? 0;
      const tb = (b.timestamp as unknown as { seconds: number })?.seconds ?? 0;
      return ta - tb;
    });
}

export async function setPlannedHours(
  userId: string,
  date: string,
  startTime: string,
  endTime: string,
  declaredOtMins = 0,
): Promise<void> {
  await setDoc(
    doc(db, 'users', userId, 'planned_hours', date),
    { userId, date, startTime, endTime, declaredOtMins, updatedAt: Timestamp.now() },
    { merge: true }
  );
}

// Authorize (or revoke) all-hours OT for an ops employee on a Sunday/holiday. Merges a flag
// into planned_hours/{date} without requiring a shift window. When true, the OT/shortage
// ledger counts every worked minute that day as auto-approved OT.
export async function setOtAuthorization(userId: string, date: string, authorized: boolean): Promise<void> {
  await setDoc(
    doc(db, 'users', userId, 'planned_hours', date),
    { userId, date, otAuthorized: authorized, updatedAt: Timestamp.now() },
    { merge: true }
  );
}

// ── Overtime Approvals ────────────────────────────────────────────────────

export async function getOtApprovalsForDateRange(start: string, end: string): Promise<OtApproval[]> {
  // Fetch + client-filter (no collection-group index required; this set stays small).
  const snap = await getDocs(collectionGroup(db, 'ot_approvals'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as OtApproval))
    .filter(a => a.date >= start && a.date <= end);
}

// Approve a day's overtime with an admin-adjusted amount + reason. Writes a per-day
// record at users/{uid}/ot_approvals/{date} (idempotent and safe to re-approve).
export async function approveOt(
  user: Pick<User, 'id' | 'name' | 'employeeId' | 'role'>,
  date: string,
  requestedMins: number,
  approvedMins: number,
  reason: string,
  approverName: string,
): Promise<void> {
  await writeOtDecision(user, date, requestedMins, approvedMins, 'approved', reason, approverName);
}

// Reject a day's overtime: records a 0-minute decision so the day stops showing as pending
// and is logged in history. Reason required (enforced by the caller).
export async function rejectOt(
  user: Pick<User, 'id' | 'name' | 'employeeId' | 'role'>,
  date: string,
  requestedMins: number,
  reason: string,
  approverName: string,
): Promise<void> {
  await writeOtDecision(user, date, requestedMins, 0, 'rejected', reason, approverName);
}

// Manually grant OT for a day the system didn't auto-detect (e.g. a missed punch where OT
// really happened). Records an approved decision flagged `manual:true`; the ledger counts it
// as granted OT exactly like an approval. Reason required (enforced by the caller).
export async function setManualOt(
  user: Pick<User, 'id' | 'name' | 'employeeId' | 'role'>,
  date: string,
  approvedMins: number,
  reason: string,
  approverName: string,
): Promise<void> {
  await writeOtDecision(user, date, approvedMins, approvedMins, 'approved', reason, approverName, true);
}

// Shared writer for an OT decision (approve / reject / manual). One doc per day at
// users/{uid}/ot_approvals/{date}; the ledger sums approvedMins live (no lifetime counter).
async function writeOtDecision(
  user: Pick<User, 'id' | 'name' | 'employeeId' | 'role'>,
  date: string,
  requestedMins: number,
  approvedMins: number,
  status: 'approved' | 'rejected',
  reason: string,
  approverName: string,
  manual = false,
): Promise<void> {
  await setDoc(
    doc(db, 'users', user.id, 'ot_approvals', date),
    {
      date, userId: user.id, userName: user.name || '', employeeId: user.employeeId || '',
      role: user.role || '', requestedMins, approvedMins, status, manual, reason,
      approvedBy: approverName, approvedAt: Timestamp.now(),
    },
    { merge: true },
  );
}

// ── Monthly Settlements ───────────────────────────────────────────────────
// Frozen at users/{uid}/settlements/{YYYY-MM} when admin Settle & Locks a month.
// The Cloud Function reads locked settlements and adds settlementCash to payroll.

export async function getSettlementsForMonth(month: string): Promise<Settlement[]> {
  // Fetch + client-filter (set stays small; avoids a collection-group index).
  const snap = await getDocs(collectionGroup(db, 'settlements'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Settlement)).filter(s => s.month === month);
}

// Write/overwrite a batch of locked settlement docs for a month (one per ops employee).
export async function settleMonth(rows: Omit<Settlement, 'id' | 'settledAt'>[]): Promise<void> {
  const batch = writeBatch(db);
  const now = Timestamp.now();
  rows.forEach(s => {
    batch.set(doc(db, 'users', s.userId, 'settlements', s.month), { ...s, id: s.month, settledAt: now }, { merge: true });
  });
  await batch.commit();
}

// Unlock a settled month so it can be revised (excluded from payroll until re-settled).
export async function unlockMonthSettlement(userId: string, month: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'settlements', month), { locked: false });
}

// ── Holidays (company-wide) ───────────────────────────────────────────────
// Stored at holidays/{date}; a marked day is skipped like a Sunday everywhere
// attendance is evaluated (no status, no penalty, excluded from working days).

// month is 1-indexed (1 = January)
export async function getHolidaysForMonth(year: number, month: number): Promise<Holiday[]> {
  const monthStr  = `${year}-${String(month).padStart(2, '0')}`;
  const q = query(
    collection(db, 'holidays'),
    where('date', '>=', `${monthStr}-01`),
    where('date', '<=', `${monthStr}-31`), // safe upper bound for any month
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday));
}

export async function getHolidaysForDateRange(start: string, end: string): Promise<Holiday[]> {
  const q = query(
    collection(db, 'holidays'),
    where('date', '>=', start),
    where('date', '<=', end),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Holiday));
}

export async function setHoliday(date: string, title: string, description: string, createdBy: string): Promise<void> {
  await setDoc(
    doc(db, 'holidays', date),
    { date, title: title.trim(), description: description.trim(), createdBy, createdAt: Timestamp.now() },
    { merge: true },
  );
}

export async function deleteHoliday(date: string): Promise<void> {
  await deleteDoc(doc(db, 'holidays', date));
}

// ── Conveyance Config ────────────────────────────────────────────────────

export async function getConveyanceConfig(): Promise<{ rate1: number; rate2: number }> {
  const snap = await getDoc(doc(db, 'config', 'conveyance'));
  if (snap.exists()) {
    const data = snap.data();
    return { rate1: data.rate1 || 0, rate2: data.rate2 || 0 };
  }
  return { rate1: 0, rate2: 0 };
}

export async function setConveyanceConfig(rate1: number, rate2: number): Promise<void> {
  await setDoc(doc(db, 'config', 'conveyance'), { rate1, rate2 });
}

// ── Site ID entry ────────────────────────────────────────────────────────
// Ops type the site name at check-in but leave Site ID + Visit Type + Work Done
// blank. Admin fills all three directly onto each individual attendance entry from
// the portal. (Firestore rules allow admins — and managers holding the Attendance or
// Manpower Utilisation Input tab — to change only these three keys; the rest of the
// event stays immutable.)
export async function updateAttendanceSiteId(
  userId: string, eventId: string, siteId: string, visitType: string, workDoneCategories: string[],
): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'attendance', eventId), {
    siteId: siteId.trim(),
    visitType: visitType.trim(),
    workDoneCategories,
  });
}

// ── Conveyance Records ──────────────────────────────────────────────────

export async function getConveyanceForMonth(month: string): Promise<ConveyanceRecord[]> {
  const snap = await getDocs(query(collection(db, 'conveyance'), where('month', '==', month)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ConveyanceRecord));
}

// ── Dashboard Stats ───────────────────────────────────────────────────────

export async function getDashboardStats() {
  const today = istTodayStr();
  const [usersSnap, sitesSnap, leavesSnap, regsSnap, attendanceSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'sites')),
    getDocs(collectionGroup(db, 'leave_requests')),
    getDocs(collectionGroup(db, 'regularization_requests')),
    getDocs(collectionGroup(db, 'attendance')),
  ]);
  const activeEmployees = usersSnap.docs.filter(d => {
    const u = d.data();
    return u.role !== 'admin' && u.active !== false;
  });
  const pendingLeaveDocs = leavesSnap.docs.filter(d => d.data().status === 'pending');
  const pendingRegDocs   = regsSnap.docs.filter(d => d.data().status === 'pending');
  // Oldest pending action across both queues (leaves + regularizations), by submittedAt.
  const earliestPendingSeconds = [...pendingLeaveDocs, ...pendingRegDocs]
    .map(d => (d.data().submittedAt as { seconds?: number } | undefined)?.seconds)
    .filter((s): s is number => typeof s === 'number')
    .reduce<number | null>((min, s) => (min === null || s < min ? s : min), null);
  return {
    totalUsers:    activeEmployees.length,
    totalSites:    sitesSnap.size,
    pendingLeaves: pendingLeaveDocs.length,
    pendingActions: pendingLeaveDocs.length + pendingRegDocs.length,
    earliestPendingSeconds,
    todayCheckIns: attendanceSnap.docs.filter(d => d.data().date === today && d.data().type?.endsWith('_in')).length,
  };
}
