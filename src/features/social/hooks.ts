import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { useSessionStore, useUserId } from '@/features/auth/session-store';
import { refreshProfileEmbedding } from '@/features/profile/embedding';
import { registerAccountCleaner } from '@/lib/account-state';
import { createInvalidationBatch } from '@/lib/invalidation-batch';
import { logger } from '@/lib/logger';
import { qk } from '@/lib/query-client';
import { secureSessionStorage } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';
import type { ActivitySort, AppNotification, Message, PostCategory, PostResponseKind, Presence, ReportReason } from '@/types/domain';

import { mergeWithOutbox } from './merge';

import {
  activityApi, chatApi, connectionsApi, discoveryApi, notificationsApi, PAGE_SIZE, platformApi, presenceApi, safetyApi, type PageCursor,
} from './api';

// ================================================================ presence
/** Account-wide presence (Available / Open to Talk). Heartbeat every 2 minutes while foregrounded. */
export function usePresence() {
  const uid = useUserId();
  return useQuery({
    queryKey: qk.presence,
    queryFn: presenceApi.heartbeat,
    enabled: !!uid,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  });
}

function useInvalidatePresence() {
  const qc = useQueryClient();
  return (p: Presence) => {
    qc.setQueryData(qk.presence, p);
    qc.invalidateQueries({ queryKey: ['discover'] });
    qc.invalidateQueries({ queryKey: ['talk-matches'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: qk.myServers });
    // Turning availability off ends on-site sessions server-side; venue views and the Hot Map follow presence.
    qc.invalidateQueries({ queryKey: ['venue-session'] });
    qc.invalidateQueries({ queryKey: ['venue-people'] });
    qc.invalidateQueries({ queryKey: ['venue-nearby'] });
    qc.invalidateQueries({ queryKey: ['server-directory'] });
    qc.invalidateQueries({ queryKey: ['hot-map'] });
  };
}

export function useSetAvailable() {
  const qc = useQueryClient();
  const done = useInvalidatePresence();
  return useMutation({
    mutationFn: (available: boolean) => presenceApi.setAvailable(available),
    onMutate: async (available) => {
      const prev = qc.getQueryData<Presence>(qk.presence);
      if (prev) qc.setQueryData(qk.presence, { ...prev, is_available: available, open_to_talk: available ? prev.open_to_talk : false });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.presence, ctx.prev),
    onSuccess: done,
  });
}

export function useSetOpenToTalk() {
  const done = useInvalidatePresence();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { open: boolean; topic: string | null; minutes?: number }) => presenceApi.setOpenToTalk(v.open, v.topic, v.minutes),
    onMutate: () => ({ prevTopic: qc.getQueryData<Presence>(qk.presence)?.talk_topic ?? null }),
    onSuccess: (p, _v, ctx) => {
      done(p);
      // Topic changed → refresh its embedding (no-op server-side without AI consent / provider).
      if (p.open_to_talk && p.talk_topic && p.talk_topic !== ctx?.prevTopic) refreshProfileEmbedding().catch(() => {});
    },
  });
}

// ================================================================ discovery
export function useDiscovery(serverId: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.discover(serverId ?? ''),
    queryFn: ({ pageParam }) => discoveryApi.discover(serverId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < 20 || all.length >= 3 ? undefined : all.length * 20),
    enabled: !!serverId && enabled,
    staleTime: 20_000,
  });
}

export function useDismissCandidate(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => discoveryApi.dismiss(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.discover(serverId) }),
  });
}

