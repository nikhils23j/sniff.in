-- Optional enrichment lives outside onboarding. A viewer sees a section only when
-- the owner selected it in at least one currently shared Server.

create table public.profile_prompt_answers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  prompt_key text not null check (prompt_key in ('weekend','teach_me','small_joy','ideal_coffee','currently_learning','ask_me_about')),
  answer text not null check (char_length(btrim(answer)) between 3 and 240),
  updated_at timestamptz not null default now(),
  primary key(user_id,prompt_key)
);
alter table public.profile_prompt_answers enable row level security;
create policy prompt_answers_own on public.profile_prompt_answers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select,insert,update,delete on public.profile_prompt_answers to authenticated;
grant all on public.profile_prompt_answers to service_role;

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 200),
  position smallint not null check (position between 1 and 6),
  created_at timestamptz not null default now(),
  unique(user_id,position)
);
create index profile_photos_user on public.profile_photos(user_id,position);
alter table public.profile_photos enable row level security;
create policy profile_photos_own on public.profile_photos for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.profile_photos to authenticated;
grant all on public.profile_photos to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
create policy profile_photos_write on storage.objects for insert to authenticated
  with check(bucket_id='profile-photos' and owner=(select auth.uid())
    and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_photos_delete on storage.objects for delete to authenticated
  using(bucket_id='profile-photos' and owner=(select auth.uid()));

create or replace function app_private.context_allowed(viewer uuid, target uuid, section text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select viewer = target or app_private.is_platform_admin(viewer) or exists(
    select 1 from public.server_members owner_m
    join public.server_members viewer_m on viewer_m.server_id=owner_m.server_id
      and viewer_m.user_id=viewer and viewer_m.status='active'
    join public.servers s on s.id=owner_m.server_id
    where owner_m.user_id=target and owner_m.status='active'
      and not s.is_archived and (s.kind <> 'short_term' or s.ends_at>now())
      and owner_m.profile_mode in (section,'both'));
$$;

create policy profile_photos_read on storage.objects for select to authenticated
  using(bucket_id='profile-photos'
    and app_private.can_view_profile((select auth.uid()),app_private.uuid_or_null((storage.foldername(name))[1]))
    and app_private.context_allowed((select auth.uid()),app_private.uuid_or_null((storage.foldername(name))[1]),'personal'));

create or replace function public.add_profile_photo(p_path text,p_position integer)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); new_id uuid;
begin
  perform app_private.rate_limit('profile_photo',20,interval '1 day');
  if p_position not between 1 and 6 or split_part(p_path,'/',1)<>v::text then
    perform app_private.fail('invalid_photo');
  end if;
  if not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path and owner=v) then
    perform app_private.fail('missing_upload');
  end if;
  insert into public.profile_photos(user_id,storage_path,position)
    values(v,p_path,p_position) returning id into new_id;
  return new_id;
end $$;

create or replace function public.remove_profile_photo(p_photo_id uuid)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); old_path text;
begin
  delete from public.profile_photos where id=p_photo_id and user_id=v returning storage_path into old_path;
  if old_path is null then perform app_private.fail('not_found'); end if;
  insert into app_private.storage_deletions(bucket,path) values('profile-photos',old_path);
end $$;

create or replace function public.set_profile_prompt(p_key text,p_answer text)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user();
begin
  if p_key not in ('weekend','teach_me','small_joy','ideal_coffee','currently_learning','ask_me_about') then
    perform app_private.fail('invalid_prompt');
  end if;
  if p_answer is null or btrim(p_answer)='' then
    delete from public.profile_prompt_answers where user_id=v and prompt_key=p_key;
  else
    insert into public.profile_prompt_answers(user_id,prompt_key,answer)
      values(v,p_key,btrim(p_answer))
    on conflict(user_id,prompt_key) do update set answer=excluded.answer,updated_at=now();
  end if;
end $$;

create or replace function public.resolve_profile_handle(p_handle text)
returns uuid language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false); target uuid;
begin
  if p_handle is null or lower(p_handle) !~ '^[a-z0-9_]{3,20}$' then return null; end if;
  select id into target from public.profiles where username=lower(p_handle)::extensions.citext;
  if target is null or not app_private.can_view_profile(v,target) then return null; end if;
  return target;
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.add_profile_photo(text,integer),public.remove_profile_photo(uuid),
  public.set_profile_prompt(text,text),public.resolve_profile_handle(text) to authenticated;
grant execute on function app_private.context_allowed(uuid,uuid,text) to authenticated;
