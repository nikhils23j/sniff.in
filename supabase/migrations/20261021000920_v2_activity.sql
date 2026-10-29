-- V2 Activity: I'm in / I'm not in (changeable), capacity ("full"), post images, Latest / For You sorting.

alter table public.activity_posts
  add column if not exists capacity integer check (capacity is null or capacity between 1 and 500),
  add column if not exists image_path text check (char_length(image_path) <= 200);

alter table public.activity_responses
  add column if not exists kind text not null default 'in' check (kind in ('in', 'not_in')),
  add column if not exists updated_at timestamptz not null default now();
create index if not exists activity_responses_post_kind on public.activity_responses (post_id, kind);

-- Post images: activity-media/<server_id>/<file>. Authors upload to Servers they're active in; members can read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('activity-media', 'activity-media', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy activity_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'activity-media'
    and app_private.is_active_member(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid()))
    and owner = (select auth.uid()));
create policy activity_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'activity-media' and owner = (select auth.uid()));
create policy activity_media_read on storage.objects for select to authenticated
  using (bucket_id = 'activity-media'
    and (app_private.is_active_member(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid()))
         or app_private.has_server_role(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid()), 'moderator')));

create or replace function app_private.check_post_image(p_server uuid, p_path text)
returns void language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if p_path is not null and split_part(p_path, '/', 1) <> p_server::text then
    perform app_private.fail('invalid_image', 'Invalid image path');
  end if;
end $$;

