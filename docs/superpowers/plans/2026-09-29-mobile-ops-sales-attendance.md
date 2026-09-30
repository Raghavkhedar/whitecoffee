# Mobile Operations & Sales Attendance (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Android's operations attendance flow (site/market GPS check-in cycle) and
sales's office-vs-site chooser to the mobile app, so operations and sales employees can use
Attendance from mobile for the first time.

**Architecture:** A new pure state-machine module (`opsAttendanceState.ts`, TDD'd, mirrors
the existing `officeAttendanceState.ts`) drives a new `OperationsAttendanceScreen`. A new
`SalesAttendanceScreen` does a one-time Firestore read on mount to detect whether the
employee has already committed to an office or field day today, and routes straight into the
matching screen — showing its own two-card chooser only when nothing is committed yet. Both
new screens reuse the existing `attendanceApi.ts` module, `useLocation.ts`, and
`AnimatedModalCard` exactly as the existing office screen does. `HomeScreen`'s Attendance
card becomes role-routed instead of hardcoded to the office route.

**Tech Stack:** Same as every existing mobile phase — Expo, TypeScript, Firebase JS SDK
(`firebase/firestore`), React Navigation. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-mobile-ops-sales-attendance-design.md`

## Global Constraints

- No Firestore rules changes — `validPunchType` already admits every event type this phase
  writes (verified in the spec).
- No site picker, no geofencing — free-text Site Name (required) + optional Site ID for
  site check-in; free-text Market Name (required) for market check-in. Matches Android
  exactly (`android/CLAUDE.md` decisions #14, #18).
- Exact Firestore field names: `siteId`, `siteName` (site events only), `marketName`
  (market events only) — alongside the existing `userId`/`employeeId`/`userName`/`date`/
  `type`/`timestamp`/`latitude`/`longitude` fields every attendance event already carries.
- Regularization, conveyance, categories, manpower reports, OT/shortage — **not** touched by
  this plan (see spec's "Out of scope").
- Every write stays offline-safe: `setDoc(...).catch(...)`, never awaited on the network ack
  (matches every existing attendance/submission write in this app).
- `npx tsc --noEmit` must stay clean and `npm test` must stay green after every task.

---

## Task 1: Pure operations attendance state machine

**Files:**
- Create: `mobile/src/attendance/opsAttendanceState.ts`
- Test: `mobile/src/attendance/opsAttendanceState.test.ts`

**Interfaces:**
- Produces: `OpsEventType` (`'home_in' | 'home_out' | 'site_in' | 'site_out' | 'market_in' | 'market_out'`),
  `OpsAttendanceEvent` (`{ type: OpsEventType; timestamp: number }`),
  `OpsState` (`'NoRecord' | 'HomeCheckedIn' | 'SiteCheckedIn' | 'MarketCheckedIn' | 'DayComplete'`),
  `deriveOpsState(events: OpsAttendanceEvent[]): OpsState`,
  `isOpsEventAllowed(state: OpsState, event: OpsEventType): boolean`. Task 2 and Task 3
  import all five names from this file.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/attendance/opsAttendanceState.test.ts`:

