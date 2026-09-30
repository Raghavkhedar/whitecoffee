import React, { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet, Alert, TextInput, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { deriveOpsState, isOpsEventAllowed, type OpsEventType } from '../attendance/opsAttendanceState';
import { subscribeTodayEvents, recordOpsEvent, todayDateString, type DayEvent } from '../attendance/attendanceApi';
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

type Props = NativeStackScreenProps<RootStackParamList, 'OperationsAttendance'>;

export default function OperationsAttendanceScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<DayEvent[]>([]);
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
    return subscribeTodayEvents(user.uid, (newEvents) => {
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

  // Android's wording, never the raw state name.
  const lastOf = (type: string) => [...events].reverse().find((e) => e.type === type);
  const since = (e?: DayEvent) => (e ? `Since ${formatTime(e.timestamp)}` : undefined);
  let header: { title: string; subtitle?: string };
  if (!eventsLoaded) header = { title: 'Loading…' };
  else if (state === 'NoRecord') header = { title: 'Not started', subtitle: 'Check in from home to begin your day' };
  else if (state === 'HomeCheckedIn') header = { title: 'At Home', subtitle: since(events[events.length - 1]) };
  else if (state === 'SiteCheckedIn') {
    const open = lastOf('site_in');
    header = { title: open?.siteName ? `At Site: ${open.siteName}` : 'At Site', subtitle: since(open) };
  } else if (state === 'MarketCheckedIn') {
    const open = lastOf('market_in');
    header = { title: open?.marketName ? `At Market: ${open.marketName}` : 'At Market', subtitle: since(open) };
  } else {
    const homeOut = lastOf('home_out');
    header = { title: 'Day complete', subtitle: homeOut ? `Home out at ${formatTime(homeOut.timestamp)}` : undefined };
  }

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
        <ScrollView contentContainerStyle={styles.scroll}>
        <FadeInView style={styles.content}>
          <AttendanceStatusHeader title={header.title} subtitle={header.subtitle} />

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

          <DayTimeline events={events} />
        </FadeInView>
        </ScrollView>

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
