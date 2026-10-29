-- R11: reserve uploads before Storage writes, recover abandoned files, and retry deletions.
create table app_private.media_uploads (
  bucket text not null,
  path text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reserved_bytes bigint not null check (reserved_bytes between 0 and 20971520),
  actual_bytes bigint,
  status text not null default 'reserved' check (status in ('reserved','uploaded','attached','abandoned','deleted')),
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  primary key(bucket,path)
);
create index media_uploads_owner_active on app_private.media_uploads(owner_id,status) include(reserved_bytes);
create index media_uploads_orphans on app_private.media_uploads(created_at)
  where status in ('reserved','uploaded');
revoke all on app_private.media_uploads from public,anon,authenticated;
grant all on app_private.media_uploads to service_role;

-- Existing objects remain valid. Their Storage metadata contributes to quota when present.
insert into app_private.media_uploads(bucket,path,owner_id,reserved_bytes,actual_bytes,status,created_at,attached_at)
select o.bucket_id,o.name,o.owner,
  greatest(0,coalesce((o.metadata->>'size')::bigint,0)),
  greatest(0,coalesce((o.metadata->>'size')::bigint,0)),
  case
    when o.bucket_id='avatars' and exists(select 1 from public.profiles p where p.avatar_path=o.name) then 'attached'
    when o.bucket_id='profile-photos' and exists(select 1 from public.profile_photos p where p.storage_path=o.name) then 'attached'
    when o.bucket_id='server-avatars' and exists(select 1 from public.servers s where s.avatar_path=o.name) then 'attached'
    when o.bucket_id='activity-media' and (exists(select 1 from public.activity_posts p where p.image_path=o.name)
      or exists(select 1 from public.activity_post_images i where i.storage_path=o.name)) then 'attached'
    when o.bucket_id='chat-media' and exists(select 1 from public.messages m where m.media_path=o.name) then 'attached'
    else 'uploaded' end,coalesce(o.created_at,now()),null
from storage.objects o
where o.bucket_id in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media')
  and o.owner is not null and coalesce((o.metadata->>'size')::bigint,0) between 0 and 20971520
on conflict(bucket,path) do nothing;

create or replace function public.reserve_media_upload(p_bucket text,p_path text,p_bytes bigint)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); parent_id uuid; bucket_limit bigint; used_bytes bigint;
begin
  select file_size_limit into bucket_limit from storage.buckets where id=p_bucket;
  if p_bucket not in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media')
    or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
    or bucket_limit is null or p_bytes is null or p_bytes<1 or p_bytes>least(bucket_limit,20971520)
  then perform app_private.fail('invalid_media'); end if;
  parent_id:=app_private.uuid_or_null(split_part(p_path,'/',1));
  if parent_id is null then perform app_private.fail('invalid_media'); end if;
  if p_bucket in ('avatars','profile-photos','feedback-media') and parent_id<>v then perform app_private.fail('forbidden'); end if;
  if p_bucket='server-avatars' and not app_private.has_server_role(parent_id,v,'admin') then perform app_private.fail('forbidden'); end if;
  if p_bucket='activity-media' and not app_private.is_active_member(parent_id,v) then perform app_private.fail('forbidden'); end if;
  if p_bucket='chat-media' and not app_private.can_send_message(parent_id,v) then perform app_private.fail('forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext('media:user:'||v::text));
  if p_bucket in ('activity-media','server-avatars') then
    perform pg_advisory_xact_lock(hashtext('media:server:'||parent_id::text));
  end if;
  select coalesce(sum(greatest(coalesce(actual_bytes,reserved_bytes),reserved_bytes)),0) into used_bytes
  from app_private.media_uploads where owner_id=v and status in ('reserved','uploaded','attached');
  if used_bytes+p_bytes>209715200 then perform app_private.fail('media_quota_exceeded'); end if;
  if p_bucket in ('activity-media','server-avatars') then
    select coalesce(sum(greatest(coalesce(actual_bytes,reserved_bytes),reserved_bytes)),0) into used_bytes
    from app_private.media_uploads where bucket in ('activity-media','server-avatars')
      and split_part(path,'/',1)=parent_id::text and status in ('reserved','uploaded','attached');
    if used_bytes+p_bytes>524288000 then perform app_private.fail('server_media_quota_exceeded'); end if;
  end if;
  insert into app_private.media_uploads(bucket,path,owner_id,reserved_bytes)
    values(p_bucket,p_path,v,p_bytes);
exception when unique_violation then perform app_private.fail('media_path_taken');
end $$;

create or replace function app_private.has_upload_reservation(p_bucket text,p_path text,p_user uuid,p_size bigint)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from app_private.media_uploads r where r.bucket=p_bucket and r.path=p_path
    and r.owner_id=p_user and r.status='reserved' and r.created_at>now()-interval '30 minutes'
    and (p_size is null or p_size<=r.reserved_bytes));
$$;

-- A restrictive policy composes with the existing per-bucket owner/member policies.
create policy media_reservation_required on storage.objects as restrictive for insert to authenticated
with check(bucket_id not in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media')
  or app_private.has_upload_reservation(bucket_id,name,(select auth.uid()),(metadata->>'size')::bigint));

create or replace function app_private.media_object_changed()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    update app_private.media_uploads set status='deleted' where bucket=old.bucket_id and path=old.name;
  elsif new.bucket_id in ('avatars','profile-photos','server-avatars','activity-media','chat-media','feedback-media') then
    update app_private.media_uploads set status=case when status='attached' then 'attached' else 'uploaded' end,
      actual_bytes=coalesce((new.metadata->>'size')::bigint,actual_bytes,reserved_bytes)
    where bucket=new.bucket_id and path=new.name and status in ('reserved','uploaded','attached');
  end if;
  return null;
