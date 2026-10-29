-- Client RPCs: onboarding, profile, tags, presence, cravings, Servers, membership, join tokens, badges.
-- Every RPC derives the actor from auth.uid(); no RPC accepts an "acting user" parameter.

-- ================================================================ onboarding & profile
create or replace function public.is_username_available(p_username text)
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select lower(p_username) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where username = lower(p_username)::citext and id <> auth.uid());
$$;

create or replace function public.complete_onboarding(
  p_username text, p_display_name text, p_date_of_birth date,
  p_gender public.gender_identity default null,
  p_discovery_audience public.discovery_audience default 'everyone')
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  existing_dob date;
  uname text := lower(btrim(p_username));
begin
  if uname !~ '^[a-z0-9_]{3,20}$' then
    perform app_private.fail('invalid_username', 'Usernames are 3-20 characters: letters, numbers, underscores');
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 60 then
    perform app_private.fail('invalid_name', 'Please enter your name');
  end if;
  if p_date_of_birth is null or p_date_of_birth > (current_date - interval '18 years')::date then
    perform app_private.fail('underage', 'Sniff.in is only for adults aged 18 and over');
  end if;
  if p_date_of_birth < (current_date - interval '110 years')::date then
    perform app_private.fail('invalid_dob', 'Please enter a valid date of birth');
  end if;
  if p_discovery_audience = 'same_gender' and p_gender is null then
    perform app_private.fail('gender_required', 'Choose your gender to use the same-gender safety filter');
  end if;
  select date_of_birth into existing_dob from public.profile_private where user_id = v;
  if existing_dob is not null and existing_dob <> p_date_of_birth then
    perform app_private.fail('dob_locked', 'Date of birth cannot be changed. Contact support.');
  end if;
  if exists (select 1 from public.profiles where username = uname::citext and id <> v) then
    perform app_private.fail('username_taken', 'That username is taken');
  end if;
  update public.profiles
    set username = uname::citext, display_name = btrim(p_display_name), onboarded_at = coalesce(onboarded_at, now())
    where id = v;
  update public.profile_private
    set date_of_birth = p_date_of_birth, gender = p_gender, discovery_audience = p_discovery_audience
    where user_id = v;
end $$;

