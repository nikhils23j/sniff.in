/**
 * Domain types mirroring the Postgres schema and RPC return shapes
 * (supabase/migrations/*). Keep in sync when an RPC signature changes.
 */
export type UUID = string;
export type ISODate = string;

export type FieldVisibility = 'members' | 'connections' | 'only_me';
export type Gender = 'woman' | 'man' | 'nonbinary';
export type DiscoveryAudience = 'everyone' | 'same_gender';
export type ServerKind = 'long_term' | 'short_term' | 'global';
export type ProfileMode = 'personal' | 'professional' | 'both';
export type JoinPolicy = 'invite_only' | 'approval' | 'open';
export type ServerVisibility = 'listed' | 'unlisted';
export type MemberRole = 'member' | 'moderator' | 'admin';
export type MemberStatus = 'pending' | 'active' | 'banned';
export type TagKind = 'interest' | 'hobby' | 'skill' | 'language' | 'career';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'fake_profile' | 'safety' | 'underage' | 'other';
export type ReportStatus = 'open' | 'reviewing' | 'actioned' | 'dismissed';
export type BadgeKind = 'member' | 'student' | 'alumni' | 'employee' | 'resident' | 'attendee' | 'organizer' | 'custom';
export type PostCategory = 'social' | 'sports' | 'travel' | 'professional' | 'study' | 'food' | 'other';
export type ServerCategory =
  | 'university' | 'college' | 'hall' | 'club' | 'company' | 'office' | 'team' | 'apartment' | 'alumni'
  | 'community' | 'event' | 'concert' | 'festival' | 'conference' | 'party' | 'restaurant' | 'travel' | 'city' | 'other';

/** Minimal public identity used in lists (already authorised by the server). */
export type MiniCard = { id: UUID; username: string; display_name: string; avatar_path: string | null };

/** Own profile row (public.profiles, own-row RLS). */
export type MyProfile = {
  id: UUID;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
  university: string | null;
  occupation: string | null;
  career_goals: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  linkedin_url: string | null;
  spotify_url: string | null;
  professional_bio: string | null;
  work_experience: string | null;
  social_preferences: string | null;
  professional_interests: string | null;
  height_cm: number | null;
  education_level: string | null;
  school_name: string | null;
  workplace: string | null;
  job_title: string | null;
  hometown: string | null;
  relationship_status: string | null;
  drinking: string | null;
  smoking: string | null;
  onboarded_at: ISODate | null;
  account_status: 'active' | 'suspended';
  created_at: ISODate;
};

export type MyPrivate = { date_of_birth: string | null; gender: Gender | null; discovery_audience: DiscoveryAudience; talk_to_genders: Gender[] };

export type UserSettings = {
  intro_pending: boolean;
  connected_audience: 'personal' | 'professional' | 'both';
  unconnected_audience: 'personal' | 'professional' | 'both';
  bio_visibility: FieldVisibility;
  education_visibility: FieldVisibility;
  occupation_visibility: FieldVisibility;
  career_goals_visibility: FieldVisibility;
  tags_visibility: FieldVisibility;
  socials_visibility: FieldVisibility;
  craving_visibility: FieldVisibility;
  badges_visibility: FieldVisibility;
  endorsements_visibility: FieldVisibility;
  ai_features_consent: boolean;
  hot_map_opt_in: boolean;
  notify_requests: boolean;
  notify_messages: boolean;
  notify_activity: boolean;
  notify_servers: boolean;
  notify_announcements: boolean;
  push_previews: boolean;
  height_visibility: FieldVisibility;
  hometown_visibility: FieldVisibility;
  relationship_visibility: FieldVisibility;
  lifestyle_visibility: FieldVisibility;
};

export type Tag = { kind: TagKind; name: string };

export type Craving = { body: string; expires_at: ISODate; server_id: UUID | null; server_name?: string | null };

export type ProfileBadge = {
  id: UUID; kind: BadgeKind; label: string; issued_at: ISODate; expires_at: ISODate | null;
  server_id: UUID; server_name: string; server_is_official: boolean;
};

export type RelationshipState = 'self' | 'connected' | 'pending_outgoing' | 'pending_incoming' | 'none';

/** get_profile_in_server(): the Server the profile was opened from. */
export type ProfileServerContext = {
  server_id: UUID;
  server_name: string;
  kind: ServerKind;
  role: MemberRole | null;
  member_note: string | null;
  member_field_label: string | null;
  joined_at: ISODate | null;
};

