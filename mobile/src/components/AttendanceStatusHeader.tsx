import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';

// Human status line at the top of an attendance screen (never the raw state-machine name).
export default function AttendanceStatusHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  title: { fontSize: 22, fontFamily: Fonts.extraBold, color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary },
});
