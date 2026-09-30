import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { approveLeave, rejectLeave, subscribePendingLeaves, type PendingLeave } from '../leave/leaveApprovalsApi';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import TopBar from '../components/TopBar';
import AnimatedPressable from '../components/AnimatedPressable';
import AnimatedModalCard from '../components/AnimatedModalCard';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'LeaveApprovals'>;

function errorMessage(e: unknown): string {
  return (e as { code?: string }).code === 'permission-denied'
    ? "You don't have permission to decide this request."
    : 'Could not save — check your connection and try again.';
}

// Admin-only: approve (whole range) or reject pending leave. Partial approval stays in the
// admin portal, as on Android.
export default function LeaveApprovalsScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<PendingLeave[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingLeave | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => subscribePendingLeaves((list) => {
    setItems(list);
    setLoadError(null);
  }, setLoadError), []);

  function confirmApprove(item: PendingLeave) {
    Alert.alert(
      'Approve leave?',
      `${item.userName || item.employeeId}: ${item.fromDate} → ${item.toDate} (${item.totalDays} day${item.totalDays === 1 ? '' : 's'})`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => doApprove(item) },
      ],
    );
  }

  async function doApprove(item: PendingLeave) {
    if (!user) return;
    setBusyId(item.id);
    try {
      await approveLeave(item.userId, item.id, user.name, user.uid);
    } catch (e) {
      Alert.alert('Approval failed', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function doReject() {
    if (!user || !rejecting) return;
    const item = rejecting;
    setRejecting(null);
    setBusyId(item.id);
    try {
      await rejectLeave(item.userId, item.id, user.name, comment.trim(), user.uid);
    } catch (e) {
      Alert.alert('Rejection failed', errorMessage(e));
    } finally {
      setBusyId(null);
      setComment('');
    }
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Leave Approvals" onBack={() => navigation.goBack()} />
      <FlatList
        data={items ?? []}
        keyExtractor={(i) => `${i.userId}/${i.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>{loadError ?? (items === null ? 'Loading…' : 'No pending leave requests')}</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.headRow}>
              <Text style={styles.name}>{item.userName || 'Unknown'}</Text>
              {item.employeeId ? <Text style={styles.emp}>{item.employeeId}</Text> : null}
            </View>
            <Text style={styles.dates}>
              {item.fromDate === item.toDate ? item.fromDate : `${item.fromDate} → ${item.toDate}`}
              {'  ·  '}
              {item.totalDays} day{item.totalDays === 1 ? '' : 's'}
            </Text>
            {item.reason ? <Text style={styles.reason}>{item.reason}</Text> : null}
            {item.placeOfVisit ? <Text style={styles.meta}>Place of visit: {item.placeOfVisit}</Text> : null}
            <View style={styles.actions}>
              <AnimatedPressable
                style={[styles.action, styles.reject]}
                disabled={busyId === item.id}
                onPress={() => {
                  setComment('');
                  setRejecting(item);
                }}
              >
                <Text style={styles.rejectText}>Reject</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={[styles.action, styles.approve]}
                disabled={busyId === item.id}
                onPress={() => confirmApprove(item)}
              >
                <Text style={styles.approveText}>{busyId === item.id ? 'Saving…' : 'Approve'}</Text>
              </AnimatedPressable>
            </View>
          </View>
        )}
      />

      <AnimatedModalCard visible={!!rejecting} style={styles.modal} onDismiss={() => setRejecting(null)}>
        <Text style={styles.modalTitle}>Reject leave</Text>
        <Text style={styles.meta}>
          {rejecting?.userName} · {rejecting?.fromDate} → {rejecting?.toDate}
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Reason for rejection (shown to the employee)"
          placeholderTextColor={Colors.textMuted}
          multiline
          value={comment}
          onChangeText={setComment}
        />
        <AnimatedPressable style={[styles.action, styles.rejectSolid]} onPress={doReject}>
          <Text style={styles.approveText}>Reject request</Text>
        </AnimatedPressable>
        <AnimatedPressable style={[styles.action, styles.cancel]} onPress={() => setRejecting(null)}>
          <Text style={styles.approveText}>Cancel</Text>
        </AnimatedPressable>
      </AnimatedModalCard>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  list: { padding: 16, gap: 12, flexGrow: 1 },
  empty: { textAlign: 'center', color: Colors.textMuted, marginTop: 80 },
  card: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 6, borderWidth: 1, borderColor: Colors.border },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontFamily: Fonts.extraBold, color: Colors.textPrimary },
  emp: { fontSize: 12, fontFamily: Fonts.semiBold, color: Colors.textMuted },
  dates: { fontSize: 14, fontFamily: Fonts.semiBold, color: Colors.primary },
  reason: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  meta: { fontSize: 12, color: Colors.textMuted },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  action: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  approve: { backgroundColor: Colors.primary },
  approveText: { color: 'white', fontFamily: Fonts.bold },
  reject: { backgroundColor: Colors.statusRejectedBg },
  rejectText: { color: Colors.statusRejectedFg, fontFamily: Fonts.bold },
  rejectSolid: { backgroundColor: Colors.statusRejectedFg, flex: 0 },
  cancel: { backgroundColor: Colors.textMuted, flex: 0 },
  modal: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, gap: 12 },
  modalTitle: { fontSize: 18, fontFamily: Fonts.extraBold, color: Colors.textPrimary },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.screenBg,
    borderRadius: 12,
    padding: 14,
    minHeight: 80,
    textAlignVertical: 'top',
    color: Colors.textPrimary,
  },
});
