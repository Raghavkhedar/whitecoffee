import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  // Phase 1 ships the OFFICE attendance flow only. `admin` shares office's attendance
  // event types (see firebase/functions/roleCapabilities.js); operations and sales punch
  // site_in/market_in, so office-shaped punches from this app would be invisible to their
  // payroll scoring. Anything else — including an unknown role — is gated out.
  const canUseOfficeAttendance = user?.role === 'office' || user?.role === 'admin';

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Hi, {user?.name || 'there'}</Text>
      {canUseOfficeAttendance ? (
        <Pressable style={styles.card} onPress={() => navigation.navigate('Attendance')}>
          <Text style={styles.cardText}>Attendance</Text>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  greeting: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E9E9',
    borderRadius: 12,
    padding: 24,
  },
  cardText: { fontSize: 18, fontWeight: '600', color: '#006A71' },
  unavailable: { fontSize: 15, color: '#8591A0', lineHeight: 22 },
  logout: { marginTop: 'auto', padding: 16, alignItems: 'center' },
  logoutText: { color: '#8591A0' },
});
