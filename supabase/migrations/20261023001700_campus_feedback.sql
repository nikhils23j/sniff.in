-- Basic private feedback inbox. Broader R06 reporting and alerting remain deferred.
create table app_private.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check(category in ('bug','suggestion','other')),
  body text not null check(char_length(btrim(body)) between 10 and 2000),
  screenshot_path text unique,
  created_at timestamptz not null default now()
);
create index feedback_submissions_recent on app_private.feedback_submissions(created_at desc);
create index feedback_submissions_category on app_private.feedback_submissions(category,created_at desc);
revoke all on app_private.feedback_submissions from public,anon,authenticated;
grant all on app_private.feedback_submissions to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('feedback-media','feedback-media',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
create policy feedback_media_write on storage.objects for insert to authenticated
  with check(bucket_id='feedback-media' and owner=(select auth.uid())
    and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy feedback_media_read on storage.objects for select to authenticated
  using(bucket_id='feedback-media' and (owner=(select auth.uid())
    or app_private.is_platform_admin((select auth.uid()))));

create or replace function public.submit_feedback(p_category text,p_body text,p_screenshot_path text default null)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); new_id uuid;
begin
  perform app_private.rate_limit('feedback',10,interval '1 day');
  if p_category not in ('bug','suggestion','other') or char_length(btrim(coalesce(p_body,''))) not between 10 and 2000 then
    perform app_private.fail('invalid_feedback');
  end if;
  if p_screenshot_path is not null and (split_part(p_screenshot_path,'/',1)<>v::text or
    not exists(select 1 from storage.objects where bucket_id='feedback-media'
      and name=p_screenshot_path and owner=v)) then perform app_private.fail('invalid_screenshot'); end if;
  insert into app_private.feedback_submissions(user_id,category,body,screenshot_path)
    values(v,p_category,btrim(p_body),p_screenshot_path) returning id into new_id;
  return new_id;
end $$;

create or replace function app_private.media_reference_exists(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case p_bucket
    when 'avatars' then exists(select 1 from public.profiles where avatar_path=p_path)
    when 'profile-photos' then exists(select 1 from public.profile_photos where storage_path=p_path)
    when 'server-avatars' then exists(select 1 from public.servers where avatar_path=p_path)
    when 'activity-media' then exists(select 1 from public.activity_posts where image_path=p_path)
      or exists(select 1 from public.activity_post_images where storage_path=p_path)
    when 'chat-media' then exists(select 1 from public.messages where media_path=p_path)
    when 'feedback-media' then exists(select 1 from app_private.feedback_submissions where screenshot_path=p_path)
    else false end;
$$;

create or replace function app_private.queue_feedback_image()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.screenshot_path is not null then
    insert into app_private.storage_deletions(bucket,path) values('feedback-media',old.screenshot_path);
  end if;
  return null;
end $$;
create trigger feedback_image_cleanup after delete on app_private.feedback_submissions
for each row execute function app_private.queue_feedback_image();

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.submit_feedback(text,text,text) to authenticated;