```ts
import { deriveOpsState, isOpsEventAllowed, type OpsAttendanceEvent } from './opsAttendanceState';

function ev(type: OpsAttendanceEvent['type'], timestamp: number): OpsAttendanceEvent {
  return { type, timestamp };
}

describe('deriveOpsState', () => {
  it('is NoRecord with no events', () => {
    expect(deriveOpsState([])).toBe('NoRecord');
  });

  it('is HomeCheckedIn after home_in', () => {
    expect(deriveOpsState([ev('home_in', 1)])).toBe('HomeCheckedIn');
  });

  it('is SiteCheckedIn after site_in', () => {
    expect(deriveOpsState([ev('home_in', 1), ev('site_in', 2)])).toBe('SiteCheckedIn');
  });

  it('is HomeCheckedIn after site_out (cycles back)', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('site_in', 2), ev('site_out', 3)]),
    ).toBe('HomeCheckedIn');
  });

  it('is MarketCheckedIn after market_in from HomeCheckedIn', () => {
    expect(deriveOpsState([ev('home_in', 1), ev('market_in', 2)])).toBe('MarketCheckedIn');
  });

  it('is MarketCheckedIn after market_in directly from SiteCheckedIn', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('site_in', 2), ev('market_in', 3)]),
    ).toBe('MarketCheckedIn');
  });

  it('is HomeCheckedIn after market_out (cycles back)', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('market_in', 2), ev('market_out', 3)]),
    ).toBe('HomeCheckedIn');
  });

  it('is SiteCheckedIn again after a second site_in (multi-cycle)', () => {
    expect(
      deriveOpsState([
        ev('home_in', 1),
        ev('site_in', 2),
        ev('site_out', 3),
        ev('site_in', 4),
      ]),
    ).toBe('SiteCheckedIn');
  });

  it('is DayComplete after home_out', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('site_in', 2), ev('site_out', 3), ev('home_out', 4)]),
    ).toBe('DayComplete');
  });

  it('stays DayComplete even if a stray event follows home_out (terminal guard)', () => {
    expect(
      deriveOpsState([
        ev('home_in', 1),
        ev('site_in', 2),
        ev('site_out', 3),
        ev('home_out', 4),
        ev('site_in', 5), // stray/out-of-order event — must not reopen the day
      ]),
    ).toBe('DayComplete');
  });
});

describe('isOpsEventAllowed', () => {
  it('allows home_in only from NoRecord', () => {
    expect(isOpsEventAllowed('NoRecord', 'home_in')).toBe(true);
    expect(isOpsEventAllowed('HomeCheckedIn', 'home_in')).toBe(false);
    expect(isOpsEventAllowed('SiteCheckedIn', 'home_in')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'home_in')).toBe(false);
    expect(isOpsEventAllowed('DayComplete', 'home_in')).toBe(false);
  });

  it('allows home_out only from HomeCheckedIn', () => {
    expect(isOpsEventAllowed('HomeCheckedIn', 'home_out')).toBe(true);
    expect(isOpsEventAllowed('SiteCheckedIn', 'home_out')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'home_out')).toBe(false);
    expect(isOpsEventAllowed('NoRecord', 'home_out')).toBe(false);
  });

  it('allows site_in only from HomeCheckedIn', () => {
    expect(isOpsEventAllowed('HomeCheckedIn', 'site_in')).toBe(true);
    expect(isOpsEventAllowed('SiteCheckedIn', 'site_in')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'site_in')).toBe(false);
    expect(isOpsEventAllowed('NoRecord', 'site_in')).toBe(false);
  });

  it('allows site_out only from SiteCheckedIn', () => {
    expect(isOpsEventAllowed('SiteCheckedIn', 'site_out')).toBe(true);
    expect(isOpsEventAllowed('HomeCheckedIn', 'site_out')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'site_out')).toBe(false);
  });

  it('allows market_in from both HomeCheckedIn and SiteCheckedIn', () => {
    expect(isOpsEventAllowed('HomeCheckedIn', 'market_in')).toBe(true);
    expect(isOpsEventAllowed('SiteCheckedIn', 'market_in')).toBe(true);
    expect(isOpsEventAllowed('MarketCheckedIn', 'market_in')).toBe(false);
    expect(isOpsEventAllowed('NoRecord', 'market_in')).toBe(false);
  });

  it('allows market_out only from MarketCheckedIn', () => {
    expect(isOpsEventAllowed('MarketCheckedIn', 'market_out')).toBe(true);
    expect(isOpsEventAllowed('HomeCheckedIn', 'market_out')).toBe(false);
    expect(isOpsEventAllowed('SiteCheckedIn', 'market_out')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest src/attendance/opsAttendanceState.test.ts`
Expected: FAIL — `Cannot find module './opsAttendanceState'`

- [ ] **Step 3: Write the implementation**

Create `mobile/src/attendance/opsAttendanceState.ts`:

