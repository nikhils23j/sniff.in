-- Chat-style Server feed: only moderators/admins post, including media.
-- Existing text announcements remain visible as text messages.
alter table public.server_announcements
  add column kind text not null default 'text'
    check (kind in ('text','image','file','gif','sticker','location')),
  add column media_path text check (char_length(media_path) <= 300),
  add column media_mime text check (char_length(media_mime) <= 100),
  add column media_size integer check (media_size between 1 and 20971520),
  add column media_name text check (char_length(media_name) <= 200),
  add column media_width integer check (media_width between 1 and 20000),
  add column media_height integer check (media_height between 1 and 20000),
  add column gif_url text check (char_length(gif_url) <= 500 and gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/'),
  add column sticker_id text check (sticker_id ~ '^[a-z0-9_-]{1,40}$'),
  add column location_lat numeric(8,5) check (location_lat between -90 and 90),
  add column location_lng numeric(8,5) check (location_lng between -180 and 180);
create unique index server_announcements_media_path on public.server_announcements(media_path) where media_path is not null;
drop index if exists public.server_announcements_server;
create index server_announcements_server on public.server_announcements(server_id,created_at desc,id desc);
alter table public.server_announcements add constraint server_announcements_kind_shape check (
  case kind
    when 'text' then media_path is null and gif_url is null and sticker_id is null and location_lat is null and location_lng is null
    when 'image' then media_path is not null and media_mime like 'image/%' and gif_url is null and sticker_id is null and location_lat is null and location_lng is null
    when 'file' then media_path is not null and media_name is not null and gif_url is null and sticker_id is null and location_lat is null and location_lng is null
    when 'gif' then gif_url is not null and media_path is null and sticker_id is null and location_lat is null and location_lng is null
    when 'sticker' then sticker_id is not null and media_path is null and gif_url is null and location_lat is null and location_lng is null
    when 'location' then location_lat is not null and location_lng is not null and media_path is null and gif_url is null and sticker_id is null
  end
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('server-media','server-media',false,20971520,array[
  'image/jpeg','image/png','image/webp','image/heic','image/gif',
  'application/pdf','text/plain','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy server_media_write on storage.objects for insert to authenticated
  with check(bucket_id='server-media'
    and owner=(select auth.uid())
    and app_private.server_is_live(app_private.uuid_or_null((storage.foldername(name))[1]))
    and app_private.has_server_role(app_private.uuid_or_null((storage.foldername(name))[1]),(select auth.uid()),'moderator'));
create policy server_media_read on storage.objects for select to authenticated
  using(bucket_id='server-media'
    and (app_private.is_active_member(app_private.uuid_or_null((storage.foldername(name))[1]),(select auth.uid()))
      or app_private.has_server_role(app_private.uuid_or_null((storage.foldername(name))[1]),(select auth.uid()),'moderator')));
create policy server_media_delete on storage.objects for delete to authenticated
  using(bucket_id='server-media' and owner=(select auth.uid()));

create or replace function public.post_server_message(
  p_server_id uuid,p_kind text,p_body text default null,p_media_path text default null,
  p_media_mime text default null,p_media_size integer default null,p_media_name text default null,
  p_media_width integer default null,p_media_height integer default null,p_gif_url text default null,
  p_sticker_id text default null,p_location_lat numeric default null,p_location_lng numeric default null)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); new_id uuid; message_body text; message_title text;
begin
  if not app_private.has_server_role(p_server_id,v,'moderator') then perform app_private.fail('forbidden'); end if;
  if not app_private.server_is_live(p_server_id) then perform app_private.fail('server_closed'); end if;
  if p_kind='text' and char_length(btrim(coalesce(p_body,''))) between 2 and 500
    and p_media_path is null and p_gif_url is null and p_sticker_id is null and p_location_lat is null and p_location_lng is null then
    message_body:=btrim(p_body);
    message_title:=left(regexp_replace(message_body,'\s+',' ','g'),80);
  elsif p_kind in ('image','file') and p_media_path is not null
    and split_part(p_media_path,'/',1)=p_server_id::text
    and p_media_path !~ '-thumb\.jpg$'
    and p_media_mime is not null and p_media_size between 1 and 20971520
    and exists(select 1 from storage.objects o where o.bucket_id='server-media' and o.name=p_media_path and o.owner=v)
    and ((p_kind='image' and p_media_mime=any(array['image/jpeg','image/png','image/webp','image/heic','image/gif']))
      or (p_kind='file' and p_media_name is not null and char_length(p_media_name) between 1 and 200)) then
    message_body:=case when p_kind='image' then 'Photo' else 'File: '||left(p_media_name,190) end;
    message_title:=left(message_body,80);
  elsif p_kind='gif' and p_gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/' then
    message_body:='GIF'; message_title:='GIF';
  elsif p_kind='sticker' and p_sticker_id ~ '^[a-z0-9_-]{1,40}$' then
    message_body:='Sticker'; message_title:='Sticker';
  elsif p_kind='location' and p_location_lat between -90 and 90 and p_location_lng between -180 and 180 then
    message_body:='Location'; message_title:='Location';
  else
    perform app_private.fail('invalid_message');
  end if;
  perform app_private.rate_limit('announcement',5,interval '1 day');
  insert into public.server_announcements(
    server_id,author_id,title,body,kind,media_path,media_mime,media_size,media_name,
    media_width,media_height,gif_url,sticker_id,location_lat,location_lng)
  values(p_server_id,v,message_title,message_body,p_kind,p_media_path,p_media_mime,p_media_size,p_media_name,
    p_media_width,p_media_height,p_gif_url,p_sticker_id,p_location_lat,p_location_lng)
  returning id into new_id;
  perform app_private.notify(m.user_id,'server_announcement',message_title,left(message_body,300),
    v,p_server_id,null,null,null,'ann:'||new_id)
  from public.server_members m where m.server_id=p_server_id and m.status='active' and m.user_id<>v limit 10000;
  perform app_private.audit('announcement_posted',p_server_id,null,null,null,jsonb_build_object('announcement_id',new_id,'kind',p_kind));
  return new_id;
end $$;
revoke execute on function public.post_server_message(uuid,text,text,text,text,integer,text,integer,integer,text,text,numeric,numeric) from public,anon;
grant execute on function public.post_server_message(uuid,text,text,text,text,integer,text,integer,integer,text,text,numeric,numeric) to authenticated;

create or replace function public.list_server_messages(
  p_server_id uuid,p_before_created timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns table(
  id uuid,title text,body text,created_at timestamptz,author_id uuid,author_name text,kind text,
  media_path text,media_mime text,media_size integer,media_name text,media_width integer,media_height integer,
  gif_url text,sticker_id text,location_lat numeric,location_lng numeric)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(false);
begin
  if not (app_private.is_active_member(p_server_id,v) or app_private.has_server_role(p_server_id,v,'moderator'))
    then perform app_private.fail('forbidden'); end if;
  return query select a.id,a.title,a.body,a.created_at,a.author_id,
    coalesce(p.display_name,'Server team'),a.kind,a.media_path,a.media_mime,a.media_size,a.media_name,
    a.media_width,a.media_height,a.gif_url,a.sticker_id,a.location_lat,a.location_lng
  from public.server_announcements a left join public.profiles p on p.id=a.author_id
  where a.server_id=p_server_id
    and (p_before_created is null or (a.created_at,a.id)<(p_before_created,p_before_id))
  order by a.created_at desc,a.id desc limit least(greatest(coalesce(p_limit,40),1),100);
end $$;
revoke execute on function public.list_server_messages(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.list_server_messages(uuid,timestamptz,uuid,integer) to authenticated;

create or replace function app_private.queue_server_media_deletion()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.media_path is not null then insert into app_private.storage_deletions(bucket,path) values('server-media',old.media_path); end if;
  elsif old.media_path is not null and old.media_path is distinct from new.media_path then
    insert into app_private.storage_deletions(bucket,path) values('server-media',old.media_path);
  end if;
  return null;
end $$;
create trigger server_message_media_cleanup after delete or update of media_path on public.server_announcements
  for each row execute function app_private.queue_server_media_deletion();
revoke execute on function app_private.queue_server_media_deletion() from public,anon;

-- Reuse the existing reservation, quota and orphan-cleanup pipeline for Server media.
create or replace function public.reserve_media_upload(p_bucket text,p_path text,p_bytes bigint)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false); parent_id uuid; bucket_limit bigint; used_bytes bigint; is_onboarded boolean;
begin
  select onboarded_at is not null into is_onboarded from public.profiles where id=v;
  if not is_onboarded and p_bucket not in ('avatars','profile-photos') then perform app_private.fail('onboarding_required'); end if;
  select file_size_limit into bucket_limit from storage.buckets where id=p_bucket;
  if p_bucket not in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media','server-media')
    or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
    or bucket_limit is null or p_bytes is null or p_bytes<1 or p_bytes>least(bucket_limit,20971520)
  then perform app_private.fail('invalid_media'); end if;
  parent_id:=app_private.uuid_or_null(split_part(p_path,'/',1));
  if parent_id is null then perform app_private.fail('invalid_media'); end if;
  if p_bucket in ('avatars','profile-photos','feedback-media') and parent_id<>v then perform app_private.fail('forbidden'); end if;
  if p_bucket='server-avatars' and not app_private.has_server_role(parent_id,v,'admin') then perform app_private.fail('forbidden'); end if;
  if p_bucket='activity-media' and not app_private.is_active_member(parent_id,v) then perform app_private.fail('forbidden'); end if;
  if p_bucket='chat-media' and not app_private.can_send_message(parent_id,v) then perform app_private.fail('forbidden'); end if;
  if p_bucket='server-media' and
    (not app_private.has_server_role(parent_id,v,'moderator') or not app_private.server_is_live(parent_id))
    then perform app_private.fail('forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext('media:user:'||v::text));
  if p_bucket in ('activity-media','server-avatars','server-media') then perform pg_advisory_xact_lock(hashtext('media:server:'||parent_id::text)); end if;
  select coalesce(sum(greatest(coalesce(actual_bytes,reserved_bytes),reserved_bytes)),0) into used_bytes
    from app_private.media_uploads where owner_id=v and status in ('reserved','uploaded','attached');
  if used_bytes+p_bytes>209715200 then perform app_private.fail('media_quota_exceeded'); end if;
  if p_bucket in ('activity-media','server-avatars','server-media') then
    select coalesce(sum(greatest(coalesce(actual_bytes,reserved_bytes),reserved_bytes)),0) into used_bytes
      from app_private.media_uploads where bucket in ('activity-media','server-avatars','server-media')
      and split_part(path,'/',1)=parent_id::text and status in ('reserved','uploaded','attached');
    if used_bytes+p_bytes>524288000 then perform app_private.fail('server_media_quota_exceeded'); end if;
  end if;
  insert into app_private.media_uploads(bucket,path,owner_id,reserved_bytes) values(p_bucket,p_path,v,p_bytes);
exception when unique_violation then perform app_private.fail('media_path_taken');
end $$;

drop policy media_reservation_required on storage.objects;
create policy media_reservation_required on storage.objects as restrictive for insert to authenticated
with check(bucket_id not in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media','server-media')
  or app_private.has_upload_reservation(bucket_id,name,(select auth.uid()),(metadata->>'size')::bigint));

create or replace function app_private.media_object_changed()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    update app_private.media_uploads set status='deleted' where bucket=old.bucket_id and path=old.name;
  elsif new.bucket_id in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media','server-media') then
    update app_private.media_uploads set status=case when status='attached' then 'attached' else 'uploaded' end,
      actual_bytes=coalesce((new.metadata->>'size')::bigint,actual_bytes,reserved_bytes)
    where bucket=new.bucket_id and path=new.name and status in ('reserved','uploaded','attached');
  end if;
  return null;
end $$;

create or replace function app_private.media_reference_exists(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case p_bucket
    when 'avatars' then exists(select 1 from public.profiles where avatar_path=p_path)
    when 'profile-photos' then exists(select 1 from public.profile_photos ph
      where ph.storage_path=p_path or (p_path ~ '-thumb\.jpg$'
        and ph.storage_path=regexp_replace(p_path,'-thumb\.jpg$','.jpg')))
    when 'server-avatars' then exists(select 1 from public.servers where avatar_path=p_path)
    when 'activity-media' then exists(select 1 from public.activity_posts p
      where p.image_path=p_path or (p_path ~ '-thumb\.jpg$'
        and p.image_path=regexp_replace(p_path,'-thumb\.jpg$','.jpg')))
      or exists(select 1 from public.activity_post_images i
      where i.storage_path=p_path or (p_path ~ '-thumb\.jpg$'
        and i.storage_path=regexp_replace(p_path,'-thumb\.jpg$','.jpg')))
    when 'chat-media' then exists(select 1 from public.messages where media_path=p_path)
    when 'server-media' then exists(select 1 from public.server_announcements where media_path=p_path)
    when 'feedback-media' then exists(select 1 from app_private.feedback_submissions where screenshot_path=p_path)
      or exists(select 1 from app_private.feedback_attachments where storage_path=p_path)
    else false end;
$$;
