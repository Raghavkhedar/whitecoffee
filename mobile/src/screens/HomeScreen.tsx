import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import HeroHeader from '../components/HeroHeader';
import FadeInView from '../components/FadeInView';
import HomeCard from '../components/HomeCard';
import TodayStatusCard from '../components/TodayStatusCard';
import AnimatedPressable from '../components/AnimatedPressable';
import { attendanceRouteFor } from '../roles/roleCapabilities';
import { useLogoutWithCheckout } from '../auth/useLogoutWithCheckout';
import { subscribeUnreadCount } from '../notifications/notificationsApi';

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
  route: keyof RootStackParamList;
}

// Deliberately NOT a port of Android's tile grid — this screen earns its own layout: a
// numbered menu-board list, ink-colored icons, warm paper background, sharp-cornered
// "stamped ticket" status card. Every other screen in this app still mirrors Android exactly.
export default function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const logout = useLogoutWithCheckout();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    return subscribeUnreadCount(user.uid, setUnreadCount);
  }, [user]);

  // Attendance, Regularization and the Today card all follow the role-capabilities table —
  // every known role gets them; an unknown role gets none (see attendanceRouteFor).
  const attendanceRoute = attendanceRouteFor(user?.role ?? '');
  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : null;

  const modules: ModuleDef[] = [
    ...(attendanceRoute
      ? [{ key: 'attendance', icon: 'time-outline' as const, label: 'Attendance', subtitle: 'Mark your day', route: attendanceRoute }]
      : []),
    { key: 'mtBuy', icon: 'cart-outline', label: 'M&T Buy', subtitle: 'Log purchases', route: 'MaterialBuy' },
    { key: 'mtRequest', icon: 'construct-outline', label: 'M&T Request', subtitle: 'Request materials', route: 'MaterialRequest' },
    { key: 'materialTransfer', icon: 'swap-horizontal-outline', label: 'Material Transfer', subtitle: 'Move stock', route: 'MaterialTransfer' },
    { key: 'toolTransfer', icon: 'hammer-outline', label: 'Tool Transfer', subtitle: 'Handover tools', route: 'ToolTransfer' },
    { key: 'leave', icon: 'calendar-outline', label: 'Leave', subtitle: 'Time off', route: 'Leave' },
    // Operations only, exactly as Android gates it. A positive check for one role's feature,
    // not an office-vs-ops binary: every other role (sales included) simply doesn't get it.
    // Admin only — isAdmin, never "office-or-admin" (the rules gate approvals on admin).
    ...(user?.role === 'admin'
      ? [{ key: 'leaveApprovals', icon: 'checkmark-done-outline' as const, label: 'Leave Approvals', subtitle: 'Review requests', route: 'LeaveApprovals' as const }]
      : []),
    ...(user?.role === 'operations'
      ? [{ key: 'workProgress', icon: 'stats-chart-outline' as const, label: 'Work Progress', subtitle: 'Daily report', route: 'WorkProgress' as const }]
      : []),
    ...(attendanceRoute
      ? [{ key: 'regularization', icon: 'alert-circle-outline' as const, label: 'Regularization', subtitle: 'Fix attendance', route: 'Regularization' as const }]
      : []),
  ];

  return (
    <View style={styles.screen}>
      <HeroHeader
        onLogout={logout}
        onNotifications={() => navigation.navigate('Notifications')}
        unreadCount={unreadCount}
        showVersion
      >
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
          {attendanceRoute && user && (
            <FadeInView style={styles.section}>
              <TodayStatusCard uid={user.uid} role={user.role} />
            </FadeInView>
          )}

          <FadeInView delay={80} style={styles.section}>
            <View style={styles.quickActions}>
              {attendanceRoute && (
                <AnimatedPressable
                  style={[styles.quickAction, styles.quickActionSolid]}
                  onPress={() => navigation.navigate(attendanceRoute)}
                >
                  <Ionicons name="time-outline" size={17} color="white" />
                  <Text style={styles.quickActionTextSolid}>Check In</Text>
                </AnimatedPressable>
              )}
              <AnimatedPressable style={[styles.quickAction, styles.quickActionOutline]} onPress={() => navigation.navigate('Leave')}>
                <Ionicons name="calendar-outline" size={17} color={Colors.textPrimary} />
                <Text style={styles.quickActionTextOutline}>Apply Leave</Text>
              </AnimatedPressable>
            </View>
          </FadeInView>

          <FadeInView delay={140} style={styles.sectionLabelWrap}>
            <View style={styles.sectionLabelRule} />
            <Text style={styles.sectionLabel}>THE LINEUP</Text>
            <View style={styles.sectionLabelRule} />
          </FadeInView>

          <View style={styles.list}>
            {modules.map((module, i) => (
              <HomeCard
                key={module.key}
                index={i + 1}
                icon={module.icon}
                label={module.label}
                subtitle={module.subtitle}
                last={i === modules.length - 1}
                delay={180 + i * 55}
                onPress={() => navigation.navigate(module.route)}
              />
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
  rolePillText: { color: 'white', fontSize: 11, fontFamily: Fonts.bold, letterSpacing: 0.4 },
  sheet: {
    flex: 1,
    backgroundColor: Colors.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
    padding: 20,
    paddingTop: 36,
  },
  section: { marginBottom: 18 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 46,
    borderRadius: 6,
  },
  quickActionSolid: { backgroundColor: Colors.textPrimary },
  quickActionOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.textPrimary },
  quickActionTextSolid: { color: 'white', fontFamily: Fonts.extraBold, fontSize: 13.5 },
  quickActionTextOutline: { color: Colors.textPrimary, fontFamily: Fonts.extraBold, fontSize: 13.5 },
  sectionLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  sectionLabelRule: { flex: 1, height: 1, backgroundColor: Colors.divider },
  sectionLabel: { fontSize: 12, fontFamily: Fonts.extraBold, color: Colors.textPrimary, letterSpacing: 2.5 },
  list: { marginTop: 4 },
});