```ts
export type OpsEventType = 'home_in' | 'home_out' | 'site_in' | 'site_out' | 'market_in' | 'market_out';

export interface OpsAttendanceEvent {
  type: OpsEventType;
  timestamp: number;
}

export type OpsState = 'NoRecord' | 'HomeCheckedIn' | 'SiteCheckedIn' | 'MarketCheckedIn' | 'DayComplete';

// Ported from Android's `deriveAttendanceState`/`isEventAllowed`
// (android/app/src/main/java/com/raghav/whitecoffee/data/model/AttendanceRecord.kt),
// verified directly against source, not paraphrase. `home_out` is TERMINAL — checked across
// the whole event list, same reasoning as officeAttendanceState.ts's identical guard: a
// stray/out-of-order event after home_out must not reopen the day.
export function deriveOpsState(events: OpsAttendanceEvent[]): OpsState {
  if (events.length === 0) return 'NoRecord';
  if (events.some((e) => e.type === 'home_out')) return 'DayComplete';
  const last = events[events.length - 1];
  switch (last.type) {
    case 'home_in':
      return 'HomeCheckedIn';
    case 'home_out':
      return 'DayComplete';
    case 'site_in':
      return 'SiteCheckedIn';
    case 'site_out':
      return 'HomeCheckedIn';
    case 'market_in':
      return 'MarketCheckedIn';
    case 'market_out':
      return 'HomeCheckedIn';
  }
}

// market_in is legal from BOTH HomeCheckedIn and SiteCheckedIn — verified directly against
// Android's isEventAllowed, which permits the same. No auto-recording of an implicit
// site_out happens; a market_in fired while SiteCheckedIn is a direct transition, exactly
// mirroring Android's own (slightly quirky) behavior rather than "fixing" it.
export function isOpsEventAllowed(state: OpsState, type: OpsEventType): boolean {
  switch (type) {
    case 'home_in':
      return state === 'NoRecord';
    case 'home_out':
      return state === 'HomeCheckedIn';
    case 'site_in':
      return state === 'HomeCheckedIn';
    case 'site_out':
      return state === 'SiteCheckedIn';
    case 'market_in':
      return state === 'HomeCheckedIn' || state === 'SiteCheckedIn';
    case 'market_out':
      return state === 'MarketCheckedIn';
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest src/attendance/opsAttendanceState.test.ts`
Expected: PASS, 16 tests

- [ ] **Step 5: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Commit**

```bash
git add mobile/src/attendance/opsAttendanceState.ts mobile/src/attendance/opsAttendanceState.test.ts
git commit -m "feat(mobile): add operations attendance state machine with tests"
```

---

## Task 2: Firestore API — record/subscribe ops events, detect sales' committed path

**Files:**
- Modify: `mobile/src/attendance/attendanceApi.ts`

**Interfaces:**
- Consumes: `OpsEventType`, `OpsAttendanceEvent` from `./opsAttendanceState` (Task 1).
  `UserProfile` (already exported from this file).
- Produces: `RecordOpsEventInput` (`{ type: OpsEventType; latitude: number; longitude:
  number; siteId?: string; siteName?: string; marketName?: string }`),
  `recordOpsEvent(user: UserProfile, input: RecordOpsEventInput): Promise<void>`,
  `subscribeTodayOpsEvents(uid: string, onChange: (events: OpsAttendanceEvent[]) => void): () => void`,
  `SalesCommittedPath` (`'office' | 'field' | null`),
  `getTodaysSalesCommittedPath(uid: string): Promise<SalesCommittedPath>`. Task 3 imports
  `recordOpsEvent`/`subscribeTodayOpsEvents`; Task 4 imports `getTodaysSalesCommittedPath`
  and `SalesCommittedPath`.

**Why `getTodaysSalesCommittedPath` exists (read before implementing):** `subscribeTodayOfficeEvents`
and the new `subscribeTodayOpsEvents` both query the *same* `users/{uid}/attendance`
collection filtered only by `date`, with no `type` filter — matching the existing office
subscription's own established shape exactly (see spec). That's fine for a role that only
ever writes one event-type family (office, or operations). It is **not** fine for sales,
who may have written either family on a given day: if `SalesAttendanceScreen` ran both
subscriptions and called both `deriveOfficeState` and `deriveOpsState` on the same raw
list, whichever function's `switch` doesn't recognize the other family's event type (e.g.
`deriveOpsState` seeing an `office_in` doc) falls through **with no `default` case** and
returns `undefined` — silently breaking the "which flow is open" check. `getTodaysSalesCommittedPath`
sidesteps this by checking raw `type` strings against two disjoint, exclusive sets
(`office_in`/`office_out` vs. `site_in`/`site_out`/`market_in`/`market_out`) instead of
deriving full state — `home_in`/`home_out` are deliberately excluded from both sets since
they're shared gates written by both flows and never distinguish which one is active.

- [ ] **Step 1: Add the new imports and types**

In `mobile/src/attendance/attendanceApi.ts`, change the top imports and add the ops import:

```ts
import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { OfficeAttendanceEvent, OfficeEventType } from './officeAttendanceState';
import type { OpsAttendanceEvent, OpsEventType } from './opsAttendanceState';
```

(`getDocs` is the only new Firestore import — everything else in that line already exists.)

- [ ] **Step 2: Add `recordOpsEvent` and `subscribeTodayOpsEvents`**