// ================================================================ requests & connections
function useInvalidateSocial() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['connections'] });
    qc.invalidateQueries({ queryKey: qk.conversations });
    qc.invalidateQueries({ queryKey: qk.chatBadge });
    qc.invalidateQueries({ queryKey: ['discover'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
    qc.invalidateQueries({ queryKey: qk.notifications });
  };
}

export const useRequests = (direction: 'incoming' | 'outgoing') =>
  useInfiniteQuery({
    queryKey: qk.requests(direction), queryFn: ({ pageParam }) => connectionsApi.listRequests(direction, pageParam),
    initialPageParam: undefined as ConversationCursor | undefined,
    getNextPageParam: (last) => last.length < PAGE_SIZE ? undefined : {
      at: last[last.length - 1].cursor_at,id: last[last.length - 1].id,snapshotAt: last[last.length - 1].snapshot_at,
    },
  });

export const usePendingRequestCount = (direction: 'incoming' | 'outgoing') =>
  useQuery({ queryKey: qk.pendingRequestCount(direction), queryFn: () => connectionsApi.pendingRequestCount(direction), refetchInterval: 60_000 });

export function useSendRequest() {
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (v: { recipient: string; serverId: string; message: string | null }) => connectionsApi.send(v.recipient, v.serverId, v.message),
    onSuccess: invalidate,
  });
}

export function useRespondToRequest() {
  const invalidate = useInvalidateSocial();
  return useMutation({ mutationFn: (v: { requestId: string; accept: boolean }) => connectionsApi.respond(v.requestId, v.accept), onSuccess: invalidate });
}

export function useCancelRequest() {
  const invalidate = useInvalidateSocial();
  return useMutation({ mutationFn: (requestId: string) => connectionsApi.cancel(requestId), onSuccess: invalidate });
}

export const useConnections = (friendsOnly = false) =>
  useInfiniteQuery({
    queryKey: qk.connections(friendsOnly), queryFn: ({ pageParam }) => connectionsApi.list(friendsOnly, pageParam),
    initialPageParam: undefined as ConversationCursor | undefined,
    getNextPageParam: (last) => last.length < PAGE_SIZE ? undefined : {
      at: last[last.length - 1].cursor_at, id: last[last.length - 1].connection_id,
      snapshotAt: last[last.length - 1].snapshot_at,
    },
  });

export function useSaveConnection() {
  const qc = useQueryClient();
  const invalidate = useInvalidateSocial();
  return useMutation({
    mutationFn: (v: { connectionId: string; saved: boolean }) => connectionsApi.save(v.connectionId, v.saved),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
}

export function useRemoveConnection() {
  const invalidate = useInvalidateSocial();
  return useMutation({ mutationFn: (connectionId: string) => connectionsApi.remove(connectionId), onSuccess: invalidate });
}

export const useRateConnection = () =>
  useMutation({ mutationFn: (v: { userId: string; rating: 1 | -1 }) => connectionsApi.rate(v.userId, v.rating) });

// ================================================================ chat
type ConversationCursor = { at: string; id: string; snapshotAt: string };

export const useConversations = () =>
  useInfiniteQuery({
    queryKey: qk.conversations,
    queryFn: ({ pageParam }) => chatApi.list(pageParam),
    initialPageParam: undefined as ConversationCursor | undefined,
    getNextPageParam: (last) => last.length < PAGE_SIZE ? undefined : {
      at: last[last.length - 1].cursor_at,
      id: last[last.length - 1].conversation_id,
      snapshotAt: last[last.length - 1].snapshot_at,
    },
    staleTime: 30_000,
  });

export const useChatNotes = () => useQuery({ queryKey: ['chat-notes'], queryFn: chatApi.notes, staleTime: 30_000 });
export const useAvailableChatPeople = () => useQuery({ queryKey: ['chat-available-people'], queryFn: chatApi.availablePeople, staleTime: 20_000 });
export function useSetChatNote() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: chatApi.setNote, onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-notes'] }) });
}
export function useClearChatNote() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: chatApi.clearNote, onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-notes'] }) });
}

export const useChatBadge = () => useQuery({
  queryKey: qk.chatBadge, queryFn: chatApi.badgeCount, refetchInterval: 60_000,
});

export const useConversation = (id: string) =>
  useQuery({ queryKey: qk.conversation(id), queryFn: () => chatApi.get(id), enabled: !!id });

