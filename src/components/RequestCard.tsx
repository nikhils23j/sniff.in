import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { FlatList, RefreshControl, View } from 'react-native';

import { ActionMenu } from '@/components/ActionMenu';
import {
  Avatar, Button, Card, EmptyState, ErrorState, IconButton, LoadingList, SegmentedControl, Text, confirm, toast,
} from '@/components/ui';
import { compactAgo } from '@/features/social/chat-extra';
import { useBlockUser, useCancelRequest, usePendingRequestCount, useRequests, useRespondToRequest } from '@/features/social/hooks';
import { useTheme } from '@/theme';
import type { ConnectionRequest } from '@/types/domain';

type Direction = 'incoming' | 'outgoing';

/** One connection request. Incoming: accept / decline / view / overflow. Outgoing: cancel. */
export function RequestCard({
  request, direction, busy, onAccept, onDecline, onCancel, onMenu,
}: {
  request: ConnectionRequest;
  direction: Direction;
  busy?: 'accept' | 'decline' | 'cancel' | null;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
  onMenu?: () => void;
}) {
  const { colors, radius } = useTheme();
  const { other } = request;
  const anyBusy = !!busy;
  return (
    <Card style={{ gap: 14 }} accessibilityLabel={`${direction === 'incoming' ? 'Request from' : 'Request to'} ${other.display_name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar path={other.avatar_path} name={other.display_name} size={52} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="subheading" numberOfLines={1}>
            {other.display_name}
          </Text>
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            @{other.username}
            {request.server_name ? `  ·  via ${request.server_name}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="micro" color="textTertiary">
            {compactAgo(request.created_at)}
          </Text>
          {direction === 'incoming' && onMenu ? <IconButton icon="ellipsis-horizontal" label={`More options for ${other.display_name}`} size={36} onPress={onMenu} /> : null}
        </View>
      </View>

      {request.message ? (
        <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: 12, borderTopLeftRadius: 4 }}>
          <Text variant="callout" style={{ fontStyle: 'italic' }}>
            “{request.message}”
          </Text>
        </View>
      ) : null}

      {request.post_excerpt ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 10 }}>
          <Ionicons name="megaphone-outline" size={16} color={colors.accentStrong} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text variant="micro" color="textSecondary">
              {direction === 'incoming' ? 'IN RESPONSE TO YOUR POST' : 'ABOUT THEIR POST'}
            </Text>
            <Text variant="caption" numberOfLines={3}>
              {request.post_excerpt}
            </Text>
          </View>
        </View>
      ) : null}

      {direction === 'incoming' ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Decline" variant="secondary" style={{ flex: 1 }} disabled={anyBusy && busy !== 'decline'} loading={busy === 'decline'} onPress={onDecline} />
            <Button title="Accept" icon="checkmark" style={{ flex: 1 }} disabled={anyBusy && busy !== 'accept'} loading={busy === 'accept'} onPress={onAccept} />
          </View>
          <Button title="View profile" variant="ghost" size="sm" onPress={() => router.push(`/user/${other.id}`)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="View profile" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/user/${other.id}`)} />
          <Button title="Cancel request" variant="danger" style={{ flex: 1 }} loading={busy === 'cancel'} onPress={onCancel} />
        </View>
      )}
    </Card>
  );
}

/**
 * Incoming / Outgoing request lists with all actions wired to the real mutations.
 * Used by the Requests screen and by the Requests segment of the Chats tab.
 */
export function RequestsView({ initialDirection = 'incoming', bottomPadding = 32 }: { initialDirection?: Direction; bottomPadding?: number }) {
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [menuFor, setMenuFor] = useState<ConnectionRequest | null>(null);
  const incoming = useRequests('incoming');
  const outgoing = useRequests('outgoing');
  const incomingCount = usePendingRequestCount('incoming');
  const respond = useRespondToRequest();
  const cancel = useCancelRequest();
  const block = useBlockUser();

  const query = direction === 'incoming' ? incoming : outgoing;

  const pull = usePullRefresh(() => query.refetch());
  const data = query.data?.pages.flat() ?? [];

  // Per-request in-flight tracking: one shared mutation object can't represent several requests at once.
  const [inFlight, setInFlight] = useState<Record<string, 'accept' | 'decline' | 'cancel'>>({});
  const track = async (id: string, kind: 'accept' | 'decline' | 'cancel', fn: () => Promise<void>) => {
    if (inFlight[id]) return;
    setInFlight((m) => ({ ...m, [id]: kind }));
    try {
      await fn();
    } finally {
      setInFlight((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  };

  const accept = (r: ConnectionRequest) => track(r.id, 'accept', async () => {
    try {
      const res = await respond.mutateAsync({ requestId: r.id, accept: true });
      if (res.status === 'accepted') {
        toast.success(`You and ${r.other.display_name} are connected`);
        router.push(`/chat/${res.conversation_id}`);
      } else {
        toast.info('This request is no longer pending');
      }
    } catch (e) {
      toast.error(e);
    }
  });

  const decline = async (r: ConnectionRequest) => {
    const ok = await confirm({
      title: `Decline ${r.other.display_name}?`,
      message: "They won't be told who declined, only that the request wasn't accepted.",
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;
    await track(r.id, 'decline', async () => {
      try {
        await respond.mutateAsync({ requestId: r.id, accept: false });
        toast.info('Request declined');
      } catch (e) {
        toast.error(e);
      }
    });
  };

  const cancelRequest = async (r: ConnectionRequest) => {
    const ok = await confirm({
      title: 'Cancel this request?',
      message: `${r.other.display_name} won't be able to accept it anymore.`,
      confirmLabel: 'Cancel request',
      destructive: true,
    });
    if (!ok) return;
    await track(r.id, 'cancel', async () => {
      try {
        await cancel.mutateAsync(r.id);
        toast.info('Request cancelled');
      } catch (e) {
        toast.error(e);
      }
    });
  };

  const blockSender = async (r: ConnectionRequest) => {
    const ok = await confirm({
      title: `Block ${r.other.display_name}?`,
      message: "They won't see you anywhere in Sniff.in or be able to contact you. You can unblock them in Settings.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync(r.other.id);
      toast.success(`${r.other.display_name} is blocked`);
    } catch (e) {
      toast.error(e);
    }
  };

  const busyFor = (r: ConnectionRequest): 'accept' | 'decline' | 'cancel' | null => inFlight[r.id] ?? null;

  let empty: React.ReactElement | undefined;
  if (query.isLoading) empty = <LoadingList />;
  else if (query.isError) empty = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else
    empty = direction === 'incoming' ? (
      <EmptyState
        icon="mail-open-outline"
        title="No requests right now"
        body="When someone wants to connect, their request shows up here. You decide whether to accept."
        action={{ label: 'Find people', icon: 'compass-outline', onPress: () => router.navigate('/discover') }}
      />
    ) : (
      <EmptyState
        icon="paper-plane-outline"
        title="No pending requests"
        body="Requests you send stay here until the other person responds."
        action={{ label: 'Find people', icon: 'compass-outline', onPress: () => router.navigate('/discover') }}
      />
    );

  return (
    <>
      <FlatList
        data={data}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14, paddingBottom: bottomPadding }}
        ListHeaderComponent={
          <View style={{ marginBottom: 4 }}>
            <SegmentedControl
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'incoming', label: 'Incoming', badge: incomingCount.data },
                { value: 'outgoing', label: 'Outgoing' },
              ]}
            />
          </View>
        }
        ListEmptyComponent={empty}
        onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <RequestCard
            request={item}
            direction={direction}
            busy={busyFor(item)}
            onAccept={() => accept(item)}
            onDecline={() => decline(item)}
            onCancel={() => cancelRequest(item)}
            onMenu={() => setMenuFor(item)}
          />
        )}
        refreshControl={<RefreshControl {...pull} />}
      />
      <ActionMenu
        visible={!!menuFor}
        title={menuFor?.other.display_name}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                { label: 'View profile', icon: 'person-outline', onPress: () => router.push(`/user/${menuFor.other.id}`) },
                { label: 'Report', icon: 'flag-outline', onPress: () => router.push({ pathname: '/report', params: { userId: menuFor.other.id, ...(menuFor.server_id ? { serverId: menuFor.server_id } : {}) } }) },
                { label: 'Block', icon: 'ban-outline', destructive: true, onPress: () => blockSender(menuFor) },
              ]
            : []
        }
      />
    </>
  );
}