Append to `mobile/src/attendance/attendanceApi.ts`, after the existing
`subscribeTodayOfficeEvents` function:

```ts
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
```

- [ ] **Step 3: Add `getTodaysSalesCommittedPath`**

Append below `subscribeTodayOpsEvents`:

```ts
export type SalesCommittedPath = 'office' | 'field' | null;

const OFFICE_ONLY_TYPES = new Set(['office_in', 'office_out']);
const FIELD_ONLY_TYPES = new Set(['site_in', 'site_out', 'market_in', 'market_out']);

// One-time read (not a live subscription — this only needs to answer "which flow, if any,
// is already committed today" once, at screen-mount time, before SalesAttendanceScreen
// decides whether to show its chooser or redirect straight into a flow). See the module-level
// comment above `subscribeTodayOpsEvents` for why this checks raw type strings against two
// disjoint sets rather than deriving full office/ops state.
export async function getTodaysSalesCommittedPath(uid: string): Promise<SalesCommittedPath> {
  const attendanceRef = collection(db, 'users', uid, 'attendance');
  const q = query(attendanceRef, where('date', '==', todayDateString()));
  const snapshot = await getDocs(q);
  const types = snapshot.docs.map((docSnap) => docSnap.data().type as string);
  if (types.some((t) => OFFICE_ONLY_TYPES.has(t))) return 'office';
  if (types.some((t) => FIELD_ONLY_TYPES.has(t))) return 'field';
  return null;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Run the full test suite (regression check)**

Run: `cd mobile && npm test -- --silent`
Expected: all existing suites still pass (this task adds no new test file — `attendanceApi.ts`
has never had one, matching every other Firestore-API module in this app, none of which are
unit tested; only pure logic modules are)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/attendance/attendanceApi.ts
git commit -m "feat(mobile): add ops attendance Firestore API and sales committed-path check"
```

---

## Task 3: Operations Attendance screen + route

**Files:**
- Create: `mobile/src/screens/OperationsAttendanceScreen.tsx`
- Modify: `mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `deriveOpsState`, `isOpsEventAllowed`, `OpsAttendanceEvent`, `OpsEventType` from
  `../attendance/opsAttendanceState` (Task 1); `subscribeTodayOpsEvents`, `recordOpsEvent`,
  `todayDateString` from `../attendance/attendanceApi` (Task 2, `todayDateString` already
  existed); `requestLocationPermission`, `getCurrentCoordinates` from `../location/useLocation`
  (unchanged, already exists); `RootStackParamList` from `../navigation/RootNavigator`.
- Produces: default-exported `OperationsAttendanceScreen` component, registered at route name
  `'OperationsAttendance'`. Task 4 (Sales screen) and Task 5 (Home screen) navigate to this
  route name.

- [ ] **Step 1: Add the route to `RootStackParamList` and register the screen**

In `mobile/src/navigation/RootNavigator.tsx`, add the import and the two new route entries
(one now for `OperationsAttendance`, and — to avoid a second edit pass to this same file in
Task 4 — also `SalesAttendance` now, even though its screen component doesn't exist until
Task 4; `RootNavigator.tsx` won't compile with `SalesAttendance` registered until Task 4's
component file exists, so **only add `OperationsAttendance` in this step**, and add
`SalesAttendance` in Task 4's own step instead):

```ts
import MaterialBuyScreen from '../screens/MaterialBuyScreen';
import MaterialRequestScreen from '../screens/MaterialRequestScreen';
import MaterialTransferScreen from '../screens/MaterialTransferScreen';
import ToolTransferScreen from '../screens/ToolTransferScreen';
import OperationsAttendanceScreen from '../screens/OperationsAttendanceScreen';

export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
  Regularization: undefined;
  MaterialBuy: undefined;
  MaterialRequest: undefined;
  MaterialTransfer: undefined;
  ToolTransfer: undefined;
  OperationsAttendance: undefined;
};
```

And inside `<Stack.Navigator>`, after the existing `ToolTransfer` screen entry:

```tsx
          <Stack.Screen name="ToolTransfer" component={ToolTransferScreen} />
          <Stack.Screen name="OperationsAttendance" component={OperationsAttendanceScreen} />
