import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import AnimatedPressable from './AnimatedPressable';

interface Tile {
  bg: string;
  fg: string;
}

interface HomeCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  onPress: () => void;
  /** Per-module tile color (Colors.Tiles.X). */
  tile: Tile;
  /** Staggered entrance delay in ms — each grid cell reveals slightly after the last. */
  delay?: number;
}

// A 2-column grid cell — icon tile above a label + subtitle, mirroring Android's own
// ModuleCard (ui/home/HomeScreen.kt) exactly, down to the per-module sub-copy.
export default function HomeCard({ icon, label, subtitle, onPress, tile, delay = 0 }: HomeCardProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));
    // One-shot mount animation, staggered by `delay`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entrance = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={entrance}>
      <AnimatedPressable style={styles.card} onPress={onPress}>
        <View style={[styles.iconTile, { backgroundColor: tile.bg }]}>
          <Ionicons name={icon} size={22} color={tile.fg} />
        </View>
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 118,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    borderRadius: 20,
    padding: 15,
    gap: 16,
    justifyContent: 'space-between',
  },
  iconTile: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14.5, fontFamily: Fonts.extraBold, color: Colors.textPrimary, lineHeight: 17 },
  subtitle: { fontSize: 11.5, fontFamily: Fonts.medium, color: Colors.textHint, marginTop: 3 },
});
