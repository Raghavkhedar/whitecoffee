'use client';

import {
  collection, collectionGroup, doc, getDocs, getDoc,
  setDoc, updateDoc, deleteDoc, deleteField, writeBatch, increment,
  Timestamp, where, query, orderBy, limit,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import { istTodayStr } from './date';
import { effectiveGrantedDates } from './leaveDates';
import { PAY_FIELDS, type Pay } from './compensation';
// Site removed from import — site management not in use
// DailyAssignment, SiteAssignmentItem removed from import — daily assignment system not in use
import type { User, LeaveRequest, AttendanceRecord, SentNotification, AttendanceStatus, RegularizationRequest, ConveyanceRecord, PlannedHours, OtApproval, Holiday, Settlement, SpecialAllowance, AttendanceCorrection, AuditEntry } from '@/types';

// ── Write attribution ─────────────────────────────────────────────────────
//
// Firestore triggers do NOT carry auth context: the onWrite trigger behind
// `firebase/functions/auditLog.js` receives the document, not the identity that wrote it.
// So "who changed this?" is answerable ONLY if the document records it. Every write that
// originates in this portal therefore stamps the acting auth uid; `lastModifiedBy` is the
// FIRST entry in the audit log's ACTOR_FIELDS list and is treated as authoritative there.
//
// `'unknown'` is written rather than omitting the field when there is no signed-in user —
// an explicit "we could not identify the writer" is more honest in an audit trail than a
// missing key, which reads identically to a legacy pre-stamping document.
//
// ⚠️ NOT every write may be stamped. Firestore rules use `changedKeysWithin(...)` to pin
// some updates to an exact key set; adding a key to one of those payloads makes the write
// DENIED. Those call sites are individually commented as EXEMPT below — do not "fix" them
// by wrapping them in stamped(). See `firebase/firestore.rules`.
export function stamped<T extends object>(data: T): T & { lastModifiedBy: string; lastModifiedAt: Timestamp } {
  return { ...data, lastModifiedBy: auth.currentUser?.uid ?? 'unknown', lastModifiedAt: Timestamp.now() };
}

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
  // Writes ONLY the fields actually supplied. Writing all four with `|| 0` would zero a
  // salary whenever a caller updated just one percentage — `merge: true` does not protect
  // against that, because the field IS present in the payload, explicitly set to 0.
  // Non-finite values are dropped rather than coerced, so an undefined or a stray string
  // can never overwrite real pay with 0.
  const payload: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const field of PAY_FIELDS) {
    const v = pay[field];
    if (typeof v === 'number' && isFinite(v)) payload[field] = v;
  }
  await setDoc(doc(db, 'users', uid, 'compensation', 'current'), stamped(payload), { merge: true });
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
  await setDoc(doc(db, 'users', uid), stamped({
    ...rest,
    homeLat: homeLat || null,
    homeLng: homeLng || null,
    conveyanceRateType: conveyanceRateType || null,
    plBalance: 0,
    active: true,
    createdAt: Timestamp.now(),
  }));
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
      // Only forward real numbers. Coercing anything else to 0 here would wipe the stored
      // salary whenever a caller passed a pay key as undefined.
      if (typeof v === 'number' && isFinite(v)) {
        pay[k as keyof Pay] = v;
        hasPay = true;
      }
      continue;
    }
    payload[k] = v === undefined ? null : v;
  }
  // The emptiness guard tests the CALLER's payload, not the stamped one — stamping first
  // would make every no-op call write two attribution fields and nothing else.
  // Safe to stamp: user-doc writes from the portal are admin-only, and the rule's
  // `changedKeysWithin(['activeSessionToken','fcmToken'])` clause guards only the
  // isOwner branch, which this portal never uses (it writes no token fields at all).
  if (Object.keys(payload).length > 0) {
    await updateDoc(doc(db, 'users', uid), stamped(payload));
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

// THE only way a password is ever set on this system: an admin, on /users, types one.
// Reset links and self-service resets were built and then deliberately removed — staff
// sign in as `<empId>@whitecoffee.internal`, which has no mailbox, so there is nowhere to
// deliver a link. Keeping one path means there is never a question of which one is live.
// See docs/password-policy.md before adding a second.
export async function resetUserPassword(uid: string, newPassword: string) {
  await httpsCallable(functions, 'resetUserPassword')({ uid, newPassword });
}

// Force this employee out of every signed-in session, on the phone and the portal.
// For "their password may be compromised" — it does NOT change the password, so pair it
// with a reset. Phones drop immediately (the app watches activeSessionToken live); a
// portal tab can survive up to an hour, until its current ID token expires.
export async function revokeUserSessions(uid: string) {
  await httpsCallable(functions, 'revokeUserSessions')({ uid });
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
  await updateDoc(doc(db, 'users', userId, 'leave_requests', requestId), stamped(payload));
}

export async function rejectLeave(
  userId: string, requestId: string, approverName: string, comment: string
) {
  await updateDoc(
    doc(db, 'users', userId, 'leave_requests', requestId),
    stamped({ status: 'rejected', approvedBy: approverName, approverComment: comment, reviewedAt: Timestamp.now() })
  );
}

/**
 * Cancel days from an ALREADY-APPROVED leave — the undo an approval never had.
 * Date-level, and allowed at any time, including after the days have been scored
 * into payroll.
 *
 * `status` stays `'approved'` and `approvedDates` is never rewritten: cancellation
 * only ADDS `cancelledDates`, so the document keeps the full history (asked for →
 * granted → revoked) and every existing `status === 'approved'` reader keeps
 * working. What changes is coverage — `leaveCoversDate` subtracts cancellations
 * last, so a cancelled day becomes an ordinary working day again.
 *
 * Two things happen per cancelled date, and only one of them is automatic:
 *
 *  - **Future / never-scored dates** need no attendance write at all. No
 *    `attendance_status` doc exists yet, and the nightly scorer will simply stop
 *    seeing leave for that day. This is why there is no past-vs-future branch here.
 *  - **Already-scored dates** are reverted to `Absent` — a PL/LWP day has zero
 *    punches by construction, so with the leave gone it is exactly the scorer's own
 *    `no leave → Absent` fallback.
 *
 * ⚠️ The revert is gated on `markedBy === 'auto'`, upholding the same invariant the
 * nightly function does: an admin-marked day is never silently rewritten. If someone
 * regularized the day after the leave scored it, that later decision wins — the date
 * is still recorded as cancelled, but its status doc is left alone and returned in
 * `skippedDates` so the caller can say so out loud.
 *
 * ⚠️ Only a **PL** day refunds `plBalance`. LWP is leave taken with a zero balance —
 * it never decremented anything, so refunding it would mint leave out of nothing.
 * This is the codebase's first `plBalance` increment outside the monthly accrual in
 * `accrueMonthlyLeave`; every other write is a decrement.
 *
 * Re-cancelling an already-cancelled date is a safe no-op: the UI only offers days
 * that are still granted, and even if one slipped through, the revert wrote
 * `markedBy: 'admin'`, so the guard above rejects it and no second refund happens.
 */
export async function cancelLeave(
  userId: string, requestId: string, cancellerName: string,
  datesToCancel: string[], reason: string,
): Promise<{ cancelled: string[]; skippedDates: string[]; refundedDays: number }> {
  const trimmedReason = reason.trim();
  // A cancellation moves money and revokes time off someone has already planned around.
  // Both guards are load-bearing, not validation theatre — the UI enforces them too.
  if (!trimmedReason) throw new Error('cancelLeave: a reason is required.');
  if (datesToCancel.length === 0) throw new Error('cancelLeave: no dates selected — nothing to cancel.');

  const leaveRef  = doc(db, 'users', userId, 'leave_requests', requestId);
  const leaveSnap = await getDoc(leaveRef);
  if (!leaveSnap.exists()) throw new Error('cancelLeave: leave request not found.');
  const leave = { id: leaveSnap.id, ...leaveSnap.data() } as LeaveRequest;
  if (leave.status !== 'approved') {
    throw new Error('cancelLeave: only an approved leave can be cancelled.');
  }

  // Re-derive what is still granted from the SERVER copy rather than trusting the
  // caller's list: a stale tab could otherwise "cancel" a day another admin already
  // cancelled and double-refund it.
  const stillGranted = new Set(effectiveGrantedDates(leave));
  const cancelling   = Array.from(new Set(datesToCancel)).filter(d => stillGranted.has(d)).sort();
  if (cancelling.length === 0) {
    throw new Error('cancelLeave: none of those dates are currently granted by this leave.');
  }

  // Every read resolves BEFORE the batch opens — a Firestore batch cannot read.
  const statusRefs  = cancelling.map(d => doc(db, 'users', userId, 'attendance_status', d));
  const statusSnaps = await Promise.all(statusRefs.map(r => getDoc(r)));

  const batch = writeBatch(db);
  const skippedDates: string[] = [];
  let refundedDays = 0;

  statusSnaps.forEach((snap, i) => {
    // No doc = never scored (a future date, a Sunday, a holiday). Nothing to undo,
    // and NOT a skip — the cancellation lands cleanly.
    if (!snap.exists()) return;
    const data = snap.data() as AttendanceStatus;
    const scoredAsLeave = data.status === 'PL' || data.status === 'LWP';
    if (!scoredAsLeave || data.markedBy !== 'auto') { skippedDates.push(cancelling[i]); return; }

    batch.set(
      statusRefs[i],
      stamped({ status: 'Absent', markedBy: 'admin', updatedAt: Timestamp.now() }),
      { merge: true },
    );
    if (data.status === 'PL') refundedDays += 1; // PL only — see the LWP note above
  });

  if (refundedDays > 0) {
    batch.update(doc(db, 'users', userId), stamped({ plBalance: increment(refundedDays) }));
  }

  // Union, never overwrite — a second cancellation must not un-cancel the first.
  const merged = Array.from(new Set([...(leave.cancelledDates ?? []), ...cancelling])).sort();
  batch.update(leaveRef, stamped({
    cancelledDates:  merged,
    cancelledBy:     cancellerName,
    cancelComment:   trimmedReason,
    lastCancelledAt: Timestamp.now(),
  }));

  await batch.commit();
  return { cancelled: cancelling, skippedDates, refundedDays };
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
    stamped({ status: 'approved', approvedBy: approverName, approverComment: comment, approvedStatus, reviewedAt: Timestamp.now() })
  );
  // Set in/out only for a Present outcome with both times given; otherwise clear any stale pair
  // so a re-approval to a non-worked status doesn't leave orphan times on the doc.
  const carryHours = approvedStatus === 'Present' && !!inTime && !!outTime;
  batch.set(
    doc(db, 'users', userId, 'attendance_status', date),
    stamped({
      date, userId, userName, employeeId, status: approvedStatus, markedBy: 'admin',
      inTime: carryHours ? inTime : deleteField(),
      outTime: carryHours ? outTime : deleteField(),
      updatedAt: Timestamp.now(),
    }),
    { merge: true }
  );
  await batch.commit();
}

