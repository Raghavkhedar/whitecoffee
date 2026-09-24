import { collection, doc, onSnapshot, orderBy, query, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { UserProfile } from '../attendance/attendanceApi';

export interface LeaveRequest {
  id: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  joiningDate: string;
  emergencyContact: string;
  placeOfVisit: string;
  reason: string;
  status: string;
  approvedDates: string[];
  cancelledDates: string[];
  submittedAt: number;
}

export interface SubmitLeaveInput {
  fromDate: string;
  toDate: string;
  totalDays: number;
  joiningDate: string;
  emergencyContact: string;
  placeOfVisit: string;
  reason: string;
}

// Local-time yyyy-MM-dd, matching attendanceApi.ts's todayDateString convention — never
// toISOString(), which would misdate a selection near a UTC day boundary.
export function formatDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function submitLeaveRequest(user: UserProfile, input: SubmitLeaveInput): Promise<void> {
  const leaveRef = collection(db, 'users', user.uid, 'leave_requests');
  const docRef = doc(leaveRef); // mints an ID locally — no network round trip
  setDoc(docRef, {
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    leaveType: '',
    fromDate: input.fromDate,
    toDate: input.toDate,
    totalDays: input.totalDays,
    joiningDate: input.joiningDate,
    emergencyContact: input.emergencyContact,
    placeOfVisit: input.placeOfVisit,
    reason: input.reason,
    status: 'pending',
    approvedDates: [],
    cancelledDates: [],
    submittedAt: Timestamp.now(),
  }).catch((error) => {
    console.error('Failed to sync leave request to server', error);
  });
}

export function subscribeMyLeaveRequests(
  uid: string,
  onChange: (requests: LeaveRequest[]) => void,
): () => void {
  const leaveRef = collection(db, 'users', uid, 'leave_requests');
  const q = query(leaveRef, orderBy('submittedAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const requests = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          fromDate: data.fromDate,
          toDate: data.toDate,
          totalDays: data.totalDays,
          joiningDate: data.joiningDate,
          emergencyContact: data.emergencyContact,
          placeOfVisit: data.placeOfVisit,
          reason: data.reason,
          status: data.status,
          approvedDates: data.approvedDates ?? [],
          cancelledDates: data.cancelledDates ?? [],
          submittedAt: data.submittedAt instanceof Timestamp ? data.submittedAt.toMillis() : 0,
        };
      });
      onChange(requests);
    },
    (error) => {
      console.error('Leave requests subscription failed', error);
    },
  );
}
