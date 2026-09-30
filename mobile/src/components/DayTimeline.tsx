import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildTimeline, type TimelineInput } from '../attendance/dayTimeline';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  start: 'home-outline',
  in: 'log-in-outline',
  out: 'log-out-outline',
  end: 'moon-outline',
};

// Today's punches as a vertical timeline — shown under the controls while the day runs, and
// as the whole screen once the day has ended.
export default function DayTimeline({ events }: { events: TimelineInput[] }) {
  const items = buildTimeline(events);
  if (items.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>TODAY'S ACTIVITY</Text>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const tone = item.kind === 'end' ? Colors.primaryDark : Colors.primary;
        return (
          <View key={item.key} style={styles.row}>
            <Text style={styles.time}>{item.time}</Text>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: tone }]}>
                <Ionicons name={ICON[item.kind]} size={12} color="white" />
              </View>
              {!last && <View style={styles.line} />}
            </View>
            <View style={[styles.body, !last && styles.bodyGap]}>
              <Text style={styles.title}>{item.title}</Text>
              {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
              {item.duration ? <Text style={styles.duration}>{item.duration}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heading: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.textMuted, letterSpacing: 1.2, marginBottom: 14 },
  row: { flexDirection: 'row' },
  time: { width: 68, fontSize: 12, fontFamily: Fonts.semiBold, color: Colors.textSecondary, paddingTop: 3 },
  rail: { width: 24, alignItems: 'center' },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: Colors.border, marginVertical: 2 },
  body: { flex: 1, marginLeft: 10, paddingTop: 2 },
  bodyGap: { paddingBottom: 16 },
  title: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.textPrimary },
  detail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  duration: { fontSize: 12, fontFamily: Fonts.semiBold, color: Colors.primary, marginTop: 2 },
});
