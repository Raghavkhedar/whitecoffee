import React, { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet } from 'react-native';
import {
  getPlannedWindow,
  isHolidayDate,
  subscribeTodayEvents,
  todayDateString,
  type DayEvent,
} from '../attendance/attendanceApi';
import { resolveRestDayType, resolveTodayStatus, type Window } from '../attendance/attendanceRules';
import { usesFixedWindow } from '../roles/roleCapabilities';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';

type Chip = { label: string; bg: string; fg: string; hint?: string };

const NEUTRAL = { bg: Colors.border, fg: Colors.textMuted };

// Same wording as Android's HomeViewModel.deriveLocation.
function describeLocation(e: DayEvent): string {
  switch (e.type) {
    case 'home_in': return 'At Home';
    case 'home_out': return 'Checked out';
    case 'site_in': return e.siteName ? `At ${e.siteName}` : 'At Site';
    case 'site_out': return 'Left site';
    case 'market_in': return e.marketName ? `At ${e.marketName}` : 'At Market';
    case 'market_out': return 'Left market';
    case 'office_in': return e.locationName ? `In Office: ${e.locationName}` : 'In Office';
    case 'office_out': return 'Left office';
    default: return '';
  }
}

function formatTime(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '';
  const d = new Date(epochMs);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function chipFor(events: DayEvent[], role: string, planned: Window | null, restDay: 'Holiday' | 'Sunday' | null): Chip {
  const preview = resolveTodayStatus(events, role, planned);
  // A rest day with no scoreable arrival is not an absence — say what the day is instead.
  if ((preview === 'NotCheckedIn' || preview === 'Pending') && restDay) return { label: restDay, ...NEUTRAL };
  if (preview === 'NotCheckedIn') {
    return { label: 'Not checked in', bg: Colors.statusRejectedBg, fg: Colors.statusRejectedFg };
  }
  switch (preview) {
    case 'Present':
      return { label: 'Present', bg: Colors.statusPresentBg, fg: Colors.statusPresentFg };
    case 'HalfDay':
      return { label: 'Half Day', bg: Colors.statusPendingBg, fg: Colors.statusPendingFg };
    case 'SL':
      return { label: 'Short Leave', bg: Colors.statusSlBg, fg: Colors.statusSlFg };
    default:
      return { label: 'Pending', ...NEUTRAL, hint: 'Not at a site yet' };
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

interface Props {
  uid: string;
  role: string;
}

// Today-at-a-glance, for every role with attendance. The chip is the same verdict the nightly
// computeDailyAttendanceStatus will assign — resolveTodayStatus is a port of Android's
// ResolveTodayStatusUseCase over the shared attendanceRules mirror — so it can't disagree with
// payroll. The date shown is the IST date, the same "today" the punches are filed under.
export default function TodayStatusCard({ uid, role }: Props) {
  const [date, setDate] = useState(todayDateString());
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [planned, setPlanned] = useState<Window | null>(null);
  const [restDay, setRestDay] = useState<'Holiday' | 'Sunday' | null>(resolveRestDayType(date, false));

  useEffect(() => subscribeTodayEvents(uid, setEvents), [uid, date]);

  useEffect(() => {
    let cancelled = false;
    setRestDay(resolveRestDayType(date, false));
    isHolidayDate(date)
      .then((h) => !cancelled && setRestDay(resolveRestDayType(date, h)))
      .catch(() => {});
    if (!usesFixedWindow(role)) {
      getPlannedWindow(uid, date)
        .then((w) => !cancelled && setPlanned(w))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [uid, role, date]);

  // Midnight rollover while backgrounded — same pattern as the attendance screens.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && todayDateString() !== date) setDate(todayDateString());
    });
    return () => sub.remove();
  }, [date]);

  const chip = chipFor(events, role, planned, restDay);
  const last = events[events.length - 1];
  const location = last ? describeLocation(last) : '';
  const since = last ? formatTime(last.timestamp) : '';
  const d = new Date(`${date}T00:00:00Z`);

  return (
    <View style={styles.card}>
      <View style={styles.dateBlock}>
        <Text style={styles.dayName}>{DAY_NAMES[d.getUTCDay()]}</Text>
        <Text style={styles.dateNum}>{d.getUTCDate()}</Text>
        <Text style={styles.monthYear}>{`${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.statusBlock}>
        <Text style={styles.todayLabel}>TODAY</Text>
        <View style={[styles.chip, { backgroundColor: chip.bg, borderColor: chip.fg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label.toUpperCase()}</Text>
        </View>
        {location ? (
          <Text style={styles.hint}>{since ? `${location} · ${since}` : location}</Text>
        ) : chip.hint ? (
          <Text style={styles.hint}>{chip.hint}</Text>
        ) : null}
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
