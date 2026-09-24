# Mobile Regularization (Phase 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Android's Regularization feature (dispute a day's auto-computed attendance
status) to the Expo/React Native mobile app, scoped to office/admin roles only, including
today's live-derived status and admin-controlled past-date regularization.

**Architecture:** A pure classification module (`regularizationStatus.ts`) ports the exact
office-role scoring rule from `firebase/functions/attendanceRules.js`, driven entirely by
data mobile's Attendance flow already subscribes to. A Firestore layer
(`regularizationApi.ts`) handles the write and the three reads this feature needs (window
flag, a past date's stored status, a duplicate-request check) plus a holiday check. A
single screen (no tabs, no history — matching Android) ties them together, reached from a
new Home card gated identically to the existing Attendance card.

**Tech Stack:** Same Expo/TypeScript/Firebase JS SDK v12 stack as Phase 1/2a. No new
dependencies — `@react-native-community/datetimepicker` is already installed from Phase 2a.

**Spec:** `docs/superpowers/specs/2026-09-24-mobile-regularization-phase2b-design.md`

## Global Constraints

- Office and admin roles only — no `claimedKm`, no operations planned-shift window, no
  settlement-lock check (out of scope per spec).
- No history/My-Submissions view — matches Android's own deliberate choice.
- The app writes `status: 'pending'` and nothing else admin-controlled — never
  `approvedBy`/`approverComment`/`approvedStatus`/`reviewedAt`.
- Every Firestore write is offline-safe: mint the doc ref locally via `doc(collection(...))`
  then `setDoc(...).catch(...)` **without** awaiting the write promise.
- Every `onSnapshot` subscription has an `onError` callback. `subscribeRegularizationWindow`
  fails **closed** (treats a read error as "window closed"), mirroring Android exactly.
- No lookback ceiling on past-date regularization — Android has none; this plan does not
  invent one.
- `npx tsc --noEmit` must stay clean project-wide after every task.

---

### Task 1: Regularization status logic

**Files:**
- Create: `mobile/src/regularization/regularizationStatus.ts`
- Test: `mobile/src/regularization/regularizationStatus.test.ts`

**Interfaces:**
- Consumes: `OfficeAttendanceEvent` type from `mobile/src/attendance/officeAttendanceState.ts`
  (already has `{ type: OfficeEventType; timestamp: number }`, `timestamp` in epoch
  milliseconds).
- Produces: `classify(inMinutes: number, outMinutes: number | null, startMin?: number,
  endMin?: number): 'HalfDay' | 'SL' | 'Present'`, `deriveTodayLiveStatus(events:
  OfficeAttendanceEvent[]): 'HalfDay' | 'SL' | null`, `isSunday(dateStr: string): boolean`,
  `isRestDay(dateStr: string, isHoliday: boolean): boolean` — all exported from
  `mobile/src/regularization/regularizationStatus.ts`. Task 4 imports
  `deriveTodayLiveStatus` and `isRestDay`.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/regularization/regularizationStatus.test.ts`:

```ts
import { classify, deriveTodayLiveStatus, isRestDay, isSunday } from './regularizationStatus';
import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';

// Converts an IST wall-clock time into the epoch-ms timestamp `deriveTodayLiveStatus`
// expects (mirroring how attendanceApi.ts stores `Timestamp.now().toMillis()`). The
// specific calendar date is irrelevant — only the IST time-of-day is being tested.
function epochForIstTime(hour: number, minute: number): number {
  const istMs = Date.UTC(2026, 0, 1, hour, minute, 0);
  return istMs - 5.5 * 60 * 60 * 1000;
}

describe('classify', () => {
  it('scores Present when in on time and out on time', () => {
    expect(classify(10 * 60, 18 * 60)).toBe('Present');
  });

  it('scores HalfDay for any lateness, however small', () => {
    expect(classify(10 * 60 + 1, 18 * 60)).toBe('HalfDay');
  });

  it('scores SL for any early-out, however small, when not late', () => {
    expect(classify(10 * 60, 18 * 60 - 1)).toBe('SL');
  });

  it('HalfDay wins when both late-in and early-out apply', () => {
    expect(classify(10 * 60 + 5, 18 * 60 - 5)).toBe('HalfDay');
  });

  it('scores only late-in when outMinutes is null (still in progress)', () => {
    expect(classify(10 * 60 + 1, null)).toBe('HalfDay');
    expect(classify(10 * 60, null)).toBe('Present');
  });

  it('respects a custom window', () => {
    expect(classify(9 * 60, 17 * 60, 9 * 60, 17 * 60)).toBe('Present');
    expect(classify(9 * 60 + 1, 17 * 60, 9 * 60, 17 * 60)).toBe('HalfDay');
  });
});

describe('deriveTodayLiveStatus', () => {
  it('returns null when there are no office_in events yet', () => {
    const events: OfficeAttendanceEvent[] = [{ type: 'home_in', timestamp: epochForIstTime(9, 0) }];
    expect(deriveTodayLiveStatus(events)).toBeNull();
  });

  it('returns null when in and out are both on time', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 0) },
      { type: 'office_out', timestamp: epochForIstTime(18, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBeNull();
  });

  it('returns HalfDay for a late first office_in', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 30) },
      { type: 'office_out', timestamp: epochForIstTime(18, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBe('HalfDay');
  });

  it('returns SL for an early last office_out with an on-time office_in', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 0) },
      { type: 'office_out', timestamp: epochForIstTime(17, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBe('SL');
  });

  it('scores only late-in when checked in but not yet checked out', () => {
    const events: OfficeAttendanceEvent[] = [{ type: 'office_in', timestamp: epochForIstTime(10, 15) }];
    expect(deriveTodayLiveStatus(events)).toBe('HalfDay');
  });

  it('uses the FIRST office_in and LAST office_out when there are multiple', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 0) },
      { type: 'office_out', timestamp: epochForIstTime(13, 0) },
      { type: 'office_in', timestamp: epochForIstTime(14, 0) },
      { type: 'office_out', timestamp: epochForIstTime(18, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBeNull();
  });
});