type MessagePages = InfiniteData<Message[], PageCursor | undefined>;

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: qk.messages(conversationId),
    queryFn: ({ pageParam }) => chatApi.messages(conversationId, pageParam),
    initialPageParam: undefined as PageCursor | undefined,
    getNextPageParam: (last) => (last.length < PAGE_SIZE ? undefined : { createdAt: last[last.length - 1].created_at, id: last[last.length - 1].id }),
    enabled: !!conversationId,
    staleTime: Infinity, // kept fresh by Realtime; refetched on every (re)subscribe and foreground
    refetchOnMount: 'always',
  });
}

/** Insert/replace a message in the newest page, de-duplicating by id and client_id. */
function upsertMessage(data: MessagePages | undefined, msg: Message): MessagePages | undefined {
  if (!data) return data;
  const pages = data.pages.map((p) => p.filter((m) => m.id !== msg.id && m.client_id !== msg.client_id));
  pages[0] = [msg, ...(pages[0] ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return { ...data, pages };
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to new messages + read receipts for ONE conversation (RLS-filtered server-side).
 * On (re)subscribe the history is refetched to fill any gap while disconnected.
 */
export function useConversationRealtime(conversationId: string): RealtimeStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    if (!conversationId) return;
    const batch = createInvalidationBatch(qc);
    // Unique topic per mount: realtime-js reuses channels by topic, which breaks when the same
    // conversation is mounted twice or re-entered while the previous channel is still leaving.
    const channel = supabase
      .channel(`conv:${conversationId}:${Crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const msg = payload.new as Message;
          qc.setQueryData<MessagePages>(qk.messages(conversationId), (d) => upsertMessage(d, msg));
          useOutbox.getState().remove(conversationId, msg.client_id);
          batch.add(qk.conversations, true);
          batch.add(qk.chatBadge, true);
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${conversationId}` },
        () => batch.add(qk.conversation(conversationId), true))
      // `SUBSCRIBED` means the channel joined; database changes only flow after this system message.
      // Refetch again here so nothing sent in between is missed.
      .on('system', {}, (msg: { extension?: string; status?: string }) => {
        if (msg?.extension === 'postgres_changes' && msg.status === 'ok') {
          batch.add(qk.messages(conversationId), true);
        }
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          // Fill any gap between the initial fetch (or a disconnect) and the subscription going live.
          batch.add(qk.messages(conversationId), true);
          setStatus('live');
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          logger.warn('realtime_channel', { status: s });
          setStatus('reconnecting');
        }
      });
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') batch.add(qk.messages(conversationId), true);
    });
    return () => {
      sub.remove();
      batch.dispose();
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  return status;
}

/**
 * Unsent (pending/failed) messages live in their own store so query refetches can never erase them.
 * They are merged with server messages for display and dropped once the server copy exists.
 */
type OutboxState = {
  ownerId: string | null;
  byConversation: Record<string, Message[]>;
  put: (m: Message) => void;
  remove: (conversationId: string, clientId: string) => void;
};
export const useOutbox = create<OutboxState>((set) => ({
  ownerId: null,
  byConversation: {},
  put: (m) => {
    const uid = useSessionStore.getState().session?.user.id;
    if (!uid || m.sender_id !== uid) return;
    set((s) => ({ ownerId: uid,
      byConversation: { ...(s.ownerId === uid ? s.byConversation : {}),
        [m.conversation_id]: [m, ...((s.ownerId === uid ? s.byConversation[m.conversation_id] : []) ?? []).filter((x) => x.client_id !== m.client_id)] },
    }));
    scheduleOutboxSave();
  },
  remove: (conversationId, clientId) => {
    set((s) => ({ byConversation: { ...s.byConversation,
      [conversationId]: (s.byConversation[conversationId] ?? []).filter((x) => x.client_id !== clientId) } }));
    scheduleOutboxSave();
  },
}));