-- ---------------------------------------------------------------- create / update posts
drop function if exists public.create_activity_post(uuid, text, text, integer);
create or replace function public.create_activity_post(
  p_server_id uuid, p_body text, p_category text default 'social', p_expires_hours integer default null,
  p_capacity integer default null, p_image_path text default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
  exp timestamptz;
  new_id uuid;
begin
  if not app_private.is_active_member(p_server_id, v) then perform app_private.fail('forbidden', 'Join this Server to post'); end if;
  if not app_private.server_is_live(p_server_id) then perform app_private.fail('server_closed', 'This Server has ended'); end if;
  perform app_private.rate_limit('activity_post', 3, interval '10 minutes');
  perform app_private.rate_limit('activity_post_day', 10, interval '1 day');
  perform app_private.check_post_image(p_server_id, p_image_path);
  select * into s from public.servers where id = p_server_id;
  if p_expires_hours is not null and p_expires_hours not between 1 and 720 then
    perform app_private.fail('invalid_duration', 'Posts can last between 1 hour and 30 days');
  end if;
  exp := now() + make_interval(hours => coalesce(p_expires_hours, 168));
  if s.kind = 'short_term' then exp := least(exp, s.ends_at); end if;
  insert into public.activity_posts (server_id, author_id, body, category, expires_at, capacity, image_path)
    values (p_server_id, v, btrim(p_body), coalesce(p_category, 'social'), exp, p_capacity, p_image_path)
    returning id into new_id;
  return new_id;
end $$;

drop function if exists public.update_activity_post(uuid, text, text, integer);
create or replace function public.update_activity_post(
  p_post_id uuid, p_body text, p_category text, p_expires_hours integer default null,
  p_capacity integer default null, p_image_path text default null, p_clear_image boolean default false)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  p public.activity_posts;
  s public.servers;
  exp timestamptz;
begin
  select * into p from public.activity_posts where id = p_post_id;
  if not found or p.author_id <> v or p.status <> 'active' then perform app_private.fail('not_found'); end if;
  perform app_private.check_post_image(p.server_id, p_image_path);
  select * into s from public.servers where id = p.server_id;
  exp := case when p_expires_hours is null then p.expires_at
              else least(now() + make_interval(hours => least(greatest(p_expires_hours, 1), 720)), p.created_at + interval '30 days') end;
  if s.kind = 'short_term' then exp := least(exp, s.ends_at); end if;
  update public.activity_posts
    set body = btrim(p_body), category = coalesce(p_category, category), expires_at = exp, capacity = p_capacity,
        image_path = case when p_clear_image then null else coalesce(p_image_path, image_path) end
    where id = p_post_id;
end $$;

-- ---------------------------------------------------------------- responses
-- p_kind: 'in' | 'not_in' | null (remove). "I'm in" reaches the author as a connection request if you
-- aren't connected yet; "I'm not in" never creates a request. Changing in → not_in withdraws a still-pending request.
create or replace function public.set_post_response(p_post_id uuid, p_kind text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  p public.activity_posts;
  prev public.activity_responses;
  in_count integer;
  resp_id uuid;
  req jsonb;
begin
  if p_kind is not null and p_kind not in ('in', 'not_in') then perform app_private.fail('invalid_kind'); end if;
  select * into p from public.activity_posts where id = p_post_id for update;  -- serialises capacity checks
  if not found or not app_private.post_visible(p, v) then perform app_private.fail('not_found', 'This post is no longer available'); end if;
  if p.author_id = v then perform app_private.fail('invalid_target', 'This is your own post'); end if;
  perform app_private.rate_limit('activity_response', 30, interval '1 hour');
  select * into prev from public.activity_responses where post_id = p.id and responder_id = v;

  if p_kind is null then
    delete from public.activity_responses where post_id = p.id and responder_id = v;
    if prev.request_id is not null then
      update public.connection_requests set status = 'cancelled' where id = prev.request_id and status = 'pending';
    end if;
    delete from public.notifications where type = 'activity_response' and dedupe_key = 'resp:' || prev.id;
    return jsonb_build_object('kind', null);
  end if;

  if p_kind = 'in' and coalesce(prev.kind, '') <> 'in' and p.capacity is not null then
    select count(*) into in_count from public.activity_responses where post_id = p.id and kind = 'in';
    if in_count >= p.capacity then perform app_private.fail('activity_full', 'This activity is full'); end if;
  end if;

  insert into public.activity_responses (post_id, responder_id, message, kind, updated_at)
    values (p.id, v, nullif(btrim(left(p_message, 280)), ''), p_kind, now())
  on conflict (post_id, responder_id) do update
    set kind = excluded.kind, message = coalesce(excluded.message, public.activity_responses.message), updated_at = now()
  returning id into resp_id;

  if p_kind = 'not_in' then
    -- Withdrawn "I'm in": remove the author's "X is in" notification.
    delete from public.notifications where type = 'activity_response' and dedupe_key = 'resp:' || resp_id;
    if prev.request_id is not null then
      update public.connection_requests set status = 'cancelled' where id = prev.request_id and status = 'pending';
      update public.activity_responses set request_id = null where id = resp_id;
    end if;
    return jsonb_build_object('kind', 'not_in', 'response_id', resp_id);
  end if;

  -- "I'm in"
  if not app_private.are_connected(v, p.author_id)
     and not exists (select 1 from public.connection_requests r where r.status = 'pending'
                     and ((r.sender_id = v and r.recipient_id = p.author_id) or (r.sender_id = p.author_id and r.recipient_id = v))) then
    begin
      req := app_private.create_request(v, p.author_id, p.server_id, p.id, p_message);
      update public.activity_responses set request_id = (req ->> 'request_id')::uuid where id = resp_id;
    exception when others then
      req := jsonb_build_object('status', 'not_sent');
    end;
  end if;
  -- Notify only on the FIRST response (toggling must not re-push the author).
  if prev.id is null then
    perform app_private.notify(p.author_id, 'activity_response',
      (select display_name from public.profiles where id = v) || ' is in', left(p.body, 80),
      v, p.server_id, null, null, p.id, 'resp:' || resp_id);
  end if;
  return jsonb_build_object('kind', 'in', 'response_id', resp_id, 'request', req);
end $$;

-- v1 compatibility: "Respond" = "I'm in".
create or replace function public.respond_to_activity_post(p_post_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  existing text;
begin
  select kind into existing from public.activity_responses where post_id = p_post_id and responder_id = auth.uid();
  if existing = 'in' then perform app_private.fail('already_responded', 'You already responded to this post'); end if;
  return public.set_post_response(p_post_id, 'in', p_message);
end $$;

drop function if exists public.list_post_responses(uuid);
create or replace function public.list_post_responses(p_post_id uuid)
returns table (id uuid, responder jsonb, kind text, message text, request_status public.request_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not exists (select 1 from public.activity_posts where id = p_post_id and author_id = v) then
    perform app_private.fail('forbidden');
  end if;
  return query
    select r.id, app_private.mini_card(r.responder_id), r.kind, r.message, cr.status, r.updated_at
    from public.activity_responses r
    left join public.connection_requests cr on cr.id = r.request_id
    where r.post_id = p_post_id and not app_private.is_blocked_between(v, r.responder_id)
    order by (r.kind = 'in') desc, r.updated_at desc;
end $$;

-- ---------------------------------------------------------------- feed: Latest / For You
drop function if exists public.list_activity(uuid, timestamptz, integer);
create or replace function public.list_activity(
  p_server_id uuid default null, p_before timestamptz default null, p_limit integer default 20,
  p_sort text default 'latest', p_offset integer default 0)
returns table (
  id uuid, server_id uuid, server_name text, server_avatar_path text, author jsonb, body text, category text,
  expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  response_count bigint, in_count bigint, not_in_count bigint, capacity integer, is_full boolean,
  my_response text, i_responded boolean, is_mine boolean, image_path text, relevance numeric, relevance_reason text)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  return query
  with visible as (
    select p.*, s.name as s_name, s.avatar_path as s_avatar
    from public.activity_posts p
    join public.servers s on s.id = p.server_id
    join public.server_members vm on vm.server_id = p.server_id and vm.user_id = v and vm.status = 'active'
    where (p_server_id is null or p.server_id = p_server_id)
      and (p_sort = 'for_you' or p_before is null or p.created_at < p_before)
      and app_private.post_visible(p, v)
  ),
  stats as (
    select vi.id,
      (select count(*) from public.activity_responses r where r.post_id = vi.id) as total,
      (select count(*) from public.activity_responses r where r.post_id = vi.id and r.kind = 'in') as ins,
      (select count(*) from public.activity_responses r where r.post_id = vi.id and r.kind = 'not_in') as outs,
      (select r.kind from public.activity_responses r where r.post_id = vi.id and r.responder_id = v) as mine
    from visible vi
  ),
  my_tags as (
    select t.name::text as name from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = v
  ),
  -- Categories I've said "I'm in" to before (personal affinity).
  affinity as (
    select p2.category, count(*) as n from public.activity_responses r
    join public.activity_posts p2 on p2.id = r.post_id
    where r.responder_id = v and r.kind = 'in' group by p2.category
  ),
  scored as (
    select vi.*, st.total, st.ins, st.outs, st.mine,
      (select mt.name from my_tags mt where char_length(mt.name) >= 3 and lower(vi.body) like '%' || lower(mt.name) || '%' limit 1) as tag_hit,
      coalesce((select least(a.n, 5) from affinity a where a.category = vi.category), 0) as aff
    from visible vi join stats st on st.id = vi.id
  )
  select sc.id, sc.server_id, sc.s_name, sc.s_avatar, app_private.mini_card(sc.author_id), sc.body, sc.category,
    sc.expires_at, sc.created_at, sc.updated_at, sc.total, sc.ins, sc.outs, sc.capacity,
    (sc.capacity is not null and sc.ins >= sc.capacity), sc.mine, sc.mine is not null, sc.author_id = v, sc.image_path,
    round((case when sc.tag_hit is not null then 5 else 0 end
           + sc.aff * 0.8
           + 5 * exp(-extract(epoch from (now() - sc.created_at)) / 3600.0 / 48.0)
           + least(sc.ins, 10) * 0.2
           - case when sc.mine = 'not_in' then 3 else 0 end)::numeric, 3),
    case when sc.tag_hit is not null then 'Matches your interest in ' || sc.tag_hit
         when sc.aff > 0 then 'You often join ' || sc.category || ' plans'
         else null end
  from scored sc
  order by
    case when p_sort = 'for_you' then
      (case when sc.tag_hit is not null then 5 else 0 end + sc.aff * 0.8
       + 5 * exp(-extract(epoch from (now() - sc.created_at)) / 3600.0 / 48.0) + least(sc.ins, 10) * 0.2
       - case when sc.mine = 'not_in' then 3 else 0 end) end desc nulls last,
    sc.created_at desc, sc.id
  limit least(greatest(p_limit, 1), 50)
  offset case when p_sort = 'for_you' then greatest(p_offset, 0) else 0 end;
end $$;

grant execute on function public.create_activity_post(uuid, text, text, integer, integer, text),
  public.update_activity_post(uuid, text, text, integer, integer, text, boolean),
  public.set_post_response(uuid, text, text), public.respond_to_activity_post(uuid, text),
  public.list_post_responses(uuid), public.list_activity(uuid, timestamptz, integer, text, integer) to authenticated;
grant execute on function app_private.check_post_image(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