create or replace function public.set_username(p_username text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  uname text := lower(btrim(p_username));
begin
  perform app_private.rate_limit('set_username', 5, interval '1 day');
  if uname !~ '^[a-z0-9_]{3,20}$' then
    perform app_private.fail('invalid_username', 'Usernames are 3-20 characters: letters, numbers, underscores');
  end if;
  if exists (select 1 from public.profiles where username = uname::citext and id <> v) then
    perform app_private.fail('username_taken', 'That username is taken');
  end if;
  update public.profiles set username = uname::citext where id = v;
end $$;

-- Guard direct profile updates: the safety filter needs a declared gender.
create or replace function app_private.profile_private_validate()
returns trigger language plpgsql as $$
begin
  if new.discovery_audience = 'same_gender' and new.gender is null then
    perform app_private.fail('gender_required', 'Choose your gender to use the same-gender safety filter');
  end if;
  return new;
end $$;
create trigger profile_private_validate before update on public.profile_private
  for each row execute function app_private.profile_private_validate();

-- Replace the caller's tags of one kind. Creates catalog tags on demand.
create or replace function public.set_my_tags(p_kind public.tag_kind, p_names text[])
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  clean citext[];
begin
  select coalesce(array_agg(distinct n::citext), '{}')
    into clean
    from (select regexp_replace(btrim(x), '\s+', ' ', 'g') as n from unnest(coalesce(p_names, '{}')) x) s
    where char_length(n) between 1 and 40;
  if coalesce(array_length(clean, 1), 0) > 15 then
    perform app_private.fail('too_many_tags', 'Choose up to 15');
  end if;
  insert into public.tags (kind, name) select p_kind, n from unnest(clean) n on conflict (kind, name) do nothing;
  delete from public.profile_tags pt using public.tags t
    where pt.tag_id = t.id and pt.user_id = v and t.kind = p_kind and not (t.name = any (clean));
  insert into public.profile_tags (user_id, tag_id)
    select v, t.id from public.tags t where t.kind = p_kind and t.name = any (clean)
    on conflict do nothing;
end $$;

create or replace function public.search_tags(p_kind public.tag_kind, p_query text, p_limit integer default 10)
returns table (name text, uses bigint) language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select t.name::text, count(pt.user_id) as uses
  from public.tags t
  left join public.profile_tags pt on pt.tag_id = t.id
  where t.kind = p_kind and (coalesce(p_query, '') = '' or t.name::text ilike '%' || p_query || '%')
  group by t.id
  order by (t.name::text ilike p_query || '%') desc, count(pt.user_id) desc, t.name
  limit least(greatest(p_limit, 1), 25);
$$;

create or replace function public.get_my_tags()
returns table (kind public.tag_kind, name text) language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select t.kind, t.name::text from public.profile_tags pt join public.tags t on t.id = pt.tag_id
  where pt.user_id = auth.uid() order by t.kind, t.name;
$$;

-- ================================================================ presence
create or replace function public.set_availability(p_minutes integer)
returns timestamptz language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  until_ts timestamptz;
begin
  if p_minutes is null or p_minutes not between 15 and 720 then
    perform app_private.fail('invalid_duration', 'Choose between 15 minutes and 12 hours');
  end if;
  until_ts := now() + make_interval(mins => p_minutes);
  insert into public.presence (user_id, available_until, available_since, updated_at)
    values (v, until_ts, now(), now())
  on conflict (user_id) do update
    set available_until = excluded.available_until,
        available_since = case when public.presence.available_until > now()
                               then public.presence.available_since else now() end,
        updated_at = now();
  update public.profiles set last_active_at = now() where id = v;
  return until_ts;
end $$;

create or replace function public.set_dnd()
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  update public.presence set available_until = null, available_since = null, updated_at = now() where user_id = v;
end $$;

-- Foreground heartbeat (client calls every ~2 min). Returns the authoritative availability.
create or replace function public.heartbeat()
returns timestamptz language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  until_ts timestamptz;
begin
  update public.profiles set last_active_at = now()
    where id = v and (last_active_at is null or last_active_at < now() - interval '60 seconds');
  select available_until into until_ts from public.presence where user_id = v and available_until > now();
  return until_ts;
end $$;

-- ================================================================ cravings
create or replace function public.set_craving(p_body text, p_server_id uuid default null, p_hours integer default 24)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  perform app_private.rate_limit('set_craving', 30, interval '1 day');
  if p_hours is null or p_hours not between 1 and 168 then
    perform app_private.fail('invalid_duration', 'Cravings last between 1 hour and 7 days');
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 140 then
    perform app_private.fail('invalid_body', 'Keep it between 3 and 140 characters');
  end if;
  if p_server_id is not null and not app_private.is_active_member(p_server_id, v) then
    perform app_private.fail('forbidden', 'You are not a member of that Server');
  end if;
  insert into public.cravings (user_id, body, server_id, expires_at, created_at)
    values (v, btrim(p_body), p_server_id, now() + make_interval(hours => p_hours), now())
  on conflict (user_id) do update
    set body = excluded.body, server_id = excluded.server_id, expires_at = excluded.expires_at, created_at = now();
end $$;

create or replace function public.clear_craving()
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from public.cravings where user_id = auth.uid();
$$;

-- ================================================================ Servers
create or replace function public.create_server(
  p_name text,
  p_kind public.server_kind,
  p_category text default 'other',
  p_description text default null,
  p_parent_id uuid default null,
  p_join_policy public.server_join_policy default 'invite_only',
  p_visibility public.server_visibility default 'unlisted',
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_ephemeral_chats boolean default false,
  p_city text default null,
  p_venue_lat numeric default null,
  p_venue_lng numeric default null,
  p_requires_parent_membership boolean default false)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  new_id uuid;
begin
  perform app_private.rate_limit('create_server', 10, interval '1 day');
  if p_kind = 'global' and not app_private.is_platform_admin(v) then
    perform app_private.fail('forbidden', 'Global Servers are curated by Sniff.in');
  end if;
  if p_parent_id is not null and not app_private.has_server_role(p_parent_id, v, 'admin') then
    perform app_private.fail('forbidden', 'Only admins of the parent Server can add sub-Servers');
  end if;
  if p_kind = 'short_term' then
    if p_ends_at is null or p_ends_at <= now() then
      perform app_private.fail('invalid_schedule', 'Short-term Servers need an end time in the future');
    end if;
    if p_ends_at - coalesce(p_starts_at, now()) > interval '30 days' then
      perform app_private.fail('invalid_schedule', 'Short-term Servers can last at most 30 days');
    end if;
  end if;
  insert into public.servers (
    name, kind, category, description, parent_id, join_policy, visibility, starts_at, ends_at,
    ephemeral_chats, city, venue_lat, venue_lng, requires_parent_membership, created_by)
  values (
    btrim(p_name), p_kind, coalesce(p_category, 'other'), nullif(btrim(p_description), ''), p_parent_id,
    p_join_policy, p_visibility, p_starts_at, p_ends_at, coalesce(p_ephemeral_chats, false),
    nullif(btrim(p_city), ''), p_venue_lat, p_venue_lng, coalesce(p_requires_parent_membership, false), v)
  returning id into new_id;
  insert into public.server_members (server_id, user_id, role, status, joined_via, approved_at)
    values (new_id, v, 'admin', 'active', 'creator', now());
  perform app_private.audit('server_created', new_id, null, null, null, jsonb_build_object('kind', p_kind));
  return new_id;
end $$;

-- Constraints that apply to every write path (RPC or RLS-guarded UPDATE).
create or replace function app_private.servers_policy_check()
returns trigger language plpgsql as $$
begin
  if new.join_policy = 'open' and new.kind <> 'global' then
    perform app_private.fail('invalid_policy', 'Open joining is only available for global Servers');
  end if;
  return new;
end $$;
create trigger servers_policy_check before insert or update on public.servers
  for each row execute function app_private.servers_policy_check();

create or replace function public.set_server_official(p_server_id uuid, p_official boolean)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.is_platform_admin(v) then perform app_private.fail('forbidden'); end if;
  update public.servers set is_official = p_official where id = p_server_id;
  perform app_private.audit(case when p_official then 'server_verified' else 'server_unverified' end, p_server_id);
end $$;

-- Bucketed live count: exact numbers below 5 are never revealed (re-identification risk).
create or replace function app_private.available_bucket(n bigint)
returns text language sql immutable as $$
  select case when n = 0 then '0' when n < 5 then 'a few' when n < 10 then '5+' when n < 25 then '10+'
              when n < 50 then '25+' when n < 100 then '50+' else '100+' end;
$$;

create or replace function app_private.server_available_count(s uuid, exclude uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)
  from public.server_members m
  join public.presence p on p.user_id = m.user_id and p.available_until > now()
  join public.profiles pr on pr.id = m.user_id and pr.account_status = 'active'
  where m.server_id = s and m.status = 'active' and m.discoverable and m.user_id is distinct from exclude;
$$;

create or replace function app_private.can_see_server(s uuid, u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.servers sv
    where sv.id = s and (
      (sv.visibility = 'listed' and (sv.kind <> 'global' or exists (
        select 1 from public.feature_flags f where f.key = 'global_discovery' and f.enabled)))
      or app_private.has_membership_row(s, u)
      or app_private.has_server_role(s, u, 'moderator')
    )
  );
$$;

create or replace function public.get_server(p_server_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  s public.servers;
  m public.server_members;
  result jsonb;
begin
  if not app_private.can_see_server(p_server_id, v) then
    perform app_private.fail('not_found', 'Server not found');
  end if;
  select * into s from public.servers where id = p_server_id;
  select * into m from public.server_members where server_id = p_server_id and user_id = v;
  result := jsonb_build_object(
    'id', s.id, 'name', s.name, 'kind', s.kind, 'category', s.category, 'description', s.description,
    'join_policy', s.join_policy, 'visibility', s.visibility, 'is_official', s.is_official,
    'requires_parent_membership', s.requires_parent_membership,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'ephemeral_chats', s.ephemeral_chats,
    'city', s.city, 'venue_lat', s.venue_lat, 'venue_lng', s.venue_lng,
    'member_count', s.member_count, 'is_archived', s.is_archived, 'created_at', s.created_at,
    'is_live', app_private.server_is_live(s.id),
    'parent', (select jsonb_build_object('id', p.id, 'name', p.name) from public.servers p where p.id = s.parent_id),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'member_count', c.member_count)
                       order by c.name)
      from public.servers c
      where c.parent_id = s.id and not c.is_archived and app_private.can_see_server(c.id, v)), '[]'::jsonb),
    'membership', case when m.user_id is null then null else jsonb_build_object(
      'role', m.role, 'status', m.status, 'discoverable', m.discoverable, 'joined_at', m.created_at) end,
    'can_manage', app_private.has_server_role(s.id, v, 'moderator'),
    'is_admin', app_private.has_server_role(s.id, v, 'admin'),
    -- Live availability is only shown to active members, and bucketed.
    'available_now', case when m.status = 'active'
      then app_private.available_bucket(app_private.server_available_count(s.id, v)) end,
    'my_badges', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'issued_at', b.issued_at, 'expires_at', b.expires_at))
      from public.server_badges b
      where b.server_id = s.id and b.user_id = v and b.status = 'active' and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
  );
  return result;