export async function rejectRegularization(
  userId: string, requestId: string, approverName: string, comment: string
) {
  await updateDoc(
    doc(db, 'users', userId, 'regularization_requests', requestId),
    stamped({ status: 'rejected', approvedBy: approverName, approverComment: comment, reviewedAt: Timestamp.now() })
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
  batch.set(logRef, stamped({
    date,
    removedEvents: removed,
    reason,
    correctedBy: adminName,
    correctedByUid: adminUid,
    correctedAt: Timestamp.now(),
    keptEventId: keepEventId,
  } satisfies Omit<AttendanceCorrection, 'id'>));

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
    // Safe to stamp: the notification CREATE rule has no changedKeysWithin clause. The
    // `changedKeysWithin(['isRead'])` restriction applies only to an owner UPDATE from the
    // employee app, which this portal never performs.
    batch.set(notifRef, stamped({ title, body, type, isRead: false, createdAt: sentAt }));
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
  batch.set(logRef, stamped(logData));

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
    stamped({ ...data, updatedAt: Timestamp.now() }),
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
    stamped({ userId, date, startTime, endTime, declaredOtMins, updatedAt: Timestamp.now() }),
    { merge: true }
  );
}

// Authorize (or revoke) all-hours OT for an ops employee on a Sunday/holiday. Merges a flag
// into planned_hours/{date} without requiring a shift window. When true, the OT/shortage
// ledger counts every worked minute that day as auto-approved OT.
export async function setOtAuthorization(userId: string, date: string, authorized: boolean): Promise<void> {
  await setDoc(
    doc(db, 'users', userId, 'planned_hours', date),
    stamped({ userId, date, otAuthorized: authorized, updatedAt: Timestamp.now() }),
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
    stamped({
      date, userId: user.id, userName: user.name || '', employeeId: user.employeeId || '',
      role: user.role || '', requestedMins, approvedMins, status, manual, reason,
      approvedBy: approverName, approvedAt: Timestamp.now(),
    }),
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
    batch.set(doc(db, 'users', s.userId, 'settlements', s.month), stamped({ ...s, id: s.month, settledAt: now }), { merge: true });
  });
  await batch.commit();
}

