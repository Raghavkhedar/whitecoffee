import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { UserProfile } from '../attendance/attendanceApi';

export interface SubmitRegularizationInput {
  date: string;
  originalStatus: string;
  reason: string;
}

export async function submitRegularizationRequest(user: UserProfile, input: SubmitRegularizationInput): Promise<void> {
  const regRef = collection(db, 'users', user.uid, 'regularization_requests');
  const docRef = doc(regRef); // mints an ID locally — no network round trip
  setDoc(docRef, {
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    date: input.date,
    originalStatus: input.originalStatus,
    reason: input.reason,
    status: 'pending',
    submittedAt: Timestamp.now(),
  }).catch((error) => {
    console.error('Failed to sync regularization request to server', error);
  });
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