```

- [ ] **Step 2: Create the screen**

Create `mobile/src/screens/OperationsAttendanceScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet, Alert, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import {
  deriveOpsState,
  isOpsEventAllowed,
  type OpsAttendanceEvent,
  type OpsEventType,
} from '../attendance/opsAttendanceState';
import { subscribeTodayOpsEvents, recordOpsEvent, todayDateString } from '../attendance/attendanceApi';
import { requestLocationPermission, getCurrentCoordinates } from '../location/useLocation';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import AnimatedModalCard from '../components/AnimatedModalCard';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'OperationsAttendance'>;

export default function OperationsAttendanceScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<OpsAttendanceEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sitePromptVisible, setSitePromptVisible] = useState(false);
  const [siteNameText, setSiteNameText] = useState('');
  const [siteIdText, setSiteIdText] = useState('');
  const [marketPromptVisible, setMarketPromptVisible] = useState(false);
  const [marketNameText, setMarketNameText] = useState('');
  const [confirmHomeOutVisible, setConfirmHomeOutVisible] = useState(false);
  // Same day-rollover freshness guard as AttendanceScreen.tsx (office) — see that file's
  // comment on `subscribedDate` for the full S338 incident this protects against.
  const [subscribedDate, setSubscribedDate] = useState(todayDateString());

  useEffect(() => {
    if (!user) return;
    return subscribeTodayOpsEvents(user.uid, (newEvents) => {
      setEvents(newEvents);
      setEventsLoaded(true);
    });
  }, [user, subscribedDate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        const current = todayDateString();
        if (current !== subscribedDate) {
          setEventsLoaded(false);
          setSubscribedDate(current);
        }
      }
    });
    return () => subscription.remove();
  }, [subscribedDate]);

  const state = deriveOpsState(events);

  async function submitEvent(
    type: OpsEventType,
    extra?: { siteId?: string; siteName?: string; marketName?: string },
  ) {
    if (todayDateString() !== subscribedDate) {
      setEventsLoaded(false);
      setSubscribedDate(todayDateString());
      return;
    }
    if (!user || submitting) return;
    if (!isOpsEventAllowed(state, type)) return;
    setSubmitting(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        Alert.alert('Location required', 'Enable location access to record attendance.');
        return;
      }
      const coords = await getCurrentCoordinates();
      await recordOpsEvent(user, { type, ...coords, ...extra });
    } catch {
      Alert.alert('Could not record attendance', 'Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSiteIn() {
    setSiteNameText('');
    setSiteIdText('');
    setSitePromptVisible(true);
  }

  function confirmSiteIn() {
    setSitePromptVisible(false);
    submitEvent('site_in', { siteName: siteNameText.trim(), siteId: siteIdText.trim() });
  }

  function handleMarketIn() {
    setMarketNameText('');
    setMarketPromptVisible(true);
  }

  function confirmMarketIn() {
    setMarketPromptVisible(false);
    submitEvent('market_in', { marketName: marketNameText.trim() });
  }

  function handleHomeOut() {
    setConfirmHomeOutVisible(true);
  }

  function confirmHomeOut() {
    setConfirmHomeOutVisible(false);
    submitEvent('home_out');
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Attendance" onBack={() => navigation.goBack()} />
      <View style={styles.container}>
        <FadeInView style={styles.content}>
          <Text style={styles.state}>Status: {state}</Text>

          {state === 'NoRecord' && (
            <AnimatedPressable
              style={styles.button}
              disabled={submitting || !eventsLoaded}
              onPress={() => submitEvent('home_in')}
            >
              <Text style={styles.buttonText}>Start Day — Home In</Text>
            </AnimatedPressable>
          )}

          {state === 'HomeCheckedIn' && (
            <>
              <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleSiteIn}>
                <Text style={styles.buttonText}>Site Check In</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleMarketIn}>
                <Text style={styles.buttonText}>Market Check In</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleHomeOut}>
                <Text style={styles.buttonText}>End Day — Home Out</Text>
              </AnimatedPressable>
            </>
          )}

          {state === 'SiteCheckedIn' && (
            <>
              <AnimatedPressable
                style={styles.button}
                disabled={submitting || !eventsLoaded}
                onPress={() => submitEvent('site_out')}
              >
                <Text style={styles.buttonText}>Site Check Out</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleMarketIn}>
                <Text style={styles.buttonText}>Market Check In</Text>
              </AnimatedPressable>
            </>
          )}

          {state === 'MarketCheckedIn' && (
            <AnimatedPressable
              style={styles.button}
              disabled={submitting || !eventsLoaded}
              onPress={() => submitEvent('market_out')}
            >
              <Text style={styles.buttonText}>Market Check Out</Text>
            </AnimatedPressable>
          )}

          {state === 'DayComplete' && <Text style={styles.state}>Day complete</Text>}
        </FadeInView>

        <AnimatedModalCard
          visible={sitePromptVisible}
          style={styles.modalCard}
          onDismiss={() => setSitePromptVisible(false)}
        >
          <Text style={styles.modalTitle}>Site details</Text>
          <TextInput style={styles.input} value={siteNameText} onChangeText={setSiteNameText} placeholder="Site Name" />
          <TextInput
            style={styles.input}
            value={siteIdText}
            onChangeText={setSiteIdText}
            placeholder="Site ID (optional)"
          />
          <AnimatedPressable
            style={styles.button}
            disabled={submitting || !eventsLoaded || !siteNameText.trim()}
            onPress={confirmSiteIn}
          >
            <Text style={styles.buttonText}>Confirm</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.buttonSecondary} onPress={() => setSitePromptVisible(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </AnimatedPressable>
        </AnimatedModalCard>

        <AnimatedModalCard
          visible={marketPromptVisible}
          style={styles.modalCard}
          onDismiss={() => setMarketPromptVisible(false)}
        >
          <Text style={styles.modalTitle}>Market details</Text>
          <TextInput
            style={styles.input}
            value={marketNameText}
            onChangeText={setMarketNameText}
            placeholder="Market Name"
          />
          <AnimatedPressable
            style={styles.button}
            disabled={submitting || !eventsLoaded || !marketNameText.trim()}
            onPress={confirmMarketIn}
          >
            <Text style={styles.buttonText}>Confirm</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.buttonSecondary} onPress={() => setMarketPromptVisible(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </AnimatedPressable>
        </AnimatedModalCard>

        <AnimatedModalCard visible={confirmHomeOutVisible} style={styles.modalCard}>
          <Text style={styles.modalTitle}>End your day?</Text>
          <Text style={styles.modalBody}>This closes today's attendance and cannot be undone from the app.</Text>
          <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={confirmHomeOut}>
            <Text style={styles.buttonText}>Yes, Home Out</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.buttonSecondary} onPress={() => setConfirmHomeOutVisible(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </AnimatedPressable>
        </AnimatedModalCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  container: { flex: 1 },
  content: { flex: 1, padding: 24, gap: 16 },
  state: { fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonSecondary: { backgroundColor: Colors.textMuted, padding: 16, borderRadius: 12, alignItems: 'center' },
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
  modalBody: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 12,
    padding: 14,
    color: Colors.textPrimary,
  },
});
```

Note the `disabled={... || !siteNameText.trim()}` on the site modal's Confirm button — Site
Name is required (Android decision, spec-verified); Market Name is required the same way for
consistency (the spec's Android investigation didn't find an explicit required/optional
distinction stated for Market Name, but an empty market name would be a useless,
unidentifiable record, so this mirrors the Site Name treatment rather than leaving it
unenforced).

- [ ] **Step 3: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Run the full test suite (regression check)**

Run: `cd mobile && npm test -- --silent`
Expected: all existing suites pass, unchanged count from Task 1

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/OperationsAttendanceScreen.tsx mobile/src/navigation/RootNavigator.tsx
git commit -m "feat(mobile): add Operations Attendance screen and route"
```

---

## Task 4: Sales Attendance chooser screen + route

**Files:**
- Create: `mobile/src/screens/SalesAttendanceScreen.tsx`
- Modify: `mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `getTodaysSalesCommittedPath`, `SalesCommittedPath` from `../attendance/attendanceApi`
  (Task 2); `RootStackParamList` (this task adds `SalesAttendance` to it); navigates to the
  existing `'Attendance'` route (office, unchanged since Phase 1) and to `'OperationsAttendance'`
  (Task 3).
- Produces: default-exported `SalesAttendanceScreen`, registered at route name `'SalesAttendance'`.
  Task 5 (Home screen) navigates to this route name.

- [ ] **Step 1: Add the route to `RootStackParamList` and register the screen**

In `mobile/src/navigation/RootNavigator.tsx`, add the import:

```ts
import OperationsAttendanceScreen from '../screens/OperationsAttendanceScreen';
import SalesAttendanceScreen from '../screens/SalesAttendanceScreen';
```

Add `SalesAttendance: undefined;` to `RootStackParamList`, after `OperationsAttendance`:

```ts
export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
  Regularization: undefined;
  MaterialBuy: undefined;
  MaterialRequest: undefined;
  MaterialTransfer: undefined;
  ToolTransfer: undefined;
  OperationsAttendance: undefined;
  SalesAttendance: undefined;
};
```

And register the screen, after `OperationsAttendance`:

```tsx
          <Stack.Screen name="OperationsAttendance" component={OperationsAttendanceScreen} />
          <Stack.Screen name="SalesAttendance" component={SalesAttendanceScreen} />
```

- [ ] **Step 2: Create the screen**

Create `mobile/src/screens/SalesAttendanceScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { getTodaysSalesCommittedPath } from '../attendance/attendanceApi';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SalesAttendance'>;

// Sales chooses office-vs-field ONCE per day (android/CLAUDE.md "ATTENDANCE LOGIC" — Sales
// users section). On mount, check whether either flow is already committed today via a
// one-time read (see attendanceApi.ts's getTodaysSalesCommittedPath doc comment for why this
// isn't a live-derived check) and redirect straight into it with `.replace` — picking the
// WRONG flow while one is already committed would feed that flow's derive function an event
// type it doesn't recognize (e.g. the office screen seeing a `site_in`), so this redirect is
// a correctness guard, not just a convenience.
export default function SalesAttendanceScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getTodaysSalesCommittedPath(user.uid)
      .then((path) => {
        if (cancelled) return;
        if (path === 'office') {
          navigation.replace('Attendance');
        } else if (path === 'field') {
          navigation.replace('OperationsAttendance');
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, navigation]);

  if (checking) {
    return (
      <View style={styles.screen}>
        <TopBar title="Attendance" onBack={() => navigation.goBack()} />
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Attendance" onBack={() => navigation.goBack()} />
      <View style={styles.container}>
        <FadeInView style={styles.content}>
          <Text style={styles.prompt}>How are you working today?</Text>
          <AnimatedPressable style={styles.card} onPress={() => navigation.navigate('Attendance')}>
            <Text style={styles.cardTitle}>Office Day</Text>
            <Text style={styles.cardSubtitle}>Check in from the office</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.card} onPress={() => navigation.navigate('OperationsAttendance')}>
            <Text style={styles.cardTitle}>Site Visit</Text>
            <Text style={styles.cardSubtitle}>Check in from a site or market</Text>
          </AnimatedPressable>
        </FadeInView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1 },
  content: { flex: 1, padding: 24, gap: 16 },
  prompt: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary, marginBottom: 8 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  cardSubtitle: { fontSize: 13, color: Colors.textMuted },
});
```

- [ ] **Step 3: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Run the full test suite (regression check)**

Run: `cd mobile && npm test -- --silent`
Expected: all existing suites pass, unchanged count from Task 1

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/SalesAttendanceScreen.tsx mobile/src/navigation/RootNavigator.tsx
git commit -m "feat(mobile): add Sales Attendance chooser screen and route"
```

