import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>Hi, {user?.name || 'there'}</Text>
      <Pressable style={styles.card} onPress={() => navigation.navigate('Attendance')}>
        <Text style={styles.cardText}>Attendance</Text>
      </Pressable>
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
  logout: { marginTop: 'auto', padding: 16, alignItems: 'center' },
  logoutText: { color: '#8591A0' },
});