const outboxKey = (uid: string) => `sniffin.text_outbox.${uid}`;
let outboxTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();
export function persistTextOutbox() {
  if (Platform.OS === 'web') return Promise.resolve();
  const { ownerId, byConversation } = useOutbox.getState();
  if (!ownerId) return Promise.resolve();
  const rows = Object.values(byConversation).flat().filter((m) => m.kind === 'text' && m.sender_id === ownerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)
    .map((m) => ({ id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
      client_id: m.client_id, body: m.body, kind: 'text', created_at: m.created_at, failed: true }));
  writeChain = writeChain.catch(() => {}).then(() => secureSessionStorage.setItem(outboxKey(ownerId), JSON.stringify(rows)));
  return writeChain;
}
function scheduleOutboxSave() {
  if (outboxTimer) clearTimeout(outboxTimer);
  outboxTimer = setTimeout(() => { outboxTimer = null; void persistTextOutbox().catch(() => {}); }, 350);
}

export async function hydrateTextOutbox(uid: string) {
  if (useOutbox.getState().ownerId === uid) return;
  useOutbox.setState({ ownerId: uid, byConversation: {} });
  if (Platform.OS === 'web') return;
  const raw = await secureSessionStorage.getItem(outboxKey(uid)).catch(() => null);
  if (!raw || useOutbox.getState().ownerId !== uid) return;
  try {
    const rows = JSON.parse(raw) as Message[];
    for (const m of rows.slice(0, 20)) {
      if (m.sender_id === uid && m.kind === 'text' && /^[0-9a-f-]{36}$/i.test(m.conversation_id) &&
        typeof m.client_id === 'string' && typeof m.body === 'string') {
        useOutbox.getState().put({ ...m, body: m.body.slice(0, 2000), pending: false, failed: true });
      }
    }
  } catch { /* A damaged local outbox cannot block chat. */ }
}

registerAccountCleaner(() => {
  if (outboxTimer) clearTimeout(outboxTimer);
  outboxTimer = null;
  const owner = useOutbox.getState().ownerId;
  useOutbox.setState({ ownerId: null, byConversation: {} });
  if (owner && Platform.OS !== 'web') {
    writeChain = writeChain.catch(() => {}).then(() => secureSessionStorage.removeItem(outboxKey(owner)));
  }
});

const EMPTY: Message[] = [];


export function useChatMessages(conversationId: string, pages: Message[][] | undefined): Message[] {
  const outbox = useOutbox((s) => s.byConversation[conversationId] ?? EMPTY);
  const server = pages?.flat() ?? EMPTY;
  return mergeWithOutbox(server, outbox);
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const uid = useUserId() ?? '';
  return useMutation({
    mutationFn: (v: { body: string; clientId: string }) => chatApi.send(conversationId, uid, v.clientId, v.body),
    onMutate: async ({ body, clientId }) => {
      useOutbox.getState().put({
        id: `local-${clientId}`, conversation_id: conversationId, sender_id: uid, client_id: clientId, body, kind: 'text',
        created_at: new Date().toISOString(), pending: true,
      });
      await persistTextOutbox().catch(() => {});
    },
    onSuccess: (msg) => {
      qc.setQueryData<MessagePages>(qk.messages(conversationId), (d) => upsertMessage(d, msg));
      useOutbox.getState().remove(conversationId, msg.client_id);
      qc.invalidateQueries({ queryKey: qk.conversations });
      qc.invalidateQueries({ queryKey: qk.chatBadge });
    },
    onError: (_e, { body, clientId }) => {
      useOutbox.getState().put({
        id: `local-${clientId}`, conversation_id: conversationId, sender_id: uid, client_id: clientId, body, kind: 'text',
        created_at: new Date().toISOString(), failed: true,
      });
    },
  });
}

export const newClientId = () => Crypto.randomUUID();

