import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TextInput, StyleSheet, ScrollView, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import {
  getPlannedWindow,
  subscribeTodayEvents,
  todayDateString,
  type DayEvent,
} from '../attendance/attendanceApi';
import type { Window } from '../attendance/attendanceRules';
import { usesConveyance, usesFixedWindow } from '../roles/roleCapabilities';
import { deriveTodayLiveStatus, isRestDay } from '../regularization/regularizationStatus';
import {
  submitRegularizationRequest,
  subscribeRegularizationWindow,
  getAttendanceStatusForDate,
  hasPendingOrApprovedRequest,
  checkIsHoliday,
  subscribeRequestForDate,
  blocksNewRequest,
  type ExistingRequest,
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

const REQUEST_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  pending: { text: 'Request submitted — pending review', bg: Colors.statusPendingBg, fg: Colors.statusPendingFg },
  approved: { text: 'Request approved', bg: Colors.statusPresentBg, fg: Colors.statusPresentFg },
  rejected: { text: 'Previous request rejected — you can request again', bg: Colors.statusRejectedBg, fg: Colors.statusRejectedFg },
};

function RequestStatus({ request }: { request: ExistingRequest | null }) {
  if (!request) return null;
  const label = REQUEST_LABEL[request.status];
  if (!label) return null;
  return (
    <View style={[styles.requestPill, { backgroundColor: label.bg }]}>
      <Text style={[styles.requestText, { color: label.fg }]}>{label.text}</Text>
      {request.approverComment ? (
        <Text style={[styles.requestComment, { color: label.fg }]}>“{request.approverComment}”</Text>
      ) : null}
    </View>
  );
}

