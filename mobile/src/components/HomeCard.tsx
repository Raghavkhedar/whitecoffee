import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  onPress: () => void;
  /** Per-module tile color (Colors.Tiles.X) — falls back to the neutral accent/primary pair
   * used before every card had its own color. */
  tile?: Tile;
}

export default function HomeCard({ icon, label, onPress, tile }: HomeCardProps) {
  const iconBg = tile?.bg ?? Colors.accent;
  const iconFg = tile?.fg ?? Colors.primary;
  return (
    <AnimatedPressable style={styles.card} onPress={onPress}>
      <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={22} color={iconFg} />
      </View>
      <Text style={styles.cardText}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 18,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, fontSize: 17, fontFamily: Fonts.semiBold, color: Colors.textPrimary },
});