---

## Task 5: Home screen role-routed Attendance card, full verification

**Files:**
- Modify: `mobile/src/screens/HomeScreen.tsx`

**Interfaces:**
- Consumes: route names `'Attendance'`, `'OperationsAttendance'` (Task 3), `'SalesAttendance'`
  (Task 4) from `RootStackParamList`.
- Produces: nothing new consumed by later tasks — this is the last task, the one that makes
  every previous task's screen reachable through the UI.

- [ ] **Step 1: Replace the role gate with a role-routed Attendance card**

In `mobile/src/screens/HomeScreen.tsx`, replace the `canUseOfficeAttendance`-only gate and
its comment with a routing table that still keeps Regularization office/admin-only:

Replace this block:

```ts
  // Phase 1 ships the OFFICE attendance flow only. `admin` shares office's attendance
  // event types (see firebase/functions/roleCapabilities.js); operations and sales punch
  // site_in/market_in, so office-shaped punches from this app would be invisible to their
  // payroll scoring. Anything else — including an unknown role — is gated out.
  // Regularization derives its live status from these same office_in/office_out events
  // (see regularizationStatus.ts), so it shares this exact gate.
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : null;
  const firstName = user?.name?.trim().split(' ')[0] || 'there';
```

with:

```ts
  // Phase 4a adds operations/site attendance and the sales office/site chooser (see
  // docs/superpowers/specs/2026-09-29-mobile-ops-sales-attendance-design.md) — every known
  // role now has an Attendance route. Regularization's live status still derives ONLY from
  // office_in/office_out events (see regularizationStatus.ts), so it keeps the office/admin
  // gate on its own; extending it to ops/sales is explicitly deferred (see that spec's
  // "Scope decisions").
  const ROLE_ATTENDANCE_ROUTES: Partial<Record<string, keyof RootStackParamList>> = {
    office: 'Attendance',
    admin: 'Attendance',
    operations: 'OperationsAttendance',
    sales: 'SalesAttendance',
  };
  const attendanceRoute = user?.role ? ROLE_ATTENDANCE_ROUTES[user.role] : undefined;
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : null;
  const firstName = user?.name?.trim().split(' ')[0] || 'there';
```

