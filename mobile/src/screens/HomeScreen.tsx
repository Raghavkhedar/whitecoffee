import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, Tiles } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import HeroHeader from '../components/HeroHeader';
import FadeInView from '../components/FadeInView';
import HomeCard from '../components/HomeCard';
import TodayStatusCard from '../components/TodayStatusCard';
import AnimatedPressable from '../components/AnimatedPressable';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const ROLE_LABELS: Record<string, string> = {
  office: 'Office',
  admin: 'Admin',
  operations: 'Operations',
  sales: 'Sales',
};

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

interface ModuleDef {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  tile: { bg: string; fg: string };
  route: keyof RootStackParamList;
}

export default function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  // Phase 1 ships the OFFICE attendance flow only. `admin` shares office's attendance
  // event types (see firebase/functions/roleCapabilities.js); operations and sales punch
  // site_in/market_in, so office-shaped punches from this app would be invisible to their
  // payroll scoring. Anything else — including an unknown role — is gated out.
  // Regularization derives its live status from these same office_in/office_out events
  // (see regularizationStatus.ts), so it shares this exact gate.
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : null;

  // Mirrors Android's module list (ui/home/HomeScreen.kt) — same labels, same sub-copy,
  // same per-module tile colors. Regularization and Attendance itself stay gated behind
  // canUseOfficeAttendance until operations/sales attendance ships.
  const modules: ModuleDef[] = [
    ...(canUseOfficeAttendance
      ? [{ key: 'attendance', icon: 'time-outline' as const, label: 'Attendance', subtitle: 'Mark your day', tile: Tiles.attendance, route: 'Attendance' as const }]
      : []),
    { key: 'mtBuy', icon: 'cart-outline', label: 'M&T Buy', subtitle: 'Log purchases', tile: Tiles.mtBuy, route: 'MaterialBuy' },
    { key: 'mtRequest', icon: 'construct-outline', label: 'M&T Request', subtitle: 'Request materials', tile: Tiles.mtRequest, route: 'MaterialRequest' },
    {
      key: 'materialTransfer',
      icon: 'swap-horizontal-outline',
      label: 'Material Transfer',
      subtitle: 'Move stock',
      tile: Tiles.materialTransfer,
      route: 'MaterialTransfer',
    },
    { key: 'toolTransfer', icon: 'hammer-outline', label: 'Tool Transfer', subtitle: 'Handover tools', tile: Tiles.toolTransfer, route: 'ToolTransfer' },
    { key: 'leave', icon: 'calendar-outline', label: 'Leave', subtitle: 'Time off', tile: Tiles.leave, route: 'Leave' },
    ...(canUseOfficeAttendance
      ? [{ key: 'regularization', icon: 'alert-circle-outline' as const, label: 'Regularization', subtitle: 'Fix attendance', tile: Tiles.regularization, route: 'Regularization' as const }]
      : []),
  ];

  // Chunked into rows of 2, matching Android's `modules.chunked(2)` grid exactly — a lone
  // trailing card gets an empty flex spacer so it doesn't stretch to full width.
  const rows: ModuleDef[][] = [];
  for (let i = 0; i < modules.length; i += 2) rows.push(modules.slice(i, i + 2));

  return (
    <View style={styles.screen}>
      <HeroHeader subtitle="Field Operations" onLogout={logout} showVersion>
        <Text style={styles.greeting}>{timeGreeting()}</Text>
        {roleLabel && (
          <View style={styles.rolePill}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#EAFFFE" />
            <Text style={styles.rolePillText}>{roleLabel}</Text>
          </View>
        )}
      </HeroHeader>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sheet}>
          {canUseOfficeAttendance && user && (
            <FadeInView style={styles.section}>
              <TodayStatusCard uid={user.uid} />
            </FadeInView>
          )}

          <FadeInView delay={80} style={styles.section}>
            <View style={styles.quickActions}>
              {canUseOfficeAttendance && (
                <AnimatedPressable style={[styles.quickAction, styles.quickActionPrimary]} onPress={() => navigation.navigate('Attendance')}>
                  <Ionicons name="time-outline" size={18} color="white" />
                  <Text style={styles.quickActionTextPrimary}>Check In</Text>
                </AnimatedPressable>
              )}
              <AnimatedPressable style={[styles.quickAction, styles.quickActionAccent]} onPress={() => navigation.navigate('Leave')}>
                <Ionicons name="calendar-outline" size={18} color={Colors.primaryDark} />
                <Text style={styles.quickActionTextAccent}>Apply Leave</Text>
              </AnimatedPressable>
            </View>
          </FadeInView>

          <FadeInView delay={140} style={styles.sectionLabelWrap}>
            <Text style={styles.sectionLabel}>MODULES</Text>
          </FadeInView>

          <View style={styles.grid}>
            {rows.map((row, rowIndex) => (
              <View key={row.map((m) => m.key).join('-')} style={styles.gridRow}>
                {row.map((module, colIndex) => (
                  <View key={module.key} style={styles.gridCell}>
                    <HomeCard
                      icon={module.icon}
                      label={module.label}
                      subtitle={module.subtitle}
                      tile={module.tile}
                      delay={180 + (rowIndex * 2 + colIndex) * 45}
                      onPress={() => navigation.navigate(module.route)}
                    />
                  </View>
                ))}
                {row.length === 1 && <View style={styles.gridCell} />}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.headerGradientEnd },
  scrollContent: { flexGrow: 1 },
  greeting: { fontSize: 20, fontFamily: Fonts.bold, color: 'white', marginTop: 14 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  rolePillText: {
    color: 'white',
    fontSize: 11,
    fontFamily: Fonts.bold,
    letterSpacing: 0.4,
  },
  sheet: {
    flex: 1,
    backgroundColor: Colors.screenBg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
    padding: 18,
    paddingTop: 24,
  },
  section: { marginBottom: 16 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 48,
    borderRadius: 14,
  },
  quickActionPrimary: { backgroundColor: Colors.primary },
  quickActionAccent: { backgroundColor: Colors.accent },
  quickActionTextPrimary: { color: 'white', fontFamily: Fonts.extraBold, fontSize: 13.5 },
  quickActionTextAccent: { color: Colors.primaryDark, fontFamily: Fonts.extraBold, fontSize: 13.5 },
  sectionLabelWrap: { marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontFamily: Fonts.extraBold, color: Colors.textMuted, letterSpacing: 1.4 },
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  gridCell: { flex: 1 },
});
