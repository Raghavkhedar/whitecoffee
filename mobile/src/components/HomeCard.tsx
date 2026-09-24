import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import AnimatedPressable from './AnimatedPressable';

interface HomeCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

export default function HomeCard({ icon, label, onPress }: HomeCardProps) {
  return (
    <AnimatedPressable style={styles.card} onPress={onPress}>
      <View style={styles.cardIcon}>
        <Ionicons name={icon} size={22} color={Colors.primary} />
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
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, fontSize: 17, fontWeight: '600', color: Colors.textPrimary },
});