- [ ] **Step 2: Render the card set from the new routing table**

Replace this block:

```tsx
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
```

with:

```tsx
            {attendanceRoute ? (
              <>
                <HomeCard icon="time-outline" label="Attendance" onPress={() => navigation.navigate(attendanceRoute)} />
                {canUseOfficeAttendance && (
                  <HomeCard
                    icon="alert-circle-outline"
                    label="Regularization"
                    onPress={() => navigation.navigate('Regularization')}
                  />
                )}
              </>
            ) : (
              <Text style={styles.unavailable}>
                Attendance isn't available for your role on this app yet.
              </Text>
            )}
```

- [ ] **Step 3: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: `TypeScript: No errors found`. If `navigation.navigate(attendanceRoute)` reports a
type error because `attendanceRoute` is typed as `keyof RootStackParamList | undefined`
rather than narrowed to the four specific route names, narrow it explicitly instead of
widening the navigate call:
```ts
  const attendanceRoute: 'Attendance' | 'OperationsAttendance' | 'SalesAttendance' | undefined =
    user?.role === 'operations' ? 'OperationsAttendance' :
    user?.role === 'sales' ? 'SalesAttendance' :
    user?.role === 'office' || user?.role === 'admin' ? 'Attendance' :
    undefined;
```
(drop the `ROLE_ATTENDANCE_ROUTES` object in that case — this inline form sidesteps any
lookup-typing issue and is equally readable at four branches).

