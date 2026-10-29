import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Avatar, Button, Card, EmptyState, ErrorState, LoadingList, Screen, Tag, TagList, Text, VerifiedBadge } from '@/components/ui';
import { useServer, useServerDirectory } from '@/features/servers/hooks';

export default function ServerDirectory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const server = useServer(id);
  const directory = useServerDirectory(server.data?.membership?.status === 'active' ? id : '');
  const people = directory.data?.pages.flat() ?? [];
  const [openedAt] = useState(() => Date.now());
  const upcoming = server.data?.kind === 'short_term' && !!server.data.starts_at && new Date(server.data.starts_at).getTime() > openedAt;
  return (
    <Screen header={<AppHeader title="Members" subtitle={server.data?.name} />}
      onRefresh={() => { void directory.refetch(); }} refreshing={directory.isRefetching}>
      <Text variant="callout" color="textSecondary">
        {server.data?.kind === 'short_term'
          ? upcoming ? 'People planning to attend. Tap someone to see their profile before the event.' : 'Admins, moderators and people who are Open to Talk here right now. Tap someone to see their profile.'
          : 'Members who are visible in this Server, with their roles and this Server’s badges. Tap someone to see their profile.'}
      </Text>
      {server.isLoading || directory.isLoading ? <LoadingList count={4} /> : server.isError || directory.isError ?
        <ErrorState error={server.error ?? directory.error} onRetry={() => { void server.refetch(); void directory.refetch(); }} /> :
        !server.data || server.data.membership?.status !== 'active' ?
          <EmptyState title="Members only" body="Join this Server to see its directory." /> : people.length === 0 ?
            <EmptyState title="No members yet" body="Share the invite to bring people together." /> :
            people.map((p) => (
              <Card key={p.user_id} onPress={() => router.push({ pathname: '/user/[id]', params: { id: p.user_id, serverId: id, serverName: server.data.name } })}
                accessibilityLabel={`Open ${p.display_name}'s profile`} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar path={p.avatar_path} name={p.display_name} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text variant="subheading">{p.display_name}</Text>
                    <Text variant="caption" color="textSecondary">@{p.username}</Text>
                  </View>
                  {p.role !== 'member' ? <Tag label={p.role === 'admin' ? 'Admin' : 'Moderator'} tone="brand" small /> : null}
                </View>
                {p.member_note && server.data.member_field_label ? <Text variant="caption" color="textSecondary">
                  {server.data.member_field_label}: {p.member_note}</Text> : null}
                {p.badges.length > 0 ? <TagList>{p.badges.map((b) => <VerifiedBadge key={b.id} label={b.label} compact />)}</TagList> : null}
              </Card>
            ))}
      {directory.hasNextPage ? <Button title="Load more" variant="secondary" loading={directory.isFetchingNextPage}
        onPress={() => directory.fetchNextPage()} /> : null}
    </Screen>
  );
}
