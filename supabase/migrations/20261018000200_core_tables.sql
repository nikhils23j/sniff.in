-- Core identity, privacy, presence and Server tables.

-- ---------------------------------------------------------------- profiles
-- The portable bio-card. Other users NEVER select this table directly; they go through
-- public.get_profile()/get_profile_cards(), which apply field-level visibility.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username extensions.citext not null unique
    check (username::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text check (char_length(bio) <= 300),
  avatar_path text check (char_length(avatar_path) <= 200),
  university text check (char_length(university) <= 100),
  occupation text check (char_length(occupation) <= 100),
  career_goals text check (char_length(career_goals) <= 300),
  website_url text check (char_length(website_url) <= 200 and website_url ~ '^https://[^\s]+$'),
  instagram_handle text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  linkedin_url text check (char_length(linkedin_url) <= 200 and linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/[^\s]+$'),
  spotify_url text check (char_length(spotify_url) <= 200 and spotify_url ~ '^https://open\.spotify\.com/[^\s]+$'),
  onboarded_at timestamptz,
  account_status public.account_status not null default 'active',
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();

-- Owner-only sensitive data. Never returned to other users by any function.
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  date_of_birth date check (date_of_birth > date '1900-01-01'),
  gender public.gender_identity,
  discovery_audience public.discovery_audience not null default 'everyone',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profile_private_touch before update on public.profile_private
  for each row execute function app_private.touch_updated_at();

-- Field-level visibility + consent + notification preferences.
create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  bio_visibility public.field_visibility not null default 'members',
  education_visibility public.field_visibility not null default 'members',
  occupation_visibility public.field_visibility not null default 'members',
  career_goals_visibility public.field_visibility not null default 'members',
  tags_visibility public.field_visibility not null default 'members',
  socials_visibility public.field_visibility not null default 'connections',
  craving_visibility public.field_visibility not null default 'members',
  badges_visibility public.field_visibility not null default 'members',
  endorsements_visibility public.field_visibility not null default 'members',
  -- Explicit consent to send this user's matchable (members-visible) profile text to an AI provider
  -- for embeddings/icebreakers. Off by default.
  ai_features_consent boolean not null default false,
  notify_requests boolean not null default true,
  notify_messages boolean not null default true,
  notify_activity boolean not null default true,
  notify_servers boolean not null default true,
  notify_announcements boolean not null default true,
  -- When false (default) push payloads are generic ("You have a new message").
  push_previews boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_settings_touch before update on public.user_settings
  for each row execute function app_private.touch_updated_at();

-- Platform administrators (Sniff.in staff). Managed only with the service role / SQL.
create table public.platform_admins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles (id) on delete set null
);

-- ---------------------------------------------------------------- tags
create table public.tags (
  id bigint generated always as identity primary key,
  kind public.tag_kind not null,
  name extensions.citext not null check (char_length(name::text) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (kind, name)
);
create index tags_name_trgm on public.tags using gin ((name::text) extensions.gin_trgm_ops);

create table public.profile_tags (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tag_id bigint not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);
create index profile_tags_tag on public.profile_tags (tag_id);

-- ---------------------------------------------------------------- presence
-- Availability is a server-side, time-boxed session. Missing row / null / past = DND.
create table public.presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  available_until timestamptz,
  available_since timestamptz,
  updated_at timestamptz not null default now()
);
create index presence_available on public.presence (available_until) where available_until is not null;

-- ---------------------------------------------------------------- servers
create table public.servers (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.servers (id) on delete restrict,
  depth smallint not null default 0 check (depth between 0 and 4),
  kind public.server_kind not null,
  category text not null default 'other' check (category in (
    'university','college','hall','club','company','office','team','apartment','alumni','community',
    'event','concert','festival','conference','party','restaurant','travel','city','other')),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text check (char_length(description) <= 500),
  join_policy public.server_join_policy not null default 'invite_only',
  visibility public.server_visibility not null default 'unlisted',
  requires_parent_membership boolean not null default false,
  -- Set only by platform admins: the Server really is the institution it claims to be.
  is_official boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  ephemeral_chats boolean not null default false,
  city text check (char_length(city) <= 60),
  -- Venue location (admin-entered, public, rounded to ~100 m). Never a user's location.
  venue_lat numeric(7,4) check (venue_lat between -90 and 90),
  venue_lng numeric(7,4) check (venue_lng between -180 and 180),
  member_count integer not null default 0,
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint short_term_needs_end check (kind <> 'short_term' or ends_at is not null),
  constraint end_after_start check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint ephemeral_only_short_term check (not ephemeral_chats or kind = 'short_term'),
  constraint no_self_parent check (parent_id is null or parent_id <> id)
);
create index servers_parent on public.servers (parent_id);
create index servers_listed on public.servers (visibility, is_archived) where visibility = 'listed';
create index servers_ends_at on public.servers (ends_at) where kind = 'short_term' and not is_archived;
create index servers_name_trgm on public.servers using gin (name extensions.gin_trgm_ops);
create trigger servers_touch before update on public.servers
  for each row execute function app_private.touch_updated_at();

-- Maintain depth, forbid cycles and kind changes.
create or replace function app_private.servers_validate()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  parent_depth smallint;
begin
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    perform app_private.fail('invalid_update', 'Server kind cannot be changed');
  end if;
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    perform app_private.fail('invalid_update', 'Server parent cannot be changed');
  end if;
  if new.parent_id is null then
    new.depth := 0;
  else
    select depth into parent_depth from public.servers where id = new.parent_id;
    if parent_depth is null then
      perform app_private.fail('not_found', 'Parent server not found');
    end if;
    if parent_depth >= 4 then
      perform app_private.fail('too_deep', 'Servers can be nested at most 5 levels');
    end if;
    new.depth := parent_depth + 1;
  end if;
  if new.is_archived and new.archived_at is null then
    new.archived_at := now();
  end if;
  new.venue_lat := round(new.venue_lat, 3);
  new.venue_lng := round(new.venue_lng, 3);
  return new;
end $$;
create trigger servers_validate before insert or update on public.servers
  for each row execute function app_private.servers_validate();

create table public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  status public.member_status not null default 'pending',
  -- Per-Server opt-out of discovery while globally available.
  discoverable boolean not null default true,
  joined_via text not null default 'token' check (joined_via in ('token','approval','creator','admin','open')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  banned_at timestamptz,
  banned_by uuid references public.profiles (id) on delete set null,
  ban_reason text check (char_length(ban_reason) <= 300),
  primary key (server_id, user_id)
);
create index server_members_user on public.server_members (user_id, status);
create index server_members_server_status on public.server_members (server_id, status);

create or replace function app_private.server_member_count()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    update public.servers s
      set member_count = (select count(*) from public.server_members m
                          where m.server_id = new.server_id and m.status = 'active')
      where s.id = new.server_id;
  end if;
  if tg_op in ('DELETE','UPDATE') and (tg_op = 'DELETE' or old.server_id <> new.server_id) then
    update public.servers s
      set member_count = (select count(*) from public.server_members m
                          where m.server_id = old.server_id and m.status = 'active')
      where s.id = old.server_id;
  end if;
  return null;
end $$;
create trigger server_members_count after insert or update of status or delete on public.server_members
  for each row execute function app_private.server_member_count();

-- QR / invite-link / short-code join tokens. Tokens are stored so admins can re-display a printed QR;
-- rows are visible only to Server staff (RLS) and can be expired, capped and revoked.
create table public.server_join_tokens (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  kind text not null check (kind in ('qr','link','code')),
  token text not null unique,
  label text check (char_length(label) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index server_join_tokens_server on public.server_join_tokens (server_id);

-- Verification badges with full provenance. A badge is only ever created by a Server admin action.
create table public.server_badges (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('member','student','alumni','employee','resident','attendee','organizer','custom')),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  status public.badge_status not null default 'active',
  issued_by uuid references public.profiles (id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoke_reason text check (char_length(revoke_reason) <= 300)
);
create unique index server_badges_one_active on public.server_badges (server_id, user_id, kind) where status = 'active';
create index server_badges_user on public.server_badges (user_id) where status = 'active';

-- Current craving: one per user, optionally scoped to one Server, always expiring.
create table public.cravings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 3 and 140),
  server_id uuid references public.servers (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '7 days 1 minute')
);
