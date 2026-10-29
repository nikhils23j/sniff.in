import Ionicons from '@expo/vector-icons/Ionicons';
import { format, isToday, isYesterday } from 'date-fns';
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionMenu, type MenuAction } from '@/components/ActionMenu';
import { AttachmentSheet, type AttachmentChoice } from '@/components/chat/AttachmentSheet';
import { CommonGroundCard } from '@/components/chat/CommonGroundCard';
import { GifPicker } from '@/components/chat/GifPicker';
import { MessageContent } from '@/components/chat/MessageContent';
import { StarterChips } from '@/components/chat/StarterChips';
import { StickerPicker } from '@/components/chat/StickerPicker';
import {
  Avatar, Banner, EmptyState, ErrorState, IconButton, Skeleton, Text, confirm, toast,
} from '@/components/ui';
import { useUserId } from '@/features/auth/session-store';
import { setFocusedConversation } from '@/features/notifications/push';
import { relativeTime } from '@/features/social/chat-extra';
import { useSendAttachment, useSendGif, useSendLocation, useSendSticker } from '@/features/social/chat-media';
import { getCurrentCoords, pickDocument, pickPhoto, takePhoto } from '@/features/social/chat-pickers';
import { hydrateDraftsForAccount, useDraftsStore } from '@/features/social/drafts-store';
import {
  hydrateTextOutbox, newClientId, useBlockUser, useConversation, useConversationRealtime, useMarkRead, useMessages, useOutbox,
  useSaveConnection, useSendMessage, useChatMessages,
} from '@/features/social/hooks';
import { toAppError } from '@/lib/errors';
import { messageSchema } from '@/lib/validation';
import { useTheme } from '@/theme';
import type { ConversationDetail, Message } from '@/types/domain';
import { useNow } from '@/hooks/use-now';

type Row = { kind: 'msg'; msg: Message; receipt: 'seen' | 'delivered' | null } | { kind: 'day'; key: string; label: string };

function dayLabel(d: Date) {
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'EEE, d MMM' : 'd MMM yyyy');
}

const dayKey = (iso: string) => format(new Date(iso), 'yyyy-MM-dd');

/** Messages arrive newest-first (inverted list). A day separator goes after the oldest message of each day. */
function buildRows(messages: Message[], myId: string | null, theirLastRead: string | null | undefined, hasMore: boolean): Row[] {
  const lastMineId = messages.find((m) => m.sender_id === myId && !m.pending && !m.failed)?.id;
  const readAt = theirLastRead ? new Date(theirLastRead).getTime() : null;
  const rows: Row[] = [];
  messages.forEach((m, i) => {
    let receipt: 'seen' | 'delivered' | null = null;
    if (m.id === lastMineId) receipt = readAt !== null && readAt >= new Date(m.created_at).getTime() ? 'seen' : 'delivered';
    rows.push({ kind: 'msg', msg: m, receipt });
    const older = messages[i + 1];
    if (older ? dayKey(older.created_at) !== dayKey(m.created_at) : !hasMore) {
      rows.push({ kind: 'day', key: `day-${dayKey(m.created_at)}`, label: dayLabel(new Date(m.created_at)) });
    }
  });
  return rows;
}

function Bubble({
  msg, mine, receipt, onRetry, onDiscard, onLongPress,
}: {
  msg: Message; mine: boolean; receipt: 'seen' | 'delivered' | null; onRetry: () => void; onDiscard: () => void; onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const time = format(new Date(msg.created_at), 'h:mm a');
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 3, paddingHorizontal: 12 }}>
      <MessageContent
        msg={msg}
        mine={mine}
        time={time}
        onRetry={onRetry}
        onLongPress={!mine && !msg.pending && !msg.failed ? onLongPress : undefined}
      />
      {msg.failed ? (
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 3, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Message not sent. Tap to retry" onPress={onRetry} hitSlop={8} style={{ flexDirection: 'row', gap: 4, alignItems: 'center', minHeight: 32 }}>
            <Ionicons name="alert-circle" size={14} color={colors.danger} />
            <Text variant="micro" style={{ color: colors.danger }}>
              Not sent — tap to retry
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Discard unsent message" onPress={onDiscard} hitSlop={8} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Text variant="micro" color="textSecondary">
              Discard
            </Text>
          </Pressable>
        </View>
      ) : receipt ? (
        <Text variant="micro" color="textTertiary" style={{ marginTop: 3 }}>
          {receipt === 'seen' ? 'Seen' : 'Delivered'}
        </Text>
      ) : null}
    </View>
  );
}

function DaySeparator({ label }: { label: string }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: 12 }}>
      <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
        <Text variant="micro" color="textSecondary">
          {label}
        </Text>
      </View>
    </View>
  );
}

