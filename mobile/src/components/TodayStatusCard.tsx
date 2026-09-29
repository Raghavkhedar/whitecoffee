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
        <View style={[styles.chip, { backgroundColor: chip.bg, borderColor: chip.fg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label.toUpperCase()}</Text>
        </View>
        {chip.label === 'Pending' && <Text style={styles.hint}>In progress — check out to confirm</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sharp corners, a solid ink border, a printed-ticket feel — deliberately not the soft
  // rounded card every other screen in this app uses.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    padding: 18,
  },
  dateBlock: { flex: 1 },
  dayName: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' },
  dateNum: { fontSize: 34, fontFamily: Fonts.extraBold, color: Colors.textPrimary, lineHeight: 36 },
  monthYear: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.textSecondary, marginTop: 2 },
  divider: { width: 1.5, height: 54, backgroundColor: Colors.textPrimary },
  statusBlock: { alignItems: 'flex-end', marginLeft: 18, maxWidth: 130 },
  todayLabel: { fontSize: 10, fontFamily: Fonts.bold, color: Colors.textMuted, letterSpacing: 1.2 },
  // A stamp, not a pill — sharp corners, a solid ink border matching the card's own.
  chip: { borderRadius: 3, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, marginTop: 8 },
  chipText: { fontSize: 11.5, fontFamily: Fonts.extraBold, letterSpacing: 0.3 },
  hint: { fontSize: 10.5, fontFamily: Fonts.medium, color: Colors.textMuted, marginTop: 6, textAlign: 'right' },
});
