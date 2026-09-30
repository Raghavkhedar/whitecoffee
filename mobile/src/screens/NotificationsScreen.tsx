import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import {
  markAllAsRead,
  markAsRead,
  subscribeNotifications,
  type AppNotification,
} from '../notifications/notificationsApi';
import { relativeTime } from '../notifications/relativeTime';
import { Colors } from '../theme/colors';
import { Fonts } from '../theme/fonts';
import TopBar from '../components/TopBar';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

// users/{uid}/notifications — written by the admin portal and Cloud Functions; the employee
// only reads and marks read (rules forbid owner-create). Tapping marks one read.
export default function NotificationsScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeNotifications(user.uid, setItems);
  }, [user]);

  const hasUnread = !!items?.some((n) => !n.isRead);
  const now = Date.now();

  function open(n: AppNotification) {
    if (!user) return;
    if (!n.isRead) markAsRead(user.uid, n.id);
    setExpanded((cur) => (cur === n.id ? null : n.id));
  }

  return (
    <View style={styles.screen}>
      <TopBar
        title="Notifications"
        onBack={() => navigation.goBack()}
        right={
          hasUnread && user
            ? { label: 'Read all', onPress: () => markAllAsRead(user.uid).catch(() => {}) }
            : undefined
        }
      />
      <FlatList
        data={items ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          items === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="notifications-off-outline" size={36} color={Colors.textHint} />
              <Text style={styles.empty}>No notifications yet</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)} style={[styles.card, !item.isRead && styles.cardUnread]}>
            <View style={styles.row}>
              {!item.isRead && <View style={styles.dot} />}
              <Text style={[styles.title, !item.isRead && styles.titleUnread]} numberOfLines={expanded === item.id ? undefined : 1}>
                {item.title}
              </Text>
              {item.createdAt != null && <Text style={styles.time}>{relativeTime(item.createdAt, now)}</Text>}
            </View>
            {item.body ? (
              <Text style={styles.body} numberOfLines={expanded === item.id ? undefined : 2}>
                {item.body}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.screenBg },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardUnread: { borderColor: Colors.primary, backgroundColor: '#F7FCFC' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  title: { flex: 1, fontSize: 15, fontFamily: Fonts.semiBold, color: Colors.textPrimary },
  titleUnread: { fontFamily: Fonts.extraBold },
  time: { fontSize: 12, color: Colors.textMuted },
  body: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  empty: { textAlign: 'center', color: Colors.textMuted, fontSize: 14 },
});
