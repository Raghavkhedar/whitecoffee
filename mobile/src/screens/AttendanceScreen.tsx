import React, { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet, Alert, TextInput, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { deriveOfficeState, isOfficeEventAllowed, type OfficeEventType } from '../attendance/officeAttendanceState';
import { subscribeTodayEvents, recordOfficeEvent, todayDateString, type DayEvent } from '../attendance/attendanceApi';
import { formatTime } from '../attendance/dayTimeline';
import DayTimeline from '../components/DayTimeline';
import AttendanceStatusHeader from '../components/AttendanceStatusHeader';
import { hasOpenSession } from '../attendance/openSession';
import { requestLocationPermission, getCurrentCoordinates } from '../location/useLocation';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import AnimatedModalCard from '../components/AnimatedModalCard';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePullToRefresh } from '../components/usePullToRefresh';

type Props = NativeStackScreenProps<RootStackParamList, 'Attendance'>;

export default function AttendanceScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const [locationText, setLocationText] = useState('');
  const [confirmHomeOutVisible, setConfirmHomeOutVisible] = useState(false);
  // The calendar date the currently-held `events` were fetched for. The Firestore query
  // bakes in `where('date', '==', ...)` at subscribe time, so a subscription left running
  // overnight keeps serving YESTERDAY's events for today's UI. Deriving state from those
  // and writing an event stamped with today's date is exactly the S338 incident documented
  // in firebase/functions/punchSequence.js — yesterday left unclosed (scored LNF), today
  // corrupted. Nothing downstream prevents it; the server only detects it afterwards.
  const [subscribedDate, setSubscribedDate] = useState(todayDateString());
  const { refreshKey, refreshControl } = usePullToRefresh(() => {
    if (todayDateString() !== subscribedDate) setSubscribedDate(todayDateString());
  });

  // Layer 1: re-subscribe whenever the date we subscribed for changes.
  useEffect(() => {
    if (!user) return;
    return subscribeTodayEvents(user.uid, (newEvents) => {
      setEvents(newEvents);
      setEventsLoaded(true);
    });
  }, [user, subscribedDate, refreshKey]);

  // Layer 1 (cont.): the app spends the rollover suspended, so nothing re-renders at
  // midnight — the date check has to happen when it wakes back up.
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

  const state = deriveOfficeState(events);

  // What the header says — Android's wording ("Checked in · At <place>"), never the raw state.
  const lastOf = (type: string) => [...events].reverse().find((e) => e.type === type);
  let header: { title: string; subtitle?: string };
  if (!eventsLoaded) header = { title: 'Loading…' };
  else if (state === 'NotStarted') header = { title: 'Day not started', subtitle: 'Check in from home to begin your day' };
  else if (state === 'DayStarted') {
    const homeIn = lastOf('home_in');
    header = { title: 'Home checked in', subtitle: homeIn ? `Since ${formatTime(homeIn.timestamp)}` : undefined };
  } else if (state === 'InOffice') {
    const open = lastOf('office_in');
    const where = open?.locationName ? `At ${open.locationName}` : 'Checked in';
    header = { title: 'Checked in', subtitle: open ? `${where} · since ${formatTime(open.timestamp)}` : undefined };
  } else {
    const homeOut = lastOf('home_out');
    header = { title: 'Day complete', subtitle: homeOut ? `Home out at ${formatTime(homeOut.timestamp)}` : undefined };
  }

  async function submitEvent(type: OfficeEventType, locationName?: string) {
    // Layer 2, write-time backstop: the AppState listener may not have fired yet (the day
    // can roll over with the app in the foreground). Never write an event whose `date` would
    // differ from the date the state we just validated against was derived from — refresh
    // instead and make the user re-tap once the UI is current.
    if (todayDateString() !== subscribedDate) {
      setEventsLoaded(false);
      setSubscribedDate(todayDateString());
      return;
    }
    if (!user || submitting) return;
    if (!isOfficeEventAllowed(state, type)) return;
    if (type === 'home_out' && hasOpenSession(events)) {
      Alert.alert('Check out first', 'You still have an open check-in today. Check out of it before ending your day.');
      return;
    }
    setSubmitting(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        Alert.alert('Location required', 'Enable location access to record attendance.');
        return;
      }
      const coords = await getCurrentCoordinates();
      await recordOfficeEvent(user, { type, ...coords, locationName });
    } catch {
      Alert.alert('Could not record attendance', 'Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOfficeIn() {
    setLocationText('');
    setLocationPromptVisible(true);
  }

  function confirmOfficeIn() {
    setLocationPromptVisible(false);
    submitEvent('office_in', locationText.trim());
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
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={refreshControl}>
        <FadeInView style={styles.content}>
          <AttendanceStatusHeader title={header.title} subtitle={header.subtitle} />

          {state === 'NotStarted' && (
            <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={() => submitEvent('home_in')}>
              <Text style={styles.buttonText}>Start Day — Home In</Text>
            </AnimatedPressable>
          )}

          {state === 'DayStarted' && (
            <>
              <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleOfficeIn}>
                <Text style={styles.buttonText}>Check In</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleHomeOut}>
                <Text style={styles.buttonText}>End Day — Home Out</Text>
              </AnimatedPressable>
            </>
          )}

          {state === 'InOffice' && (
            <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={() => submitEvent('office_out')}>
              <Text style={styles.buttonText}>Office Check Out</Text>
            </AnimatedPressable>
          )}

          <DayTimeline events={events} />
        </FadeInView>
        </ScrollView>

        <AnimatedModalCard
          visible={locationPromptVisible}
          style={styles.modalCard}
          onDismiss={() => setLocationPromptVisible(false)}
        >
          <Text style={styles.modalTitle}>Where are you checking in?</Text>
          <TextInput
            style={styles.input}
            value={locationText}
            onChangeText={setLocationText}
            placeholder="Office or site name"
          />
          <AnimatedPressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={confirmOfficeIn}>
            <Text style={styles.buttonText}>Confirm</Text>
          </AnimatedPressable>
          {/* iOS has no hardware back and this overlay isn't tap-dismissible — without a
              Cancel, a mis-tap traps the user into writing an office_in they didn't want. */}
          <AnimatedPressable style={styles.buttonSecondary} onPress={() => setLocationPromptVisible(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </AnimatedPressable>
        </AnimatedModalCard>

        <AnimatedModalCard visible={confirmHomeOutVisible} style={styles.modalCard}>
          <Text style={styles.modalTitle}>End your day?</Text>
          <Text style={styles.modalBody}>
            This closes today's attendance and cannot be undone from the app.
          </Text>
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
  scroll: { flexGrow: 1 },
  content: { padding: 24, gap: 16 },
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
