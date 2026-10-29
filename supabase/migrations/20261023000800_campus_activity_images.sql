-- First image remains in activity_posts.image_path for old clients; additional
-- ordered images are separate metadata pointing to private object storage.
create table public.activity_post_images (
  post_id uuid not null references public.activity_posts(id) on delete cascade,
  position smallint not null check(position between 2 and 6),
  storage_path text not null unique check(char_length(storage_path)<=200),
  primary key(post_id,position)
);
create index activity_post_images_post on public.activity_post_images(post_id);
alter table public.activity_post_images enable row level security;
revoke all on public.activity_post_images from anon,authenticated;
grant all on public.activity_post_images to service_role;

create or replace function app_private.queue_activity_extra_image()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.activity_posts where image_path=old.storage_path) then
    insert into app_private.storage_deletions(bucket,path) values('activity-media',old.storage_path);
  end if;
  return old;
end $$;
create trigger activity_extra_image_cleanup after delete on public.activity_post_images
  for each row execute function app_private.queue_activity_extra_image();

create or replace function app_private.set_post_extra_images(p_post_id uuid,p_paths text[])
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  v uuid:=app_private.require_user(); p public.activity_posts; path text; n integer;
begin
  select * into p from public.activity_posts where id=p_post_id for update;
  if not found or p.author_id<>v or p.status<>'active' then perform app_private.fail('forbidden'); end if;
  if coalesce(array_length(p_paths,1),0)>5 then perform app_private.fail('too_many_images'); end if;
  if exists(select 1 from unnest(coalesce(p_paths,'{}'::text[])) x group by x having count(*)>1) then
    perform app_private.fail('duplicate_image');
  end if;
  foreach path in array coalesce(p_paths,'{}'::text[]) loop
    perform app_private.check_post_image(p.server_id,path);
    if path is null or not exists(select 1 from storage.objects o
      where o.bucket_id='activity-media' and o.name=path and o.owner=v) then
      perform app_private.fail('missing_upload');
    end if;
  end loop;
  delete from public.activity_post_images
    where post_id=p_post_id and not(storage_path=any(coalesce(p_paths,'{}'::text[])));
  for n in 1..coalesce(array_length(p_paths,1),0) loop
    update public.activity_post_images set position=n+1
      where post_id=p_post_id and storage_path=p_paths[n];
    if not found then
      insert into public.activity_post_images(post_id,position,storage_path)
        values(p_post_id,n+1,p_paths[n]);
    end if;
  end loop;
end $$;

create or replace function public.create_activity_with_images(
  p_server_id uuid,p_body text,p_category text default 'social',p_expires_hours integer default null,
  p_capacity integer default null,p_image_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare post_id uuid;
begin
  if coalesce(array_length(p_image_paths,1),0)>6 then perform app_private.fail('too_many_images'); end if;
  post_id:=public.create_activity_post(p_server_id,p_body,p_category,p_expires_hours,p_capacity,p_image_paths[1]);
  perform app_private.set_post_extra_images(post_id,p_image_paths[2:6]);
  return post_id;
end $$;

create or replace function public.update_activity_with_images(
  p_post_id uuid,p_body text,p_category text,p_expires_hours integer,
  p_capacity integer,p_image_paths text[])
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if coalesce(array_length(p_image_paths,1),0)>6 then perform app_private.fail('too_many_images'); end if;
  perform public.update_activity_post(p_post_id,p_body,p_category,p_expires_hours,p_capacity,
    p_image_paths[1],coalesce(array_length(p_image_paths,1),0)=0);
  perform app_private.set_post_extra_images(p_post_id,p_image_paths[2:6]);
end $$;

create or replace function public.get_activity_images(p_post_ids uuid[])
returns table(post_id uuid,storage_path text,image_position smallint)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user();
begin
  return query
  select p.id,p.image_path,1::smallint from public.activity_posts p
  where p.id=any(p_post_ids[1:50]) and p.image_path is not null
    and app_private.is_active_member(p.server_id,v) and app_private.post_visible(p,v)
  union all
  select p.id,i.storage_path,i.position from public.activity_post_images i
    join public.activity_posts p on p.id=i.post_id
  where p.id=any(p_post_ids[1:50]) and app_private.is_active_member(p.server_id,v)
    and app_private.post_visible(p,v)
  order by post_id,image_position;
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.create_activity_with_images(uuid,text,text,integer,integer,text[]),
  public.update_activity_with_images(uuid,text,text,integer,integer,text[]),
  public.get_activity_images(uuid[]) to authenticated;