// Unlock a settled month so it can be revised (excluded from payroll until re-settled).
export async function unlockMonthSettlement(userId: string, month: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'settlements', month), stamped({ locked: false }));
}

// ── Monthly Special Allowance ─────────────────────────────────────────────
// Stored at users/{uid}/specialAllowance/{YYYY-MM} — a sibling of settlements/{YYYY-MM},
// shaped like it, but covering ALL FOUR roles (SA is not a ledger/ops concept). Entered
// fresh each month in the Users page pay block; frozen alongside the OT settlement when
// admin Settle & Locks the month on OT Settlements.
//
// ⚠️ The ABSENCE of a doc means "not yet decided", NOT ₹0 — so a blank amount must write
// nothing at all rather than a zero doc.
//
// NOT stored on users/{uid}/compensation/current: that document is one standing record of
// rates, so writing August's SA there would destroy July's. See `SpecialAllowance` in
// @/types and docs/superpowers/specs/2026-07-25-special-allowance-design.md.

export async function getSpecialAllowance(uid: string, month: string): Promise<SpecialAllowance | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'specialAllowance', month));
  return snap.exists() ? ({ id: snap.id, userId: uid, ...snap.data() } as SpecialAllowance) : null;
}

export async function getSpecialAllowancesForMonth(month: string): Promise<SpecialAllowance[]> {
  // Fetch + client-filter (set stays small; avoids a collection-group index) — as
  // getSettlementsForMonth does. `userId` is seeded from the parent path so the doc's own
  // field wins when present but a doc written without it is still attributable.
  //
  // ⚠️ Filtered on the DOC ID, not the `month` field — the doc id IS the month, and it is
  // what `snapshotDailySpend` keys off (functions/index.js). Filtering on the field instead
  // made this view diverge from the backend's for any doc missing it, so a doc the functions
  // happily read could be invisible here (locked, with no unlock path on this page).
  const snap = await getDocs(collectionGroup(db, 'specialAllowance'));
  return snap.docs
    .filter(d => d.id === month)
    .map(d => ({ id: d.id, userId: d.ref.parent.parent?.id ?? '', ...d.data() } as SpecialAllowance));
}

