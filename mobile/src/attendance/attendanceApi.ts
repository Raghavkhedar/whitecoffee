import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { OfficeAttendanceEvent, OfficeEventType } from './officeAttendanceState';
import type { OpsAttendanceEvent, OpsEventType } from './opsAttendanceState';

export interface UserProfile {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
}

export interface RecordEventInput {
  type: OfficeEventType;
  latitude: number;
  longitude: number;
  locationName?: string;
}

/**
 * The device-local calendar date, `yyyy-MM-dd` — the single definition of "today" for
 * both the `date` field written on every event and the `where('date', '==', ...)` filter
 * the day's subscription is built from. Exported so callers (AttendanceScreen) can detect
 * a day rollover against the exact same notion of a day, rather than duplicating date math.
 */
export function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function recordOfficeEvent(user: UserProfile, input: RecordEventInput): Promise<void> {
  const attendanceRef = collection(db, 'users', user.uid, 'attendance');
  const docRef = doc(attendanceRef); // mints an ID locally — no network round trip
  setDoc(docRef, {
    userId: user.uid,
    employeeId: user.employeeId,
    userName: user.name,
    date: todayDateString(),
    type: input.type,
    timestamp: Timestamp.now(),
    latitude: input.latitude,
    longitude: input.longitude,
    ...(input.locationName ? { locationName: input.locationName } : {}),
  }).catch((error) => {
    console.error('Failed to sync attendance event to server', error);
  });
}

export function subscribeTodayOfficeEvents(
  uid: string,
  onChange: (events: OfficeAttendanceEvent[]) => void,
): () => void {
  const attendanceRef = collection(db, 'users', uid, 'attendance');
  const q = query(attendanceRef, where('date', '==', todayDateString()), orderBy('timestamp', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const events = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          type: data.type as OfficeEventType,
          timestamp: (data.timestamp as Timestamp).toMillis(),
        };
      });
      onChange(events);
    },
    (error) => {
      console.error('Attendance events subscription failed', error);
    },
  );
}

export interface RecordOpsEventInput {
  type: OpsEventType;
  latitude: number;
  longitude: number;
  siteId?: string;
  siteName?: string;
  marketName?: string;
}

export async function recordOpsEvent(user: UserProfile, input: RecordOpsEventInput): Promise<void> {
  const attendanceRef = collection(db, 'users', user.uid, 'attendance');
  const docRef = doc(attendanceRef); // mints an ID locally — no network round trip
  setDoc(docRef, {
    userId: user.uid,
    employeeId: user.employeeId,
    userName: user.name,
    date: todayDateString(),
    type: input.type,
    timestamp: Timestamp.now(),
    latitude: input.latitude,
    longitude: input.longitude,
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.siteName ? { siteName: input.siteName } : {}),
    ...(input.marketName ? { marketName: input.marketName } : {}),
  }).catch((error) => {
    console.error('Failed to sync attendance event to server', error);
  });
}

export function subscribeTodayOpsEvents(
  uid: string,
  onChange: (events: OpsAttendanceEvent[]) => void,
): () => void {
  const attendanceRef = collection(db, 'users', uid, 'attendance');
  const q = query(attendanceRef, where('date', '==', todayDateString()), orderBy('timestamp', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const events = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          type: data.type as OpsEventType,
          timestamp: (data.timestamp as Timestamp).toMillis(),
        };
      });
      onChange(events);
    },
    (error) => {
      console.error('Attendance events subscription failed', error);
    },
  );
}

export type SalesCommittedPath = 'office' | 'field' | null;

const OFFICE_ONLY_TYPES = new Set(['office_in', 'office_out']);
const FIELD_ONLY_TYPES = new Set(['site_in', 'site_out', 'market_in', 'market_out']);

// One-time read (not a live subscription — this only needs to answer "which flow, if any,
// is already committed today" once, at screen-mount time, before SalesAttendanceScreen
// decides whether to show its chooser or redirect straight into a flow). Checks raw type
// strings against two disjoint sets rather than deriving full office/ops state: both
// subscribeTodayOfficeEvents and subscribeTodayOpsEvents query the SAME collection filtered
// only by `date`, with no `type` filter, matching the office subscription's own established
// shape. That's fine for a role that only ever writes one event-type family. It is NOT fine
// for sales, who may have written either family on a given day — if the caller ran both
// subscriptions and called both derive functions on the same raw list, whichever function's
// switch doesn't recognize the other family's event type (e.g. deriveOpsState seeing an
// office_in doc) falls through with no default case and returns undefined, silently breaking
// the "which flow is open" check. home_in/home_out are deliberately excluded from both sets
// since they're shared gates written by both flows and never distinguish which one is active.
export async function getTodaysSalesCommittedPath(uid: string): Promise<SalesCommittedPath> {
  const attendanceRef = collection(db, 'users', uid, 'attendance');
  const q = query(attendanceRef, where('date', '==', todayDateString()));
  const snapshot = await getDocs(q);
  const types = snapshot.docs.map((docSnap) => docSnap.data().type as string);
  if (types.some((t) => OFFICE_ONLY_TYPES.has(t))) return 'office';
  if (types.some((t) => FIELD_ONLY_TYPES.has(t))) return 'field';
  return null;
}
