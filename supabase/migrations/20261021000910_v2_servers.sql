-- V2 Servers: profile pictures, visit tracking (Trending), Explore excludes joined Servers.

alter table public.servers add column if not exists avatar_path text check (char_length(avatar_path) <= 200);
grant update (avatar_path) on public.servers to authenticated;

-- An avatar path must live in the Server's own folder: server-avatars/<server_id>/<file>.
create or replace function app_private.servers_avatar_check()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then
    perform app_private.fail('invalid_avatar', 'Invalid picture path');
  end if;
  return new;
end $$;
create trigger servers_avatar_check before insert or update of avatar_path on public.servers
  for each row execute function app_private.servers_avatar_check();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('server-avatars', 'server-avatars', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.uuid_or_null(t text)
returns uuid language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create policy server_avatars_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'server-avatars'
    and app_private.has_server_role(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid()), 'admin'));
create policy server_avatars_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'server-avatars'
    and app_private.has_server_role(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid()), 'admin'));
create policy server_avatars_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'server-avatars'
    and app_private.has_server_role(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid()), 'admin'));
-- Anyone who can see the Server (listed, member, staff) can see its picture.
create policy server_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'server-avatars'
    and app_private.can_see_server(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid())));

-- ---------------------------------------------------------------- visits (one row per user/Server/day)
create table public.server_visits (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  primary key (server_id, user_id, day)
);
create index server_visits_day on public.server_visits (day, server_id);
alter table public.server_visits enable row level security;  -- no client policies: aggregate use only
revoke all on public.server_visits from anon, authenticated;
grant all on public.server_visits to service_role;

create or replace function public.record_server_visit(p_server_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if app_private.can_see_server(p_server_id, v) then
    insert into public.server_visits (server_id, user_id) values (p_server_id, v) on conflict do nothing;
  end if;
end $$;

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
    'id', s.id, 'name', s.name, 'avatar_path', s.avatar_path, 'kind', s.kind, 'category', s.category, 'description', s.description,
    'join_policy', s.join_policy, 'visibility', s.visibility, 'is_official', s.is_official,
    'requires_parent_membership', s.requires_parent_membership,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'ephemeral_chats', s.ephemeral_chats,
    'city', s.city, 'venue_lat', s.venue_lat, 'venue_lng', s.venue_lng,
    'member_count', s.member_count, 'is_archived', s.is_archived, 'created_at', s.created_at,
    'is_live', app_private.server_is_live(s.id),
    'parent', (select jsonb_build_object('id', p.id, 'name', p.name, 'avatar_path', p.avatar_path) from public.servers p where p.id = s.parent_id),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'member_count', c.member_count, 'avatar_path', c.avatar_path)
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

drop function if exists public.list_my_servers();
create or replace function public.list_my_servers()
returns table (
  id uuid, name text, kind public.server_kind, category text, parent_id uuid, parent_name text,
  is_official boolean, ends_at timestamptz, ephemeral_chats boolean, member_count integer,
  role public.member_role, status public.member_status, discoverable boolean, is_live boolean, available_now text,
  avatar_path text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.id, s.name, s.kind, s.category, s.parent_id, p.name, s.is_official, s.ends_at, s.ephemeral_chats,
         s.member_count, m.role, m.status, m.discoverable, app_private.server_is_live(s.id),
         case when m.status = 'active' then app_private.available_bucket(app_private.server_available_count(s.id, auth.uid())) end,
         s.avatar_path
  from public.server_members m
  join public.servers s on s.id = m.server_id
  left join public.servers p on p.id = s.parent_id
  where m.user_id = auth.uid() and m.status <> 'banned'
  order by app_private.server_is_live(s.id) desc, s.kind, s.name;
$$;

-- Explore: discoverable Servers the user has NOT joined (any membership row, including pending/banned, excludes it).
drop function if exists public.search_servers(text, integer);
create or replace function public.search_servers(p_query text default '', p_limit integer default 30)
returns table (
  id uuid, name text, kind public.server_kind, category text, city text, parent_name text, is_official boolean,
  join_policy public.server_join_policy, member_count integer, ends_at timestamptz, avatar_path text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.id, s.name, s.kind, s.category, s.city, p.name, s.is_official, s.join_policy, s.member_count, s.ends_at, s.avatar_path
  from public.servers s
  left join public.servers p on p.id = s.parent_id
  where s.visibility = 'listed' and not s.is_archived
    and (s.kind <> 'short_term' or s.ends_at > now())
    and (s.kind <> 'global' or exists (select 1 from public.feature_flags f where f.key = 'global_discovery' and f.enabled))
    and not exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = auth.uid())
    and (coalesce(btrim(p_query), '') = '' or s.name ilike '%' || btrim(p_query) || '%' or s.city ilike btrim(p_query) || '%')
  order by s.is_official desc, s.member_count desc, s.name
  limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function public.record_server_visit(uuid), public.get_server(uuid), public.list_my_servers(),
  public.search_servers(text, integer) to authenticated;
grant execute on function app_private.uuid_or_null(text), app_private.servers_avatar_check() to authenticated, service_role;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
