-- Connections, chat, activity, safety, notifications, integrations.

-- ---------------------------------------------------------------- activity hub
create table public.activity_posts (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 3 and 500),
  category text not null default 'social' check (category in ('social','sports','travel','professional','study','food','other')),
  expires_at timestamptz,
  status public.post_status not null default 'active',
  removed_by uuid references public.profiles (id) on delete set null,
  removed_reason text check (char_length(removed_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at <= created_at + interval '30 days 1 minute')
);
create index activity_posts_server_recent on public.activity_posts (server_id, created_at desc) where status = 'active';
create index activity_posts_author on public.activity_posts (author_id);
create trigger activity_posts_touch before update on public.activity_posts
  for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------- requests & connections
create table public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  server_id uuid references public.servers (id) on delete set null,
  activity_post_id uuid references public.activity_posts (id) on delete set null,
  message text check (char_length(message) <= 280),
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);
-- At most ONE pending request per unordered pair (prevents duplicates and crossed requests).
create unique index connection_requests_one_pending
  on public.connection_requests (least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status = 'pending';
create index connection_requests_recipient on public.connection_requests (recipient_id, status, created_at desc);
create index connection_requests_sender on public.connection_requests (sender_id, status, created_at desc);

-- Enforce the request state machine even for privileged writers.
create or replace function app_private.connection_requests_transition()
returns trigger language plpgsql as $$
begin
  if old.status <> new.status then
    if not (old.status = 'pending' and new.status in ('accepted','declined','cancelled','expired')) then
      perform app_private.fail('invalid_transition', format('%s -> %s is not allowed', old.status, new.status));
    end if;
    new.responded_at := coalesce(new.responded_at, now());
  end if;
  if new.sender_id <> old.sender_id or new.recipient_id <> old.recipient_id then
    perform app_private.fail('invalid_update', 'Participants are immutable');
  end if;
  return new;
end $$;
create trigger connection_requests_transition before update on public.connection_requests
  for each row execute function app_private.connection_requests_transition();

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  request_id uuid references public.connection_requests (id) on delete set null,
  origin_server_id uuid references public.servers (id) on delete set null,
  status public.connection_status not null default 'active',
  a_saved boolean not null default false,
  b_saved boolean not null default false,
  -- Non-null only for connections made in an ephemeral short-term Server and not yet saved by both.
  expires_at timestamptz,
  blocked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index connections_user_b on public.connections (user_b);
create index connections_expiring on public.connections (expires_at) where expires_at is not null;
create trigger connections_touch before update on public.connections
  for each row execute function app_private.touch_updated_at();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.connections (id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_participants_user on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  -- Client-generated idempotency key: retries never create duplicates.
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (sender_id, client_id)
);
create index messages_conversation_recent on public.messages (conversation_id, created_at desc);

-- ---------------------------------------------------------------- safety
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  target_post_id uuid references public.activity_posts (id) on delete set null,
  target_message_id uuid references public.messages (id) on delete set null,
  server_id uuid references public.servers (id) on delete set null,
  reason public.report_reason not null,
  details text check (char_length(details) <= 1000),
  -- Evidence snapshot (reported content may later expire/delete). Disclosed in the privacy policy.
  content_snapshot text check (char_length(content_snapshot) <= 2000),
  status public.report_status not null default 'open',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text check (char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  check (target_user_id is not null or target_post_id is not null or target_message_id is not null)
);
create index reports_server_status on public.reports (server_id, status, created_at desc);
create index reports_status on public.reports (status, created_at desc);
create index reports_reporter on public.reports (reporter_id);

-- Append-only audit trail for every administrative / moderation action.
create table public.moderation_actions (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  server_id uuid references public.servers (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  target_post_id uuid references public.activity_posts (id) on delete set null,
  report_id uuid references public.reports (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index moderation_actions_server on public.moderation_actions (server_id, created_at desc);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup on public.rate_limit_events (user_id, action, created_at desc);

-- "Not now" in discovery. Personal, time-boxed, never affects anyone else's ranking.
create table public.discovery_dismissals (
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, target_id)
);

-- Private post-connection feedback. -1 only hides the subject from the RATER's recommendations;
-- +1 contributes a small capped boost. Never displayed, never a cross-user penalty.
create table public.interaction_feedback (
  rater_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (rater_id, subject_id),
  check (rater_id <> subject_id)
);
create index interaction_feedback_subject on public.interaction_feedback (subject_id) where rating = 1;

-- Opt-in written endorsements; shown only after the subject approves.
create table public.endorsements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 10 and 500),
  status public.endorsement_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, subject_id),
  check (author_id <> subject_id)
);
create index endorsements_subject on public.endorsements (subject_id, status);
create trigger endorsements_touch before update on public.endorsements
  for each row execute function app_private.touch_updated_at();

