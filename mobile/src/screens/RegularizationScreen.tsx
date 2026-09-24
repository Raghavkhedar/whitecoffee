import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
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
  const modalScrollRef = useRef<ScrollView>(null);

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
        <ScrollView
          ref={modalScrollRef}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
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
            // Same fix as LeaveScreen's Reason field: automaticallyAdjustKeyboardInsets only
            // guarantees the cursor is visible, not the whole field, and this is the last
            // field before Submit/Cancel — scroll to the end so the keyboard never strands
            // the buttons below it.
            onFocus={() => modalScrollRef.current?.scrollToEnd({ animated: true })}
          />
          {formError && <Text style={styles.error}>{formError}</Text>}
          <AnimatedPressable style={styles.button} disabled={submitting} onPress={handleSubmit}>
            <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Submit Request'}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.buttonSecondary} onPress={() => setModalVisible(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </AnimatedPressable>
        </ScrollView>
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
  // Short modal (title, one status line, one input, error, two buttons) — a small buffer
  // below Cancel is enough once scrolled to the end; no need for Leave's large paddingBottom
  // tuning, which exists there for a much longer multi-field form.
  modalContent: { paddingBottom: 12 },
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