/**
 * Is this month frozen for editing? True when EITHER half of Settle & Lock has fired: any
 * locked `settlements/{month}` doc or any locked `specialAllowance/{month}` doc — the same
 * union `snapshotDailySpend` builds its `lockedSet` from, and both keyed on the doc id
 * (=== the month) for exactly that reason.
 *
 * ⚠️ The lock is a property of the MONTH, not of one employee's document. An employee with no
 * SA doc at lock time is still inside a locked month: a value typed for them afterwards
 * reaches nothing — snapshotDailySpend never recomputes a locked month (it reconciles SA once,
 * on the run that freezes it), exportToSheets only rebuilds the CURRENT month's block, and OT
 * Settlements offers only "Unlock to revise". So gate on this, never on `saDoc?.locked`.
 */
export async function isMonthLocked(month: string): Promise<boolean> {
  const [settle, sa] = await Promise.all([
    getDocs(collectionGroup(db, 'settlements')),
    getDocs(collectionGroup(db, 'specialAllowance')),
  ]);
  const hasLocked = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
    docs.some(d => d.id === month && d.data().locked === true);
  return hasLocked(settle.docs) || hasLocked(sa.docs);
}

/**
 * Set one employee's SA for one month. Callers must only reach here with a real amount —
 * a blank input means "not yet decided" and must not call this at all.
 *
 * ⚠️ Never writes `locked` on an existing doc: saving an amount must not be able to
 * silently unlock a month that Settle & Lock froze. The lock defaults are written only on
 * FIRST creation, where there is by definition no lock to destroy; unlocking is an
 * explicit action on the OT Settlements page.
 */
