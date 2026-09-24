# Mobile Leave (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Leave feature (apply + view own history) to the existing WhiteCoffee mobile app, visible to all roles, matching Android's verified behavior exactly.

**Architecture:** Two new pure/Firestore modules (`leaveCoverage.ts`, `leaveApi.ts`) following the same shape as the Phase 1 attendance modules, plus a new two-tab `LeaveScreen` wired into the existing navigator and Home screen.

**Tech Stack:** Same Expo/TypeScript/Firebase JS SDK stack as Phase 1, plus one new dependency: `@react-native-community/datetimepicker` (Expo-Go-compatible, installed via `npx expo install`).

**Spec:** `docs/superpowers/specs/2026-09-24-mobile-leave-phase2a-design.md`

## Global Constraints

- No backend changes. Firestore schema and rules for `/users/{uid}/leave_requests/{id}` are unchanged — this is a new client only.
- Leave is visible to **all roles**, unlike Attendance which is gated to `office`/`admin` — do not add a role check to the Leave card or screen.
- Field names written on submit must exactly match the Android schema: `userId`, `userName`, `employeeId`, `leaveType` (always `''`), `fromDate`, `toDate` (`yyyy-MM-dd`), `totalDays` (number), `joiningDate` (`yyyy-MM-dd`), `emergencyContact`, `placeOfVisit`, `reason`, `status` (`'pending'`), `approvedDates: []`, `cancelledDates: []`, `submittedAt` (Firestore `Timestamp`).
- Validation matches Android exactly: both dates required, `toDate >= fromDate` (i.e. the expanded day count must be `> 0`), `emergencyContact`/`placeOfVisit`/`reason` all required non-blank after trimming.
- Writes must be offline-safe: mint the document reference locally via `doc(collection(...))` and call `setDoc(...).catch(...)` without awaiting the network round-trip — the same pattern already fixed into `mobile/src/attendance/attendanceApi.ts`'s `recordOfficeEvent`. Do not `await addDoc(...)`.
- Reads must use `onSnapshot` with an `onError` callback that at minimum `console.error`s — the same pattern already fixed into `subscribeTodayOfficeEvents`. Do not omit the error callback.
- A leave's displayed status must come from the coverage-overlay logic (`leaveDisplayStatus`), never from the raw `status` field alone — a fully-cancelled approved leave must display as rejected.
- Button protection: disable on tap while submitting, matching the rest of the app.

---

### Task 1: Leave Coverage Logic (TDD)

**Files:**
- Create: `mobile/src/leave/leaveCoverage.ts`
- Test: `mobile/src/leave/leaveCoverage.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `LeaveLike` (`{ fromDate: string; toDate?: string; status?: string; approvedDates?: string[]; cancelledDates?: string[] }`), `expandDateRange(from: string, to?: string): string[]`, `requestedDates(leave: LeaveLike): string[]`, `grantedDates(leave: LeaveLike): string[]`, `cancelledDates(leave: LeaveLike): string[]`, `effectiveGrantedDates(leave: LeaveLike): string[]`, `effectiveGrantedDayCount(leave: LeaveLike): number`, `isCancelled(leave: LeaveLike): boolean`, `isPartiallyCancelled(leave: LeaveLike): boolean`, `isPartialApproval(leave: LeaveLike): boolean`, `LeaveDisplayStatus` (`'pending' | 'approved' | 'partial' | 'rejected'`), `leaveDisplayStatus(leave: LeaveLike): LeaveDisplayStatus` — all exported from `mobile/src/leave/leaveCoverage.ts`. Task 4 imports `expandDateRange`, `effectiveGrantedDayCount`, and `leaveDisplayStatus`.

This is a faithful port of the read-side of `admin/src/lib/leaveDates.ts` (already mirrored across Android/admin/functions — this becomes the fourth mirror, mobile). The write-side notification-message helpers there (`partialApprovalMessage`, `leaveCancelledMessage`) are portal-only and are NOT ported here.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/leave/leaveCoverage.test.ts`:

