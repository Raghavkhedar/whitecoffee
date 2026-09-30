import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { todayDateString, type UserProfile } from '../attendance/attendanceApi';

export interface SubmitRegularizationInput {
  date: string;
  originalStatus: string;
  reason: string;
  /** KM travelled that day — only for roles that earn conveyance; null otherwise. */
  claimedKm: number | null;
}

/**
 * Same document Android writes (RegularizationRequest.toMap() + audit stamp).
 *
 * TODAY is fire-and-forget: the rules always allow a same-day create, and awaiting the server
 * ack would hang offline. A PAST date is different — the rules can refuse it (window closed,
 * month already Settle & Locked), so it is awaited and a denial is thrown as a readable error
 * instead of reporting success for a request that silently never lands (Android does the same).
 */
export async function submitRegularizationRequest(user: UserProfile, input: SubmitRegularizationInput): Promise<void> {
  const docRef = doc(collection(db, 'users', user.uid, 'regularization_requests'));
  const now = Timestamp.now();
  const write = setDoc(docRef, {
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    date: input.date,
    originalStatus: input.originalStatus,
    reason: input.reason,
    status: 'pending',
    approverComment: '',
    approvedStatus: '',
    claimedKm: input.claimedKm,
    submittedAt: now,
    reviewedAt: null,
    lastModifiedBy: auth.currentUser?.uid || user.uid,
    lastModifiedAt: now,
  });
  if (input.date === todayDateString()) {
    write.catch((error) => console.error('Failed to sync regularization request to server', error));
    return;
  }
  try {
    await write;
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') {
      throw new Error('Regularization for past dates is currently closed, or that month has already been settled.');
    }
    throw new Error('Could not submit — check your connection and try again.');
  }
}

// Fails CLOSED on a read error — an unreadable window must never be treated as open,
// mirroring Android's own `.catch { emit(false) }` exactly.
export function subscribeRegularizationWindow(onChange: (open: boolean) => void): () => void {
  const windowRef = doc(db, 'config', 'regularizationWindow');
  return onSnapshot(
    windowRef,
    (snapshot) => {
      onChange(snapshot.exists() ? Boolean(snapshot.data().open) : false);
    },
    (error) => {
      console.error('Regularization window subscription failed', error);
      onChange(false);
    },
  );
}

export async function getAttendanceStatusForDate(uid: string, date: string): Promise<string | null> {
  const statusRef = doc(db, 'users', uid, 'attendance_status', date);
  const snapshot = await getDoc(statusRef);
  if (!snapshot.exists()) return null;
  return (snapshot.data().status as string | undefined) ?? null;
}

// A single equality filter on `date` — deliberately not combined with a second `where`
// on `status`, which would need a composite index declared in firestore.indexes.json (a
// backend change this phase doesn't make). The result set for one date is always tiny, so
// filtering status client-side costs nothing.
export async function hasPendingOrApprovedRequest(uid: string, date: string): Promise<boolean> {
  const regRef = collection(db, 'users', uid, 'regularization_requests');
  const q = query(regRef, where('date', '==', date));
  const snapshot = await getDocs(q);
  return snapshot.docs.some((docSnap) => {
    const status = docSnap.data().status;
    return status === 'pending' || status === 'approved';
  });
}

export async function checkIsHoliday(date: string): Promise<boolean> {
  const holidayRef = doc(db, 'holidays', date);
  const snapshot = await getDoc(holidayRef);
  return snapshot.exists();
}

export interface ExistingRequest {
  status: string; // 'pending' | 'approved' | 'rejected'
  approverComment: string;
}

/**
 * The live request for a date (the active one if any, else the latest) — so the screen shows
 * "pending review" the moment a request is filed (the local write is visible immediately, even
 * offline) instead of offering the button again. Only pending/approved block a new request,
 * matching hasPendingOrApprovedRequest and Android; a rejected one can be re-filed.
 */
export function subscribeRequestForDate(
  uid: string,
  date: string,
  onChange: (request: ExistingRequest | null) => void,
): () => void {
  const q = query(collection(db, 'users', uid, 'regularization_requests'), where('date', '==', date));
  return onSnapshot(
    q,
    (snapshot) => {
      const all = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          status: String(data.status ?? ''),
          approverComment: String(data.approverComment ?? ''),
          submittedAt: (data.submittedAt as Timestamp | undefined)?.toMillis() ?? 0,
        };
      });
      const active = all.find((r) => r.status === 'pending' || r.status === 'approved');
      const latest = active ?? all.sort((a, b) => b.submittedAt - a.submittedAt)[0];
      onChange(latest ? { status: latest.status, approverComment: latest.approverComment } : null);
    },
    (error) => console.error('Regularization request subscription failed', error),
  );
}

export function blocksNewRequest(request: ExistingRequest | null): boolean {
  return request?.status === 'pending' || request?.status === 'approved';
}