/**
 * public.get_profile() / get_profile_in_server() / preview_my_profile(): one universal profile.
 * Fields are null (lists empty) when hidden from the viewer by the owner's privacy settings.
 */
export type ProfileView = MiniCard & {
  connection_count: number;
  available?: boolean;
  server_context?: ProfileServerContext | null;
  bio: string | null;
  professional_bio: string | null;
  work_experience: string | null;
  social_preferences: string | null;
  professional_interests: string | null;
  height_cm: number | null;
  education_level: string | null;
  school_name: string | null;
  workplace: string | null;
  job_title: string | null;
  hometown: string | null;
  relationship_status: string | null;
  drinking: string | null;
  smoking: string | null;
  photos: { id: UUID; storage_path: string; position: number }[];
  prompt_answers: { prompt_key: string; answer: string }[];
  venue_topic?: string | null;
  venue_location_hint?: string | null;
  venue_expires_at?: ISODate | null;
  university: string | null;
  occupation: string | null;
  career_goals: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  linkedin_url: string | null;
  spotify_url: string | null;
  socials_hidden: boolean;
  tags: Tag[];
  shared_tags: string[];
  craving: Craving | null;
  badges: ProfileBadge[];
  endorsements: { id: UUID; body: string; created_at: ISODate; author: MiniCard }[];
  relationship: {
    state: RelationshipState;
    request_id: UUID | null;
    connection_id: UUID | null;
    conversation_id: UUID | null;
    is_friend: boolean;
  };
  affiliations: Affiliation[];
};

export type ChatNote = {
  user: MiniCard; body: string | null; song_title: string | null; song_artist: string | null;
  song_url: string | null; expires_at: ISODate;
};

export type AvailableChatPerson = {
  user: MiniCard; server_id: UUID; server_name: string; request_state: 'none' | 'outgoing' | 'incoming';
};

export type Affiliation = {
  id: UUID; kind: 'college' | 'employer'; org_name: string; domain: string; verified_at: ISODate;
  /** 'registry' = official university registry; 'self' = typed by the user (only the domain is verified). */
  org_name_source?: 'registry' | 'self';
};

export type ServerSummary = {
  avatar_path: string | null;
  id: UUID; name: string; kind: ServerKind; category: ServerCategory; parent_id: UUID | null; parent_name: string | null;
  is_official: boolean; ends_at: ISODate | null; ephemeral_chats: boolean; member_count: number;
  role: MemberRole; status: MemberStatus; discoverable: boolean; is_live: boolean; available_now: string | null;
};

export type ServerSearchResult = {
  avatar_path: string | null;
  id: UUID; name: string; kind: ServerKind; category: ServerCategory; city: string | null; parent_name: string | null;
  is_official: boolean; join_policy: JoinPolicy; member_count: number; ends_at: ISODate | null;
};

export type ServerDetail = {
  avatar_path: string | null;
  id: UUID; name: string; kind: ServerKind; category: ServerCategory; description: string | null;
  join_policy: JoinPolicy; visibility: ServerVisibility; is_official: boolean; requires_parent_membership: boolean;
  starts_at: ISODate | null; ends_at: ISODate | null; ephemeral_chats: boolean; city: string | null;
  venue_lat: number | null; venue_lng: number | null; member_count: number; is_archived: boolean; created_at: ISODate;
  member_field_label: string | null; member_field_hint: string | null; creator: MiniCard | null;
  is_live: boolean;
  parent: { id: UUID; name: string; avatar_path: string | null } | null;
  children: { id: UUID; name: string; category: ServerCategory; member_count: number; avatar_path: string | null }[];
  membership: { role: MemberRole; status: MemberStatus; discoverable: boolean; profile_mode: ProfileMode; member_note: string | null; joined_at: ISODate } | null;
  can_manage: boolean;
  is_admin: boolean;
  available_now: string | null;
  my_badges: { id: UUID; kind: BadgeKind; label: string; issued_at: ISODate; expires_at: ISODate | null }[];
};

export type JoinPreview =
  | { status: 'invalid' }
  | {
      status: 'valid'; server_id: UUID; name: string; kind: ServerKind; category: ServerCategory; description: string | null;
      is_official: boolean; member_count: number; join_policy: JoinPolicy; ends_at: ISODate | null; ephemeral_chats: boolean;
      parent_name: string | null; requires_parent_membership: boolean; my_status: MemberStatus | null;
      avatar_path: string | null; member_field_label: string | null; member_field_hint: string | null;
    };

export type JoinResult = { status: 'invalid' } | { status: 'active' | 'pending'; server_id: UUID };

