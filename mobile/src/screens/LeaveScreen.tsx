import React, { useEffect, useRef, useState } from 'react';
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
  const applyScrollRef = useRef<ScrollView>(null);

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
    // Mirrors firebase/firestore.rules's isValidLeaveDates ceiling (d.totalDays <= 366) —
    // keep this in sync with that rule, not a magic number to "clean up".
    if (dayCount > 366) {
      setFormError('Leave range cannot exceed 366 days — check your selected dates.');
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
        <ScrollView
          ref={applyScrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
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
              // automaticallyAdjustKeyboardInsets only guarantees the cursor is visible, which
              // for an empty/short multiline field can leave its bottom half under the keyboard.
              // It's also the last field before Submit, so scrolling to the end (with the extra
              // bottom padding on `content`) reliably clears the whole box plus the button.
              onFocus={() => applyScrollRef.current?.scrollToEnd({ animated: true })}
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
  // Small extra bottom padding for breathing room below the Submit button once scrolled to
  // the end — automaticallyAdjustKeyboardInsets already accounts for the keyboard itself, so
  // this only needs to be a little slack, not enough to compensate for the keyboard again.
  content: { padding: 24, paddingBottom: 40, gap: 16 },
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
