-- V2 chat media: photos, files, GIFs, stickers, explicitly shared location.

alter table public.messages
  add column if not exists kind text not null default 'text'
    check (kind in ('text', 'image', 'file', 'gif', 'sticker', 'location')),
  add column if not exists media_path text check (char_length(media_path) <= 300),
  add column if not exists media_mime text check (char_length(media_mime) <= 100),
  add column if not exists media_size integer check (media_size between 1 and 20971520),
  add column if not exists media_name text check (char_length(media_name) <= 200),
  add column if not exists media_width integer check (media_width between 1 and 20000),
  add column if not exists media_height integer check (media_height between 1 and 20000),
  add column if not exists gif_url text check (char_length(gif_url) <= 500 and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/'),
  add column if not exists sticker_id text check (sticker_id ~ '^[a-z0-9_-]{1,40}$'),
  add column if not exists location_lat numeric(8,5) check (location_lat between -90 and 90),
  add column if not exists location_lng numeric(8,5) check (location_lng between -180 and 180);

alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_kind_shape check (
  case kind
    when 'text' then body is not null and char_length(btrim(body)) between 1 and 2000
    when 'image' then media_path is not null and media_mime like 'image/%'
    when 'file' then media_path is not null and media_name is not null
    when 'gif' then gif_url is not null
    when 'sticker' then sticker_id is not null
    when 'location' then location_lat is not null and location_lng is not null
  end
  and (body is null or char_length(body) <= 2000));

grant insert (kind, media_path, media_mime, media_size, media_name, media_width, media_height, gif_url, sticker_id,
              location_lat, location_lng) on public.messages to authenticated;

-- Media must live in the conversation's own folder: chat-media/<conversation_id>/<file>.
create or replace function app_private.messages_media_check()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.media_path is not null and split_part(new.media_path, '/', 1) <> new.conversation_id::text then
    perform app_private.fail('invalid_media', 'Invalid attachment');
  end if;
  return new;
end $$;
create trigger messages_media_check before insert on public.messages
  for each row execute function app_private.messages_media_check();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 20971520, array[
  'image/jpeg','image/png','image/webp','image/heic','image/gif',
  'application/pdf','text/plain',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy chat_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media'
    and app_private.can_send_message(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid())));
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media'
    and app_private.is_conversation_member(app_private.uuid_or_null((storage.foldername(name))[1]), (select auth.uid())));
create policy chat_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and owner = (select auth.uid()));

-- ---------------------------------------------------------------- storage cleanup queue
-- Deleted messages (ephemeral expiry, block cleanup, account deletion) queue their files; the `media-cleanup`
-- Edge Function removes them through the Storage API (deleting storage.objects rows in SQL would orphan files).
create table if not exists app_private.storage_deletions (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0
);
grant all on app_private.storage_deletions to service_role;

create or replace function app_private.queue_message_media_deletion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.media_path is not null then
    insert into app_private.storage_deletions (bucket, path) values ('chat-media', old.media_path);
  end if;
  return null;
end $$;
create trigger messages_media_cleanup after delete on public.messages
  for each row execute function app_private.queue_message_media_deletion();

create or replace function app_private.queue_post_image_deletion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and old.image_path is not null then
    insert into app_private.storage_deletions (bucket, path) values ('activity-media', old.image_path);
  elsif tg_op = 'UPDATE' and old.image_path is not null and old.image_path is distinct from new.image_path then
    insert into app_private.storage_deletions (bucket, path) values ('activity-media', old.image_path);
  end if;
  return null;
end $$;
create trigger activity_posts_media_cleanup after delete or update of image_path on public.activity_posts
  for each row execute function app_private.queue_post_image_deletion();

-- Service-role RPCs for the cleanup worker (not granted to clients).
create or replace function public.claim_storage_deletions(p_limit integer default 100)
returns table (id bigint, bucket text, path text)
language sql security definer set search_path = public, pg_temp as $$
  update app_private.storage_deletions d set attempts = d.attempts + 1
  where d.id in (select id from app_private.storage_deletions where attempts < 5 order by id limit p_limit for update skip locked)
  returning d.id, d.bucket, d.path;
$$;
create or replace function public.complete_storage_deletions(p_ids bigint[])
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from app_private.storage_deletions where id = any (p_ids);
$$;
revoke execute on function public.claim_storage_deletions(integer), public.complete_storage_deletions(bigint[]) from public, anon, authenticated;
grant execute on function public.claim_storage_deletions(integer), public.complete_storage_deletions(bigint[]) to service_role;

-- Chat list previews for media messages.
drop function if exists public.list_conversations();
create or replace function public.list_conversations()
returns table (
  conversation_id uuid, connection_id uuid, other jsonb, last_message text, last_message_at timestamptz,
  last_sender_id uuid, unread_count bigint, expires_at timestamptz, is_friend boolean)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select cv.id, c.id,
         app_private.mini_card(case when c.user_a = auth.uid() then c.user_b else c.user_a end),
         case lm.kind
           when 'image' then '📷 Photo' when 'file' then '📎 ' || coalesce(lm.media_name, 'File')
           when 'gif' then 'GIF' when 'sticker' then 'Sticker' when 'location' then '📍 Location'
           else lm.body end, coalesce(lm.created_at, cv.created_at), lm.sender_id,
         (select count(*) from public.messages m
           where m.conversation_id = cv.id and m.sender_id <> auth.uid()
             and m.created_at > coalesce(me.last_read_at, '-infinity')),
         c.expires_at, c.a_saved and c.b_saved
  from public.conversation_participants me
  join public.conversations cv on cv.id = me.conversation_id
  join public.connections c on c.id = cv.connection_id and c.status = 'active'
  left join lateral (
    select m.body, m.kind, m.media_name, m.created_at, m.sender_id from public.messages m
    where m.conversation_id = cv.id order by m.created_at desc limit 1) lm on true
  where me.user_id = auth.uid() and me.hidden_at is null
  order by coalesce(lm.created_at, cv.created_at) desc
  limit 200;
$$;

grant execute on function public.list_conversations() to authenticated;
grant execute on function app_private.messages_media_check(), app_private.queue_message_media_deletion(),
  app_private.queue_post_image_deletion() to authenticated, service_role;

-- Re-allow regenerating icebreakers (user-initiated "refresh"), rate limited.
create or replace function public.reset_icebreakers(p_connection_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not exists (select 1 from public.connections c where c.id = p_connection_id and v in (c.user_a, c.user_b) and c.status = 'active') then
    perform app_private.fail('not_found');
  end if;
  perform app_private.rate_limit('icebreaker_refresh', 5, interval '1 hour');
  delete from public.icebreakers where connection_id = p_connection_id;
end $$;
grant execute on function public.reset_icebreakers(uuid) to authenticated;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
-- (service-only RPCs above stay revoked from authenticated)
revoke execute on all functions in schema app_private from public, anon;
