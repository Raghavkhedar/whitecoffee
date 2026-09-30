import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import AnimatedPressable from './AnimatedPressable';
import appConfig from '../../app.json';

const APP_VERSION = appConfig.expo.version;

interface HeroHeaderProps {
  onLogout?: () => void;
  onNotifications?: () => void;
  unreadCount?: number;
  showVersion?: boolean;
  children?: React.ReactNode;
}

// Full-bleed gradient header used by Home — every other screen keeps the flat TopBar; this
// is deliberately reserved for the one first-impression screen, so it stays a moment rather
// than becoming visual noise everywhere. Uses the Colors.headerGradientStart/End pair
// already defined for this (ported from Android's palette, which the app never deviates
// from) but previously unused in this app.
export default function HeroHeader({ onLogout, onNotifications, unreadCount = 0, showVersion, children }: HeroHeaderProps) {
  const insets = useSafeAreaInsets();
  const topOffset = insets.top + 12;

  return (
    <LinearGradient
      colors={[Colors.headerGradientStart, Colors.headerGradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { paddingTop: topOffset + 14 }]}
    >
      {onLogout && (
        <AnimatedPressable
          style={[styles.logoutButton, { top: topOffset }]}
          onPress={onLogout}
          hitSlop={10}
          accessibilityLabel="Log out"
        >
          <Ionicons name="log-out-outline" size={20} color="white" />
        </AnimatedPressable>
      )}
      {onNotifications && (
        <AnimatedPressable
          style={[styles.logoutButton, { top: topOffset, right: onLogout ? 64 : 20 }]}
          onPress={onNotifications}
          hitSlop={10}
          accessibilityLabel={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Ionicons name="notifications-outline" size={20} color="white" />
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </AnimatedPressable>
      )}
      <View style={styles.brandRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeLetter}>W</Text>
        </View>
        <Text style={styles.wordmark}>
          White<Text style={styles.wordmarkAccent}>Coffee</Text>
        </Text>
      </View>
      {children}
      {showVersion && <Text style={styles.version}>v{APP_VERSION}</Text>}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  logoutButton: {
    position: 'absolute',
    right: 20,
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  unreadBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.statusRejectedFg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: 'white', fontSize: 10, fontFamily: Fonts.extraBold },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLetter: { color: 'white', fontSize: 16, fontFamily: Fonts.extraBold },
  wordmark: { fontSize: 20, fontFamily: Fonts.bold, color: 'white', letterSpacing: 0.2 },
  wordmarkAccent: { fontFamily: Fonts.extraBold, color: Colors.accent },
  version: { position: 'absolute', bottom: 10, right: 20, fontSize: 11, color: 'rgba(255,255,255,0.55)' },
});