export function useMarkRead(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => chatApi.markRead(conversationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversations });
      qc.invalidateQueries({ queryKey: qk.chatBadge });
      qc.invalidateQueries({ queryKey: qk.notifications });
    },
  });
}

export const useIcebreakers = (connectionId: string | undefined) =>
  useQuery({ queryKey: qk.icebreakers(connectionId ?? ''), queryFn: () => chatApi.icebreakers(connectionId!), enabled: !!connectionId, staleTime: 10 * 60_000 });

// ================================================================ activity
export function useActivity(serverId: string | null, sort: ActivitySort = 'latest') {
  return useInfiniteQuery({
    queryKey: [...qk.activity(serverId), sort],
    queryFn: ({ pageParam }) =>
      activityApi.list(serverId, sort, sort !== 'for_you' ? { before: pageParam as PageCursor | undefined } : { offset: (pageParam as number | undefined) ?? 0 }),
    initialPageParam: undefined as PageCursor | number | undefined,
    getNextPageParam: (last, all) => {
      if (last.length < 20) return undefined;
      return sort !== 'for_you' ? { createdAt: last[last.length - 1].created_at, id: last[last.length - 1].id } : all.length * 20;
    },
    // For You is offset-paged over a live score, so a post can shift between pages; never render it twice.
    select: (data) => {
      const seen = new Set<string>();
      return { ...data, pages: data.pages.map((page) => page.filter((p) => !seen.has(p.id) && !!seen.add(p.id))) };
    },
  });
}

/** Single post (detail screen). Lives under ['activity'] so every activity invalidation refreshes it. */
export const useActivityPost = (postId: string | undefined) =>
  useQuery({ queryKey: ['activity', 'post', postId ?? ''], queryFn: () => activityApi.get(postId!), enabled: !!postId });

function useInvalidateActivity() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['activity'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreatePost() {
  const inv = useInvalidateActivity();
  return useMutation({
    mutationFn: (v: { serverId: string; body: string; category: PostCategory; expiresHours: number | null; capacity: number | null; imagePaths: string[] }) =>
      activityApi.create(v),
    onSuccess: inv,
  });
}

export function useUpdatePost() {
  const inv = useInvalidateActivity();
  return useMutation({
    mutationFn: (v: { postId: string; body: string; category: PostCategory; expiresHours: number | null; capacity: number | null; imagePaths: string[] }) =>
      activityApi.update(v),
    onSuccess: inv,
  });
}

export function useDeletePost() {
  const inv = useInvalidateActivity();
  return useMutation({ mutationFn: (postId: string) => activityApi.remove(postId), onSuccess: inv });
}

/** I'm in / I'm not in / remove (kind = null). */
export function useSetPostResponse() {
  const inv = useInvalidateActivity();
  const invSocial = useInvalidateSocial();
  return useMutation({
    mutationFn: (v: { postId: string; kind: PostResponseKind | null; message?: string | null }) =>
      activityApi.setResponse(v.postId, v.kind, v.message ?? null),
    onSuccess: () => {
      inv();
      invSocial();
    },
  });
}

/** v1 alias: "Respond" = I'm in. */
export function useRespondToPost() {
  const set = useSetPostResponse();
  return { ...set, mutate: (v: { postId: string; message: string | null }, o?: Parameters<typeof set.mutate>[1]) => set.mutate({ postId: v.postId, kind: 'in', message: v.message }, o),
    mutateAsync: (v: { postId: string; message: string | null }) => set.mutateAsync({ postId: v.postId, kind: 'in', message: v.message }) };
}

export const usePostResponses = (postId: string) =>
  useQuery({ queryKey: qk.postResponses(postId), queryFn: () => activityApi.responses(postId), enabled: !!postId });

export function useModerateRemovePost() {
  const inv = useInvalidateActivity();
  return useMutation({ mutationFn: (v: { postId: string; reason: string | null }) => activityApi.moderateRemove(v.postId, v.reason), onSuccess: inv });
}

// ================================================================ safety
export function useBlockUser() {
  const invalidate = useInvalidateSocial();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => safetyApi.block(userId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: qk.blocked });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userId: string) => safetyApi.unblock(userId), onSuccess: () => qc.invalidateQueries({ queryKey: qk.blocked }) });
}

