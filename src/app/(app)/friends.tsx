import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { AppHeader, Avatar, EmptyState, ErrorState, LoadingList, Screen, Text } from '@/components/ui';
import { useConnections } from '@/features/social/hooks';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { useTheme } from '@/theme';

export default function FriendsScreen() {
  const t = useTheme();
  const connections = useConnections();
  const pull = usePullRefresh(() => connections.refetch());
  const people = connections.data?.pages.flat() ?? [];
  const empty = connections.isLoading ? <LoadingList count={4} /> : connections.isError
    ? <ErrorState error={connections.error} onRetry={() => connections.refetch()} />
    : <EmptyState icon="people-outline" title="No friends yet" body="People you connect with will appear here." />;
  return <Screen scroll={false} padded={false} keyboard={false} header={<AppHeader title="Friends" subtitle="Your connections" />}>
    <FlatList data={people} keyExtractor={(person) => person.connection_id}
      contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, paddingBottom: 40 }}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.other.display_name}'s profile`}
        onPress={() => router.push(`/user/${item.other.id}`)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
          borderRadius: t.radius.lg, backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
          borderWidth: 1, borderColor: t.colors.border })}>
        <Avatar path={item.other.avatar_path} name={item.other.display_name} size={46} />
        <View style={{ flex: 1, gap: 2 }}><Text variant="subheading" numberOfLines={1}>{item.other.display_name}</Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>@{item.other.username}</Text></View>
      </Pressable>}
      ListEmptyComponent={empty}
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (connections.hasNextPage && !connections.isFetchingNextPage) void connections.fetchNextPage(); }}
      refreshControl={<RefreshControl tintColor={t.colors.primary} {...pull} />} />
  </Screen>;
}
