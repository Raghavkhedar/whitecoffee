import { addDoc, collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { OfficeAttendanceEvent, OfficeEventType } from './officeAttendanceState';

export interface UserProfile {
  uid: string;
  employeeId: string;
  name: string;
}

export interface RecordEventInput {
  type: OfficeEventType;
  latitude: number;
  longitude: number;
  locationName?: string;
}

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function recordOfficeEvent(user: UserProfile, input: RecordEventInput): Promise<void> {
  const attendanceRef = collection(db, 'users', user.uid, 'attendance');
  await addDoc(attendanceRef, {
    userId: user.uid,
    employeeId: user.employeeId,
    userName: user.name,
    date: todayDateString(),
    type: input.type,
    timestamp: Timestamp.now(),
    latitude: input.latitude,
    longitude: input.longitude,
    ...(input.locationName ? { locationName: input.locationName } : {}),
  });
}

export function subscribeTodayOfficeEvents(
  uid: string,
  onChange: (events: OfficeAttendanceEvent[]) => void,
): () => void {
  const attendanceRef = collection(db, 'users', uid, 'attendance');
  const q = query(attendanceRef, where('date', '==', todayDateString()), orderBy('timestamp', 'asc'));
  return onSnapshot(q, (snapshot) => {
    const events = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        type: data.type as OfficeEventType,
        timestamp: (data.timestamp as Timestamp).toMillis(),
      };
    });
    onChange(events);
  });
}
