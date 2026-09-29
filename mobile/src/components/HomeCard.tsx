import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import AnimatedPressable from './AnimatedPressable';

interface HomeCardProps {
  index: number;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  onPress: () => void;
  /** Omits the bottom hairline — set on the last row in the list. */
  last?: boolean;
  /** Staggered entrance delay in ms — each row reveals slightly after the last. */
  delay?: number;
}

// A menu-board row: a tracked index number, one ink-colored icon (no colorful tile chip),
// label + subtitle, hairline divider below. Deliberately not the icon-tile grid every other
// screen in this app has — Home is the one place a different, more editorial layout earns
// its keep.
export default function HomeCard({ index, icon, label, subtitle, onPress, last, delay = 0 }: HomeCardProps) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-10);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }));
    translateX.value = withDelay(delay, withTiming(0, { duration: 360, easing: Easing.out(Easing.cubic) }));
    // One-shot mount animation, staggered by `delay`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entrance = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Animated.View style={entrance}>
      <AnimatedPressable style={[styles.row, !last && styles.rowDivided]} onPress={onPress}>
        <Text style={styles.index}>{String(index).padStart(2, '0')}</Text>
        <Ionicons name={icon} size={20} color={Colors.textPrimary} style={styles.icon} />
        <View style={styles.textBlock}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 14,
  },
  rowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  index: { fontSize: 13, fontFamily: Fonts.extraBold, color: Colors.primary, letterSpacing: 0.5, width: 20 },
  icon: { width: 22 },
  textBlock: { flex: 1 },
  label: { fontSize: 15.5, fontFamily: Fonts.bold, color: Colors.textPrimary },
  subtitle: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.textMuted, marginTop: 2 },
});