export default function RegularizationScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [plannedWindow, setPlannedWindow] = useState<Window | null>(null);
  const role = user?.role ?? '';
  // KM is offered only to roles that earn conveyance (ops/sales) — same gate as Android.
  const canClaimConveyance = usesConveyance(role);
  const [km, setKm] = useState('');
  const [windowOpen, setWindowOpen] = useState(false);
  const modalScrollRef = useRef<ScrollView>(null);
  // Same rollover guard as AttendanceScreen.tsx: the Firestore query behind
  // subscribeTodayEvents bakes in `where('date', '==', ...)` at subscribe time, so a
  // subscription left running across midnight keeps serving yesterday's events. Re-key the
  // subscription on this and re-check it on AppState 'active' (see below).
  const [subscribedDate, setSubscribedDate] = useState(todayDateString());

  const [pastPickerVisible, setPastPickerVisible] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date>(yesterday());
  const [pastStatus, setPastStatus] = useState<string | null>(null);
  const [pastStatusLoading, setPastStatusLoading] = useState(false);
  const [todayRequest, setTodayRequest] = useState<ExistingRequest | null>(null);
  const [pastRequest, setPastRequest] = useState<ExistingRequest | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState('');
  const [modalOriginalStatus, setModalOriginalStatus] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Re-subscribe whenever the date we subscribed for changes.
  useEffect(() => {
    if (!user) return;
    return subscribeTodayEvents(user.uid, setEvents);
  }, [user, subscribedDate]);

  // Operations score against the day's planned shift (10:00–18:00 when none is set).
  useEffect(() => {
    if (!user || usesFixedWindow(user.role)) return;
    let cancelled = false;
    setPlannedWindow(null);
    getPlannedWindow(user.uid, subscribedDate)
      .then((w) => !cancelled && setPlannedWindow(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, subscribedDate]);

  // The app spends the rollover suspended, so nothing re-renders at midnight — the date
  // check has to happen when it wakes back up.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        const current = todayDateString();
        if (current !== subscribedDate) {
          setSubscribedDate(current);
        }
      }
    });
    return () => subscription.remove();
  }, [subscribedDate]);

  useEffect(() => {
    return subscribeRegularizationWindow(setWindowOpen);
  }, []);

  // The request already filed for today / the picked date, if any — live, so the button is
  // replaced by its status the moment a request is submitted.
  useEffect(() => {
    if (!user) return;
    setTodayRequest(null);
    return subscribeRequestForDate(user.uid, subscribedDate, setTodayRequest);
  }, [user, subscribedDate]);

  const pickedDateString = formatDateString(pickedDate);
  useEffect(() => {
    if (!user || !pastPickerVisible) return;
    setPastRequest(null);
    return subscribeRequestForDate(user.uid, pickedDateString, setPastRequest);
  }, [user, pastPickerVisible, pickedDateString]);

  const todayLiveStatus = deriveTodayLiveStatus(events, role, plannedWindow);

  function openTodayModal() {
    // Write-time backstop, mirroring Attendance's submitEvent: the AppState listener may
    // not have fired yet (the day can roll over with the app in the foreground). Never open
    // the modal against a `todayLiveStatus` derived from a stale day's events — refresh and
    // make the user re-tap once the UI is current.
    if (todayDateString() !== subscribedDate) {
      setSubscribedDate(todayDateString());
      return;
    }
    if (!todayLiveStatus || blocksNewRequest(todayRequest)) return;
    setFormError(null);
    setReason('');
    setKm('');
    setModalDate(todayDateString());
    setModalOriginalStatus(todayLiveStatus);
    setModalVisible(true);
  }

  async function loadPastStatus(date: Date) {
    if (!user) return;
    setPastStatusLoading(true);
    setFormError(null);
    try {
      const status = await getAttendanceStatusForDate(user.uid, formatDateString(date));
      setPastStatus(status ?? 'Unmarked');
    } catch {
      setPastStatus(null);
      setFormError('Could not check this date — check your connection and try again.');
    } finally {
      setPastStatusLoading(false);
    }
  }

  async function handlePickPastDate(_: DateTimePickerEvent, date?: Date) {
    if (!date) return;
    setPickedDate(date);
    await loadPastStatus(date);
  }

  // A compact iOS DateTimePicker only fires onChange when the user actually moves the value
  // away from what's shown — picking up yesterday (the default `pickedDate`, and the single
  // most likely date to correct) would otherwise never trigger handlePickPastDate, leaving
  // pastStatus null and the "Request Correction" button permanently hidden. Load the status
  // for whatever's already shown as soon as the section opens.
  useEffect(() => {
    if (pastPickerVisible) {
      loadPastStatus(pickedDate);
    }
    // Only re-run when the section is opened/closed — handlePickPastDate covers the
    // already-open case where the user actively changes the date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastPickerVisible]);

  function openPastModal() {
    if (!pastStatus || blocksNewRequest(pastRequest)) return;
    setFormError(null);
    setReason('');
    setKm('');
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
    let claimedKm: number | null = null;
    if (canClaimConveyance && km.trim()) {
      claimedKm = Number(km.trim().replace(',', '.'));
      if (!Number.isFinite(claimedKm) || claimedKm < 0) {
        setFormError('KM must be a number.');
        return;
      }
    }
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      let duplicate: boolean;
      let holiday: boolean;
      try {
        // Both are direct Firestore reads (unlike submitRegularizationRequest below, which
        // is fire-and-forget and never rejects) — offline, these reject, so they need their
        // own error handling rather than surfacing as an unhandled rejection with the UI
        // silently falling back to idle.
        duplicate = await hasPendingOrApprovedRequest(user.uid, modalDate);
        holiday = await checkIsHoliday(modalDate);
      } catch {
        setFormError('Could not check this date — check your connection and try again.');
        return;
      }
      if (duplicate) {
        setFormError('You already have a pending or approved request for this date.');
        return;
      }
      if (isRestDay(modalDate, holiday)) {
        setFormError('This date is a rest day and cannot be regularized.');
        return;
      }
      try {
        await submitRegularizationRequest(user, {
          date: modalDate,
          originalStatus: modalOriginalStatus,
          reason: reason.trim(),
          claimedKm,
        });
      } catch (e) {
        setFormError((e as Error).message);
        return;
      }
      setModalVisible(false);
      setReason('');
      setKm('');
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
              <RequestStatus request={todayRequest} />
              {!blocksNewRequest(todayRequest) && (
                <AnimatedPressable style={styles.button} onPress={openTodayModal}>
                  <Text style={styles.buttonText}>Request Correction</Text>
                </AnimatedPressable>
              )}
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
                {!pastStatusLoading && !pastStatus && formError && (
                  <Text style={styles.error}>{formError}</Text>
                )}
                {!pastStatusLoading && pastStatus && (
                  <>
                    <Text style={styles.state}>
                      {formatDateString(pickedDate)} status: {STATUS_LABEL[pastStatus] ?? pastStatus}
                    </Text>
                    <RequestStatus request={pastRequest} />
                    {!blocksNewRequest(pastRequest) && (
                      <AnimatedPressable style={styles.button} onPress={openPastModal}>
                        <Text style={styles.buttonText}>Request Correction</Text>
                      </AnimatedPressable>
                    )}
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

      <AnimatedModalCard visible={modalVisible} style={styles.modalCard} onDismiss={() => setModalVisible(false)}>
        <ScrollView
          ref={modalScrollRef}
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="always"
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
            {canClaimConveyance && (
              <TextInput
                style={styles.input}
                placeholder="KM traveled that day (optional)"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                value={km}
                onChangeText={setKm}
                onFocus={() => modalScrollRef.current?.scrollToEnd({ animated: true })}
              />
            )}
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
  requestPill: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 4 },
  requestText: { fontSize: 13, fontWeight: '700' },
  requestComment: { fontSize: 13 },
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
  modalContent: { paddingBottom: 12, gap: 12 },
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
