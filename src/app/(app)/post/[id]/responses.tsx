import { formatDistanceToNow } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppHeader, Avatar, Banner, Button, Card, EmptyState, ErrorState, LoadingList, Screen, SectionHeader, Tag, Text } from '@/components/ui';
import { usePostResponses } from '@/features/social/hooks';
import { toAppError } from '@/lib/errors';
import type { PostResponse, RequestStatus } from '@/types/domain';

const STATUS: Record<RequestStatus, { label: string; tone: 'neutral' | 'brand' | 'accent' | 'warning' }> = {
  pending: { label: 'Request pending', tone: 'warning' },
  accepted: { label: 'Connected', tone: 'accent' },
  declined: { label: 'Declined', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

function ResponseCard({ r }: { r: PostResponse }) {
  // Not-in responders never send connection requests, so only "in" shows request state.
  const status = r.kind === 'in' && r.request_status ? STATUS[r.request_status] : null;
  return (
    <Card style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${r.responder.display_name}'s profile`}
        onPress={() => router.push(`/user/${r.responder.id}`)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
        <Avatar path={r.responder.avatar_path} name={r.responder.display_name} size={44} />
        <View style={{ flex: 1 }}>
          <Text variant="subheading" numberOfLines={1}>
            {r.responder.display_name}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            @{r.responder.username} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
          </Text>
        </View>
      </Pressable>
      {r.message ? <Text variant="callout">{r.message}</Text> : r.kind === 'in' ? <Text variant="caption" color="textTertiary">No message</Text> : null}
      {r.kind === 'in' ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {status ? <Tag label={status.label} tone={status.tone} small /> : <Tag label="No request sent" small />}
          {r.request_status === 'pending' ? (
            <Pressable accessibilityRole="link" accessibilityLabel="Review pending request" hitSlop={8} onPress={() => router.push('/requests')} style={{ minHeight: 32, justifyContent: 'center' }}>
              <Text variant="caption" color="primary">Review in Requests</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function PostResponsesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const responses = usePostResponses(id);
  const list = responses.data ?? [];

  const ins = list.filter((r) => r.kind === 'in');
  const outs = list.filter((r) => r.kind === 'not_in');

  let body: React.ReactNode;
  if (responses.isLoading) body = <LoadingList count={2} />;
  else if (responses.isError)
    body =
      toAppError(responses.error).code === 'forbidden' ? (
        <EmptyState icon="lock-closed-outline" title="Only the author can see responses" body="Responses to a post are visible to the person who wrote it." />
      ) : (
        <ErrorState error={responses.error} onRetry={() => { responses.refetch(); }} />
      );
  else if (list.length === 0)
    body = (
      <EmptyState icon="chatbubbles-outline" title="No responses yet" body="When someone says they are in or not in, they show up here. People who are in can also send you a connection request." />
    );
  else
    body = (
      <>
        <SectionHeader title={`I'm in (${ins.length})`} />
        {ins.length ? ins.map((r) => <ResponseCard key={r.id} r={r} />) : <Text variant="callout" color="textTertiary">Nobody yet.</Text>}
        <SectionHeader title={`Not in (${outs.length})`} />
        {outs.length ? outs.map((r) => <ResponseCard key={r.id} r={r} />) : <Text variant="callout" color="textTertiary">Nobody yet.</Text>}
      </>
    );

  return (
    <Screen
      header={<AppHeader title="Responses" subtitle={list.length ? `${ins.length} in · ${outs.length} not in` : undefined} />}
      edges={['top', 'bottom']}
      onRefresh={() => { responses.refetch(); }}
      refreshing={responses.isRefetching}>
      <Banner
        tone="info"
        icon="mail-outline"
        body="People who said they are in and were not connected with you also sent a connection request. Accept the ones you want in Requests; nobody can message you until you do."
      />
      {body}
      <Button title="Open requests" variant="secondary" icon="mail-open-outline" onPress={() => router.push('/requests')} />
    </Screen>
  );
}
