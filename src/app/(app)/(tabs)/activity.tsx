import Ionicons from '@expo/vector-icons/Ionicons';
import { formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionMenu } from '@/components/ActionMenu';
import { ImageViewer } from '@/components/chat/ImageViewer';
import { ServerAvatar } from '@/components/ServerAvatar';
import {
  Button, Card, EmptyState, ErrorState, LoadingList, SegmentedControl, Tag, Text, TextField, confirm, toast,
} from '@/components/ui';
import { useSignedUrl, useThumbnailUrl } from '@/features/media/hooks';
import { useMyServers } from '@/features/servers/hooks';
import { useActivity, useDeletePost, useSetPostResponse } from '@/features/social/hooks';
import { toAppError } from '@/lib/errors';
import { palette, useTheme } from '@/theme';
import type { ActivityPost, ActivitySort, PostCategory } from '@/types/domain';
import { useNow } from '@/hooks/use-now';

const CATEGORY: Record<PostCategory, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  social: { label: 'Social', icon: 'people', color: palette.rani500 },
  sports: { label: 'Sports', icon: 'basketball', color: palette.leaf500 },
  travel: { label: 'Travel', icon: 'airplane', color: palette.peacock500 },
  professional: { label: 'Professional', icon: 'briefcase', color: palette.violet600 },
  study: { label: 'Study', icon: 'book', color: palette.teal600 },
  food: { label: 'Food', icon: 'restaurant', color: palette.saffron600 },
  other: { label: 'Other', icon: 'ellipsis-horizontal-circle', color: palette.slate600 },
};

function Chip({ label, icon, color, bold }: { label: string; icon?: keyof typeof Ionicons.glyphMap; color: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${color}22`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text variant={bold ? 'micro' : 'caption'} style={{ color }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

type RespondOutcome =
  | { kind: 'form' }
  | { kind: 'done'; text: string; conversationId?: string };

function RespondSheet({ post, onClose }: { post: ActivityPost | null; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const respond = useSetPostResponse();
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<RespondOutcome>({ kind: 'form' });

  const close = () => {
    setMessage('');
    setOutcome({ kind: 'form' });
    onClose();
  };

  const send = () => {
    if (!post) return;
    const name = post.author.display_name;
    respond.mutate(
      { postId: post.id, kind: 'in', message: message.trim() || null },
      {
        onSuccess: (r) => {
          const req = r.request;
          if (req && req.status === 'pending') setOutcome({ kind: 'done', text: `Response sent. We also sent ${name} a connection request, and they will be notified.` });
          else if (req && req.status === 'accepted') setOutcome({ kind: 'done', text: `Response sent. You and ${name} are now connected.`, conversationId: req.conversation_id });
          else if (req && req.status === 'declined') setOutcome({ kind: 'done', text: `Response sent. ${name} will see it.` });
          else if (req && req.status === 'not_sent') setOutcome({ kind: 'done', text: `Response sent. ${name} will see it, but a connection request couldn't be sent right now.` });
          else setOutcome({ kind: 'done', text: `Response sent. You already have a connection or an open request with ${name}.` });
        },
        onError: (e) => {
          if (toAppError(e).code === 'activity_full') {
            toast.error('This plan just filled up.');
            close();
          } else {
            toast.error(e);
          }
        },
      },
    );
  };

  return (
    <Modal visible={!!post} animationType="slide" transparent onRequestClose={close}>
      <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: colors.overlay }} onPress={close} />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: insets.bottom + 20, gap: 14 }}>
        {outcome.kind === 'done' ? (
          <>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Ionicons name="checkmark-circle" size={44} color={colors.success} />
              <Text variant="heading" align="center">
                You&apos;re in
              </Text>
              <Text variant="callout" color="textSecondary" align="center">
                {outcome.text}
              </Text>
            </View>
            {outcome.conversationId ? (
              <Button title="Open chat" icon="chatbubble-ellipses-outline" onPress={() => { const id = outcome.conversationId; close(); router.push(`/chat/${id}`); }} />
            ) : null}
            <Button title="Done" variant={outcome.conversationId ? 'secondary' : 'primary'} onPress={close} />
          </>
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Text variant="title">I&apos;m in</Text>
              <Text variant="callout" color="textSecondary" numberOfLines={3}>
                {post ? `Reply to ${post.author.display_name}: “${post.body}”` : ''}
              </Text>
            </View>
            <TextField
              label="Add a message (optional)"
              placeholder="e.g. I can make it at 7. Where shall we meet?"
              value={message}
              onChangeText={setMessage}
              maxCount={280}
              multiline
            />
            <Text variant="caption" color="textTertiary">
              Responding lets the author know you are interested. If you are not connected yet, we also send a connection request they can accept.
            </Text>
            <Button title="Send response" size="lg" loading={respond.isPending} onPress={send} />
            <Button title="Cancel" variant="ghost" onPress={close} />
          </>
        )}
      </View>
    </Modal>
  );
}

