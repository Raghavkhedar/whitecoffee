import React, { useCallback, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { enableNetwork } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Colors } from '../theme/colors';

const MIN_SPIN_MS = 700;

/**
 * Pull-to-refresh for any ScrollView/FlatList: pass `refreshControl` to it, and add
 * `refreshKey` to the deps of the effects that load data. Bumping the key tears those
 * listeners down and re-opens them, which fetches the current server state; one-time reads
 * (planned shift, holidays, a past date's status) re-run the same way. `onRefresh` is for any
 * extra work a screen needs. The spinner always shows for at least MIN_SPIN_MS so the
 * gesture reads as having done something, even when nothing changed.
 */
export function usePullToRefresh(onRefresh?: () => unknown) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    const minSpin = new Promise((r) => setTimeout(r, MIN_SPIN_MS));
    try {
      // Nudges the SDK to reconnect now if it was backing off after a network drop.
      await Promise.all([enableNetwork(db).catch(() => {}), Promise.resolve(onRefreshRef.current?.()), minSpin]);
    } catch {
      await minSpin;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={refresh}
      tintColor={Colors.primary}
      colors={[Colors.primary]}
      progressBackgroundColor={Colors.surface}
    />
  );

  return { refreshKey, refreshControl };
}