export type JoinToken = {
  id: UUID; server_id: UUID; kind: 'qr' | 'link' | 'code'; token: string; label: string | null;
  expires_at: ISODate | null; max_uses: number | null; use_count: number; revoked_at: ISODate | null; created_at: ISODate;
};

export type DiscoveryCandidate = {
  user_id: UUID; username: string; display_name: string; avatar_path: string | null;
  occupation: string | null; university: string | null; craving: string | null;
  shared_tags: string[]; reasons: string[];
  badges: { label: string; kind: BadgeKind; is_official: boolean }[];
  score: number; request_state: 'none' | 'outgoing' | 'incoming';
};

export type ConnectionRequest = {
  id: UUID; other: MiniCard; server_id: UUID | null; server_name: string | null; message: string | null;
  activity_post_id: UUID | null; post_excerpt: string | null; created_at: ISODate; cursor_at: ISODate; snapshot_at: ISODate;
};

export type RequestResult =
  | { status: 'pending'; request_id: UUID }
  | { status: 'accepted'; request_id?: UUID; connection_id: UUID; conversation_id: UUID }
  | { status: 'declined' };

export type Connection = {
  connection_id: UUID; conversation_id: UUID | null; other: MiniCard; is_friend: boolean; i_saved: boolean;
  they_saved: boolean; expires_at: ISODate | null; origin_server_id: UUID | null; origin_server_name: string | null;
  created_at: ISODate; cursor_at: ISODate; snapshot_at: ISODate;
};

export type ConversationSummary = {
  conversation_id: UUID; connection_id: UUID; other: MiniCard; last_message: string | null; last_message_at: ISODate;
  last_sender_id: UUID | null; unread_count: number; expires_at: ISODate | null; is_friend: boolean;
  cursor_at: ISODate; snapshot_at: ISODate;
};

export type ConversationDetail = {
  conversation_id: UUID; connection_id: UUID; other: MiniCard; expires_at: ISODate | null; is_friend: boolean;
  i_saved: boolean; they_saved: boolean; origin_server_name: string | null; can_send: boolean;
  their_last_read_at: ISODate | null;
};

export type MessageKind = 'text' | 'image' | 'file' | 'gif' | 'sticker' | 'location';

export type Message = {
  id: UUID; conversation_id: UUID; sender_id: UUID; client_id: UUID; body: string | null; created_at: ISODate;
  kind: MessageKind;
  media_path?: string | null; media_mime?: string | null; media_size?: number | null; media_name?: string | null;
  media_width?: number | null; media_height?: number | null; gif_url?: string | null; sticker_id?: string | null;
  location_lat?: number | null; location_lng?: number | null;
  /** client-only: local file URI while uploading */
  local_uri?: string | null;
  upload_progress?: number;
  /** client-only: optimistic state */
  pending?: boolean;
  failed?: boolean;
};

export type PostResponseKind = 'in' | 'not_in';
export type ActivitySort = 'latest' | 'mine' | 'for_you';

export type ActivityPost = {
  id: UUID; server_id: UUID; server_name: string; server_avatar_path: string | null; author: MiniCard; body: string;
  category: PostCategory; expires_at: ISODate | null; created_at: ISODate; updated_at: ISODate;
  response_count: number; in_count: number; not_in_count: number; capacity: number | null; is_full: boolean;
  my_response: PostResponseKind | null; i_responded: boolean; is_mine: boolean; image_path: string | null;
  image_paths?: string[];
  relevance: number; relevance_reason: string | null;
};

export type PostResponse = {
  id: UUID; responder: MiniCard; kind: PostResponseKind; message: string | null;
  request_status: RequestStatus | null; created_at: ISODate;
};

export type NotificationType =
  | 'connection_request' | 'request_accepted' | 'message' | 'server_membership' | 'server_announcement'
  | 'activity_response' | 'badge_granted' | 'endorsement' | 'connection_saved' | 'ephemeral_expiring' | 'moderation';

export type AppNotification = {
  id: UUID; type: NotificationType; title: string; body: string | null; actor_id: UUID | null;
  server_id: UUID | null; request_id: UUID | null; conversation_id: UUID | null; post_id: UUID | null;
  read_at: ISODate | null; created_at: ISODate;
};

export type ServerMember = {
  user_id: UUID; username: string; display_name: string; avatar_path: string | null; role: MemberRole;
  status: MemberStatus; joined_at: ISODate; ban_reason: string | null;
  /** issued_by: who granted it (moderators may revoke only their own). */
  badges: { id: UUID; kind: BadgeKind; label: string; expires_at: ISODate | null; issued_by?: UUID | null }[];
};

