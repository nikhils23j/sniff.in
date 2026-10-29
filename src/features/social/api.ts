import { AppError, toAppError } from '@/lib/errors';
import { DOCUMENT_TYPES, finalizeMediaUpload, prepareImage, randomFileName, thumbnailPath, uploadWithProgress } from '@/lib/upload';
import { rpc, run } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import type {
  ActivitySort, Gif, MessageKind, Presence, PostResponseKind,
  ActivityPost, AppNotification, BlockedUser, Connection, ConnectionRequest, ConversationDetail,
  ConversationSummary, DiscoveryCandidate, IcebreakerResult, Message, PostCategory, PostResponse, ReportReason,
  RequestResult, FeatureFlag, ChatNote, AvailableChatPerson,
} from '@/types/domain';
import { templateIcebreakers, type IcebreakerContext } from '../../../supabase/functions/_shared/icebreaker-templates';

export const PAGE_SIZE = 30;
export type PageCursor = { createdAt: string; id: string };
const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, client_id, body, kind, media_path, media_mime, media_size, media_name, media_width, media_height, gif_url, sticker_id, location_lat, location_lng, created_at';

export const presenceApi = {
  /** Authoritative presence (also marks the user active). */
  heartbeat: () => rpc<Presence>('heartbeat'),
  setAvailable: (available: boolean) => rpc<Presence>('set_available', { p_available: available }),
  /** minutes: how long Open to Talk stays on (1–720); it expires automatically server-side. */
  setOpenToTalk: (open: boolean, topic: string | null, minutes = 120) =>
    rpc<Presence>('set_open_to_talk', { p_open: open, p_topic: topic, p_minutes: minutes }),
};

export const discoveryApi = {
  discover: (serverId: string, offset = 0) =>
    rpc<DiscoveryCandidate[]>('discover_available_people', { p_server_id: serverId, p_limit: 20, p_offset: offset }),
  dismiss: (userId: string) => rpc<void>('dismiss_candidate', { p_user_id: userId, p_hours: 168 }),
};

export const connectionsApi = {
  send: (recipient: string, serverId: string, message: string | null) =>
    rpc<RequestResult>('send_connection_request', { p_recipient: recipient, p_server_id: serverId, p_message: message }),
  respond: (requestId: string, accept: boolean) =>
    rpc<RequestResult>('respond_to_request', { p_request_id: requestId, p_accept: accept }),
  cancel: (requestId: string) => rpc<void>('cancel_request', { p_request_id: requestId }),
  listRequests: (direction: 'incoming' | 'outgoing', before?: { at: string; id: string; snapshotAt: string }) =>
    rpc<ConnectionRequest[]>('list_requests_page', { p_direction: direction, p_before_at: before?.at ?? null,
      p_before_id: before?.id ?? null, p_snapshot_at: before?.snapshotAt ?? null, p_limit: PAGE_SIZE }),
  pendingRequestCount: (direction: 'incoming' | 'outgoing') => rpc<number>('get_pending_request_count', { p_direction: direction }),
  list: (friendsOnly: boolean, before?: { at: string; id: string; snapshotAt: string }) =>
    rpc<Connection[]>('list_connections_page', { p_friends_only: friendsOnly,
      p_before_at: before?.at ?? null, p_before_id: before?.id ?? null,
      p_snapshot_at: before?.snapshotAt ?? null, p_limit: PAGE_SIZE }),
  save: (connectionId: string, saved: boolean) =>
    rpc<{ is_friend: boolean; expires_at: string | null }>('save_connection', { p_connection_id: connectionId, p_saved: saved }),
  remove: (connectionId: string) => rpc<void>('remove_connection', { p_connection_id: connectionId }),
  rate: (userId: string, rating: 1 | -1) => rpc<void>('rate_connection', { p_user_id: userId, p_rating: rating }),
};

