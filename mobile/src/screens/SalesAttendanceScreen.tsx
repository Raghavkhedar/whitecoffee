import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { getTodaysSalesCommittedPath } from '../attendance/attendanceApi';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { usePullToRefresh } from '../components/usePullToRefresh';

type Props = NativeStackScreenProps<RootStackParamList, 'SalesAttendance'>;

// Sales chooses office-vs-field ONCE per day (android/CLAUDE.md "ATTENDANCE LOGIC" — Sales
// users section). On mount, check whether either flow is already committed today via a
// one-time read (see attendanceApi.ts's getTodaysSalesCommittedPath doc comment for why this
// isn't a live-derived check) and redirect straight into it with `.replace` — picking the
// WRONG flow while one is already committed would feed that flow's derive function an event
// type it doesn't recognize (e.g. the office screen seeing a `site_in`), so this redirect is
// a correctness guard, not just a convenience.
export default function SalesAttendanceScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [checking, setChecking] = useState(true);
  const { refreshKey, refreshControl } = usePullToRefresh();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getTodaysSalesCommittedPath(user.uid)
      .then((path) => {
        if (cancelled) return;
        if (path === 'office') {
          navigation.replace('Attendance');
        } else if (path === 'field') {
          navigation.replace('OperationsAttendance');
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, navigation, refreshKey]);

  if (checking) {
    return (
      <View style={styles.screen}>
        <TopBar title="Attendance" onBack={() => navigation.goBack()} />
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopBar title="Attendance" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.container} refreshControl={refreshControl}>
        <FadeInView style={styles.content}>
          <Text style={styles.prompt}>How are you working today?</Text>
          <AnimatedPressable style={styles.card} onPress={() => navigation.replace('Attendance')}>
            <Text style={styles.cardTitle}>Office Day</Text>
            <Text style={styles.cardSubtitle}>Check in from the office</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.card} onPress={() => navigation.replace('OperationsAttendance')}>
            <Text style={styles.cardTitle}>Site Visit</Text>
            <Text style={styles.cardSubtitle}>Check in from a site or market</Text>
          </AnimatedPressable>
        </FadeInView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flexGrow: 1 },
  content: { flex: 1, padding: 24, gap: 16 },
  prompt: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary, marginBottom: 8 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  cardSubtitle: { fontSize: 13, color: Colors.textMuted },
});