end $$;

create or replace function public.list_my_servers()
returns table (
  id uuid, name text, kind public.server_kind, category text, parent_id uuid, parent_name text,
  is_official boolean, ends_at timestamptz, ephemeral_chats boolean, member_count integer,
  role public.member_role, status public.member_status, discoverable boolean, is_live boolean, available_now text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.id, s.name, s.kind, s.category, s.parent_id, p.name, s.is_official, s.ends_at, s.ephemeral_chats,
         s.member_count, m.role, m.status, m.discoverable, app_private.server_is_live(s.id),
         case when m.status = 'active' then app_private.available_bucket(app_private.server_available_count(s.id, auth.uid())) end
  from public.server_members m
  join public.servers s on s.id = m.server_id
  left join public.servers p on p.id = s.parent_id
  where m.user_id = auth.uid()
  order by app_private.server_is_live(s.id) desc, s.kind, s.name;
$$;

create or replace function public.search_servers(p_query text default '', p_limit integer default 30)
returns table (
  id uuid, name text, kind public.server_kind, category text, city text, parent_name text, is_official boolean,
  join_policy public.server_join_policy, member_count integer, ends_at timestamptz, my_status public.member_status)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.id, s.name, s.kind, s.category, s.city, p.name, s.is_official, s.join_policy, s.member_count, s.ends_at, m.status
  from public.servers s
  left join public.servers p on p.id = s.parent_id
  left join public.server_members m on m.server_id = s.id and m.user_id = auth.uid()
  where s.visibility = 'listed' and not s.is_archived
    and (s.kind <> 'short_term' or s.ends_at > now())
    and (s.kind <> 'global' or exists (select 1 from public.feature_flags f where f.key = 'global_discovery' and f.enabled))
    and (coalesce(btrim(p_query), '') = '' or s.name ilike '%' || btrim(p_query) || '%' or s.city ilike btrim(p_query) || '%')
  order by s.is_official desc, s.member_count desc, s.name
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.archive_server(p_server_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  update public.servers set is_archived = true where id = p_server_id;
  perform app_private.audit('server_archived', p_server_id);
end $$;

-- ================================================================ join tokens
create or replace function app_private.random_code(len integer)
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  out text := '';
begin
  for i in 0 .. len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function public.create_join_token(
  p_server_id uuid, p_kind text default 'qr', p_expires_minutes integer default null,
  p_max_uses integer default null, p_label text default null)
returns public.server_join_tokens language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
  tok text;
  exp timestamptz;
  row public.server_join_tokens;
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  perform app_private.rate_limit('create_join_token', 50, interval '1 hour');
  select * into s from public.servers where id = p_server_id;
  if not app_private.server_is_live(p_server_id) then
    perform app_private.fail('server_closed', 'This Server has ended or is archived');
  end if;
  if p_kind not in ('qr','link','code') then perform app_private.fail('invalid_kind'); end if;
  if p_expires_minutes is not null and p_expires_minutes not between 5 and 525600 then
    perform app_private.fail('invalid_duration');
  end if;
  exp := case when p_expires_minutes is not null then now() + make_interval(mins => p_expires_minutes) end;
  if s.kind = 'short_term' then exp := least(coalesce(exp, s.ends_at), s.ends_at); end if;
  -- Short codes are human-typable (8 chars from a 31-symbol alphabet, ~8.5e11 space) and rate-limited;
  -- QR/link tokens carry 144 bits of randomness.
  tok := case when p_kind = 'code' then app_private.random_code(8)
              else translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_') end;
  insert into public.server_join_tokens (server_id, kind, token, label, created_by, expires_at, max_uses)
    values (p_server_id, p_kind, tok, nullif(btrim(p_label), ''), v, exp, p_max_uses)
    returning * into row;
  perform app_private.audit('join_token_created', p_server_id, null, null, null, jsonb_build_object('token_id', row.id, 'kind', p_kind));
  return row;
end $$;

create or replace function public.revoke_join_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s uuid;
begin
  select server_id into s from public.server_join_tokens where id = p_token_id;
  if s is null or not app_private.has_server_role(s, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  update public.server_join_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_token_id;
  perform app_private.audit('join_token_revoked', s, null, null, null, jsonb_build_object('token_id', p_token_id));
end $$;

create or replace function app_private.normalize_token(p text)
returns text language sql immutable as $$
  -- Accept a raw token, a short code (case-insensitive) or a full join URL (…?t=TOKEN / …/join/TOKEN).
  select case
    when p ~ '[?&]t=' then substring(p from '[?&]t=([A-Za-z0-9_=-]+)')
    when p ~ '/join/' then substring(p from '/join/([A-Za-z0-9_=-]+)')
    when btrim(p) ~ '^[A-Za-z0-9]{8}$' then upper(btrim(p))
    else btrim(p)
  end;
$$;

-- Returns NULL for unknown/expired/revoked/exhausted tokens. Callers must NOT raise on NULL:
-- raising would roll back the rate-limit event and make brute-forcing codes free.
create or replace function app_private.valid_token(p_token text)
returns public.server_join_tokens language plpgsql stable security definer set search_path = public, pg_temp as $$
declare row public.server_join_tokens;
begin
  select * into row from public.server_join_tokens where token = app_private.normalize_token(p_token);
  if not found or row.revoked_at is not null or (row.expires_at is not null and row.expires_at <= now())
     or (row.max_uses is not null and row.use_count >= row.max_uses)
     or not app_private.server_is_live(row.server_id) then
    return null;
  end if;
  return row;
end $$;

create or replace function public.preview_join_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  t public.server_join_tokens;
  s public.servers;
begin
  perform app_private.rate_limit('join_attempt', 20, interval '10 minutes');
  t := app_private.valid_token(p_token);
  if t.id is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into s from public.servers where id = t.server_id;
  return jsonb_build_object('status', 'valid',
    'server_id', s.id, 'name', s.name, 'kind', s.kind, 'category', s.category, 'description', s.description,
    'is_official', s.is_official, 'member_count', s.member_count, 'join_policy', s.join_policy,
    'ends_at', s.ends_at, 'ephemeral_chats', s.ephemeral_chats,
    'parent_name', (select name from public.servers where id = s.parent_id),
    'requires_parent_membership', s.requires_parent_membership,
    'my_status', (select status from public.server_members where server_id = s.id and user_id = v));
end $$;

create or replace function app_private.notify_server_staff(p_server uuid, p_actor uuid, p_title text, p_body text, p_dedupe text)
returns void language sql security definer set search_path = public, pg_temp as $$
  select app_private.notify(m.user_id, 'server_membership', p_title, p_body, p_actor, p_server, null, null, null, p_dedupe || ':' || m.user_id)
  from public.server_members m
  where m.server_id = p_server and m.status = 'active' and m.role in ('moderator','admin')
  limit 25;
$$;

create or replace function public.join_server_with_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  t public.server_join_tokens;
  s public.servers;
  existing public.server_members;
  new_status public.member_status;
begin
  perform app_private.rate_limit('join_attempt', 20, interval '10 minutes');
  t := app_private.valid_token(p_token);
  if t.id is null then return jsonb_build_object('status', 'invalid'); end if;
  -- Serialize concurrent uses of the same capped token, then re-validate under the lock.
  perform 1 from public.server_join_tokens where id = t.id for update;
  t := app_private.valid_token(t.token);
  if t.id is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into s from public.servers where id = t.server_id;
  select * into existing from public.server_members where server_id = s.id and user_id = v;
  if existing.status = 'banned' then
    perform app_private.fail('banned', 'You cannot join this Server');
  end if;
  if existing.status = 'active' then
    return jsonb_build_object('server_id', s.id, 'status', 'active');
  end if;
  if s.requires_parent_membership and not app_private.is_active_member(s.parent_id, v) then
    perform app_private.fail('parent_membership_required', 'Join the parent Server first');
  end if;
  new_status := case when s.join_policy = 'approval' then 'pending' else 'active' end;
  insert into public.server_members (server_id, user_id, role, status, joined_via, approved_at)
    values (s.id, v, 'member', new_status, 'token', case when new_status = 'active' then now() end)
  on conflict (server_id, user_id) do update
    set status = excluded.status, approved_at = excluded.approved_at, joined_via = 'token';
  update public.server_join_tokens set use_count = use_count + 1 where id = t.id;
  if new_status = 'pending' then
    perform app_private.notify_server_staff(s.id, v, 'New join request', 'Someone asked to join ' || s.name, 'joinreq:' || s.id || ':' || v);
  end if;
  return jsonb_build_object('server_id', s.id, 'status', new_status);
end $$;

-- Listed + approval Servers can be requested without a token.
create or replace function public.request_to_join(p_server_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
  existing public.server_members;
  new_status public.member_status;
begin
  perform app_private.rate_limit('join_attempt', 20, interval '10 minutes');
  select * into s from public.servers where id = p_server_id;
  if not found or s.visibility <> 'listed' or not app_private.server_is_live(s.id) then
    perform app_private.fail('not_found', 'Server not found');
  end if;
  if s.join_policy = 'invite_only' then
    perform app_private.fail('invite_required', 'This Server is invite-only. Scan its QR code or use an invite.');
  end if;
  if s.join_policy = 'open' and not (
       exists (select 1 from public.feature_flags f where f.key = 'global_discovery' and f.enabled)
       or exists (select 1 from public.entitlements e where e.user_id = v and e.feature = 'global_discovery'
                  and e.status = 'active' and (e.ends_at is null or e.ends_at > now()))) then
    perform app_private.fail('premium_required', 'Global Servers are in limited beta');
  end if;
  select * into existing from public.server_members where server_id = s.id and user_id = v;
  if existing.status = 'banned' then perform app_private.fail('banned', 'You cannot join this Server'); end if;
  if existing.status in ('active','pending') then
    return jsonb_build_object('server_id', s.id, 'status', existing.status);
  end if;
  if s.requires_parent_membership and not app_private.is_active_member(s.parent_id, v) then
    perform app_private.fail('parent_membership_required', 'Join the parent Server first');
  end if;
  new_status := case when s.join_policy = 'open' then 'active' else 'pending' end;
  insert into public.server_members (server_id, user_id, status, joined_via, approved_at)
    values (s.id, v, new_status, case when new_status = 'active' then 'open' else 'approval' end,
            case when new_status = 'active' then now() end);
  if new_status = 'pending' then
    perform app_private.notify_server_staff(s.id, v, 'New join request', 'Someone asked to join ' || s.name, 'joinreq:' || s.id || ':' || v);
  end if;
  return jsonb_build_object('server_id', s.id, 'status', new_status);
end $$;

create or replace function public.leave_server(p_server_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  m public.server_members;
begin
  select * into m from public.server_members where server_id = p_server_id and user_id = v;
  if not found then return; end if;
  if m.status = 'banned' then
    -- Leaving would erase the ban; banned rows stay.
    perform app_private.fail('banned', 'You were removed from this Server');
  end if;
  if m.role = 'admin' and m.status = 'active'
     and not exists (select 1 from public.server_members where server_id = p_server_id and role = 'admin' and status = 'active' and user_id <> v)
     and exists (select 1 from public.server_members where server_id = p_server_id and status = 'active' and user_id <> v) then
    perform app_private.fail('last_admin', 'Make someone else an admin before leaving');
  end if;
  delete from public.server_members where server_id = p_server_id and user_id = v;
  delete from public.cravings where user_id = v and server_id = p_server_id;
end $$;

-- ================================================================ membership administration
create or replace function app_private.effective_rank(s uuid, u uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app_private.is_platform_admin(u) then 4
    when exists (
      with recursive chain (id, parent_id) as (
        select id, parent_id from public.servers where id = (select parent_id from public.servers where id = s)
        union all
        select p.id, p.parent_id from public.servers p join chain c on p.id = c.parent_id)
      select 1 from chain c join public.server_members m on m.server_id = c.id and m.user_id = u
      where m.status = 'active' and m.role = 'admin') then 3
    else coalesce((select case m.role when 'admin' then 2 when 'moderator' then 1 else 0 end
                   from public.server_members m where m.server_id = s and m.user_id = u and m.status = 'active'), -1)
  end;
$$;

create or replace function public.review_membership(p_server_id uuid, p_user_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  select * into s from public.servers where id = p_server_id;
  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id and status = 'pending') then
    perform app_private.fail('not_found', 'No pending request');
  end if;
  if p_approve then
    update public.server_members set status = 'active', approved_at = now(), approved_by = v
      where server_id = p_server_id and user_id = p_user_id;
    perform app_private.notify(p_user_id, 'server_membership', 'You''re in: ' || s.name, 'Your request to join was approved.',
      v, p_server_id, null, null, null, 'joined:' || p_server_id);
  else
    delete from public.server_members where server_id = p_server_id and user_id = p_user_id;
  end if;
  perform app_private.audit(case when p_approve then 'membership_approved' else 'membership_rejected' end, p_server_id, p_user_id);
end $$;

create or replace function public.set_member_role(p_server_id uuid, p_user_id uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  cur public.member_role;
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  select role into cur from public.server_members where server_id = p_server_id and user_id = p_user_id and status = 'active';
  if cur is null then perform app_private.fail('not_found', 'Not an active member'); end if;
  if cur = 'admin' and p_role <> 'admin'
     and not exists (select 1 from public.server_members where server_id = p_server_id and role = 'admin' and status = 'active' and user_id <> p_user_id) then
    perform app_private.fail('last_admin', 'A Server needs at least one admin');
  end if;
  update public.server_members set role = p_role where server_id = p_server_id and user_id = p_user_id;
  perform app_private.audit('role_changed', p_server_id, p_user_id, null, null, jsonb_build_object('from', cur, 'to', p_role));
end $$;

create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  if p_user_id = v or app_private.effective_rank(p_server_id, p_user_id) >= app_private.effective_rank(p_server_id, v) then
    perform app_private.fail('forbidden', 'You cannot ban someone with an equal or higher role');
  end if;
  insert into public.server_members (server_id, user_id, role, status, joined_via, banned_at, banned_by, ban_reason, discoverable)
    values (p_server_id, p_user_id, 'member', 'banned', 'admin', now(), v, left(p_reason, 300), false)
  on conflict (server_id, user_id) do update
    set status = 'banned', role = 'member', banned_at = now(), banned_by = v, ban_reason = left(p_reason, 300), discoverable = false;
  delete from public.cravings where user_id = p_user_id and server_id = p_server_id;
  update public.activity_posts set status = 'removed', removed_by = v, removed_reason = 'Author banned'
    where server_id = p_server_id and author_id = p_user_id and status = 'active';
  perform app_private.audit('member_banned', p_server_id, p_user_id, null, null, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.unban_member(p_server_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  delete from public.server_members where server_id = p_server_id and user_id = p_user_id and status = 'banned';
  perform app_private.audit('member_unbanned', p_server_id, p_user_id);
end $$;

create or replace function public.remove_member(p_server_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  if p_user_id = v or app_private.effective_rank(p_server_id, p_user_id) >= app_private.effective_rank(p_server_id, v) then
    perform app_private.fail('forbidden', 'You cannot remove someone with an equal or higher role');
  end if;
  delete from public.server_members where server_id = p_server_id and user_id = p_user_id and status <> 'banned';
  delete from public.cravings where user_id = p_user_id and server_id = p_server_id;
  perform app_private.audit('member_removed', p_server_id, p_user_id);
end $$;

-- Staff-only member list (regular members only see counts: membership is not public information).
create or replace function public.list_server_members(
  p_server_id uuid, p_status public.member_status default 'active', p_query text default '', p_limit integer default 50, p_offset integer default 0)
returns table (
  user_id uuid, username text, display_name text, avatar_path text, role public.member_role,
  status public.member_status, joined_at timestamptz, ban_reason text, badges jsonb)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  return query
    select m.user_id, pr.username::text, pr.display_name, pr.avatar_path, m.role, m.status, m.created_at, m.ban_reason,
           coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'expires_at', b.expires_at))
                     from public.server_badges b where b.server_id = p_server_id and b.user_id = m.user_id and b.status = 'active'), '[]'::jsonb)
    from public.server_members m join public.profiles pr on pr.id = m.user_id
    where m.server_id = p_server_id and m.status = p_status
      and (coalesce(p_query, '') = '' or pr.display_name ilike '%' || p_query || '%' or pr.username::text ilike '%' || p_query || '%')
    order by (m.role = 'admin') desc, (m.role = 'moderator') desc, m.created_at desc
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- ================================================================ badges (verification)
create or replace function public.grant_badge(
  p_server_id uuid, p_user_id uuid, p_kind text, p_label text, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  new_id uuid;
  sname text;
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  if not app_private.is_active_member(p_server_id, p_user_id) then
    perform app_private.fail('not_member', 'Badges can only be granted to active members');
  end if;
  if p_expires_at is not null and p_expires_at <= now() then perform app_private.fail('invalid_expiry'); end if;
  if exists (select 1 from public.server_badges where server_id = p_server_id and user_id = p_user_id and kind = p_kind and status = 'active') then
    perform app_private.fail('badge_exists', 'This member already has that badge');
  end if;
  insert into public.server_badges (server_id, user_id, kind, label, issued_by, expires_at)
    values (p_server_id, p_user_id, p_kind, btrim(p_label), v, p_expires_at)
    returning id into new_id;
  select name into sname from public.servers where id = p_server_id;
  perform app_private.audit('badge_granted', p_server_id, p_user_id, null, null, jsonb_build_object('badge_id', new_id, 'kind', p_kind, 'label', p_label));
  perform app_private.notify(p_user_id, 'badge_granted', 'New verified badge', btrim(p_label) || ', verified by ' || sname,
    v, p_server_id, null, null, null, 'badge:' || new_id);
  return new_id;
end $$;

create or replace function public.revoke_badge(p_badge_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  b public.server_badges;
begin
  select * into b from public.server_badges where id = p_badge_id;
  if not found or not app_private.has_server_role(b.server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  update public.server_badges set status = 'revoked', revoked_at = now(), revoked_by = v, revoke_reason = left(p_reason, 300)
    where id = p_badge_id and status = 'active';
  perform app_private.audit('badge_revoked', b.server_id, b.user_id, null, null, jsonb_build_object('badge_id', p_badge_id, 'reason', p_reason));
end $$;