```ts
import {
  expandDateRange,
  requestedDates,
  grantedDates,
  cancelledDates,
  effectiveGrantedDates,
  effectiveGrantedDayCount,
  isCancelled,
  isPartiallyCancelled,
  isPartialApproval,
  leaveDisplayStatus,
  type LeaveLike,
} from './leaveCoverage';

describe('expandDateRange', () => {
  it('expands an inclusive range', () => {
    expect(expandDateRange('2026-01-01', '2026-01-03')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('treats a missing "to" as a single-day range', () => {
    expect(expandDateRange('2026-01-05')).toEqual(['2026-01-05']);
  });

  it('returns [] for an inverted range', () => {
    expect(expandDateRange('2026-01-05', '2026-01-01')).toEqual([]);
  });

  it('returns [] for a malformed date', () => {
    expect(expandDateRange('not-a-date')).toEqual([]);
  });
});

describe('requestedDates', () => {
  it('returns the full fromDate..toDate range', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-03' };
    expect(requestedDates(leave)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });
});

describe('grantedDates', () => {
  it('is the whole requested range when approvedDates is empty (compatibility rule)', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-03', approvedDates: [] };
    expect(grantedDates(leave)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });

  it('is bounded to the requested range, ignoring a stray out-of-range entry', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      approvedDates: ['2026-02-01', '2026-03-01'],
    };
    expect(grantedDates(leave)).toEqual(['2026-02-01']);
  });
});

describe('cancelledDates', () => {
  it('is empty when cancelledDates is empty or absent', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02' };
    expect(cancelledDates(leave)).toEqual([]);
  });

  it('is bounded to what was actually granted', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      approvedDates: ['2026-02-01'],
      cancelledDates: ['2026-02-01', '2026-02-02'],
    };
    expect(cancelledDates(leave)).toEqual(['2026-02-01']);
  });
});

describe('effectiveGrantedDates / effectiveGrantedDayCount', () => {
  it('is granted minus cancelled', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-03',
      cancelledDates: ['2026-02-02'],
    };
    expect(effectiveGrantedDates(leave)).toEqual(['2026-02-01', '2026-02-03']);
    expect(effectiveGrantedDayCount(leave)).toBe(2);
  });
});

describe('isCancelled / isPartiallyCancelled', () => {
  it('is false when nothing was cancelled', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02' };
    expect(isCancelled(leave)).toBe(false);
    expect(isPartiallyCancelled(leave)).toBe(false);
  });

  it('isPartiallyCancelled is true only when some but not all days remain', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      cancelledDates: ['2026-02-01'],
    };
    expect(isCancelled(leave)).toBe(true);
    expect(isPartiallyCancelled(leave)).toBe(true);
  });

  it('isPartiallyCancelled is false when ALL granted days were cancelled', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      cancelledDates: ['2026-02-01', '2026-02-02'],
    };
    expect(isCancelled(leave)).toBe(true);
    expect(isPartiallyCancelled(leave)).toBe(false);
  });
});

describe('isPartialApproval', () => {
  it('is false for a pending leave', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02', status: 'pending' };
    expect(isPartialApproval(leave)).toBe(false);
  });

  it('is false for a legacy approval with no approvedDates', () => {
    const leave: LeaveLike = { fromDate: '2026-02-01', toDate: '2026-02-02', status: 'approved' };
    expect(isPartialApproval(leave)).toBe(false);
  });

  it('is true when approvedDates covers fewer days than requested', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-03',
      status: 'approved',
      approvedDates: ['2026-02-01'],
    };
    expect(isPartialApproval(leave)).toBe(true);
  });
});

describe('leaveDisplayStatus', () => {
  it('is pending for a pending leave', () => {
    expect(leaveDisplayStatus({ fromDate: '2026-02-01', status: 'pending' })).toBe('pending');
  });

  it('is rejected for a rejected leave', () => {
    expect(leaveDisplayStatus({ fromDate: '2026-02-01', status: 'rejected' })).toBe('rejected');
  });

  it('is approved for a plain approval with no overlays', () => {
    expect(leaveDisplayStatus({ fromDate: '2026-02-01', status: 'approved' })).toBe('approved');
  });

  it('is partial for a partial approval', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-03',
      status: 'approved',
      approvedDates: ['2026-02-01'],
    };
    expect(leaveDisplayStatus(leave)).toBe('partial');
  });

  it('is partial when some but not all granted days were cancelled', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      status: 'approved',
      cancelledDates: ['2026-02-01'],
    };
    expect(leaveDisplayStatus(leave)).toBe('partial');
  });

  it('is rejected when a full cancellation revoked every granted day', () => {
    const leave: LeaveLike = {
      fromDate: '2026-02-01',
      toDate: '2026-02-02',
      status: 'approved',
      cancelledDates: ['2026-02-01', '2026-02-02'],
    };
    expect(leaveDisplayStatus(leave)).toBe('rejected');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/leave/leaveCoverage.test.ts
```

