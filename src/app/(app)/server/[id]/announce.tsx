import Ionicons from '@expo/vector-icons/Ionicons';
import { format, isToday, isYesterday } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, TextInput, View } from 'react-native';

import { ServerAvatar } from '@/components/ServerAvatar';
import { AttachmentSheet, type AttachmentChoice } from '@/components/chat/AttachmentSheet';
import { GifPicker } from '@/components/chat/GifPicker';
import { MessageContent } from '@/components/chat/MessageContent';
import { StickerPicker } from '@/components/chat/StickerPicker';
import { AppHeader, EmptyState, ErrorState, IconButton, LoadingList, Screen, Text, confirm, toast } from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { serversApi, type ServerMessageFields } from '@/features/servers/api';
import { usePostServerMessage, useServer, useServerMessages } from '@/features/servers/hooks';
import { validateAttachment } from '@/features/social/chat-media';
import { getCurrentCoords, pickDocument, pickPhoto, takePhoto } from '@/features/social/chat-pickers';
import { toAppError } from '@/lib/errors';
import { finalizeMediaUpload } from '@/lib/upload';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';
import type { Announcement, Message } from '@/types/domain';

function dateLabel(value: string) {
  const date = new Date(value);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'd MMM yyyy');
}

export default function ServerMessagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ownId = useUserId();
  const { colors, radius, typography } = useTheme();
  const listRef = useRef<FlatList<Announcement>>(null);
  const needsScrollToBottom = useRef(true);
  const busyRef = useRef(false);
  const server = useServer(id);
  const canPost = server.data?.can_manage === true && server.data.is_live && !server.data.is_archived;
  const feed = useServerMessages(server.data?.membership?.status === 'active' || server.data?.can_manage ? id : '');
  const post = usePostServerMessage(id);
  const [draft, setDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const messages = useMemo(() => [...(feed.data?.pages.flat() ?? [])].reverse(), [feed.data]);
  const valid = draft.trim().length >= 2;

  if (server.isLoading) {
    return <Screen header={<AppHeader title="Server" />}><LoadingList count={2} /></Screen>;
  }
  if (server.isError || !server.data) {
    return <Screen header={<AppHeader title="Server" />}><ErrorState error={server.error} onRetry={server.refetch} /></Screen>;
  }
  if (server.data.membership?.status !== 'active' && !server.data.can_manage) {
    return (
      <Screen header={<AppHeader title={server.data.name} />}>
        <EmptyState icon="lock-closed-outline" title="Members only" body="Join this Server to read its messages." />
        <Pressable accessibilityRole="button" onPress={() => router.push(`/server/${id}/details`)}>
          <Text color="primary" align="center">View Server and join</Text>
        </Pressable>
      </Screen>
    );
  }

  const send = async () => {
    const body = draft.trim();
    if (busyRef.current || post.isPending || sendingMedia || body.length < 2 || body.length > 500) return;
    busyRef.current = true;
    try {
      await post.mutateAsync({ kind: 'text', body });
      setDraft('');
      needsScrollToBottom.current = true;
    } catch (error) {
      toast.error(toAppError(error).code === 'rate_limited' ? "You've reached today's limit of 5 Server messages." : error);
    } finally {
      busyRef.current = false;
    }
  };

  const sendRich = async (fields: ServerMessageFields, uploadAlreadyStarted = false) => {
    if (!uploadAlreadyStarted && (post.isPending || busyRef.current)) return;
    busyRef.current = true;
    setSendingMedia(true);
    try {
      await post.mutateAsync(fields);
      needsScrollToBottom.current = true;
      if (fields.media_path) void finalizeMediaUpload('server-media', fields.media_path).catch(() => {});
    } catch (error) {
      if (fields.media_path) void supabase.storage.from('server-media').remove([fields.media_path]).catch(() => {});
      toast.error(toAppError(error).code === 'rate_limited' ? "You've reached today's limit of 5 Server messages." : error);
    } finally {
      busyRef.current = false;
      setSendingMedia(false);
      setUploadProgress(0);
    }
  };

  const onAttach = async (choice: AttachmentChoice) => {
    if (choice === 'gif') return setGifOpen(true);
    if (choice === 'sticker') return setStickerOpen(true);
    if (choice === 'location') {
      const ok = await confirm({ title: 'Share your exact location with every Server member?', message: 'Only share this if you want all members to see this spot.', confirmLabel: 'Share location' });
      if (!ok) return;
      try {
        const position = await getCurrentCoords();
        if (position) void sendRich({ kind: 'location', location_lat: position.lat, location_lng: position.lng });
      } catch (error) { toast.error(error); }
      return;
    }
    try {
      const file = await (choice === 'photo' ? pickPhoto : choice === 'camera' ? takePhoto : pickDocument)();
      if (!file) return;
      validateAttachment(file);
      if (busyRef.current) return;
      busyRef.current = true;
      setSendingMedia(true);
      setUploadProgress(0);
      const fields = await serversApi.uploadServerAttachment(id, file, setUploadProgress);
      await sendRich(fields, true);
    } catch (error) {
      busyRef.current = false;
      setSendingMedia(false);
      setUploadProgress(0);
      toast.error(error);
    }
  };

  return (
    <Screen
      scroll={false}
      padded={false}
      edges={['top', 'bottom']}
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Server info for ${server.data.name}`}
            onPress={() => router.push(`/server/${id}/details`)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ServerAvatar name={server.data.name} category={server.data.category} avatarPath={server.data.avatar_path} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subheading" numberOfLines={1}>{server.data.name}</Text>
              <Text variant="caption" color="textSecondary">Server info</Text>
            </View>
          </Pressable>
          <IconButton icon="information-circle-outline" label="Server info" onPress={() => router.push(`/server/${id}/details`)} />
        </View>
      }
      footer={canPost ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add photo, file, GIF, sticker or location"
              disabled={sendingMedia || post.isPending}
              onPress={() => { Keyboard.dismiss(); setSheetOpen(true); }}
              style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted }}>
              <Ionicons name="add" size={25} color={colors.primary} />
            </Pressable>
            <View style={{ flex: 1, backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14 }}>
              <TextInput
                accessibilityLabel="Message Server members"
                placeholder="Message Server members"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={500}
                style={{ ...typography.body, color: colors.text, minHeight: 40, maxHeight: 120, paddingTop: Platform.OS === 'ios' ? 10 : 8, paddingBottom: Platform.OS === 'ios' ? 10 : 8 }}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send Server message"
              accessibilityState={{ disabled: !valid || post.isPending || sendingMedia }}
              disabled={!valid || post.isPending || sendingMedia}
              onPress={send}
              style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: valid && !post.isPending && !sendingMedia ? colors.primary : colors.surfaceMuted }}>
              <Ionicons name="arrow-up" size={22} color={valid && !post.isPending && !sendingMedia ? colors.onPrimary : colors.textTertiary} />
            </Pressable>
          </View>
          {sendingMedia ? <Text variant="micro" color="textSecondary" align="center">Sending attachment… {Math.round(uploadProgress * 100)}%</Text> : null}
          <Text variant="micro" color="textTertiary" align="center">Admins and moderators can send up to 5 messages per day. Members are notified.</Text>
        </View>
      ) : (
        <Text variant="caption" color="textSecondary" align="center">
          {server.data.is_archived || !server.data.is_live
            ? 'This Server is closed and its messages are read-only.'
            : 'Only admins and moderators can send Server messages.'}
        </Text>
      )}>
      {feed.isLoading ? <LoadingList count={3} /> : feed.isError ? (
        <ErrorState error={feed.error} onRetry={feed.refetch} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          onRefresh={() => feed.refetch()}
          refreshing={feed.isRefetching}
          onContentSizeChange={() => {
            if (messages.length && needsScrollToBottom.current) {
              needsScrollToBottom.current = false;
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 14, paddingVertical: 16, gap: 8 }}
          ListHeaderComponent={feed.hasNextPage ? (
            <Pressable accessibilityRole="button" disabled={feed.isFetchingNextPage}
              onPress={() => { void feed.fetchNextPage(); }} style={{ alignSelf: 'center', padding: 12 }}>
              <Text color="primary">{feed.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}</Text>
            </Pressable>
          ) : undefined}
          ListEmptyComponent={<EmptyState compact icon="chatbubbles-outline" title="No messages yet" body="Server updates from admins and moderators will appear here." />}
          renderItem={({ item, index }) => {
            const showDay = index === 0 || dateLabel(item.created_at) !== dateLabel(messages[index - 1].created_at);
            const mine = !!ownId && item.author_id === ownId;
            return (
              <View style={{ gap: 8 }}>
                {showDay ? (
                  <View style={{ alignItems: 'center', marginVertical: 8 }}>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted }}>
                      <Text variant="micro" color="textSecondary">{dateLabel(item.created_at)}</Text>
                    </View>
                  </View>
                ) : null}
                <View style={{ width: '100%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  <View style={{ gap: 3, width: '100%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                    <Text variant="micro" color="primary">{mine ? 'You' : item.author_name ?? 'Server team'}</Text>
                    {item.kind === 'text' && item.title && item.title !== item.body?.replace(/\s+/g, ' ').slice(0, 80) ? (
                      <Text variant="subheading">{item.title}</Text>
                    ) : null}
                    <MessageContent
                      bucket="server-media"
                      msg={{
                        id: item.id, conversation_id: id, sender_id: item.author_id ?? '', client_id: item.id,
                        body: item.kind && item.kind !== 'text' ? null : item.body, kind: item.kind ?? 'text',
                        created_at: item.created_at, media_path: item.media_path, media_mime: item.media_mime,
                        media_size: item.media_size, media_name: item.media_name, media_width: item.media_width,
                        media_height: item.media_height, gif_url: item.gif_url, sticker_id: item.sticker_id,
                        location_lat: item.location_lat, location_lng: item.location_lng,
                      } satisfies Message}
                      mine={mine}
                      time={format(new Date(item.created_at), 'h:mm a')}
                      onRetry={() => {}}
                    />
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
      <AttachmentSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} onChoose={onAttach} />
      <GifPicker visible={gifOpen} onClose={() => setGifOpen(false)}
        onPick={(gif) => { void sendRich({ kind: 'gif', gif_url: gif.url, media_width: gif.width, media_height: gif.height }); }} />
      <StickerPicker visible={stickerOpen} onClose={() => setStickerOpen(false)}
        onPick={(stickerId) => { void sendRich({ kind: 'sticker', sticker_id: stickerId }); }} />
    </Screen>
  );
}
