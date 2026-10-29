import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingList, Screen, Text, toast } from '@/components/ui';
import { RequestCard } from '@/components/RequestCard';
import { routeForNotification } from '@/features/notifications/push';
import { compactAgo } from '@/features/social/chat-extra';
import { useMarkNotificationsRead, useNotifications, useRequests, useRespondToRequest } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { AppNotification, NotificationType } from '@/types/domain';

const ICONS: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  connection_request: 'person-add-outline',
  request_accepted: 'checkmark-circle-outline',
  message: 'chatbubble-ellipses-outline',
  server_membership: 'enter-outline',
  server_announcement: 'megaphone-outline',
  activity_response: 'chatbox-outline',
  badge_granted: 'ribbon-outline',
  endorsement: 'ribbon-outline',
  connection_saved: 'heart-outline',
  ephemeral_expiring: 'time-outline',
  moderation: 'shield-outline',
};

function NotificationRow({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  const { colors, radius } = useTheme();
  const unread = !item.read_at;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body ?? ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start', borderRadius: radius.lg, minHeight: 64,
        backgroundColor: pressed ? colors.surfaceMuted : unread ? colors.surfaceBrand : colors.surface,
        borderWidth: 1, borderColor: unread ? 'transparent' : colors.border,
      })}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={ICONS[item.type] ?? 'notifications-outline'} size={19} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={unread ? 'bodyStrong' : 'callout'} numberOfLines={2}>
          {item.title}
        </Text>
        {item.body ? (
          <Text variant="caption" color="textSecondary" numberOfLines={3}>
            {item.body}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text variant="micro" color="textTertiary">
          {compactAgo(item.created_at)}
        </Text>
        {unread ? <View accessibilityLabel="Unread" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const q = useNotifications();
  const incoming = useRequests('incoming');
  const respond = useRespondToRequest();
  const markRead = useMarkNotificationsRead();
  const [refreshing, setRefreshing] = useState(false);
  const requests = incoming.data?.pages.flat() ?? [];
  const pendingIds = new Set(requests.map((r) => r.id));
  const items = (q.data?.pages.flat() ?? []).filter((n) => n.type !== 'connection_request' || !n.request_id || !pendingIds.has(n.request_id));
  const hasUnread = items.some((n) => !n.read_at);

  const open = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate([n.id], { onError: (e) => toast.error(e) });
    // Types without a destination of their own stay here (the item is simply marked read).
    const routable = !!n.conversation_id || !!n.server_id
      || ['connection_request', 'request_accepted', 'activity_response', 'endorsement', 'badge_granted'].includes(n.type);
    if (routable) {
      routeForNotification({
        type: n.type, conversation_id: n.conversation_id, server_id: n.server_id, request_id: n.request_id, post_id: n.post_id,
      });
    }
  };

  let empty: React.ReactElement;
  if (q.isLoading) empty = <LoadingList count={5} />;
  else if (q.isError) empty = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else
    empty = (
      <EmptyState
        icon="notifications-off-outline"
        title="You're all caught up"
        body="Requests, accepted connections, Server updates and chat reminders will show up here."
      />
    );

  return (
    <Screen
      scroll={false}
      padded={false}
      keyboard={false}
      header={
        <AppHeader
          title="Notifications"
          right={
            hasUnread ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications as read"
                disabled={markRead.isPending}
                hitSlop={8}
                onPress={() => markRead.mutate(null, { onError: (e) => toast.error(e) })}
                style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', opacity: markRead.isPending ? 0.5 : 1 }}>
                <Text variant="callout" color="primary">
                  Mark all read
                </Text>
              </Pressable>
            ) : null
          }
        />
      }>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 10, paddingBottom: 40 }}
        renderItem={({ item }) => <NotificationRow item={item} onPress={() => open(item)} />}
        ListHeaderComponent={<View style={{ gap: 10, marginBottom: 10 }}>
          {requests.length ? <Text variant="heading">Requests for you</Text> : null}
          {requests.map((request) => <RequestCard key={request.id} request={request} direction="incoming"
            busy={respond.isPending && respond.variables?.requestId === request.id ? (respond.variables.accept ? 'accept' : 'decline') : null}
            onAccept={() => respond.mutate({ requestId: request.id, accept: true }, {
              onSuccess: (result) => { if (result.status === 'accepted' && result.conversation_id) router.push(`/chat/${result.conversation_id}`); }, onError: toast.error,
            })}
            onDecline={() => respond.mutate({ requestId: request.id, accept: false }, { onError: toast.error })} />)}
          {requests.length && items.length ? <Text variant="heading" style={{ marginTop: 8 }}>Other notifications</Text> : null}
        </View>}
        ListEmptyComponent={requests.length ? undefined : empty}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
        }}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} /> : undefined}
        refreshControl={
          <RefreshControl
            tintColor={colors.primary}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([q.refetch(), incoming.refetch()]);
              setRefreshing(false);
            }}
          />
        }
      />
    </Screen>
  );
}