export const chatApi = {
  notes: () => rpc<ChatNote[]>('list_chat_notes'),
  setNote: (v: { body: string | null; songTitle: string | null; songArtist: string | null; songUrl: string | null }) =>
    rpc<void>('set_chat_note', { p_body: v.body, p_song_title: v.songTitle, p_song_artist: v.songArtist, p_song_url: v.songUrl }),
  clearNote: () => rpc<void>('clear_chat_note'),
  availablePeople: () => rpc<AvailableChatPerson[]>('available_people_for_chat', { p_limit: 30 }),
  list: (before?: { at: string; id: string; snapshotAt: string }) => rpc<ConversationSummary[]>('list_conversations_page', {
    p_before_at: before?.at ?? null, p_before_id: before?.id ?? null,
    p_snapshot_at: before?.snapshotAt ?? null, p_limit: PAGE_SIZE,
  }),
  badgeCount: () => rpc<number>('get_chat_badge_count'),
  get: (id: string) => rpc<ConversationDetail>('get_conversation', { p_conversation_id: id }),
  /** Newest-first page; both timestamp and id make equal-timestamp pages stable. */
  async messages(conversationId: string, before?: PageCursor): Promise<Message[]> {
    let q = supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);
    if (before) q = q.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
    return run(q) as Promise<Message[]>;
  },
  /** Idempotent send: a retry with the same clientId never duplicates (unique(sender_id, client_id)). */
  async send(conversationId: string, senderId: string, clientId: string, body: string): Promise<Message> {
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, client_id: clientId, body })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        // Already stored by an earlier attempt whose response was lost.
        const existing = await run(
          supabase.from('messages').select(MESSAGE_COLUMNS)
            .eq('sender_id', senderId).eq('client_id', clientId).single(),
        );
        return existing as unknown as Message;
      }
      throw toAppError(error);
    }
    return data as Message;
  },
  /** Inserts a non-text message (media already uploaded). Same idempotency guarantees as send(). */
  async sendRich(conversationId: string, senderId: string, clientId: string, fields: {
    kind: Exclude<MessageKind, 'text'>; body?: string | null; media_path?: string; media_mime?: string; media_size?: number;
    media_name?: string; media_width?: number; media_height?: number; gif_url?: string; sticker_id?: string;
    location_lat?: number; location_lng?: number;
  }): Promise<Message> {
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, client_id: clientId, ...fields })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return (await run(supabase.from('messages').select(MESSAGE_COLUMNS).eq('sender_id', senderId).eq('client_id', clientId).single())) as unknown as Message;
      }
      throw toAppError(error);
    }
    if (fields.media_path) void finalizeMediaUpload('chat-media', fields.media_path).catch(() => {});
    return data as unknown as Message;
  },
  /** Uploads an image or document into chat-media/<conversation>/… and returns the fields for sendRich(). */
  async uploadAttachment(conversationId: string, file: { uri: string; name?: string | null; mime?: string | null; isImage: boolean },
    onProgress?: (f: number) => void) {
    if (file.isImage && file.mime === 'image/gif') {
      // Keep animation: upload GIFs as-is (no re-encode).
      const path = `${conversationId}/${randomFileName('gif')}`;
      const { size } = await uploadWithProgress({ bucket: 'chat-media', path, uri: file.uri, contentType: 'image/gif', onProgress });
      return { kind: 'image' as const, media_path: path, media_mime: 'image/gif', media_size: size };
    }
    if (file.isImage) {
      const img = await prepareImage(file.uri, 1600);
      const path = `${conversationId}/${randomFileName('jpg')}`;
      const { size } = await uploadWithProgress({ bucket: 'chat-media', path, uri: img.uri, contentType: img.mime, onProgress });
      return { kind: 'image' as const, media_path: path, media_mime: img.mime, media_size: size, media_width: img.width, media_height: img.height };
    }
    const mime = file.mime ?? 'application/octet-stream';
    if (!DOCUMENT_TYPES.includes(mime)) throw new AppError('unsupported_file', 'Send PDFs, Office documents or text files.');
    const ext = (file.name ?? '').split('.').pop() ?? 'bin';
    const path = `${conversationId}/${randomFileName(ext)}`;
    const { size } = await uploadWithProgress({ bucket: 'chat-media', path, uri: file.uri, contentType: mime, onProgress });
    return { kind: 'file' as const, media_path: path, media_mime: mime, media_size: size, media_name: (file.name ?? 'File').slice(0, 200) };
  },
  resetIcebreakers: (connectionId: string) => rpc<void>('reset_icebreakers', { p_connection_id: connectionId }),
  async searchGifs(query: string, offset = 0): Promise<Gif[]> {
    const { data, error } = await supabase.functions.invoke('gif-search', { body: { query, offset } });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      throw status === 503 ? new AppError('gifs_not_configured', 'GIFs are not available yet.') : toAppError(error);
    }
    return (data as { gifs: Gif[] }).gifs;
  },
  markRead: (conversationId: string) => rpc<void>('mark_conversation_read', { p_conversation_id: conversationId }),
  hide: (conversationId: string) => rpc<void>('hide_conversation', { p_conversation_id: conversationId }),

  /** AI icebreakers via Edge Function, falling back to deterministic templates (no AI claimed). */
  async icebreakers(connectionId: string): Promise<IcebreakerResult> {
    const { data, error } = await supabase.functions.invoke('icebreakers', { body: { connection_id: connectionId } });
    if (!error && data && Array.isArray((data as IcebreakerResult).suggestions)) return data as IcebreakerResult;
    const ctx = await rpc<IcebreakerContext>('get_icebreaker_context', { p_connection_id: connectionId });
    return { suggestions: templateIcebreakers(ctx), source: 'template' };
  },
};

