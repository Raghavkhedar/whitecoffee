import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';

interface TopBarProps {
  title: string;
  onBack: () => void;
}

// Compact gradient header for every screen below Home/Login — same gradient family as
// HeroHeader (Colors.headerGradientStart/End) so the app reads as one visual language, but
// sized for a form screen rather than a full-bleed moment: the content below still needs to
// be the star here.
export default function TopBar({ title, onBack }: TopBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[Colors.headerGradientStart, Colors.headerGradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.bar, { paddingTop: insets.top + 8 }]}
    >
      <Pressable onPress={onBack} hitSlop={8} style={styles.backButton} accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={22} color="white" />
      </Pressable>
      <Text style={styles.screenTitle} numberOfLines={1}>
        {title}
      </Text>
      {/* Invisible spacer matching the back button's width, keeping the title centered. */}
      <View style={styles.backButton} />

    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  backButton: { padding: 8, width: 38 },
  screenTitle: { flex: 1, fontSize: 17, fontFamily: Fonts.semiBold, color: 'white', textAlign: 'center' },
});
