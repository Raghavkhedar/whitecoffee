import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import appConfig from '../../app.json';

const APP_VERSION = appConfig.expo.version;

interface TopBarProps {
  /** Shown next to the back button instead of the brand mark, when `onBack` is set. */
  title?: string;
  /** Renders a back chevron and switches the left side to `title` instead of the brand mark. */
  onBack?: () => void;
}

export default function TopBar({ title, onBack }: TopBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.left}>
        {onBack ? (
          <>
            <Pressable onPress={onBack} hitSlop={8} style={styles.backButton}>
              <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.screenTitle}>{title}</Text>
          </>
        ) : (
          <View style={styles.brand}>
            <View style={styles.badge}>
              <Text style={styles.badgeLetter}>W</Text>
            </View>
            <Text style={styles.wordmark}>
              White<Text style={styles.wordmarkAccent}>Coffee</Text>
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.version}>v{APP_VERSION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  backButton: { padding: 4, marginRight: 2 },
  screenTitle: { fontSize: 17, fontWeight: '600', color: Colors.textPrimary },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLetter: { color: 'white', fontSize: 13, fontWeight: '700' },
  wordmark: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  wordmarkAccent: { fontWeight: '800', color: Colors.primary },
  version: { fontSize: 12, color: Colors.textMuted },
});
