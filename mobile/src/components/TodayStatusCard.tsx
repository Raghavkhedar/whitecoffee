import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';
import { subscribeTodayOfficeEvents } from '../attendance/attendanceApi';
import { classify } from '../regularization/regularizationStatus';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';

type Chip = { label: string; bg: string; fg: string };

// Same IST-minutes conversion as regularizationStatus.ts's private `istMinutesOfDay` — small
// enough that duplicating it here (rather than exporting a helper solely for this one caller)
// matches this app's existing tolerance for a few duplicated lines over cross-module coupling.
function istMinutesOfDay(epochMs: number): number {
  const istMs = epochMs + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function deriveChip(events: OfficeAttendanceEvent[]): Chip {
  const checkIns = events.filter((e) => e.type === 'office_in');
  const checkOuts = events.filter((e) => e.type === 'office_out');
  if (checkIns.length === 0) {
    return { label: 'Not checked in', bg: Colors.statusRejectedBg, fg: Colors.statusRejectedFg };
  }
  if (checkOuts.length === 0) {
    return { label: 'Pending', bg: Colors.border, fg: Colors.textMuted };
  }
  const inMin = istMinutesOfDay(checkIns[0].timestamp);
  const outMin = istMinutesOfDay(checkOuts[checkOuts.length - 1].timestamp);
  const result = classify(inMin, outMin);
  if (result === 'Present') return { label: 'Present', bg: Colors.statusPresentBg, fg: Colors.statusPresentFg };
  if (result === 'HalfDay') return { label: 'Half Day', bg: Colors.statusPendingBg, fg: Colors.statusPendingFg };
  return { label: 'Short Leave', bg: Colors.statusSlBg, fg: Colors.statusSlFg };
}

const DAY_NAME_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

interface Props {
  uid: string;
}

// The employee's live today-at-a-glance card, ported from Android's TodayStatusCard
// (ui/home/HomeScreen.kt) — date on the left, a status chip on the right derived from the
// same office_in/office_out events + classify() rule Regularization already uses, so the
// chip can never disagree with what the nightly payroll job will eventually write.
export default function TodayStatusCard({ uid }: Props) {
  const [events, setEvents] = useState<OfficeAttendanceEvent[]>([]);
  const now = new Date();

  useEffect(() => {
    return subscribeTodayOfficeEvents(uid, setEvents);
  }, [uid]);

  const chip = deriveChip(events);

  return (
    <View style={styles.card}>
      <View style={styles.dateBlock}>
        <Text style={styles.dayName}>{DAY_NAME_FORMAT.format(now)}</Text>
        <Text style={styles.dateNum}>{now.getDate()}</Text>
        <Text style={styles.monthYear}>{MONTH_YEAR_FORMAT.format(now)}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.statusBlock}>
        <Text style={styles.todayLabel}>TODAY</Text>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label}</Text>
        </View>
        {chip.label === 'Pending' && <Text style={styles.hint}>In progress — check out to confirm</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    padding: 18,
  },
  dateBlock: { flex: 1 },
  dayName: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.textMuted },
  dateNum: { fontSize: 33, fontFamily: Fonts.extraBold, color: '#0B0F0F', lineHeight: 35 },
  monthYear: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.textSecondary, marginTop: 2 },
  divider: { width: 1, height: 54, backgroundColor: Colors.border },
  statusBlock: { alignItems: 'flex-end', marginLeft: 18, maxWidth: 130 },
  todayLabel: { fontSize: 10, fontFamily: Fonts.semiBold, color: Colors.textMuted, letterSpacing: 0.4 },
  chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginTop: 7 },
  chipText: { fontSize: 12, fontFamily: Fonts.bold },
  hint: { fontSize: 10.5, fontFamily: Fonts.medium, color: Colors.textMuted, marginTop: 6, textAlign: 'right' },
});