export const activityApi = {
  get: (postId: string) => rpc<ActivityPost>('get_activity_post', { p_post_id: postId }),
  /** Latest: cursor = created_at of the last post. For You: offset-based (ranked). */
  async list(serverId: string | null, sort: ActivitySort, page: { before?: PageCursor; offset?: number } = {}): Promise<ActivityPost[]> {
    const posts = await rpc<ActivityPost[]>('list_activity_page', {
      p_server_id: serverId, p_before: page.before?.createdAt ?? null, p_before_id: page.before?.id ?? null,
      p_limit: 20, p_sort: sort, p_offset: page.offset ?? 0,
    });
    if (!posts.length) return posts;
    const images = await rpc<{ post_id: string; storage_path: string; image_position: number }[]>('get_activity_images', { p_post_ids: posts.map((p) => p.id) });
    return posts.map((p) => ({ ...p, image_paths: images.filter((i) => i.post_id === p.id).map((i) => i.storage_path) }));
  },
  create: async (v: { serverId: string; body: string; category: PostCategory; expiresHours: number | null; capacity: number | null; imagePaths: string[] }) => {
    const id = await rpc<string>('create_activity_with_images', {
      p_server_id: v.serverId, p_body: v.body, p_category: v.category, p_expires_hours: v.expiresHours,
      p_capacity: v.capacity, p_image_paths: v.imagePaths,
    });
    for (const path of v.imagePaths) {
      void finalizeMediaUpload('activity-media', path).catch(() => {});
      const thumb = thumbnailPath(path);
      if (thumb) void finalizeMediaUpload('activity-media', thumb).catch(() => {});
    }
    return id;
  },
  update: async (v: { postId: string; body: string; category: PostCategory; expiresHours: number | null; capacity: number | null; imagePaths: string[] }) => {
    await rpc<void>('update_activity_with_images', {
      p_post_id: v.postId, p_body: v.body, p_category: v.category, p_expires_hours: v.expiresHours,
      p_capacity: v.capacity, p_image_paths: v.imagePaths,
    });
    for (const path of v.imagePaths) {
      void finalizeMediaUpload('activity-media', path).catch(() => {});
      const thumb = thumbnailPath(path);
      if (thumb) void finalizeMediaUpload('activity-media', thumb).catch(() => {});
    }
  },
  remove: (postId: string) => rpc<void>('delete_activity_post', { p_post_id: postId }),
  /** kind null = remove my response. */
  setResponse: (postId: string, kind: PostResponseKind | null, message: string | null) =>
    rpc<{ kind: PostResponseKind | null; response_id?: string; request?: RequestResult | { status: 'not_sent' } | null }>(
      'set_post_response', { p_post_id: postId, p_kind: kind, p_message: message }),
  respond: (postId: string, message: string | null) =>
    rpc<{ response_id: string; request: RequestResult | { status: 'not_sent' } | null }>('respond_to_activity_post', { p_post_id: postId, p_message: message }),
  responses: (postId: string) => rpc<PostResponse[]>('list_post_responses', { p_post_id: postId }),
  moderateRemove: (postId: string, reason: string | null) => rpc<void>('moderate_remove_post', { p_post_id: postId, p_reason: reason }),
  async uploadImage(serverId: string, localUri: string, onProgress?: (f: number) => void): Promise<string> {
    const img = await prepareImage(localUri, 1600);
    const path = `${serverId}/${randomFileName('jpg')}`;
    const thumbPath = thumbnailPath(path)!;
    await uploadWithProgress({ bucket: 'activity-media', path, uri: img.uri, contentType: img.mime,
      onProgress: (fraction) => onProgress?.(fraction * 0.9) });
    try {
      const thumb = await prepareImage(localUri, 480);
      await uploadWithProgress({ bucket: 'activity-media', path: thumbPath, uri: thumb.uri, contentType: thumb.mime,
        onProgress: (fraction) => onProgress?.(0.9 + fraction * 0.1) });
    } catch (error) {
      await supabase.storage.from('activity-media').remove([path, thumbPath]);
      throw error;
    }
    return path;
  },
};

