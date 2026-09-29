import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../theme/colors';
import HeroHeader from '../components/HeroHeader';
import FadeInView from '../components/FadeInView';
import HomeCard from '../components/HomeCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const ROLE_LABELS: Record<string, string> = {
  office: 'Office',
  admin: 'Admin',
  operations: 'Operations',
  sales: 'Sales',
};

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
  const firstName = user?.name?.trim().split(' ')[0] || 'there';

  return (
    <View style={styles.screen}>
      <HeroHeader subtitle="Field Operations" onLogout={logout} showVersion>
        <Text style={styles.greeting}>Hi, {firstName}</Text>
        {roleLabel && (
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>{roleLabel}</Text>
          </View>
        )}
      </HeroHeader>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sheet}>
          <FadeInView style={styles.cards}>
            {canUseOfficeAttendance ? (
              <>
                <HomeCard icon="time-outline" label="Attendance" onPress={() => navigation.navigate('Attendance')} />
                <HomeCard
                  icon="alert-circle-outline"
                  label="Regularization"
                  onPress={() => navigation.navigate('Regularization')}
                />
              </>
            ) : (
              <Text style={styles.unavailable}>
                Attendance isn't available for your role on this app yet.
              </Text>
            )}
            <HomeCard icon="calendar-outline" label="Leave" onPress={() => navigation.navigate('Leave')} />
            <HomeCard icon="cart-outline" label="M&T Buy" onPress={() => navigation.navigate('MaterialBuy')} />
            <HomeCard icon="construct-outline" label="M&T Request" onPress={() => navigation.navigate('MaterialRequest')} />
            <HomeCard
              icon="swap-horizontal-outline"
              label="Material Transfer"
              onPress={() => navigation.navigate('MaterialTransfer')}
            />
            <HomeCard icon="hammer-outline" label="Tool Transfer" onPress={() => navigation.navigate('ToolTransfer')} />
          </FadeInView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.headerGradientEnd },
  scrollContent: { flexGrow: 1 },
  greeting: { fontSize: 22, fontWeight: '700', color: 'white', marginTop: 14 },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
  },
  rolePillText: { color: 'white', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  sheet: {
    flex: 1,
    backgroundColor: Colors.screenBg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -20,
    padding: 24,
    paddingTop: 28,
  },
  cards: { gap: 16 },
  unavailable: { fontSize: 15, color: Colors.textMuted, lineHeight: 22 },
});
