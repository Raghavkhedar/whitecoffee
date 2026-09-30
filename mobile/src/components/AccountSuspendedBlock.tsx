import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';

interface Props {
  reason: string;
  expectedReturn: string;
}

// Full-screen, non-dismissable — a port of Android's AccountSuspendedBlock. It lifts on its own
// when an admin restores the account (the users/{uid} listener flips accountStatus back). The
// rules already refuse a suspended user's writes (isActive()); without this screen they would
// just see actions mysteriously fail.
export default function AccountSuspendedBlock({ reason, expectedReturn }: Props) {
  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed-outline" size={34} color={Colors.statusRejectedFg} />
      </View>
      <Text style={styles.title}>Account suspended</Text>
      {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      {expectedReturn ? <Text style={styles.expected}>Expected return: {expectedReturn}</Text> : null}
      <Text style={styles.body}>
        Please contact your administrator. Your access will return automatically once restored.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.screenBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.statusRejectedBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 22, fontFamily: Fonts.extraBold, color: Colors.textPrimary },
  reason: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' },
  expected: { fontSize: 13, color: Colors.textMuted },
  body: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8 },
});