export async function setSpecialAllowance(
  uid: string, month: string, data: { amount: number; date: string },
): Promise<void> {
  const ref = doc(db, 'users', uid, 'specialAllowance', month);
  const existing = await getDoc(ref);
  const lockDefaults = existing.exists() ? {} : { locked: false, lockedBy: null, lockedAt: null };
  await setDoc(
    ref,
    stamped({ id: month, month, userId: uid, amount: data.amount, date: data.date, ...lockDefaults }),
    { merge: true },
  );
}

// Freeze every ENTERED SA for a month (one batch, called by Settle & Lock beside settleMonth).
// Only pass employees that actually have an SA doc — this must not conjure ₹0 rows for the
// people the manager deliberately left blank.
export async function lockSpecialAllowances(
  rows: { userId: string; month: string; lockedBy: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const batch = writeBatch(db);
  const now = Timestamp.now();
  rows.forEach(r => {
    batch.set(
      doc(db, 'users', r.userId, 'specialAllowance', r.month),
      // `id`/`month`/`userId` are re-asserted, not decoration: a merge-set CREATES the doc if
      // it vanished between load and commit, and a doc carrying only lock fields would be a
      // zombie — locked with no amount, no unlock path on the Users page, and read as ₹0 by
      // the functions. Identity fields keep even that degenerate doc self-describing.
      stamped({ id: r.month, month: r.month, userId: r.userId, locked: true, lockedBy: r.lockedBy, lockedAt: now }),
      { merge: true },
    );
  });
  await batch.commit();
}

// Release one employee's frozen SA so it can be revised (mirrors unlockMonthSettlement).
export async function unlockSpecialAllowance(userId: string, month: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'specialAllowance', month), stamped({ locked: false }));
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
    stamped({ date, title: title.trim(), description: description.trim(), createdBy, createdAt: Timestamp.now() }),
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
  await setDoc(doc(db, 'config', 'conveyance'), stamped({ rate1, rate2 }));
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
  // ⚠️ EXEMPT FROM stamped() — DO NOT ADD lastModifiedBy/lastModifiedAt HERE.
  // The attendance update rule is:
  //   allow update: if (isAdmin() || canWriteAttendance())
  //                 && changedKeysWithin(['siteId', 'visitType', 'workDoneCategories']);
  // `changedKeysWithin` is `hasOnly(...)`, and it is ANDed onto BOTH branches — the admin
  // branch does not escape it. A fourth key in this payload therefore makes the write
  // PERMISSION_DENIED for everyone, silently breaking Site ID entry on the Manpower
  // Utilisation Input page. The tight key set is deliberate: it is what keeps a punch's
  // timestamp/location/type tamper-proof, so widening the rule is not the fix either.
  // The audit trigger still records this change (path, before/after, changedKeys); only
  // the actor falls back to "unknown" for these three fields.
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

// ── Audit log ─────────────────────────────────────────────────────────────

/**
 * Recent audit entries, newest first.
 *
 * Deliberately filters ONLY on `atMillis` — the same field it orders by — so Firestore
 * needs no composite index. Collection/user/actor narrowing is done in the page, on an
 * already-bounded result set. Adding a `where` on another field here would require a new
 * index and the page would silently fail until someone created it.
 *
 * Admin-only: firestore.rules restricts audit_log reads to admins.
 */
export async function getAuditLog(fromMillis: number, toMillis: number, max = 500): Promise<AuditEntry[]> {
  const snap = await getDocs(query(
    collection(db, 'audit_log'),
    where('atMillis', '>=', fromMillis),
    where('atMillis', '<=', toMillis),
    orderBy('atMillis', 'desc'),
    limit(max),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditEntry));
}
