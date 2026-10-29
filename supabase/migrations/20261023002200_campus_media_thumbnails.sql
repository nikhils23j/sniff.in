-- Pre-generated JPEG thumbnails avoid downloading a full 1280/1600px image into
-- an 80px tile. This works on Storage plans without dynamic image transforms.
create or replace function app_private.thumbnail_path(p_path text)
returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
  select regexp_replace(p_path,'\.jpg$','-thumb.jpg');
$$;

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
    when 'feedback-media' then exists(select 1 from app_private.feedback_submissions where screenshot_path=p_path)
    else false end;
$$;

create or replace function app_private.queue_profile_photo_deletion()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare thumb text:=app_private.thumbnail_path(old.storage_path);
begin
  insert into app_private.storage_deletions(bucket,path) values('profile-photos',old.storage_path);
  if thumb<>old.storage_path and exists(select 1 from storage.objects
    where bucket_id='profile-photos' and name=thumb) then
    insert into app_private.storage_deletions(bucket,path) values('profile-photos',thumb);
  end if;
  return null;
end $$;
create trigger profile_photo_cleanup after delete on public.profile_photos
  for each row execute function app_private.queue_profile_photo_deletion();

create or replace function public.remove_profile_photo(p_photo_id uuid)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); removed uuid;
begin
  delete from public.profile_photos where id=p_photo_id and user_id=v returning id into removed;
  if removed is null then perform app_private.fail('not_found'); end if;
end $$;

create or replace function app_private.queue_activity_extra_image()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare thumb text:=app_private.thumbnail_path(old.storage_path);
begin
  if not exists(select 1 from public.activity_posts where image_path=old.storage_path) then
    insert into app_private.storage_deletions(bucket,path) values('activity-media',old.storage_path);
    if thumb<>old.storage_path and exists(select 1 from storage.objects
      where bucket_id='activity-media' and name=thumb) then
      insert into app_private.storage_deletions(bucket,path) values('activity-media',thumb);
    end if;
  end if;
  return old;
end $$;

create or replace function app_private.queue_post_image_deletion()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare old_path text; thumb text;
begin
  if tg_op='DELETE' then old_path:=old.image_path;
  elsif old.image_path is distinct from new.image_path then old_path:=old.image_path;
  end if;
  if old_path is not null then
    insert into app_private.storage_deletions(bucket,path) values('activity-media',old_path);
    thumb:=app_private.thumbnail_path(old_path);
    if thumb<>old_path and exists(select 1 from storage.objects
      where bucket_id='activity-media' and name=thumb) then
      insert into app_private.storage_deletions(bucket,path) values('activity-media',thumb);
    end if;
  end if;
  return null;
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.remove_profile_photo(uuid) to authenticated;