create table public.activity_responses (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.activity_posts (id) on delete cascade,
  responder_id uuid not null references public.profiles (id) on delete cascade,
  message text check (char_length(message) <= 280),
  request_id uuid references public.connection_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (post_id, responder_id)
);

create table public.server_announcements (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 2 and 80),
  body text not null check (char_length(btrim(body)) between 2 and 500),
  created_at timestamptz not null default now()
);
create index server_announcements_server on public.server_announcements (server_id, created_at desc);

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'connection_request','request_accepted','message','server_membership','server_announcement',
    'activity_response','badge_granted','endorsement','connection_saved','ephemeral_expiring','moderation')),
  actor_id uuid references public.profiles (id) on delete set null,
  server_id uuid references public.servers (id) on delete cascade,
  request_id uuid references public.connection_requests (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  post_id uuid references public.activity_posts (id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 300),
  dedupe_key text,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_recent on public.notifications (user_id, created_at desc);
create index notifications_user_unread on public.notifications (user_id) where read_at is null;

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique check (char_length(token) <= 300),
  platform text not null check (platform in ('ios','android','web')),
  provider text not null default 'expo' check (provider in ('expo','fcm','apns')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user on public.push_tokens (user_id);

-- ---------------------------------------------------------------- business readiness (no payments yet)
create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);
insert into public.feature_flags (key, enabled, description) values
  ('global_discovery', false, 'City-wide/global Servers (premium beta).'),
  ('vibe_map', true, 'Aggregated venue-level activity map (k-anonymous).'),
  ('ai_icebreakers', true, 'Use the configured LLM for icebreakers (falls back to templates).'),
  ('semantic_matching', false, 'Blend pgvector similarity into ranking (requires embedding provider).'),
  ('payments', false, 'Live billing provider. Must stay false until a provider is configured.');

-- Entitlements decouple "what you may do" from "how you paid". Granted only by service role / platform admins.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  server_id uuid references public.servers (id) on delete cascade,
  feature text not null check (feature in ('global_discovery','server_pro','targeted_pings','premium_filters')),
  source text not null check (source in ('grant','trial','subscription')),
  status text not null default 'active' check (status in ('active','cancelled','expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  provider text,
  provider_ref text,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (server_id is null))
);
create index entitlements_user on public.entitlements (user_id) where user_id is not null;
create index entitlements_server on public.entitlements (server_id) where server_id is not null;

-- ---------------------------------------------------------------- AI integration storage
-- Embeddings of members-visible profile text, only for users with ai_features_consent.
-- No client access whatsoever (no RLS policies), used only inside discover_people().
create table public.profile_embeddings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  embedding extensions.vector(1024) not null,
  model text not null,
  content_hash text not null,
  updated_at timestamptz not null default now()
);

create table public.icebreakers (
  connection_id uuid primary key references public.connections (id) on delete cascade,
  suggestions text[] not null,
  source text not null check (source in ('ai','template')),
  model text,
  created_at timestamptz not null default now()
);
