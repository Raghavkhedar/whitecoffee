import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../theme/colors';
import TopBar from '../components/TopBar';

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
        <Text style={styles.greeting}>Hi, {user?.name || 'there'}</Text>
        {canUseOfficeAttendance ? (
          <Pressable style={styles.card} onPress={() => navigation.navigate('Attendance')}>
            <View style={styles.cardIcon}>
              <Ionicons name="time-outline" size={22} color={Colors.primary} />
            </View>
            <Text style={styles.cardText}>Attendance</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </Pressable>
        ) : (
          <Text style={styles.unavailable}>
            Attendance isn't available for your role on this app yet.
          </Text>
        )}
        <Pressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  container: { flex: 1, padding: 24, gap: 16 },
  greeting: { fontSize: 22, fontWeight: '600', marginBottom: 8, color: Colors.textPrimary },
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
  unavailable: { fontSize: 15, color: Colors.textMuted, lineHeight: 22 },
  logout: { marginTop: 'auto', padding: 16, alignItems: 'center' },
  logoutText: { color: Colors.textMuted },
});