export const useBlockedUsers = () => useQuery({ queryKey: qk.blocked, queryFn: safetyApi.listBlocked });

export const useReport = () =>
  useMutation({
    mutationFn: (v: { reason: ReportReason; details?: string | null; userId?: string | null; postId?: string | null; messageId?: string | null; serverId?: string | null }) =>
      safetyApi.report(v),
  });

export const useSetAccountStatus = () =>
  useMutation({ mutationFn: (v: { userId: string; status: 'active' | 'suspended'; reason: string | null }) => safetyApi.setAccountStatus(v.userId, v.status, v.reason) });

// ================================================================ notifications
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: qk.notifications,
    queryFn: ({ pageParam }) => notificationsApi.list(pageParam),
    initialPageParam: undefined as PageCursor | undefined,
    getNextPageParam: (last) => (last.length < PAGE_SIZE ? undefined : { createdAt: last[last.length - 1].created_at, id: last[last.length - 1].id }),
  });
}

export const useUnreadNotificationCount = () =>
  useQuery({ queryKey: [...qk.notifications, 'unread'], queryFn: notificationsApi.unreadCount });

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ids: string[] | null) => notificationsApi.markRead(ids), onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }) });
}

/**
 * One user-scoped subscription (RLS: only this user's rows) that keeps badges, the request inbox
 * and the chat list fresh. Mounted once inside the signed-in app shell.
 */
export function useNotificationsRealtime() {
  const uid = useUserId();
  const qc = useQueryClient();
  useEffect(() => {
    if (!uid) return;
    const batch = createInvalidationBatch(qc);
    const channel = supabase
      .channel(`notifications:${uid}:${Crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        (payload) => {
          const n = payload.new as Partial<AppNotification>;
          batch.add(qk.notifications, true);
          batch.add([...qk.notifications, 'unread'], true);
          if (n.type === 'message') batch.add(qk.conversations, true);
          if (n.type === 'message' || n.type === 'connection_request') batch.add(qk.chatBadge, true);
          if (n.type === 'connection_request' || n.type === 'request_accepted') {
            batch.add(['requests']);
            batch.add(['connections']);
            batch.add(qk.conversations, true);
            batch.add(qk.chatBadge, true);
          }
          if (n.type === 'server_membership' || n.type === 'badge_granted') batch.add(['servers']);
          if (n.type === 'server_announcement' && n.server_id) {
            batch.add(qk.announcements(n.server_id), true);
            batch.add(qk.serverMessages(n.server_id), true);
          }
          if (n.type === 'activity_response') batch.add(['activity']);
          if (n.type === 'connection_saved') batch.add(['conversation']);
        })
      // Once database changes are actually flowing, catch up on anything that arrived while connecting.
      .on('system', {}, (msg: { extension?: string; status?: string }) => {
        if (msg?.extension === 'postgres_changes' && msg.status === 'ok') {
          batch.add(qk.notifications, true);
          batch.add([...qk.notifications, 'unread'], true);
          batch.add(['requests']);
          batch.add(qk.conversations, true);
          batch.add(qk.chatBadge, true);
        }
      })
      .subscribe();
    return () => {
      batch.dispose();
      supabase.removeChannel(channel);
    };
  }, [uid, qc]);
}

// ================================================================ platform
export const useFeatureFlags = () =>
  useQuery({
    queryKey: qk.flags,
    queryFn: platformApi.flags,
    staleTime: 10 * 60_000,
    select: (rows) => Object.fromEntries(rows.map((r) => [r.key, r.enabled])) as Record<string, boolean>,
  });