Expected: FAIL — `Cannot find module './leaveCoverage'`.

- [ ] **Step 3: Implement the coverage module**

Create `mobile/src/leave/leaveCoverage.ts`:

```ts
// Faithful port of the READ side of admin/src/lib/leaveDates.ts (mirrored there,
// firebase/functions/leaveCoverage.js, and Android's LeaveRequest.kt — change all four
// together). The write-side notification-message helpers are portal-only and not ported
// here; this app never approves or cancels leave.

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface LeaveLike {
  fromDate: string;
  toDate?: string;
  status?: string;
  approvedDates?: string[];
  cancelledDates?: string[];
}

export function expandDateRange(from: string, to?: string): string[] {
  if (!from || !DATE_RE.test(from)) return [];
  const end = to && DATE_RE.test(to) ? to : from;
  if (end < from) return [];
  const out: string[] = [];
  for (let t = toUtc(from).getTime(), stop = toUtc(end).getTime(); t <= stop; t += MS_PER_DAY) {
    out.push(fromUtc(new Date(t)));
  }
  return out;
}

export function requestedDates(leave: LeaveLike): string[] {
  return expandDateRange(leave.fromDate, leave.toDate);
}

export function grantedDates(leave: LeaveLike): string[] {
  const requested = requestedDates(leave);
  const approved = leave.approvedDates;
  if (!approved || approved.length === 0) return requested;
  const inRange = new Set(requested);
  return approved.filter((d) => inRange.has(d)).sort();
}

export function cancelledDates(leave: LeaveLike): string[] {
  const cancelled = leave.cancelledDates;
  if (!cancelled || cancelled.length === 0) return [];
  const granted = new Set(grantedDates(leave));
  return cancelled.filter((d) => granted.has(d)).sort();
}

export function effectiveGrantedDates(leave: LeaveLike): string[] {
  const cancelled = new Set(cancelledDates(leave));
  if (cancelled.size === 0) return grantedDates(leave);
  return grantedDates(leave).filter((d) => !cancelled.has(d));
}

export function effectiveGrantedDayCount(leave: LeaveLike): number {
  return effectiveGrantedDates(leave).length;
}

export function isCancelled(leave: LeaveLike): boolean {
  return cancelledDates(leave).length > 0;
}

export function isPartiallyCancelled(leave: LeaveLike): boolean {
  return isCancelled(leave) && effectiveGrantedDates(leave).length > 0;
}

export function requestedDayCount(leave: LeaveLike): number {
  return requestedDates(leave).length;
}

export function isPartialApproval(leave: LeaveLike): boolean {
  if (leave.status !== 'approved') return false;
  const approved = leave.approvedDates;
  if (!approved || approved.length === 0) return false;
  return grantedDates(leave).length < requestedDayCount(leave);
}

export type LeaveDisplayStatus = 'pending' | 'approved' | 'partial' | 'rejected';

// A fully-cancelled approval displays identically to "rejected" per the admin
// portal's own convention (android/CLAUDE.md: "a full cancellation renders in the
// REJECTED colours despite status == 'approved'").
export function leaveDisplayStatus(leave: LeaveLike): LeaveDisplayStatus {
  if (leave.status !== 'approved') {
    return leave.status === 'rejected' ? 'rejected' : 'pending';
  }
  if (isCancelled(leave)) {
    return effectiveGrantedDates(leave).length > 0 ? 'partial' : 'rejected';
  }
  return isPartialApproval(leave) ? 'partial' : 'approved';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/leave/leaveCoverage.test.ts
```

Expected: PASS, all test cases green.

