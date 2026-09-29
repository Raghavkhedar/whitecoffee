import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, Tiles } from '../theme/colors';
import { Fonts } from '../theme/fonts';
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

  return (
    <View style={styles.screen}>
      <HeroHeader subtitle="Field Operations" onLogout={logout} showVersion>
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
                <HomeCard
                  icon="time-outline"
                  label="Attendance"
                  tile={Tiles.attendance}
                  onPress={() => navigation.navigate('Attendance')}
                />
                <HomeCard
                  icon="alert-circle-outline"
                  label="Regularization"
                  tile={Tiles.regularization}
                  onPress={() => navigation.navigate('Regularization')}
                />
              </>
            ) : (
              <Text style={styles.unavailable}>
                Attendance isn't available for your role on this app yet.
              </Text>
            )}
            <HomeCard icon="calendar-outline" label="Leave" tile={Tiles.leave} onPress={() => navigation.navigate('Leave')} />
            <HomeCard
              icon="cart-outline"
              label="M&T Buy"
              tile={Tiles.mtBuy}
              onPress={() => navigation.navigate('MaterialBuy')}
            />
            <HomeCard
              icon="construct-outline"
              label="M&T Request"
              tile={Tiles.mtRequest}
              onPress={() => navigation.navigate('MaterialRequest')}
            />
            <HomeCard
              icon="swap-horizontal-outline"
              label="Material Transfer"
              tile={Tiles.materialTransfer}
              onPress={() => navigation.navigate('MaterialTransfer')}
            />
            <HomeCard
              icon="hammer-outline"
              label="Tool Transfer"
              tile={Tiles.toolTransfer}
              onPress={() => navigation.navigate('ToolTransfer')}
            />
          </FadeInView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.headerGradientEnd },
  scrollContent: { flexGrow: 1 },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 14,
  },
  rolePillText: {
    color: 'white',
    fontSize: 11,
    fontFamily: Fonts.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
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
