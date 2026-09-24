import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';
import FadeInView from '../components/FadeInView';
import AnimatedPressable from '../components/AnimatedPressable';
import HomeCard from '../components/HomeCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  // Phase 1 ships the OFFICE attendance flow only. `admin` shares office's attendance
  // event types (see firebase/functions/roleCapabilities.js); operations and sales punch
  // site_in/market_in, so office-shaped punches from this app would be invisible to their
  // payroll scoring. Anything else — including an unknown role — is gated out.
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';

  return (
    <View style={styles.screen}>
      <TopBar />
      <View style={styles.container}>
        <FadeInView style={styles.cards}>
          {canUseOfficeAttendance ? (
            <HomeCard icon="time-outline" label="Attendance" onPress={() => navigation.navigate('Attendance')} />
          ) : (
            <Text style={styles.unavailable}>
              Attendance isn't available for your role on this app yet.
            </Text>
          )}
          <HomeCard icon="calendar-outline" label="Leave" onPress={() => navigation.navigate('Leave')} />
        </FadeInView>
        <AnimatedPressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  container: { flex: 1, padding: 24 },
  cards: { gap: 16 },
  unavailable: { fontSize: 15, color: Colors.textMuted, lineHeight: 22 },
  logout: { marginTop: 'auto', padding: 16, alignItems: 'center' },
  logoutText: { color: Colors.textMuted },
});