function ChatSkeleton() {
  return (
    <View style={{ flex: 1, padding: 16, gap: 14, justifyContent: 'flex-end' }} accessibilityLabel="Loading messages">
      <View style={{ alignItems: 'flex-start' }}><Skeleton width="55%" height={44} radius={18} /></View>
      <View style={{ alignItems: 'flex-end' }}><Skeleton width="40%" height={36} radius={18} /></View>
      <View style={{ alignItems: 'flex-start' }}><Skeleton width="65%" height={60} radius={18} /></View>
      <View style={{ alignItems: 'flex-end' }}><Skeleton width="50%" height={36} radius={18} /></View>
    </View>
  );
}

function useFocusedConversation(conversationId: string) {
  useFocusEffect(
    useCallback(() => {
      setFocusedConversation(conversationId);
      return () => setFocusedConversation(null);
    }, [conversationId]),
  );
}

export default function ChatScreen() {
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id ?? '';
  useFocusedConversation(conversationId);
  const { colors, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const myId = useUserId();
  const focused = useIsFocused();

  const detailQ = useConversation(conversationId);
  const messagesQ = useMessages(conversationId);
  const realtime = useConversationRealtime(conversationId);
  const send = useSendMessage(conversationId);
  const attach = useSendAttachment(conversationId);
  const sendGif = useSendGif(conversationId);
  const sendSticker = useSendSticker(conversationId);
  const sendLocation = useSendLocation(conversationId);
  const { mutate: markRead } = useMarkRead(conversationId);
  const save = useSaveConnection();
  const block = useBlockUser();

  const detail: ConversationDetail | undefined = detailQ.data;
  const messages = useChatMessages(conversationId, messagesQ.data?.pages);
  const latestFromOther = messages.find((m) => m.sender_id !== myId && !m.id.startsWith('local-'))?.id;

  // Mark read on open and whenever a new message from the other person lands while we're looking at it.
  useEffect(() => {
    if (focused && conversationId) markRead();
  }, [focused, conversationId, latestFromOther, markRead]);

  // ---- composer
  const setDraft = useDraftsStore((s) => s.setDraft);
  const [text, setText] = useState(() => useDraftsStore.getState().drafts[conversationId] ?? '');
  useEffect(() => {
    if (!myId) return;
    void Promise.all([hydrateDraftsForAccount(myId), hydrateTextOutbox(myId)]).then(() => {
      const saved = useDraftsStore.getState().drafts[conversationId];
      if (saved) setText((current) => current || saved);
    });
  }, [myId, conversationId]);
  useEffect(() => {
    const serverIds = new Set(messagesQ.data?.pages.flat().map((m) => m.client_id) ?? []);
    if (!serverIds.size) return;
    for (const pending of useOutbox.getState().byConversation[conversationId] ?? []) {
      if (serverIds.has(pending.client_id)) useOutbox.getState().remove(conversationId, pending.client_id);
    }
  }, [messagesQ.data, conversationId]);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const changeText = (v: string) => {
    setText(v);
    setDraft(conversationId, v);
  };
  const parsed = messageSchema.safeParse(text);
  const canSend = !!detail?.can_send && parsed.success;
  const starterSending = useRef(false);

  const sendStarter = (suggestion: string) => {
    const valid = messageSchema.safeParse(suggestion);
    if (!valid.success || !detail?.can_send || starterSending.current) return;
    starterSending.current = true;
    send.mutate({ body: valid.data, clientId: newClientId() }, {
      onError: (e) => toast.error(e),
      onSettled: () => { starterSending.current = false; },
    });
  };

  const submit = () => {
    if (!parsed.success || !detail?.can_send) return;
    send.mutate({ body: parsed.data, clientId: newClientId() }, { onError: (e) => toast.error(e) });
    setText('');
    setDraft(conversationId, '');
  };

  const retry = (m: Message) => {
    if (m.kind === 'text') send.mutate({ body: m.body ?? '', clientId: m.client_id }, { onError: (e) => toast.error(e) });
    else attach.retry(m.client_id).catch((e) => toast.error(e));
  };
  const discard = (m: Message) => (m.kind === 'text' ? useOutbox.getState().remove(conversationId, m.client_id) : attach.discard(m.client_id));

  // ---- attachments (photo, camera, document, GIF, sticker, location)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);

  /** Runs a send that may throw synchronously (validation) or reject (upload/insert); both end in a toast. */
  const fire = (fn: () => Promise<unknown>) => {
    try {
      fn().catch((e) => toast.error(e));
    } catch (e) {
      toast.error(e);
    }
  };

  const shareLocation = async () => {
    const who = detail?.other.display_name ?? 'them';
    const ok = await confirm({
      title: `Share your current location with ${who}?`,
      message: "They'll see this exact spot.",
      confirmLabel: 'Share location',
    });
    if (!ok) return;
    try {
      toast.info('Getting your location…');
      const pos = await getCurrentCoords();
      if (pos) fire(() => sendLocation(pos.lat, pos.lng));
    } catch (e) {
      toast.error(e);
    }
  };

  const onAttach = async (choice: AttachmentChoice) => {
    try {
      if (choice === 'gif') return setGifOpen(true);
      if (choice === 'sticker') return setStickerOpen(true);
      if (choice === 'location') return await shareLocation();
      const file = await (choice === 'photo' ? pickPhoto : choice === 'camera' ? takePhoto : pickDocument)();
      if (file) fire(() => attach.send(file));
    } catch (e) {
      toast.error(e);
    }
  };

  // ---- menus & actions
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportMsg, setReportMsg] = useState<Message | null>(null);

  const saveConnection = async () => {
    if (!detail) return;
    try {
      const res = await save.mutateAsync({ connectionId: detail.connection_id, saved: true });
      toast.success(res.is_friend ? `You and ${detail.other.display_name} are now friends` : "Saved. We'll keep this chat if they save it too.");
    } catch (e) {
      toast.error(e);
    }
  };

  const blockUser = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: `Block ${detail.other.display_name}?`,
      message: "This closes the chat and hides you from each other everywhere in Sniff.in. You can unblock them in Settings.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await block.mutateAsync(detail.other.id);
      toast.success(`${detail.other.display_name} is blocked`);
      router.back();
    } catch (e) {
      toast.error(e);
    }
  };

  const menuActions: MenuAction[] = detail
    ? [
        { label: 'View profile', icon: 'person-outline', onPress: () => router.push(`/user/${detail.other.id}`) },
        ...(!detail.is_friend && !detail.i_saved
          ? [{ label: 'Save connection', icon: 'heart-outline' as const, onPress: saveConnection }]
          : []),
        { label: 'Report user', icon: 'flag-outline', onPress: () => router.push({ pathname: '/report', params: { userId: detail.other.id } }) },
        { label: 'Block', icon: 'ban-outline', destructive: true, onPress: blockUser },
      ]
    : [];

  // ---- body states
  const detailError = detailQ.isError ? toAppError(detailQ.error) : null;
  const unavailable = detailError?.code === 'not_found';

  const rows = buildRows(messages, myId, detail?.their_last_read_at, !!messagesQ.hasNextPage);
  const showStarters = !!detail && detail.can_send && messagesQ.isSuccess && messages.length < 3;

  const expired = !!detail && !detail.can_send && !!detail.expires_at && new Date(detail.expires_at).getTime() <= now;
  const ephemeral = !!detail && !!detail.expires_at && !detail.is_friend && !expired;

  let content: React.ReactNode;
  if (unavailable) {
    content = (
      <EmptyState
        icon="chatbubble-ellipses-outline"
        title="This conversation is no longer available"
        body="It may have expired, been removed, or closed."
        action={{ label: 'Back to chats', onPress: () => router.replace('/(tabs)/chats') }}
      />
    );
  } else if (detailQ.isError) {
    content = <ErrorState error={detailQ.error} onRetry={() => detailQ.refetch()} />;
  } else if (detailQ.isLoading || messagesQ.isLoading) {
    content = <ChatSkeleton />;
  } else if (messagesQ.isError && messages.length === 0) {
    content = <ErrorState error={messagesQ.error} onRetry={() => messagesQ.refetch()} />;
  } else if (messages.length === 0) {
    content = (
      <View style={{ flex: 1, padding: 16, gap: 16, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Avatar path={detail?.other.avatar_path} name={detail?.other.display_name ?? ''} size={72} />
          <Text variant="heading">{detail?.other.display_name}</Text>
          <Text variant="callout" color="textSecondary" align="center">
            {detail?.can_send ? 'You’re connected. Say hello.' : 'No messages in this chat.'}
          </Text>
        </View>
        {detail ? <CommonGroundCard connectionId={detail.connection_id} serverName={detail.origin_server_name} /> : null}
      </View>
    );
  } else {
    content = (
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => (r.kind === 'msg' ? r.msg.client_id : r.key)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingVertical: 8 }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (messagesQ.hasNextPage && !messagesQ.isFetchingNextPage) messagesQ.fetchNextPage();
        }}
        ListFooterComponent={
          messagesQ.isFetchingNextPage ? (
            <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} />
          ) : !messagesQ.hasNextPage && detail ? (
            <CommonGroundCard connectionId={detail.connection_id} serverName={detail.origin_server_name} defaultExpanded={messages.length < 6} />
          ) : undefined
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <DaySeparator label={item.label} />
          ) : (
            <Bubble
              msg={item.msg}
              mine={item.msg.sender_id === myId}
              receipt={item.receipt}
              onRetry={() => retry(item.msg)}
              onDiscard={() => discard(item.msg)}
              onLongPress={() => setReportMsg(item.msg)}
            />
          )
        }
      />
    );
  }

  const name = detail?.other.display_name;
  const showComposer = !!detail && !unavailable;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 56, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/chats'))}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.surfaceMuted : 'transparent' })}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          {detail ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}, view profile`}
              onPress={() => router.push(`/user/${detail.other.id}`)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
              <Avatar path={detail.other.avatar_path} name={detail.other.display_name} size={36} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading" numberOfLines={1}>
                  {name}
                </Text>
                <Text variant="caption" color="textSecondary" numberOfLines={1}>
                  {detail.origin_server_name ? `via ${detail.origin_server_name}` : `@${detail.other.username}`}
                </Text>
              </View>
            </Pressable>
          ) : (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {detailQ.isLoading ? (
                <>
                  <Skeleton width={36} height={36} radius={18} />
                  <Skeleton width={120} height={16} />
                </>
              ) : null}
            </View>
          )}
          {detail ? <IconButton icon="ellipsis-horizontal" label="Chat options" onPress={() => setMenuOpen(true)} /> : null}
        </View>

        {realtime === 'reconnecting' ? (
          <View accessibilityRole="alert" style={{ backgroundColor: colors.warningSoft, paddingVertical: 4, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            <ActivityIndicator size="small" color={colors.warning} />
            <Text variant="micro" style={{ color: colors.warning }}>
              Reconnecting…
            </Text>
          </View>
        ) : null}

        {ephemeral && detail ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
            <Banner
              tone="warning"
              title={detail.i_saved && !detail.they_saved ? 'Waiting for them' : undefined}
              body={`This chat disappears ${relativeTime(detail.expires_at!)} unless you both save the connection.`}
              action={detail.i_saved ? undefined : { label: 'Save connection', onPress: saveConnection }}
            />
          </View>
        ) : null}

        <View style={{ flex: 1 }}>{content}</View>

        {showStarters && detail && !keyboardUp ? (
          <StarterChips
            connectionId={detail.connection_id}
            conversationId={conversationId}
            onPick={sendStarter}
            sending={send.isPending}
          />
        ) : null}

        {showComposer && detail ? (
          detail.can_send ? (
            <View
              style={{
                flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8,
                paddingBottom: keyboardUp ? 8 : Math.max(insets.bottom, 8) + 4, borderTopWidth: 1, borderTopColor: colors.border,
                backgroundColor: colors.background,
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add photo, file, GIF, sticker or location"
                onPress={() => {
                  Keyboard.dismiss();
                  setSheetOpen(true);
                }}
                style={({ pressed }) => ({
                  width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed ? colors.primarySoft : colors.surfaceMuted,
                })}>
                <Ionicons name="add" size={26} color={colors.primary} />
              </Pressable>
              <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 22, paddingHorizontal: 14 }}>
                <TextInput
                  ref={inputRef}
                  accessibilityLabel="Message"
                  placeholder={`Message ${name?.split(' ')[0] ?? ''}`}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={text}
                  onChangeText={changeText}
                  multiline
                  maxLength={2000}
                  style={{ ...typography.body, color: colors.text, maxHeight: 120, minHeight: 40, paddingTop: Platform.OS === 'ios' ? 10 : 8, paddingBottom: Platform.OS === 'ios' ? 10 : 8 }}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                onPress={submit}
                style={{
                  width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: canSend ? colors.primary : colors.surfaceMuted,
                }}>
                <Ionicons name="arrow-up" size={22} color={canSend ? colors.onPrimary : colors.textTertiary} />
              </Pressable>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 12) }}>
              <Banner
                tone="danger"
                icon="lock-closed"
                title={expired ? 'This chat has expired' : 'This chat is closed'}
                body={
                  expired
                    ? 'The event ended and you did not both save the connection, so messages can no longer be sent.'
                    : 'You can’t send messages here anymore. It may have expired or been closed by one of you.'
                }
              />
            </View>
          )
        ) : null}
      </View>

      <AttachmentSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} onChoose={onAttach} />
      <GifPicker
        visible={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={(g) => fire(() => sendGif(g.url, g.width, g.height))}
      />
      <StickerPicker visible={stickerOpen} onClose={() => setStickerOpen(false)} onPick={(id) => fire(() => sendSticker(id))} />
      <ActionMenu visible={menuOpen} title={name} actions={menuActions} onClose={() => setMenuOpen(false)} />
      <ActionMenu
        visible={!!reportMsg}
        title="Message"
        onClose={() => setReportMsg(null)}
        actions={
          reportMsg
            ? [{
                label: 'Report message', icon: 'flag-outline', destructive: true,
                onPress: () => router.push({ pathname: '/report', params: { messageId: reportMsg.id, userId: reportMsg.sender_id } }),
              }]
            : []
        }
      />
    </KeyboardAvoidingView>
  );
}
