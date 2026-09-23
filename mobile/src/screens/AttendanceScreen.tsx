import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, TextInput, Modal } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import {
  deriveOfficeState,
  isOfficeEventAllowed,
  type OfficeAttendanceEvent,
  type OfficeEventType,
} from '../attendance/officeAttendanceState';
import { subscribeTodayOfficeEvents, recordOfficeEvent } from '../attendance/attendanceApi';
import { requestLocationPermission, getCurrentCoordinates } from '../location/useLocation';

export default function AttendanceScreen() {
  const { user } = useAuth();
  const [events, setEvents] = useState<OfficeAttendanceEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const [locationText, setLocationText] = useState('');
  const [confirmHomeOutVisible, setConfirmHomeOutVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    return subscribeTodayOfficeEvents(user.uid, (newEvents) => {
      setEvents(newEvents);
      setEventsLoaded(true);
    });
  }, [user]);

  const state = deriveOfficeState(events);

  async function submitEvent(type: OfficeEventType, locationName?: string) {
    if (!user || submitting) return;
    if (!isOfficeEventAllowed(state, type)) return;
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
    <View style={styles.container}>
      <Text style={styles.state}>Status: {state}</Text>

      {state === 'NotStarted' && (
        <Pressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={() => submitEvent('home_in')}>
          <Text style={styles.buttonText}>Start Day — Home In</Text>
        </Pressable>
      )}

      {state === 'DayStarted' && (
        <>
          <Pressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleOfficeIn}>
            <Text style={styles.buttonText}>Office Check In</Text>
          </Pressable>
          <Pressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={handleHomeOut}>
            <Text style={styles.buttonText}>End Day — Home Out</Text>
          </Pressable>
        </>
      )}

      {state === 'InOffice' && (
        <Pressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={() => submitEvent('office_out')}>
          <Text style={styles.buttonText}>Office Check Out</Text>
        </Pressable>
      )}

      {state === 'DayEnded' && <Text style={styles.state}>Day complete</Text>}

      <Modal visible={locationPromptVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Where are you?</Text>
            <TextInput
              style={styles.input}
              value={locationText}
              onChangeText={setLocationText}
              placeholder="e.g. Head Office"
            />
            <Pressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={confirmOfficeIn}>
              <Text style={styles.buttonText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={confirmHomeOutVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>End your day?</Text>
            <Text>This closes today's attendance and cannot be undone from the app.</Text>
            <Pressable style={styles.button} disabled={submitting || !eventsLoaded} onPress={confirmHomeOut}>
              <Text style={styles.buttonText}>Yes, Home Out</Text>
            </Pressable>
            <Pressable style={styles.buttonSecondary} onPress={() => setConfirmHomeOutVisible(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  state: { fontSize: 18, fontWeight: '600' },
  button: { backgroundColor: '#006A71', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#8591A0', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: 'white', borderRadius: 12, padding: 24, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#E2E9E9', borderRadius: 8, padding: 12 },
});
