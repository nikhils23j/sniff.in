import { formatDistanceToNow } from 'date-fns';
import { View } from 'react-native';

import { AppHeader, Avatar, Banner, Button, Card, EmptyState, ErrorState, LoadingList, Screen, Text, confirm, toast } from '@/components/ui';
import { useBlockedUsers, useUnblockUser } from '@/features/social/hooks';
import type { BlockedUser } from '@/types/domain';

export default function BlockedScreen() {
  const blocked = useBlockedUsers();
  const unblock = useUnblockUser();

  const onUnblock = async (u: BlockedUser) => {
    const ok = await confirm({
      title: `Unblock ${u.display_name}?`,
      message: `Your old chat with ${u.display_name} will not come back. If you share a Server, you could find each other again and they could send you a new request.`,
      confirmLabel: 'Unblock',
      destructive: true,
    });
    if (!ok) return;
    unblock.mutate(u.user_id, { onSuccess: () => toast.success(`${u.display_name} was unblocked`), onError: toast.error });
  };

  const list = blocked.data ?? [];
  let body: React.ReactNode;
  if (blocked.isLoading) body = <LoadingList count={2} />;
  else if (blocked.isError) body = <ErrorState error={blocked.error} onRetry={() => { blocked.refetch(); }} />;
  else if (list.length === 0)
    body = <EmptyState icon="happy-outline" title="You haven't blocked anyone" body="If someone makes you uncomfortable, open their profile and choose Block. They will not be told." />;
  else
    body = list.map((u) => (
      <Card key={u.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={u.display_name} size={44} />
        <View style={{ flex: 1 }}>
          <Text variant="subheading" numberOfLines={1}>
            {u.display_name}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            @{u.username} · blocked {formatDistanceToNow(new Date(u.blocked_at), { addSuffix: true })}
          </Text>
        </View>
        <Button
          title="Unblock"
          size="sm"
          variant="secondary"
          loading={unblock.isPending && unblock.variables === u.user_id}
          disabled={unblock.isPending}
          onPress={() => onUnblock(u)}
        />
      </Card>
    ));

  return (
    <Screen header={<AppHeader title="Blocked people" />} edges={['top', 'bottom']} onRefresh={() => { blocked.refetch(); }} refreshing={blocked.isRefetching}>
      <Banner tone="info" icon="ban-outline" body="Blocked people can't see you, find you or message you, and you won't see them. They are never told." />
      {body}
    </Screen>
  );
}