export const safetyApi = {
  block: (userId: string) => rpc<void>('block_user', { p_user_id: userId }),
  unblock: (userId: string) => rpc<void>('unblock_user', { p_user_id: userId }),
  listBlocked: () => rpc<BlockedUser[]>('list_blocked'),
  report: (args: {
    reason: ReportReason; details?: string | null; userId?: string | null; postId?: string | null;
    messageId?: string | null; serverId?: string | null;
  }) =>
    rpc<string>('create_report', {
      p_reason: args.reason, p_details: args.details ?? null, p_target_user: args.userId ?? null,
      p_target_post: args.postId ?? null, p_target_message: args.messageId ?? null, p_server_id: args.serverId ?? null,
    }),
  setAccountStatus: (userId: string, status: 'active' | 'suspended', reason: string | null) =>
    rpc<void>('set_account_status', { p_user_id: userId, p_status: status, p_reason: reason }),
};

export const notificationsApi = {
  async list(before?: PageCursor): Promise<AppNotification[]> {
    let q = supabase.from('notifications')
      .select('id, type, title, body, actor_id, server_id, request_id, conversation_id, post_id, read_at, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE);
    if (before) q = q.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
    return run(q) as Promise<AppNotification[]>;
  },
  async unreadCount(): Promise<number> {
    const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).neq('type', 'message');
    if (error) throw toAppError(error);
    return count ?? 0;
  },
  markRead: (ids: string[] | null) => rpc<void>('mark_notifications_read', { p_ids: ids }),
  registerPushToken: (token: string, platform: 'ios' | 'android' | 'web', provider: 'expo' | 'fcm' | 'apns') =>
    rpc<void>('register_push_token', { p_token: token, p_platform: platform, p_provider: provider }),
  unregisterPushToken: (token: string) => rpc<void>('unregister_push_token', { p_token: token }),
};

export const platformApi = {
  flags: () => run(supabase.from('feature_flags').select('key, enabled')) as Promise<FeatureFlag[]>,
};