function PostCard({
  post, onRespond, onMore, sort,
}: { post: ActivityPost; onRespond: () => void; onMore: () => void; sort: ActivitySort }) {
  const { colors, radius } = useTheme();
  const del = useDeletePost();
  const setResponse = useSetPostResponse();
  const now = useNow();
  const [viewer, setViewer] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const imagePaths = post.image_paths ?? (post.image_path ? [post.image_path] : []);
  const currentPath = imagePaths[Math.min(imageIndex, Math.max(imagePaths.length - 1, 0))] ?? null;
  const image = useThumbnailUrl('activity-media', currentPath);
  const fullImage = useSignedUrl('activity-media', viewer ? currentPath : null);
  const cat = CATEGORY[post.category] ?? CATEGORY.other;
  const expires = post.expires_at && new Date(post.expires_at).getTime() > now
    ? `expires in ${formatDistanceToNowStrict(new Date(post.expires_at))}`
    : null;
  const mine = post.my_response;
  const fullForMe = post.is_full && mine !== 'in';

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this post?',
      message: 'It is removed for everyone in the Server. People who already responded keep any connection requests.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    del.mutate(post.id, { onSuccess: () => toast.success('Post deleted'), onError: toast.error });
  };

  const apply = (kind: 'in' | 'not_in' | null, okText?: string) =>
    setResponse.mutate(
      { postId: post.id, kind },
      {
        onSuccess: () => okText && toast.success(okText),
        onError: (e) => toast.error(toAppError(e).code === 'activity_full' ? 'This plan just filled up.' : e),
      },
    );

  const tapIn = async () => {
    if (mine === 'in') {
      const ok = await confirm({ title: 'Remove your response?', message: 'You will no longer be counted as in for this plan.', confirmLabel: 'Remove', destructive: true });
      if (ok) apply(null, 'Response removed');
    } else {
      onRespond();
    }
  };

  const tapNotIn = async () => {
    if (mine === 'not_in') {
      const ok = await confirm({ title: 'Remove your response?', message: 'You will no longer be marked as not in.', confirmLabel: 'Remove', destructive: true });
      if (ok) apply(null, 'Response removed');
    } else {
      apply('not_in');
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ServerAvatar name={post.server_name} category="other" avatarPath={post.server_avatar_path} size={42} />
        <View style={{ flex: 1 }}>
          <Text variant="subheading" numberOfLines={1}>
            {post.server_name}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            by{' '}
            <Text
              variant="caption"
              accessibilityRole="link"
              accessibilityLabel={`View ${post.author.display_name}'s profile`}
              onPress={() => router.push(`/user/${post.author.id}`)}
              style={{ color: colors.primary }}>
              {post.is_mine ? 'you' : post.author.display_name}
            </Text>{' '}
            · {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
          </Text>
        </View>
        {!post.is_mine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            hitSlop={8}
            onPress={onMore}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip label={cat.label} icon={cat.icon} color={cat.color} />
        {expires ? <Tag label={expires} icon="time-outline" small /> : null}
        {post.capacity ? (
          <Chip
            label={`${Math.min(post.in_count, post.capacity)}/${post.capacity} spots`}
            icon="people-circle-outline"
            color={post.is_full ? palette.red600 : palette.teal600}
          />
        ) : null}
        {post.is_full ? <Chip label="FULL" color={palette.red600} bold /> : null}
      </View>

      <Text variant="body">{post.body}</Text>

      {currentPath ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel="Plan photo. Tap to view full screen"
          onPress={() => image.data && setViewer(true)}
          style={{ width: '100%', aspectRatio: 16 / 10, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
          {image.data ? (
            <Image source={{ uri: image.data, cacheKey: currentPath }} contentFit="cover" transition={150} style={{ flex: 1 }} />
          ) : null}
        </Pressable>
      ) : null}
      {imagePaths.length > 1 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button title="Previous" size="sm" variant="ghost" disabled={imageIndex === 0} onPress={() => setImageIndex((n) => Math.max(0, n - 1))} />
        <Text variant="caption" color="textSecondary">{Math.min(imageIndex, imagePaths.length - 1) + 1} / {imagePaths.length}</Text>
        <Button title="Next" size="sm" variant="ghost" disabled={imageIndex >= imagePaths.length - 1} onPress={() => setImageIndex((n) => Math.min(imagePaths.length - 1, n + 1))} />
      </View> : null}

      {sort === 'for_you' && post.relevance_reason ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Ionicons name="sparkles" size={14} color={colors.primary} />
          <Text variant="caption" style={{ color: colors.primary, flex: 1 }}>
            {post.relevance_reason}
          </Text>
        </View>
      ) : null}

      <Text variant="caption" color="textSecondary" accessibilityLabel={`${post.in_count} in, ${post.not_in_count} not in`}>
        <Text variant="caption" style={{ color: colors.success }}>{post.in_count} in</Text>
        {'  ·  '}
        {post.not_in_count} not in
      </Text>

      <Button title="View activity details" size="sm" variant="ghost" icon="arrow-forward-outline"
        onPress={() => router.push(`/post/${post.id}`)} />

      {post.is_mine ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button
            title={`Responses (${post.in_count} in / ${post.not_in_count} not in)`}
            size="sm"
            icon="chatbubbles-outline"
            onPress={() => router.push(`/post/${post.id}/responses`)}
          />
          <Button
            title="Edit"
            size="sm"
            variant="secondary"
            icon="create-outline"
            onPress={() =>
              router.push({
                pathname: '/post/compose',
                params: {
                  postId: post.id, serverId: post.server_id, body: post.body, category: post.category,
                  ...(post.capacity ? { capacity: String(post.capacity) } : {}),
                  ...(post.image_path ? { imagePath: post.image_path } : {}),
                  imagePaths: JSON.stringify(imagePaths),
                },
              })
            }
          />
          <Button title="Delete" size="sm" variant="danger" icon="trash-outline" loading={del.isPending} onPress={onDelete} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button
            title={fullForMe ? 'Full' : "I'm in"}
            icon={mine === 'in' ? 'checkmark-circle' : 'hand-right-outline'}
            variant={mine === 'in' ? 'primary' : 'secondary'}
            disabled={fullForMe || setResponse.isPending}
            onPress={tapIn}
            accessibilityState={{ selected: mine === 'in', disabled: fullForMe || setResponse.isPending }}
            style={{ flex: 1 }}
          />
          <Button
            title="I'm not in"
            icon={mine === 'not_in' ? 'close-circle' : 'close-circle-outline'}
            variant={mine === 'not_in' ? 'danger' : 'secondary'}
            disabled={setResponse.isPending}
            onPress={tapNotIn}
            accessibilityState={{ selected: mine === 'not_in', disabled: setResponse.isPending }}
            style={{ flex: 1 }}
          />
        </View>
      )}
      <ImageViewer uri={fullImage.data} visible={viewer} onClose={() => setViewer(false)} label="Plan photo" />
    </Card>
  );
}

export default function ActivityScreen() {
  const t = useTheme();
  const [pulling, setPulling] = useState(false);
  const insets = useSafeAreaInsets();
  const servers = useMyServers();
  const [serverId, setServerId] = useState<string | null>(null);
  const [sort, setSort] = useState<ActivitySort>('latest');
  const [respondTo, setRespondTo] = useState<ActivityPost | null>(null);
  const [menuFor, setMenuFor] = useState<ActivityPost | null>(null);

  const liveServers = useMemo(() => (servers.data ?? []).filter((s) => s.status === 'active' && s.is_live), [servers.data]);
  // If the selected Server is no longer live (left, ended) fall back to "All".
  const activeFilter = serverId && liveServers.some((s) => s.id === serverId) ? serverId : null;
  const activity = useActivity(activeFilter, sort);
  const shown = activity.data?.pages.flat() ?? [];

  const header = (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" accessibilityRole="header">
            Activity
          </Text>
          <Text variant="caption" color="textSecondary">
            Open plans in your Servers. Posts expire.
          </Text>
        </View>
        <Button
          title="Post"
          size="sm"
          icon="add"
          onPress={() => router.push({ pathname: '/post/compose', params: activeFilter ? { serverId: activeFilter } : {} })}
        />
      </View>
      <SegmentedControl<ActivitySort>
        options={[{ value: 'latest', label: 'Latest' }, { value: 'mine', label: 'Posted by You' }]}
        value={sort}
        onChange={setSort}
      />
      {liveServers.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Tag label="All my Servers" selected={!activeFilter} onPress={() => setServerId(null)} />
          {liveServers.map((s) => (
            <Tag key={s.id} label={s.name} selected={s.id === activeFilter} onPress={() => setServerId(s.id)} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (servers.isLoading || activity.isLoading) body = <LoadingList />;
  else if (activity.isError) body = <ErrorState error={activity.error} onRetry={() => { activity.refetch(); }} />;
  else if (servers.isError) body = <ErrorState error={servers.error} onRetry={() => { servers.refetch(); }} />;
  else if (liveServers.length === 0)
    body = (
      <EmptyState
        title="Join a Server to see plans"
        body="Activity shows open plans from the Servers you are in: your campus, office, building or event."
        action={{ label: 'Join a Server', icon: 'qr-code', onPress: () => router.push('/join') }}
      />
    );
  else if (shown.length === 0 && sort === 'mine')
    body = (
      <EmptyState
        icon="sparkles-outline"
        title="You haven't posted an activity yet"
        body="Post a plan to a Server and it will appear here."
        action={{ label: 'Try Latest', icon: 'time-outline', onPress: () => setSort('latest') }}
      />
    );
  else if (shown.length === 0)
    body = (
      <EmptyState
        icon="megaphone-outline"
        title="No open plans yet"
        body={'Post one: “Badminton at 7am?” Everyone in the Server can see it and say they’re in.'}
        action={{ label: 'Post a plan', icon: 'add', onPress: () => router.push({ pathname: '/post/compose', params: activeFilter ? { serverId: activeFilter } : {} }) }}
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: insets.top }}>
      <FlatList
        data={body ? [] : shown}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
        ListHeaderComponent={<View style={{ gap: 16, marginBottom: 4 }}>{header}{body}</View>}
        renderItem={({ item }) => (
          <PostCard post={item} sort={sort} onRespond={() => setRespondTo(item)} onMore={() => setMenuFor(item)} />
        )}
        onEndReachedThreshold={0.4}
        onEndReached={() => activity.hasNextPage && !activity.isFetchingNextPage && activity.fetchNextPage()}
        ListFooterComponent={
          activity.isFetchingNextPage ? (
            <LoadingList count={1} />
          ) : shown.length > 0 && !body && !activity.hasNextPage ? (
            <Text variant="caption" color="textTertiary" align="center" style={{ marginTop: 8 }}>
              That&apos;s everything open right now.
            </Text>
          ) : undefined
        }
        refreshControl={
          <RefreshControl
            tintColor={t.colors.primary}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void Promise.allSettled([servers.refetch(), activity.refetch()]).finally(() => setPulling(false));
            }}
          />
        }
      />
      <RespondSheet post={respondTo} onClose={() => setRespondTo(null)} />
      <ActionMenu
        visible={!!menuFor}
        title={menuFor ? `Post by ${menuFor.author.display_name}` : undefined}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                {
                  label: 'Report post',
                  icon: 'flag-outline',
                  destructive: true,
                  onPress: () => router.push({ pathname: '/report', params: { postId: menuFor.id, serverId: menuFor.server_id } }),
                },
              ]
            : []
        }
      />
    </View>
  );
}
