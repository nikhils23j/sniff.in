-- Server-scoped identity and expiring on-site participation. Paid entitlements remain
-- separate from ownership/roles; no billing check is attached to creation.

alter table public.server_members
  add column profile_mode text not null default 'personal' check (profile_mode in ('personal','professional','both')),
  add column member_note text check (char_length(member_note) <= 100);
alter table public.servers
  add column member_field_label text check (char_length(member_field_label) <= 40),
  add column member_field_hint text check (char_length(member_field_hint) <= 120);
grant update (member_field_label, member_field_hint) on public.servers to authenticated;

alter table public.profiles
  add column professional_bio text check (char_length(professional_bio) <= 400),
  add column work_experience text check (char_length(work_experience) <= 400),
  add column social_preferences text check (char_length(social_preferences) <= 240),
  add column professional_interests text check (char_length(professional_interests) <= 240);
grant update (professional_bio, work_experience, social_preferences, professional_interests) on public.profiles to authenticated;

alter table public.presence add column talk_expires_at timestamptz;
create index presence_talk_expires on public.presence (talk_expires_at) where open_to_talk;

create table public.venue_sessions (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  open_to_talk boolean not null default false,
  topic text check (char_length(topic) <= 140),
  location_hint text check (char_length(location_hint) <= 100),
  profile_mode text not null check (profile_mode in ('personal','professional','both')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (server_id,user_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);
create index venue_sessions_live on public.venue_sessions (server_id,ends_at) include (open_to_talk);
alter table public.venue_sessions enable row level security;
revoke all on public.venue_sessions from anon, authenticated;
grant all on public.venue_sessions to service_role;

create or replace function public.set_server_profile(p_server_id uuid, p_mode text, p_note text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(); s public.servers;
begin
  if p_mode not in ('personal','professional','both') then perform app_private.fail('invalid_mode'); end if;
  select * into s from public.servers where id = p_server_id;
  if s.id is null or not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden'); end if;
  if p_note is not null and (s.kind <> 'long_term' or s.member_field_label is null) then
    perform app_private.fail('invalid_member_note');
  end if;
  update public.server_members set profile_mode = p_mode, member_note = nullif(btrim(left(p_note,100)), '')
    where server_id = p_server_id and user_id = v;
end $$;

create or replace function public.set_venue_session(
  p_server_id uuid, p_open boolean, p_minutes integer default 120,
  p_topic text default null, p_location_hint text default null, p_mode text default 'personal')
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
  expiry timestamptz;
begin
  perform app_private.rate_limit('venue_session', 30, interval '1 hour');
  if p_mode not in ('personal','professional','both') then perform app_private.fail('invalid_mode'); end if;
  if p_minutes < 1 or p_minutes > 720 then perform app_private.fail('invalid_duration'); end if;
  if char_length(coalesce(p_topic,'')) > 140 or char_length(coalesce(p_location_hint,'')) > 100 then
    perform app_private.fail('invalid_text');
  end if;
  select * into s from public.servers where id = p_server_id;
  if s.kind <> 'short_term' or not app_private.server_is_live(p_server_id)
     or not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden'); end if;
  expiry := least(now() + make_interval(mins => p_minutes), s.ends_at);
  if expiry <= now() then perform app_private.fail('server_closed'); end if;
  insert into public.venue_sessions(server_id,user_id,open_to_talk,topic,location_hint,profile_mode,ends_at)
    values(p_server_id,v,p_open,nullif(btrim(p_topic),''),nullif(btrim(p_location_hint),''),p_mode,expiry)
  on conflict (server_id,user_id) do update set
    open_to_talk = excluded.open_to_talk, topic = excluded.topic,
    location_hint = excluded.location_hint, profile_mode = excluded.profile_mode,
    starts_at = now(), ends_at = excluded.ends_at, updated_at = now();
  update public.server_members set profile_mode = p_mode where server_id = p_server_id and user_id = v;
  if p_open then
    insert into public.presence(user_id,is_available) values (v,true)
      on conflict (user_id) do update set is_available = true, updated_at = now();
  end if;
  return jsonb_build_object('server_id',p_server_id,'open_to_talk',p_open,'ends_at',expiry);
end $$;

create or replace function public.end_venue_session(p_server_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  delete from public.venue_sessions where server_id = p_server_id and user_id = v;
end $$;

create or replace function public.my_venue_session(p_server_id uuid)
returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select to_jsonb(v) from public.venue_sessions v
  where v.server_id = p_server_id and v.user_id = auth.uid() and v.ends_at > now();
$$;

create or replace function public.venue_people(p_server_id uuid, p_limit integer default 30)
returns table(user_id uuid, username text, display_name text, avatar_path text,
  topic text, location_hint text, profile_mode text, ends_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not app_private.is_active_member(p_server_id,v) or not app_private.server_is_live(p_server_id) then
    perform app_private.fail('forbidden');
  end if;
  return query
    select vs.user_id, p.username::text, p.display_name, p.avatar_path,
      vs.topic, vs.location_hint, vs.profile_mode, vs.ends_at
    from public.venue_sessions vs join public.profiles p on p.id = vs.user_id
    join public.server_members m on m.server_id = vs.server_id and m.user_id = vs.user_id
    where vs.server_id = p_server_id and vs.user_id <> v and vs.open_to_talk
      and vs.ends_at > now() and m.status = 'active' and m.discoverable
      and p.account_status = 'active' and not app_private.is_blocked_between(v,vs.user_id)
      and app_private.audience_compatible(v,vs.user_id)
    order by vs.updated_at desc, vs.user_id limit least(greatest(p_limit,1),50);
end $$;

-- The account-wide switch remains useful outside a venue, but is no longer perpetual.
drop function public.set_open_to_talk(boolean,text);
create or replace function public.set_open_to_talk(
  p_open boolean, p_topic text default null, p_minutes integer default 120)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(); topic text := nullif(btrim(p_topic),'');
begin
  perform app_private.rate_limit('set_open_to_talk',60,interval '1 hour');
  if p_minutes < 1 or p_minutes > 720 then perform app_private.fail('invalid_duration'); end if;
  if char_length(coalesce(topic,'')) > 140 then perform app_private.fail('invalid_topic'); end if;
  insert into public.presence(user_id,is_available,open_to_talk,talk_topic,talk_updated_at,talk_expires_at)
    values(v,true,p_open,topic,now(),case when p_open then now() + make_interval(mins => p_minutes) end)
  on conflict(user_id) do update set
    open_to_talk = p_open, is_available = public.presence.is_available or p_open,
    talk_topic = case when p_open then topic else public.presence.talk_topic end,
    talk_embedding = case when public.presence.talk_topic is distinct from topic then null else public.presence.talk_embedding end,
    talk_updated_at = now(), talk_expires_at = excluded.talk_expires_at, updated_at = now();
  return public.heartbeat();
end $$;

create or replace function app_private.is_open_to_talk(u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.presence
    where user_id = u and is_available and open_to_talk and talk_expires_at > now());
$$;

create or replace function public.heartbeat()
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false); p public.presence;
begin
  update public.profiles set last_active_at = now()
    where id = v and (last_active_at is null or last_active_at < now() - interval '60 seconds');
  insert into public.presence(user_id) values(v) on conflict(user_id) do nothing;
  select * into p from public.presence where user_id = v;
  return jsonb_build_object('is_available',p.is_available,
    'open_to_talk',p.is_available and p.open_to_talk and p.talk_expires_at > now(),
    'talk_topic',p.talk_topic,'talk_expires_at',p.talk_expires_at);
end $$;

-- A device sign-out does not silently claim to change account-wide availability;
-- an explicit DND action does end all on-site invitations.
create or replace function app_private.dnd_ends_venue_sessions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_available and not new.is_available then
    delete from public.venue_sessions where user_id = new.user_id and open_to_talk;
  end if;
  return new;
end $$;
create trigger dnd_ends_venue_sessions after update of is_available on public.presence
  for each row execute function app_private.dnd_ends_venue_sessions();

-- Expired rows do not count even if cleanup has not run yet. This is only retention housekeeping.
create or replace function public.cleanup_venue_sessions()
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n integer;
begin
  delete from public.venue_sessions where ends_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
revoke execute on function public.cleanup_venue_sessions() from authenticated;
grant execute on function public.set_server_profile(uuid,text,text),
  public.set_venue_session(uuid,boolean,integer,text,text,text),
  public.end_venue_session(uuid),public.my_venue_session(uuid),
  public.venue_people(uuid,integer),public.set_open_to_talk(boolean,text,integer)
  to authenticated;
grant execute on function public.cleanup_venue_sessions() to service_role;
