import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { AppHeader, EmptyState, ErrorState, LoadingList, Screen } from '@/components/ui';
import { useResolveHandle } from '@/features/profile/hooks';

/** Shared profile link: https://<APP_LINK_DOMAIN>/@handle arrives here as /u/handle (see +native-intent). */
export default function ProfileHandleLink() {
  const { handle: raw } = useLocalSearchParams<{ handle: string }>();
  const handle = typeof raw === 'string' ? raw.replace(/^@/, '').toLowerCase() : undefined;
  const query = useResolveHandle(handle);
  useEffect(() => {
    if (query.data) router.replace({ pathname: '/user/[id]', params: { id: query.data } });
  }, [query.data]);
  return (
    <Screen header={<AppHeader title="Shared profile" />}>
      {query.isLoading || query.data ? (
        <LoadingList count={2} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => { void query.refetch(); }} />
      ) : (
        <EmptyState
          icon="person-outline"
          title="Profile unavailable"
          body="This link may have changed, or you may not have access to this profile."
          action={{ label: 'Go back', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) }}
        />
      )}
    </Screen>
  );
}