- [ ] **Step 5: Run the full project type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/leave/leaveCoverage.ts mobile/src/leave/leaveCoverage.test.ts
git commit -m "feat(mobile): add leave coverage-overlay logic with tests"
```

---

### Task 2: Leave Firestore API

**Files:**
- Create: `mobile/src/leave/leaveApi.ts`

**Interfaces:**
- Consumes: `db` from `mobile/src/firebase/config.ts`; `UserProfile` from `mobile/src/attendance/attendanceApi.ts`.
- Produces: `LeaveRequest` (`{ id: string; fromDate: string; toDate: string; totalDays: number; joiningDate: string; emergencyContact: string; placeOfVisit: string; reason: string; status: string; approvedDates: string[]; cancelledDates: string[]; submittedAt: number }`), `SubmitLeaveInput` (`{ fromDate: string; toDate: string; totalDays: number; joiningDate: string; emergencyContact: string; placeOfVisit: string; reason: string }`), `formatDateString(date: Date): string`, `submitLeaveRequest(user: UserProfile, input: SubmitLeaveInput): Promise<void>`, `subscribeMyLeaveRequests(uid: string, onChange: (requests: LeaveRequest[]) => void): () => void` — all exported from `mobile/src/leave/leaveApi.ts`. Task 4 imports all of these.

- [ ] **Step 1: Write the Firestore read/write functions**

Create `mobile/src/leave/leaveApi.ts`:

```ts
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
```

- [ ] **Step 2: Verify it type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/leave/leaveApi.ts
git commit -m "feat(mobile): add Firestore leave request read/write API"
```

---

### Task 3: Navigation, Home Card, and Reusable HomeCard Component

**Files:**
- Create: `mobile/src/components/HomeCard.tsx`
- Modify: `mobile/src/screens/HomeScreen.tsx`
- Modify: `mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `AnimatedPressable` from `mobile/src/components/AnimatedPressable.tsx`; `Colors` from `mobile/src/theme/colors.ts`.
- Produces: `HomeCard` (default export, props `{ icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }`) from `mobile/src/components/HomeCard.tsx`. `RootStackParamList` extended with `Leave: undefined`. Task 4's `LeaveScreen` is registered into `RootNavigator`'s stack by this task and imported from `../screens/LeaveScreen` — that file does not exist yet (created in Task 4). This is the same intentional, documented sequencing already used in Phase 1 (Task 6 there registered `AttendanceScreen` before it existed) — `npx tsc --noEmit` will report exactly one error, "Cannot find module '../screens/LeaveScreen'", until Task 4 lands. That is expected; do not work around it.

Note: two Attendance/Leave cards will now sit side by side on Home — this task extracts the card markup the Attendance card already used into a shared `HomeCard` component so both cards (and any future Phase 3 cards) share one implementation instead of duplicating the icon-tile + label + chevron markup.

- [ ] **Step 1: Create the reusable HomeCard component**

Create `mobile/src/components/HomeCard.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import AnimatedPressable from './AnimatedPressable';

interface HomeCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

export default function HomeCard({ icon, label, onPress }: HomeCardProps) {
  return (
    <AnimatedPressable style={styles.card} onPress={onPress}>
      <View style={styles.cardIcon}>
        <Ionicons name={icon} size={22} color={Colors.primary} />
      </View>
      <Text style={styles.cardText}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 18,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, fontSize: 17, fontWeight: '600', color: Colors.textPrimary },
});
```

- [ ] **Step 2: Update HomeScreen to use HomeCard and add the Leave card**

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
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';

  return (
    <View style={styles.screen}>
      <TopBar />
      <View style={styles.container}>
        <FadeInView style={styles.cards}>
          {canUseOfficeAttendance ? (
            <HomeCard icon="time-outline" label="Attendance" onPress={() => navigation.navigate('Attendance')} />
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

- [ ] **Step 3: Register the Leave route**

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

export type RootStackParamList = {
  Home: undefined;
  Attendance: undefined;
  Leave: undefined;
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
        </Stack.Navigator>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
```

- [ ] **Step 4: Verify the expected single error**

```bash
npx tsc --noEmit
```