describe('isSunday', () => {
  it('is true for a known Sunday', () => {
    expect(isSunday('2026-09-27')).toBe(true);
  });

  it('is false for a known weekday', () => {
    expect(isSunday('2026-09-24')).toBe(false);
  });
});

describe('isRestDay', () => {
  it('is true on a Sunday regardless of the holiday flag', () => {
    expect(isRestDay('2026-09-27', false)).toBe(true);
  });

  it('is true on a weekday flagged as a holiday', () => {
    expect(isRestDay('2026-09-24', true)).toBe(true);
  });

  it('is false on an ordinary weekday', () => {
    expect(isRestDay('2026-09-24', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest regularizationStatus`
Expected: FAIL — `Cannot find module './regularizationStatus'`

- [ ] **Step 3: Write the implementation**

Create `mobile/src/regularization/regularizationStatus.ts`:

```ts
import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';

// Ported from firebase/functions/attendanceRules.js — office/admin's fixed-window branch
// only. Operations' planned-shift window is out of scope for this phase (mobile has no
// operations attendance flow yet); see the Phase 2b spec's "Scope decisions" section.
const OFFICE_START_MIN = 10 * 60; // 10:00
const OFFICE_END_MIN = 18 * 60; // 18:00

/**
 * Late-in and early-out are graded independently, zero grace on either side — HalfDay
 * wins when both apply. Mirrors attendanceRules.js's `classify` exactly (same signature,
 * same null-outMinutes semantics for a day still in progress).
 */
export function classify(
  inMinutes: number,
  outMinutes: number | null,
  startMin: number = OFFICE_START_MIN,
  endMin: number = OFFICE_END_MIN,
): 'HalfDay' | 'SL' | 'Present' {
  const late = Math.max(0, inMinutes - startMin);
  const earlyOut = outMinutes == null ? 0 : Math.max(0, endMin - outMinutes);
  if (late > 0) return 'HalfDay';
  if (earlyOut > 0) return 'SL';
  return 'Present';
}

// Epoch ms (UTC) → IST minutes-of-day, matching firebase/functions/nightlyScoring.js's
// getHourIST/getMinuteIST (shift by +5:30, read the UTC wall-clock components).
function istMinutesOfDay(epochMs: number): number {
  const istMs = epochMs + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Today's live-derived status from the same event stream Attendance already subscribes
 * to — first office_in, last office_out (events arrive pre-sorted ascending by timestamp
 * from subscribeTodayOfficeEvents). Returns null when there's nothing to flag: no
 * office_in yet, or the day classifies as Present — this is a deliberate subset of
 * classify()'s output, matching Android's own live-preview semantics exactly.
 */
export function deriveTodayLiveStatus(events: OfficeAttendanceEvent[]): 'HalfDay' | 'SL' | null {
  const checkIns = events.filter((e) => e.type === 'office_in');
  const checkOuts = events.filter((e) => e.type === 'office_out');
  if (checkIns.length === 0) return null;
  const inMinutes = istMinutesOfDay(checkIns[0].timestamp);
  const outMinutes = checkOuts.length > 0 ? istMinutesOfDay(checkOuts[checkOuts.length - 1].timestamp) : null;
  const status = classify(inMinutes, outMinutes);
  return status === 'Present' ? null : status;
}

// Mirrors firestore.rules's isSundayDate — UTC day-of-week on a "yyyy-mm-ddT00:00:00Z"
// string, never a bare `new Date(dateStr)`/`getDay()` (that reads the LOCAL day, which
// drifts from IST near midnight on a device in a different timezone).
export function isSunday(dateStr: string): boolean {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 0;
}

// Mirrors firestore.rules's isRestDate (Sunday OR a holidays/{date} doc). This module has
// no Firestore access, so the holiday flag is passed in by the caller — same split as
// attendanceRules.js's own resolveRestDayType.
export function isRestDay(dateStr: string, isHoliday: boolean): boolean {
  return isSunday(dateStr) || isHoliday;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest regularizationStatus`
Expected: PASS, all tests green.

- [ ] **Step 5: Verify the whole project still type-checks**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/regularization/regularizationStatus.ts mobile/src/regularization/regularizationStatus.test.ts
git commit -m "feat(mobile): add regularization status derivation logic with tests"
```

---

### Task 2: Regularization Firestore API

**Files:**
- Create: `mobile/src/regularization/regularizationApi.ts`

**Interfaces:**
- Consumes: `db` from `mobile/src/firebase/config.ts`; `UserProfile` from
  `mobile/src/attendance/attendanceApi.ts`.
- Produces: `SubmitRegularizationInput` (`{ date: string; originalStatus: string; reason:
  string }`), `submitRegularizationRequest(user: UserProfile, input:
  SubmitRegularizationInput): Promise<void>`, `subscribeRegularizationWindow(onChange:
  (open: boolean) => void): () => void`, `getAttendanceStatusForDate(uid: string, date:
  string): Promise<string | null>`, `hasPendingOrApprovedRequest(uid: string, date:
  string): Promise<boolean>`, `checkIsHoliday(date: string): Promise<boolean>` — all
  exported from `mobile/src/regularization/regularizationApi.ts`. Task 4 imports all five
  functions and the input type.

- [ ] **Step 1: Write the Firestore read/write functions**

Create `mobile/src/regularization/regularizationApi.ts`:

```ts
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/regularization/regularizationApi.ts
git commit -m "feat(mobile): add Firestore regularization read/write API"
```

---

### Task 3: Navigation and Home card

**Files:**
- Modify: `mobile/src/screens/HomeScreen.tsx`
- Modify: `mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `HomeCard` from `mobile/src/components/HomeCard.tsx` (unchanged from Phase 2a).
- Produces: `RootStackParamList` extended with `Regularization: undefined`. Task 4's
  `RegularizationScreen` is registered into `RootNavigator`'s stack by this task and
  imported from `../screens/RegularizationScreen` — that file does not exist yet (created
  in Task 4). This is the same intentional, documented sequencing already used in Phase 1
  (Task 6/7) and Phase 2a (Task 3/4): `npx tsc --noEmit` will report exactly one error,
  "Cannot find module '../screens/RegularizationScreen'", until Task 4 lands. That is
  expected; do not work around it.

- [ ] **Step 1: Add the Regularization card to Home**

Replace the full contents of `mobile/src/screens/HomeScreen.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import HomeCard from '../components/HomeCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  // Phase 1 ships the OFFICE attendance flow only. `admin` shares office's attendance
  // event types (see firebase/functions/roleCapabilities.js); operations and sales punch
  // site_in/market_in, so office-shaped punches from this app would be invisible to their
  // payroll scoring. Anything else — including an unknown role — is gated out.
  // Regularization derives its live status from these same office_in/office_out events
  // (see regularizationStatus.ts), so it shares this exact gate.
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';

  return (
    <View style={styles.screen}>
      <TopBar />
      <View style={styles.container}>
        <FadeInView style={styles.cards}>
          {canUseOfficeAttendance ? (
            <>
              <HomeCard icon="time-outline" label="Attendance" onPress={() => navigation.navigate('Attendance')} />
              <HomeCard
                icon="alert-circle-outline"
                label="Regularization"
                onPress={() => navigation.navigate('Regularization')}
              />
            </>
          ) : (
            <Text style={styles.unavailable}>
              Attendance isn't available for your role on this app yet.
            </Text>
          )}
          <HomeCard icon="calendar-outline" label="Leave" onPress={() => navigation.navigate('Leave')} />
        </FadeInView>
        <AnimatedPressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  container: { flex: 1, padding: 24 },
  cards: { gap: 16 },
  unavailable: { fontSize: 15, color: Colors.textMuted, lineHeight: 22 },
  logout: { marginTop: 'auto', padding: 16, alignItems: 'center' },
  logoutText: { color: Colors.textMuted },
});
```

- [ ] **Step 2: Register the Regularization route**

Replace the full contents of `mobile/src/navigation/RootNavigator.tsx`:

```tsx
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import LeaveScreen from '../screens/LeaveScreen';
import RegularizationScreen from '../screens/RegularizationScreen';

export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
  Regularization: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Attendance" component={AttendanceScreen} />
          <Stack.Screen name="Leave" component={LeaveScreen} />
          <Stack.Screen name="Regularization" component={RegularizationScreen} />
        </Stack.Navigator>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
```

- [ ] **Step 3: Verify the expected single error**

Run: `cd mobile && npx tsc --noEmit`
Expected: exactly one error — `Cannot find module '../screens/RegularizationScreen'` (or
equivalent) in `RootNavigator.tsx`. No other errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/HomeScreen.tsx mobile/src/navigation/RootNavigator.tsx
git commit -m "feat(mobile): add Regularization route and Home card"
```

---

### Task 4: Regularization screen

**Files:**
- Create: `mobile/src/screens/RegularizationScreen.tsx`

**Interfaces:**
- Consumes: `useAuth` from `mobile/src/auth/AuthContext.tsx`; `subscribeTodayOfficeEvents`,
  `todayDateString` from `mobile/src/attendance/attendanceApi.ts` (Phase 1);
  `OfficeAttendanceEvent` type from `mobile/src/attendance/officeAttendanceState.ts`;
  `deriveTodayLiveStatus`, `isRestDay` from `mobile/src/regularization/regularizationStatus.ts`
  (Task 1); `submitRegularizationRequest`, `subscribeRegularizationWindow`,
  `getAttendanceStatusForDate`, `hasPendingOrApprovedRequest`, `checkIsHoliday` from
  `mobile/src/regularization/regularizationApi.ts` (Task 2); `formatDateString` from
  `mobile/src/leave/leaveApi.ts` (Phase 2a — reused rather than duplicating date-format
  logic); `TopBar` from `mobile/src/components/TopBar.tsx`; `FadeInView`,
  `AnimatedPressable`, `AnimatedModalCard` from `mobile/src/components/`; `Colors` from
  `mobile/src/theme/colors.ts`; `RootStackParamList` from
  `mobile/src/navigation/RootNavigator.tsx` (Task 3).
- Produces: default-exported `RegularizationScreen`, registered into `RootNavigator`'s
  stack by Task 3.

- [ ] **Step 1: Write the Regularization screen**

Create `mobile/src/screens/RegularizationScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { subscribeTodayOfficeEvents, todayDateString } from '../attendance/attendanceApi';
import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';
import { deriveTodayLiveStatus, isRestDay } from '../regularization/regularizationStatus';
import {
  submitRegularizationRequest,
  subscribeRegularizationWindow,
  getAttendanceStatusForDate,
  hasPendingOrApprovedRequest,
  checkIsHoliday,
} from '../regularization/regularizationApi';
import { formatDateString } from '../leave/leaveApi';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import AnimatedModalCard from '../components/AnimatedModalCard';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Regularization'>;

const STATUS_LABEL: Record<string, string> = {
  HalfDay: 'Half Day',
  SL: 'Short Leave',
  Present: 'Present',
  Absent: 'Absent',
  LNF: 'Late / No Follow-up',
  Unmarked: 'Unmarked',
};

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

export default function RegularizationScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<OfficeAttendanceEvent[]>([]);
  const [windowOpen, setWindowOpen] = useState(false);

  const [pastPickerVisible, setPastPickerVisible] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date>(yesterday());
  const [pastStatus, setPastStatus] = useState<string | null>(null);
  const [pastStatusLoading, setPastStatusLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState('');
  const [modalOriginalStatus, setModalOriginalStatus] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeTodayOfficeEvents(user.uid, setEvents);
  }, [user]);

  useEffect(() => {
    return subscribeRegularizationWindow(setWindowOpen);
  }, []);

  const todayLiveStatus = deriveTodayLiveStatus(events);

  function openTodayModal() {
    if (!todayLiveStatus) return;
    setFormError(null);
    setReason('');
    setModalDate(todayDateString());
    setModalOriginalStatus(todayLiveStatus);
    setModalVisible(true);
  }

  async function handlePickPastDate(_: DateTimePickerEvent, date?: Date) {
    if (!date || !user) return;
    setPickedDate(date);
    setPastStatusLoading(true);
    try {
      const status = await getAttendanceStatusForDate(user.uid, formatDateString(date));
      setPastStatus(status ?? 'Unmarked');
    } finally {
      setPastStatusLoading(false);
    }
  }

  function openPastModal() {
    if (!pastStatus) return;
    setFormError(null);
    setReason('');
    setModalDate(formatDateString(pickedDate));
    setModalOriginalStatus(pastStatus);
    setModalVisible(true);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!reason.trim()) {
      setFormError('A reason is required.');
      return;
    }
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      if (await hasPendingOrApprovedRequest(user.uid, modalDate)) {
        setFormError('You already have a pending or approved request for this date.');
        return;
      }
      if (isRestDay(modalDate, await checkIsHoliday(modalDate))) {
        setFormError('This date is a rest day and cannot be regularized.');
        return;
      }
      await submitRegularizationRequest(user, {
        date: modalDate,
        originalStatus: modalOriginalStatus,
        reason: reason.trim(),
      });
      setModalVisible(false);
      setReason('');
    } finally {
      setSubmitting(false);
    }
  }

  const pickerDisplay = Platform.OS === 'ios' ? 'compact' : 'default';

  return (
    <View style={styles.screen}>
      <TopBar title="Regularization" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <FadeInView style={styles.card}>
          <Text style={styles.label}>Today</Text>
          {todayLiveStatus ? (
            <>
              <Text style={styles.state}>
                Today's status looks like: {STATUS_LABEL[todayLiveStatus] ?? todayLiveStatus}
              </Text>
              <AnimatedPressable style={styles.button} onPress={openTodayModal}>
                <Text style={styles.buttonText}>Request Correction</Text>
              </AnimatedPressable>
            </>
          ) : (
            <Text style={styles.muted}>No issues with today's attendance so far.</Text>
          )}
        </FadeInView>

        {windowOpen && (
          <FadeInView style={styles.card}>
            <Text style={styles.label}>Another date</Text>
            {pastPickerVisible ? (
              <>
                <DateTimePicker
                  value={pickedDate}
                  mode="date"
                  display={pickerDisplay}
                  maximumDate={yesterday()}
                  onChange={handlePickPastDate}
                />
                {pastStatusLoading && <Text style={styles.muted}>Checking that date…</Text>}
                {!pastStatusLoading && pastStatus && (
                  <>
                    <Text style={styles.state}>
                      {formatDateString(pickedDate)} status: {STATUS_LABEL[pastStatus] ?? pastStatus}
                    </Text>
                    <AnimatedPressable style={styles.button} onPress={openPastModal}>
                      <Text style={styles.buttonText}>Request Correction</Text>
                    </AnimatedPressable>
                  </>
                )}
              </>
            ) : (
              <AnimatedPressable style={styles.button} onPress={() => setPastPickerVisible(true)}>
                <Text style={styles.buttonText}>Request for Another Date</Text>
              </AnimatedPressable>
            )}
          </FadeInView>
        )}
      </ScrollView>

      <AnimatedModalCard visible={modalVisible} style={styles.modalCard}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text style={styles.modalTitle}>Request Correction</Text>
          <Text style={styles.modalBody}>
            {modalDate} — {STATUS_LABEL[modalOriginalStatus] ?? modalOriginalStatus}
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Reason"
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={3}
            value={reason}
            onChangeText={setReason}
          />
          {formError && <Text style={styles.error}>{formError}</Text>}
          <AnimatedPressable style={styles.button} disabled={submitting} onPress={handleSubmit}>
            <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Submit Request'}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.buttonSecondary} onPress={() => setModalVisible(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </AnimatedPressable>
        </KeyboardAvoidingView>
      </AnimatedModalCard>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  content: { padding: 24, gap: 16 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 10,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  state: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  muted: { fontSize: 14, color: Colors.textMuted },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonSecondary: { backgroundColor: Colors.textMuted, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '600' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    gap: 12,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 6,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  modalBody: { fontSize: 14, color: Colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 12,
    padding: 14,
    color: Colors.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  error: { color: Colors.statusRejectedFg, fontSize: 13 },
});
```

- [ ] **Step 2: Verify the whole project type-checks**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors. This is the point where `RootNavigator.tsx`'s import of
`RegularizationScreen` (Task 3) finally resolves.

- [ ] **Step 3: Run the full test suite**

Run: `cd mobile && npx jest`
Expected: all tests pass (Phase 1's suite, Task 1 of Phase 2a's leave-coverage suite, and
this plan's Task 1 regularization-status suite). No new test file is added in this task —
it's UI/Firestore code, consistent with `LeaveScreen.tsx`/`leaveApi.ts` having none either.

- [ ] **Step 4: Manual device walkthrough**

No simulator/device is available in this environment — do full static verification (steps
2-3 above) and note in your report that the live walkthrough could not be performed here.
When it is run on a real device, it should cover:

1. Check in late (or check out early) via the Attendance flow, then open Regularization
   from Home and confirm the flagged status matches (Half Day for late-in, Short Leave for
   early-out-only).
2. Submit a correction for today; confirm the resulting Firestore document under
   `/users/{uid}/regularization_requests/` matches Android's field shape (no `claimedKm`,
   `status: 'pending'`, no admin fields).
3. Try submitting a second request for the same date; confirm the client-side duplicate
   check blocks it with a message, before any Firestore write happens.
4. From the admin portal, toggle `config/regularizationWindow.open` on; confirm the
   "Request for Another Date" button appears on the Regularization screen (and disappears
   again when toggled off).
5. With the window open, pick a past Sunday or a holiday date; confirm the rest-day check
   blocks submission with a message.
6. Pick an ordinary past date with an existing `attendance_status` doc; confirm its stored
   status displays correctly and a correction can be submitted for it.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/RegularizationScreen.tsx
git commit -m "feat(mobile): add Regularization screen with today and past-date flows"
```
