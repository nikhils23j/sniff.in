import { rpc, run } from '@/lib/rpc';
import { AppError } from '@/lib/errors';
import { DOCUMENT_TYPES, finalizeMediaUpload, prepareImage, randomFileName, uploadWithProgress } from '@/lib/upload';
import { supabase } from '@/lib/supabase';
import type {
  Announcement, AuditEntry, DirectoryMember, JoinPolicy, JoinPreview, JoinResult, JoinToken, MemberRole, MemberStatus, MessageKind, NearbyVenue, ProfileMode, Report,
  ReportStatus, ServerCategory, ServerDetail, ServerKind, ServerMember, ServerSearchResult, ServerStats,
  ServerSummary, ServerVisibility, BadgeKind, VenuePerson, VenueSession,
} from '@/types/domain';

export type CreateServerInput = {
  name: string;
  kind: ServerKind;
  category: ServerCategory;
  description?: string | null;
  parentId?: string | null;
  joinPolicy: JoinPolicy;
  visibility: ServerVisibility;
  startsAt?: string | null;
  endsAt?: string | null;
  ephemeralChats?: boolean;
  city?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
  requiresParentMembership?: boolean;
};

export type ServerMessageFields = {
  kind: MessageKind; body?: string | null; media_path?: string | null; media_mime?: string | null;
  media_size?: number | null; media_name?: string | null; media_width?: number | null; media_height?: number | null;
  gif_url?: string | null; sticker_id?: string | null; location_lat?: number | null; location_lng?: number | null;
};

export type ServerSettingsPatch = Partial<{
  avatar_path: string | null;
  name: string; description: string | null; join_policy: JoinPolicy; visibility: ServerVisibility;
  starts_at: string | null; ends_at: string | null; ephemeral_chats: boolean; city: string | null;
  venue_lat: number | null; venue_lng: number | null; requires_parent_membership: boolean;
  member_field_label: string | null; member_field_hint: string | null;
}>;

export type JoinPreferences = { token: string; mode: ProfileMode; note?: string | null;
  open?: boolean; minutes?: number; topic?: string | null; locationHint?: string | null };