Expected: exactly one error — `Cannot find module '../screens/LeaveScreen'` (or equivalent) in `RootNavigator.tsx`. No other errors. This is expected per the Interfaces note above.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/HomeCard.tsx mobile/src/screens/HomeScreen.tsx mobile/src/navigation/RootNavigator.tsx
git commit -m "feat(mobile): add Leave route and HomeCard, extract card component"
```

---

### Task 4: Leave Screen (Apply + History Tabs)

**Files:**
- Create: `mobile/src/screens/LeaveScreen.tsx`

**Interfaces:**
- Consumes: `useAuth` from `mobile/src/auth/AuthContext.tsx`; `submitLeaveRequest`, `subscribeMyLeaveRequests`, `formatDateString`, `LeaveRequest` from `mobile/src/leave/leaveApi.ts` (Task 2); `expandDateRange`, `effectiveGrantedDayCount`, `leaveDisplayStatus` from `mobile/src/leave/leaveCoverage.ts` (Task 1); `TopBar` from `mobile/src/components/TopBar.tsx`; `FadeInView`, `AnimatedPressable` from `mobile/src/components/`; `Colors` from `mobile/src/theme/colors.ts`; `RootStackParamList` from `mobile/src/navigation/RootNavigator.tsx` (Task 3).
- Produces: default-exported `LeaveScreen`, registered into `RootNavigator`'s stack by Task 3.

- [ ] **Step 1: Install the date picker dependency**

```bash
cd mobile
npx expo install @react-native-community/datetimepicker
```

- [ ] **Step 2: Write the Leave screen**

Note before writing this file: the code below imports `type DateTimePickerEvent` from
`@react-native-community/datetimepicker`. If `npx tsc --noEmit` reports that this named
type export doesn't exist on the installed version, check
`node_modules/@react-native-community/datetimepicker/src/index.tsx` (or its `.d.ts`) for
the actual exported event type name and adjust the import accordingly — the `onChange`
callback's second parameter is what matters (a `Date | undefined`), not the exact event
type name, so a minor rename here doesn't affect behavior.

Create `mobile/src/screens/LeaveScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import {
  submitLeaveRequest,
  subscribeMyLeaveRequests,
  formatDateString,
  type LeaveRequest,
} from '../leave/leaveApi';
import { expandDateRange, effectiveGrantedDayCount, leaveDisplayStatus } from '../leave/leaveCoverage';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Leave'>;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  partial: 'Partially Approved',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: Colors.statusPendingBg, fg: Colors.statusPendingFg },
  approved: { bg: Colors.statusPresentBg, fg: Colors.statusPresentFg },
  partial: { bg: Colors.statusPendingBg, fg: Colors.statusPendingFg },
  rejected: { bg: Colors.statusRejectedBg, fg: Colors.statusRejectedFg },
};

