import Ionicons from '@expo/vector-icons/Ionicons';
import { formatDistanceToNow } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  AppHeader, Avatar, Banner, Button, Card, EmptyState, ErrorState, LoadingList, Screen, SectionHeader, SegmentedControl, Tag, Text, confirm, toast,
} from '@/components/ui';
import { useEndorsementList, useMySettings, useRevokeEndorsement, useSetEndorsementStatus } from '@/features/profile/hooks';
import { useTheme } from '@/theme';
import type { EndorsementItem } from '@/types/domain';

type Direction = 'received' | 'written';

const STATUS: Record<EndorsementItem['status'], { received: string; written: string; tone: 'accent' | 'warning' | 'neutral' }> = {
  approved: { received: 'Shown on profile', written: 'Approved and shown', tone: 'accent' },
  pending: { received: 'Waiting for you', written: 'Pending their approval', tone: 'warning' },
  hidden: { received: 'Hidden', written: 'Not shown', tone: 'neutral' },
};

function PersonHeader({ item, direction }: { item: EndorsementItem; direction: Direction }) {
  const { colors } = useTheme();
  const other = item.other;
  const name = other?.display_name ?? 'Former member';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={other ? `Open ${name}'s profile` : name}
      disabled={!other}
      onPress={() => other && router.push(`/user/${other.id}`)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minHeight: 44 }}>
      <Avatar path={other?.avatar_path} name={name} size={40} />
      <View style={{ flex: 1 }}>
        <Text variant="callout" numberOfLines={1}>
          {direction === 'written' ? `To ${name}` : name}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {other ? `@${other.username} · ` : ''}
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </Text>
      </View>
      {other ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

function EndorsementCard({
  item, direction, children,
}: { item: EndorsementItem; direction: Direction; children?: React.ReactNode }) {
  const s = STATUS[item.status];
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PersonHeader item={item} direction={direction} />
        <Tag label={s[direction]} tone={s.tone} small />
      </View>
      <Text variant="body">&ldquo;{item.body}&rdquo;</Text>
      {children}
    </Card>
  );
}

function ReceivedList() {
  const list = useEndorsementList('received');
  const setStatus = useSetEndorsementStatus();

  const act = (e: EndorsementItem, status: 'approved' | 'hidden') =>
    setStatus.mutate(
      { id: e.id, status },
      {
        onSuccess: () => {
          void list.refetch();
          toast.success(status === 'approved' ? 'Now shown on your profile' : 'Hidden from your profile');
        },
        onError: toast.error,
      },
    );

  const rows = list.data ?? [];
  const groups: { title: string; items: EndorsementItem[] }[] = [
    { title: 'Waiting for your approval', items: rows.filter((r) => r.status === 'pending') },
    { title: 'Shown on your profile', items: rows.filter((r) => r.status === 'approved') },
    { title: 'Hidden', items: rows.filter((r) => r.status === 'hidden') },
  ];

  if (list.isLoading) return <LoadingList count={2} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => { void list.refetch(); }} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="chatbox-ellipses-outline"
        title="No endorsements yet"
        body="People you are connected with can write a short note about you. Nothing is shown on your profile until you approve it."
      />
    );
  }
  return (
    <>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <View key={g.title} style={{ gap: 10 }}>
            <SectionHeader title={`${g.title} (${g.items.length})`} />
            {g.items.map((e) => {
              const busy = setStatus.isPending && setStatus.variables?.id === e.id;
              return (
                <EndorsementCard key={e.id} item={e} direction="received">
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {e.status !== 'approved' ? (
                      <Button title="Approve" size="sm" icon="checkmark" loading={busy} disabled={busy} onPress={() => act(e, 'approved')} />
                    ) : null}
                    {e.status !== 'hidden' ? (
                      <Button title="Hide" size="sm" variant="secondary" icon="eye-off-outline" loading={busy} disabled={busy} onPress={() => act(e, 'hidden')} />
                    ) : null}
                  </View>
                </EndorsementCard>
              );
            })}
          </View>
        ))}
    </>
  );
}

function WrittenList() {
  const list = useEndorsementList('written');
  const revoke = useRevokeEndorsement();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const doRevoke = async (e: EndorsementItem) => {
    const name = e.other?.display_name ?? 'this person';
    const ok = await confirm({
      title: 'Revoke this endorsement?',
      message: `It will be removed from ${name}'s profile and you won't be able to restore it. You can write a new one later.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    setRevokingId(e.id);
    revoke.mutate(e.id, {
      onSuccess: () => {
        void list.refetch();
        toast.success('Endorsement revoked');
      },
      onError: toast.error,
      onSettled: () => setRevokingId(null),
    });
  };

  const rows = list.data ?? [];
  if (list.isLoading) return <LoadingList count={2} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => { void list.refetch(); }} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="ribbon-outline"
        title="You haven't written any yet"
        body="Open a connection's profile and tap Write an endorsement. They review it before it appears."
      />
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title={`Written by you (${rows.length})`} />
      {rows.map((e) => (
        <EndorsementCard key={e.id} item={e} direction="written">
          <View style={{ flexDirection: 'row' }}>
            <Button
              title="Revoke"
              size="sm"
              variant="danger"
              icon="arrow-undo-outline"
              loading={revokingId === e.id}
              disabled={revoke.isPending}
              onPress={() => { void doRevoke(e); }}
            />
          </View>
        </EndorsementCard>
      ))}
    </View>
  );
}

export default function EndorsementsScreen() {
  const settings = useMySettings();
  const received = useEndorsementList('received');
  const written = useEndorsementList('written');
  const [tab, setTab] = useState<Direction>('received');

  const pending = (received.data ?? []).filter((r) => r.status === 'pending').length;
  const vis = settings.data?.endorsements_visibility;
  const active = tab === 'received' ? received : written;

  return (
    <Screen
      header={<AppHeader title="Endorsements" />}
      edges={['top', 'bottom']}
      onRefresh={() => { void active.refetch(); }}
      refreshing={active.isRefetching}>
      <SegmentedControl<Direction>
        options={[
          { value: 'received', label: 'Received', badge: pending },
          { value: 'written', label: 'Written' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'received' ? (
        <Banner
          tone="info"
          icon="shield-checkmark-outline"
          body={`Endorsements are opt-in: only the ones you approve are shown${vis ? `, to ${vis === 'members' ? 'people who can see your card' : vis === 'connections' ? 'your connections' : 'nobody but you'}` : ''}. Authors are people you were connected with when they wrote it.`}
          action={{ label: 'Change who sees endorsements', onPress: () => router.push('/settings/privacy') }}
        />
      ) : (
        <Banner
          tone="info"
          icon="ribbon-outline"
          body="These are endorsements you wrote. You can revoke one any time and it disappears from their profile."
        />
      )}
      {tab === 'received' ? <ReceivedList /> : <WrittenList />}
    </Screen>
  );
}