export type DirectoryMember = { user_id: UUID; username: string; display_name: string; avatar_path: string | null;
  role: MemberRole; joined_at: ISODate; profile_mode: ProfileMode;
  member_note: string | null; badges: { id: UUID; kind: BadgeKind; label: string; expires_at: ISODate | null }[] };

export type VenueSession = { server_id: UUID; user_id: UUID; open_to_talk: boolean; topic: string | null;
  location_hint: string | null; profile_mode: ProfileMode; starts_at: ISODate; ends_at: ISODate };
export type VenuePerson = { user_id: UUID; username: string; display_name: string; avatar_path: string | null;
  topic: string | null; location_hint: string | null;
  profile_mode: ProfileMode; ends_at: ISODate;
  /** Empty when the person hides their tags from members. */
  interests: string[] | null; shared_interests: string[] | null };
export type NearbyVenue = { server_id: UUID; name: string; category: string; venue_lat: number; venue_lng: number;
  participants: number; open_to_talk: number; ends_at: ISODate };

export type Report = {
  id: UUID; reason: ReportReason; details: string | null; content_snapshot: string | null; status: ReportStatus;
  server_id: UUID | null; server_name: string | null; target: MiniCard | null; target_post_id: UUID | null;
  reporter: MiniCard | null; created_at: ISODate; resolution_note: string | null;
};

export type AuditEntry = { id: number; action: string; actor: MiniCard | null; target: MiniCard | null; details: Record<string, unknown>; created_at: ISODate };

export type ServerStats = {
  active_members: number; pending_members: number; banned_members: number; joined_last_7d: number;
  available_now: string; posts_last_7d: number; connections_last_7d: number; open_reports: number;
  active_badges: number; computed_at: ISODate;
};

export type Announcement = {
  id: UUID; title: string; body: string; created_at: ISODate;
  author_id?: UUID | null; author_name?: string | null; kind?: MessageKind;
  media_path?: string | null; media_mime?: string | null; media_size?: number | null; media_name?: string | null;
  media_width?: number | null; media_height?: number | null; gif_url?: string | null; sticker_id?: string | null;
  location_lat?: number | null; location_lng?: number | null;
};

export type BlockedUser = { user_id: UUID; username: string; display_name: string; blocked_at: ISODate };

export type Endorsement = { id: UUID; author_id: UUID; subject_id: UUID; body: string; status: 'pending' | 'approved' | 'hidden'; created_at: ISODate };

export type FeatureFlag = { key: string; enabled: boolean };

export type IcebreakerResult = { suggestions: string[]; source: 'ai' | 'template';
  current?: { suggestion: string; source_url: string; source_title: string; as_of: string } };

// ---------------------------------------------------------------- V2
export type Presence = { is_available: boolean; open_to_talk: boolean; talk_topic: string | null; talk_expires_at: ISODate | null };

export type TalkMatch = {
  user_id: UUID; username: string; display_name: string; avatar_path: string | null; occupation: string | null;
  university: string | null; talk_topic: string | null; shared_server_id: UUID; shared_server_name: string;
  shared_tags: string[]; reasons: string[]; score: number; request_state: 'none' | 'outgoing' | 'incoming';
};

export type DashboardServer = {
  id: UUID; name: string; kind: ServerKind; category: ServerCategory; city: string | null; avatar_path: string | null;
  member_count: number; is_official: boolean; join_policy: JoinPolicy; ends_at: ISODate | null; parent_name: string | null;
  reason: string | null;
};

export type DiscoverDashboard = {
  popular_servers: DashboardServer[];
  trending_servers: DashboardServer[];
  suggested_servers: DashboardServer[];
  activities_for_you: ActivityPost[];
  open_to_talk_nearby: string;
  my_server_count: number;
  computed_at: ISODate;
};

export type EndorsementItem = { id: UUID; other: MiniCard | null; body: string; status: 'pending' | 'approved' | 'hidden'; created_at: ISODate };

export type OrgDomain = { domain: string; org_name: string; kind: 'college' | 'employer'; country: string | null };

export type AffiliationStart = { verification_id: UUID; org_name: string; registry_match: boolean; suggestion: string | null };

export type HotCell = { lat: number; lng: number; people: number; people_label: string; intensity: number; as_of: ISODate;
  server_ids?: string[]; server_names?: string[] };

export type Gif = { id: string; title: string; url: string; preview_url: string; width: number; height: number };