export default function LeaveScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'apply' | 'history'>('apply');

  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [joiningDate, setJoiningDate] = useState(new Date());
  const [emergencyContact, setEmergencyContact] = useState('');
  const [placeOfVisit, setPlaceOfVisit] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [history, setHistory] = useState<LeaveRequest[]>([]);

  useEffect(() => {
    if (!user) return;
    return subscribeMyLeaveRequests(user.uid, setHistory);
  }, [user]);

  const dayCount = expandDateRange(formatDateString(fromDate), formatDateString(toDate)).length;

  async function handleSubmit() {
    setFormError(null);
    if (dayCount <= 0) {
      setFormError('End date must be on or after start date.');
      return;
    }
    if (!emergencyContact.trim() || !placeOfVisit.trim() || !reason.trim()) {
      setFormError('Emergency contact, place of visit, and reason are all required.');
      return;
    }
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      await submitLeaveRequest(user, {
        fromDate: formatDateString(fromDate),
        toDate: formatDateString(toDate),
        totalDays: dayCount,
        joiningDate: formatDateString(joiningDate),
        emergencyContact: emergencyContact.trim(),
        placeOfVisit: placeOfVisit.trim(),
        reason: reason.trim(),
      });
      setEmergencyContact('');
      setPlaceOfVisit('');
      setReason('');
      setTab('history');
    } finally {
      setSubmitting(false);
    }
  }

  const pickerDisplay = Platform.OS === 'ios' ? 'compact' : 'default';

  return (
    <View style={styles.screen}>
      <TopBar title="Leave" onBack={() => navigation.goBack()} />
      <View style={styles.tabs}>
        <AnimatedPressable
          style={[styles.tab, tab === 'apply' ? styles.tabActive : null]}
          onPress={() => setTab('apply')}
        >
          <Text style={[styles.tabText, tab === 'apply' ? styles.tabTextActive : null]}>Apply</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.tab, tab === 'history' ? styles.tabActive : null]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabText, tab === 'history' ? styles.tabTextActive : null]}>History</Text>
        </AnimatedPressable>
      </View>

      {tab === 'apply' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <FadeInView style={styles.card}>
            <Text style={styles.label}>Leave Start Date</Text>
            <DateTimePicker
              value={fromDate}
              mode="date"
              display={pickerDisplay}
              onChange={(_: DateTimePickerEvent, date?: Date) => date && setFromDate(date)}
            />

            <Text style={styles.label}>Leave End Date</Text>
            <DateTimePicker
              value={toDate}
              mode="date"
              display={pickerDisplay}
              onChange={(_: DateTimePickerEvent, date?: Date) => date && setToDate(date)}
            />

            {dayCount > 0 && (
              <Text style={styles.dayCount}>
                {dayCount} day{dayCount === 1 ? '' : 's'} total
              </Text>
            )}

            <Text style={styles.label}>Joining Date</Text>
            <DateTimePicker
              value={joiningDate}
              mode="date"
              display={pickerDisplay}
              onChange={(_: DateTimePickerEvent, date?: Date) => date && setJoiningDate(date)}
            />

            <Text style={styles.label}>Emergency Contact No.</Text>
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              value={emergencyContact}
              onChangeText={setEmergencyContact}
            />

            <Text style={styles.label}>Place of Visit</Text>
            <TextInput
              style={styles.input}
              placeholder="Where will you be?"
              placeholderTextColor={Colors.textMuted}
              value={placeOfVisit}
              onChangeText={setPlaceOfVisit}
            />

            <Text style={styles.label}>Reason for Leave</Text>
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
          </FadeInView>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <FadeInView style={styles.historyList}>
            {history.length === 0 ? (
              <Text style={styles.empty}>No leave requests yet.</Text>
            ) : (
              history.map((leave) => {
                const displayStatus = leaveDisplayStatus(leave);
                const colors = STATUS_COLORS[displayStatus];
                const days = effectiveGrantedDayCount(leave);
                return (
                  <View key={leave.id} style={styles.historyCard}>
                    <View style={styles.historyHeader}>
                      <Text style={styles.historyDates}>
                        {leave.fromDate} – {leave.toDate}
                      </Text>
                      <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                        <Text style={[styles.badgeText, { color: colors.fg }]}>
                          {STATUS_LABEL[displayStatus]}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.historyMeta}>
                      {days} day{days === 1 ? '' : 's'} · {leave.placeOfVisit}
                    </Text>
                  </View>
                );
              })
            )}
          </FadeInView>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, paddingTop: 12 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: 'white' },
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
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 10,
    padding: 12,
    color: Colors.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  dayCount: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
  error: { color: Colors.statusRejectedFg, fontSize: 13 },
  button: { backgroundColor: Colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '600' },
  historyList: { gap: 12 },
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyDates: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  historyMeta: { fontSize: 13, color: Colors.textSecondary },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  empty: { textAlign: 'center', color: Colors.textMuted, marginTop: 40 },
});
```

- [ ] **Step 3: Verify the whole project type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors. This is the point where `RootNavigator.tsx`'s import of `LeaveScreen` (Task 3) finally resolves.

- [ ] **Step 4: Run the full test suite**

```bash
npx jest
```

Expected: all tests pass (the Task 1 leave-coverage suite plus the existing Phase 1 suite).

- [ ] **Step 5: Manual device walkthrough**

No simulator/device is available in this environment (same constraint as Phase 1) — do full static verification (steps 3-4 above) and note in your report that the live walkthrough could not be performed here. When it is run on a real device, it should cover:

1. Open the Leave tab from Home (visible regardless of role — confirm this specifically, since Attendance is role-gated but Leave must not be).
2. Fill out the Apply form: pick a start date, an end date after it, confirm the "N days total" chip updates, fill in Joining Date, Emergency Contact, Place of Visit, and Reason, then submit.
3. Confirm the screen switches to the History tab and the new request appears with a "Pending" badge.
4. Try submitting with an end date before the start date — confirm the inline error appears and no Firestore write happens.
5. Check the Firestore console (or admin portal's `/leaves` page) to confirm the document under `/users/{uid}/leave_requests/` has the exact field shape Android would have written, and that it appears in the admin approval queue.
6. If possible, have an admin partially approve or cancel the request from the portal, then reload the History tab and confirm the badge updates to "Partially Approved" or "Rejected" per the coverage logic.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/LeaveScreen.tsx mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): add Leave screen with apply form and history list"
```
