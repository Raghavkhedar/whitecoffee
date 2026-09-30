import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { buildPunchPayload, istDateString } from './punchPayload';
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
  isMockLocation: boolean;
  locationName?: string;
}

/**
 * Today's IST calendar date, `yyyy-MM-dd` — the single definition of "today" for both the
 * `date` field written on every event and the `where('date', '==', ...)` filter the day's
 * subscription is built from. IST, not the device zone: see istDateString. Exported so callers
 * (AttendanceScreen) can detect a day rollover against the exact same notion of a day.
 */
export function todayDateString(): string {
  return istDateString(Date.now());
}

// Fire-and-forget, like Android: the doc id is minted locally and the write is NOT awaited —
// awaiting the server ack would hang the punch offline.
function writePunch(user: UserProfile, fields: Parameters<typeof buildPunchPayload>[1]): void {
  const docRef = doc(collection(db, 'users', user.uid, 'attendance'));
  const now = Timestamp.now();
  const actorUid = auth.currentUser?.uid || user.uid;
  const payload = buildPunchPayload(user, fields, istDateString(now.toMillis()), now, actorUid);
  setDoc(docRef, payload).catch((error) => {
    console.error('Failed to sync attendance event to server', error);
  });
}

export async function recordOfficeEvent(user: UserProfile, input: RecordEventInput): Promise<void> {
  writePunch(user, input);
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
  isMockLocation: boolean;
  siteId?: string;
  siteName?: string;
  marketName?: string;
}

export async function recordOpsEvent(user: UserProfile, input: RecordOpsEventInput): Promise<void> {
  writePunch(user, input);
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