export const serversApi = {
  listMine: () => rpc<ServerSummary[]>('list_my_servers'),
  relevantForHome: () => rpc<string[]>('home_relevant_server_ids'),
  search: (query: string) => rpc<ServerSearchResult[]>('search_servers', { p_query: query, p_limit: 30 }),
  get: (id: string) => rpc<ServerDetail>('get_server', { p_server_id: id }),

  create: (i: CreateServerInput) =>
    rpc<string>('create_server', {
      p_name: i.name, p_kind: i.kind, p_category: i.category, p_description: i.description ?? null,
      p_parent_id: i.parentId ?? null, p_join_policy: i.joinPolicy, p_visibility: i.visibility,
      p_starts_at: i.startsAt ?? null, p_ends_at: i.endsAt ?? null, p_ephemeral_chats: i.ephemeralChats ?? false,
      p_city: i.city ?? null, p_venue_lat: i.venueLat ?? null, p_venue_lng: i.venueLng ?? null,
      p_requires_parent_membership: i.requiresParentMembership ?? false,
    }),

  /** Admin edits go straight through RLS (column-scoped grant + admin policy). */
  async update(id: string, patch: ServerSettingsPatch) {
    const rows = await run(supabase.from('servers').update(patch).eq('id', id).select('id'));
    if (!rows || (rows as unknown[]).length === 0) throw new Error('forbidden: You can no longer edit this Server');
  },
  archive: (id: string) => rpc<void>('archive_server', { p_server_id: id }),

  previewToken: (token: string) => rpc<JoinPreview>('preview_join_token', { p_token: token }),
  joinWithToken: (v: JoinPreferences) => rpc<JoinResult>('join_server_with_preferences', {
    p_token: v.token, p_mode: v.mode, p_note: v.note ?? null, p_open: v.open ?? false,
    p_minutes: v.minutes ?? 120, p_topic: v.topic ?? null, p_location_hint: v.locationHint ?? null,
  }),
  setProfile: (id: string, mode: ProfileMode, note: string | null) => rpc<void>('set_server_profile', { p_server_id: id, p_mode: mode, p_note: note }),
  directory: (id: string, offset = 0) => rpc<DirectoryMember[]>('server_directory', { p_server_id: id, p_limit: 50, p_offset: offset }),
  venuePeople: (id: string) => rpc<VenuePerson[]>('venue_people', { p_server_id: id, p_limit: 30 }),
  myVenueSession: (id: string) => rpc<VenueSession | null>('my_venue_session', { p_server_id: id }),
  setVenueSession: (id: string, v: { open: boolean; minutes: number; topic: string | null; locationHint: string | null; mode: ProfileMode }) =>
    rpc<{ ends_at: string }>('set_venue_session', { p_server_id: id, p_open: v.open, p_minutes: v.minutes,
      p_topic: v.topic, p_location_hint: v.locationHint, p_mode: v.mode }),
  endVenueSession: (id: string) => rpc<void>('end_venue_session', { p_server_id: id }),
  nearbyVenues: (lat: number, lng: number) => rpc<NearbyVenue[]>('venue_nearby', { p_lat: lat, p_lng: lng, p_radius_km: 5 }),
  requestToJoin: (id: string) => rpc<JoinResult>('request_to_join', { p_server_id: id }),
  leave: (id: string) => rpc<void>('leave_server', { p_server_id: id }),
  setDiscoverable: (id: string, userId: string, discoverable: boolean) =>
    run(supabase.from('server_members').update({ discoverable }).eq('server_id', id).eq('user_id', userId)),

  // ---- administration
  listTokens: (id: string) =>
    run(supabase.from('server_join_tokens').select('*').eq('server_id', id).order('created_at', { ascending: false })) as Promise<JoinToken[]>,
  createToken: (id: string, kind: 'qr' | 'link' | 'code', expiresMinutes: number | null, maxUses: number | null, label: string | null) =>
    rpc<JoinToken>('create_join_token', {
      p_server_id: id, p_kind: kind, p_expires_minutes: expiresMinutes, p_max_uses: maxUses, p_label: label,
    }),
  revokeToken: (tokenId: string) => rpc<void>('revoke_join_token', { p_token_id: tokenId }),

  listMembers: (id: string, status: MemberStatus, query = '', offset = 0) =>
    rpc<ServerMember[]>('list_server_members', { p_server_id: id, p_status: status, p_query: query, p_limit: 50, p_offset: offset }),
  reviewMembership: (id: string, userId: string, approve: boolean) =>
    rpc<void>('review_membership', { p_server_id: id, p_user_id: userId, p_approve: approve }),
  setRole: (id: string, userId: string, role: MemberRole) =>
    rpc<void>('set_member_role', { p_server_id: id, p_user_id: userId, p_role: role }),
  ban: (id: string, userId: string, reason: string | null) =>
    rpc<void>('ban_member', { p_server_id: id, p_user_id: userId, p_reason: reason }),
  unban: (id: string, userId: string) => rpc<void>('unban_member', { p_server_id: id, p_user_id: userId }),
  remove: (id: string, userId: string) => rpc<void>('remove_member', { p_server_id: id, p_user_id: userId }),

  grantBadge: (id: string, userId: string, kind: BadgeKind, label: string, expiresAt: string | null) =>
    rpc<string>('grant_badge', { p_server_id: id, p_user_id: userId, p_kind: kind, p_label: label, p_expires_at: expiresAt }),
  revokeBadge: (badgeId: string, reason: string | null) => rpc<void>('revoke_badge', { p_badge_id: badgeId, p_reason: reason }),

  stats: (id: string) => rpc<ServerStats>('server_stats', { p_server_id: id }),
  auditLog: (id: string) => rpc<AuditEntry[]>('list_audit_log', { p_server_id: id, p_limit: 100 }),
  reports: (id: string | null, status: ReportStatus | null) =>
    rpc<Report[]>('list_reports', { p_server_id: id, p_status: status }),
  reviewReport: (reportId: string, status: ReportStatus, note: string | null) =>
    rpc<void>('review_report', { p_report_id: reportId, p_status: status, p_note: note }),

  postAnnouncement: (id: string, title: string, body: string) =>
    rpc<string>('post_announcement', { p_server_id: id, p_title: title, p_body: body }),
  postServerMessage: (id: string, fields: ServerMessageFields) =>
    rpc<string>('post_server_message', {
      p_server_id: id, p_kind: fields.kind, p_body: fields.body ?? null,
      p_media_path: fields.media_path ?? null, p_media_mime: fields.media_mime ?? null,
      p_media_size: fields.media_size ?? null, p_media_name: fields.media_name ?? null,
      p_media_width: fields.media_width ?? null, p_media_height: fields.media_height ?? null,
      p_gif_url: fields.gif_url ?? null, p_sticker_id: fields.sticker_id ?? null,
      p_location_lat: fields.location_lat ?? null, p_location_lng: fields.location_lng ?? null,
    }),
  announcements: (id: string) => rpc<Announcement[]>('list_server_messages', { p_server_id: id, p_limit: 3 }),
  messages: (id: string, before?: { created_at: string; id: string }) =>
    rpc<Announcement[]>('list_server_messages', {
      p_server_id: id, p_before_created: before?.created_at ?? null, p_before_id: before?.id ?? null, p_limit: 40,
    }),

  async uploadServerAttachment(id: string, file: { uri: string; name?: string | null; mime?: string | null; isImage: boolean },
    onProgress?: (fraction: number) => void): Promise<ServerMessageFields> {
    if (file.isImage && file.mime === 'image/gif') {
      const path = `${id}/${randomFileName('gif')}`;
      const { size } = await uploadWithProgress({ bucket: 'server-media', path, uri: file.uri, contentType: 'image/gif', onProgress });
      return { kind: 'image', media_path: path, media_mime: 'image/gif', media_size: size };
    }
    if (file.isImage) {
      const image = await prepareImage(file.uri, 1600);
      const path = `${id}/${randomFileName('jpg')}`;
      const { size } = await uploadWithProgress({ bucket: 'server-media', path, uri: image.uri, contentType: image.mime, onProgress });
      return { kind: 'image', media_path: path, media_mime: image.mime, media_size: size, media_width: image.width, media_height: image.height };
    }
    const mime = file.mime ?? '';
    if (!DOCUMENT_TYPES.includes(mime)) throw new AppError('unsupported_file', 'Send PDFs, Office documents or text files.');
    const path = `${id}/${randomFileName((file.name ?? '').split('.').pop() ?? 'bin')}`;
    const { size } = await uploadWithProgress({ bucket: 'server-media', path, uri: file.uri, contentType: mime, onProgress });
    return { kind: 'file', media_path: path, media_mime: mime, media_size: size, media_name: (file.name ?? 'File').slice(0, 200) };
  },

  setOfficial: (id: string, official: boolean) => rpc<void>('set_server_official', { p_server_id: id, p_official: official }),

  recordVisit: (id: string) => rpc<void>('record_server_visit', { p_server_id: id }),

  /** Admin-only (Storage RLS): square-crop upstream, upload to server-avatars/<id>/…, point the Server at it. */
  async uploadAvatar(id: string, localUri: string, _previous: string | null, onProgress?: (f: number) => void) {
    const img = await prepareImage(localUri, 640);
    const path = `${id}/${randomFileName('jpg')}`;
    await uploadWithProgress({ bucket: 'server-avatars', path, uri: img.uri, contentType: img.mime, onProgress });
    await serversApi.update(id, { avatar_path: path } as ServerSettingsPatch);
    void finalizeMediaUpload('server-avatars', path).catch(() => {});
    return path;
  },
  async removeAvatar(id: string, _path: string) {
    await serversApi.update(id, { avatar_path: null } as ServerSettingsPatch);
  },
};