- [ ] **Step 4: Run the full test suite**

Run: `cd mobile && npm test -- --silent`
Expected: `Test Suites: 4 passed, 4 total` (the three existing suites plus Task 1's new
`opsAttendanceState.test.ts`), all green.

- [ ] **Step 5: Verify the dev server bundles the whole app**

Run: `cd mobile && npx expo start` (background it or use a separate terminal), wait for
`packager-status:running` at `http://localhost:8081/status`, then fetch the bundle directly
to confirm Metro compiles every new file with no errors:
```bash
curl -s -m 90 "http://localhost:8081/index.ts.bundle?platform=ios&dev=true&hot=false&lazy=true" -o /tmp/bundle.js -w "HTTP:%{http_code} SIZE:%{size_download}\n"
```
Expected: `HTTP:200` with a `SIZE` larger than the pre-change bundle (new screens/modules
add real bytes).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/HomeScreen.tsx
git commit -m "feat(mobile): route the Home Attendance card by role for ops/sales"
```

- [ ] **Step 7: Manual verification (requires a physical device — no simulator available)**

Not automatable; do this after the six steps above are green. Use the operations test
account from `android/CLAUDE.md` (`test@whitecoffee.com` / `test1234`) for the operations
walkthrough; sales needs a real sales-role account (create or borrow one via the admin
portal's `/users` page if none exists yet).

- Operations account: Home → Attendance card → confirm it opens `OperationsAttendanceScreen`
  directly (no chooser). Walk Home In → Site In (fill Site Name + Site ID) → Site Out →
  Market In (fill Market Name) → Market Out → Site In again → Home Out (confirm dialog).
  After each step, check the resulting doc under `/users/{uid}/attendance/` in the Firebase
  console or admin portal matches the field shape in this plan's Global Constraints exactly.
- Confirm `market_in` is reachable directly while `SiteCheckedIn` (button visible without
  first tapping Site Check Out).
- Sales account: Home → Attendance card → confirm the chooser appears on a fresh day (no
  prior events). Pick "Site Visit", do a `site_in`, then kill and reopen the app, tap
  Attendance again from Home — confirm it redirects straight into
  `OperationsAttendanceScreen` (no chooser shown). Repeat for "Office Day" → `office_in` →
  reopen → confirms it redirects straight into the existing office `AttendanceScreen`.
- Confirm the Regularization card is absent for both the operations and sales test accounts,
  and still present for an office/admin account (unchanged behavior).
