import { useCallback, useState } from 'react';

/** Spinner only for a user pull, not for background refetches (realtime invalidations made it flash). */
export function usePullRefresh(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().catch(() => {}).finally(() => setRefreshing(false));
  }, [refresh]);
  return { refreshing, onRefresh };
}