end $$;
create trigger media_object_changed after insert or update of metadata or delete on storage.objects
for each row execute function app_private.media_object_changed();

create or replace function app_private.media_reference_exists(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case p_bucket
    when 'avatars' then exists(select 1 from public.profiles where avatar_path=p_path)
    when 'profile-photos' then exists(select 1 from public.profile_photos where storage_path=p_path)
    when 'server-avatars' then exists(select 1 from public.servers where avatar_path=p_path)
    when 'activity-media' then exists(select 1 from public.activity_posts where image_path=p_path)
      or exists(select 1 from public.activity_post_images where storage_path=p_path)
    when 'chat-media' then exists(select 1 from public.messages where media_path=p_path)
    else false end;
$$;

create or replace function public.finalize_media_upload(p_bucket text,p_path text)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false); r app_private.media_uploads;
begin
  select * into r from app_private.media_uploads where bucket=p_bucket and path=p_path and owner_id=v for update;
  if not found or not app_private.media_reference_exists(p_bucket,p_path) then perform app_private.fail('invalid_media'); end if;
  update app_private.media_uploads set status='attached',attached_at=coalesce(attached_at,now())
    where bucket=p_bucket and path=p_path;
end $$;

-- Replace/clear avatar references even if the mobile client is interrupted before deleting old media.
create or replace function app_private.queue_replaced_avatar()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' and old.avatar_path is not null then
    insert into app_private.storage_deletions(bucket,path)
      values(case when tg_table_name='profiles' then 'avatars' else 'server-avatars' end,old.avatar_path);
  elsif tg_op='UPDATE' and old.avatar_path is not null and old.avatar_path is distinct from new.avatar_path then
    insert into app_private.storage_deletions(bucket,path)
      values(case when tg_table_name='profiles' then 'avatars' else 'server-avatars' end,old.avatar_path);
  end if;
  return null;
end $$;
create trigger profile_avatar_cleanup after update of avatar_path or delete on public.profiles
for each row execute function app_private.queue_replaced_avatar();
create trigger server_avatar_cleanup after update of avatar_path or delete on public.servers
for each row execute function app_private.queue_replaced_avatar();

alter table app_private.storage_deletions add column status text not null default 'pending'
  check(status in ('pending','leased')),
  add column next_attempt_at timestamptz not null default now(),
  add column lease_until timestamptz,
  add column last_error text;
create index storage_deletions_ready on app_private.storage_deletions(next_attempt_at)
  where status in ('pending','leased');

create or replace function public.claim_storage_deletions(p_limit integer default 100)
returns table(id bigint,bucket text,path text)
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
  return query with picked as (
    select d.id from app_private.storage_deletions d
    where (d.status='pending' and d.next_attempt_at<=now())
       or (d.status='leased' and d.lease_until<now())
    order by d.next_attempt_at,d.id for update skip locked limit least(greatest(p_limit,1),200)
  )
  update app_private.storage_deletions d set status='leased',lease_until=now()+interval '90 seconds',attempts=d.attempts+1
  from picked where d.id=picked.id returning d.id,d.bucket,d.path;
end $$;
create or replace function public.fail_storage_deletions(p_ids bigint[],p_error text)
returns void language sql security definer set search_path=public,pg_temp as $$
  update app_private.storage_deletions set status='pending',lease_until=null,last_error=left(p_error,100),
    next_attempt_at=now()+make_interval(secs=>least(3600,(2^least(attempts,9))::integer*5))
  where id=any(p_ids) and status='leased';
$$;

create or replace function public.sweep_orphan_media(p_limit integer default 200)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r app_private.media_uploads; n integer:=0;
begin
  for r in select * from app_private.media_uploads
    where status in ('reserved','uploaded') and created_at<now()-interval '2 hours'
    order by created_at for update skip locked limit least(greatest(p_limit,1),200)
  loop
    if app_private.media_reference_exists(r.bucket,r.path) then
      update app_private.media_uploads set status='attached',attached_at=now()
        where bucket=r.bucket and path=r.path;
    else
      if exists(select 1 from storage.objects where bucket_id=r.bucket and name=r.path) then
        insert into app_private.storage_deletions(bucket,path) values(r.bucket,r.path);
      end if;
      update app_private.media_uploads set status='abandoned' where bucket=r.bucket and path=r.path;
    end if;
    n:=n+1;
  end loop;
  return n;
end $$;

create or replace function app_private.run_maintenance_campus_media()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare base jsonb:=app_private.run_maintenance_v2(); swept integer;
begin
  swept:=public.sweep_orphan_media(200);
  if swept>0 then perform app_private.call_function('media-cleanup','{}'::jsonb); end if;
  return base||jsonb_build_object('media_swept',swept);
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function public.claim_storage_deletions(integer),public.complete_storage_deletions(bigint[]),
  public.fail_storage_deletions(bigint[],text),public.sweep_orphan_media(integer) from authenticated;
grant execute on function public.reserve_media_upload(text,text,bigint),public.finalize_media_upload(text,text)
  to authenticated;
grant execute on function app_private.has_upload_reservation(text,text,uuid,bigint) to authenticated;
grant execute on function public.claim_storage_deletions(integer),public.complete_storage_deletions(bigint[]),
  public.fail_storage_deletions(bigint[],text),public.sweep_orphan_media(integer) to service_role;
revoke execute on function app_private.run_maintenance_campus_media() from authenticated;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule('sniffin-maintenance');
    perform cron.schedule('sniffin-maintenance','*/5 * * * *',
      'select app_private.run_maintenance_campus_media()');
  end if;
exception when others then raise notice 'Media maintenance schedule skipped: %',sqlerrm;
end $$;
