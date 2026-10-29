-- Version 3.1 UI redesign: progressive onboarding fields, profile visibility,
-- Instagram-style chat notes, and safe available-person discovery.

alter table public.profiles
  add column if not exists height_cm smallint check (height_cm between 90 and 250),
  add column if not exists education_level text check (education_level is null or education_level in ('school','diploma','undergraduate','postgraduate','doctorate','prefer_not_to_say')),
  add column if not exists school_name text check (char_length(school_name) <= 120),
  add column if not exists workplace text check (char_length(workplace) <= 120),
  add column if not exists job_title text check (char_length(job_title) <= 100),
  add column if not exists hometown text check (char_length(hometown) <= 100),
  add column if not exists relationship_status text check (relationship_status is null or relationship_status in ('single','in_a_relationship','married','it_s_complicated','prefer_not_to_say')),
  add column if not exists drinking text check (drinking is null or drinking in ('never','sometimes','socially','regularly','prefer_not_to_say')),
  add column if not exists smoking text check (smoking is null or smoking in ('never','sometimes','socially','regularly','prefer_not_to_say'));

alter table public.profile_private
  add column if not exists talk_to_genders public.gender_identity[] not null
    default array['woman','man','nonbinary']::public.gender_identity[];

alter table public.user_settings
  add column if not exists height_visibility public.field_visibility not null default 'members',
  add column if not exists hometown_visibility public.field_visibility not null default 'members',
  add column if not exists relationship_visibility public.field_visibility not null default 'connections',
  add column if not exists lifestyle_visibility public.field_visibility not null default 'connections';

grant update(height_cm,education_level,school_name,workplace,job_title,hometown,relationship_status,drinking,smoking)
  on public.profiles to authenticated;
grant update(talk_to_genders) on public.profile_private to authenticated;
grant update(height_visibility,hometown_visibility,relationship_visibility,lifestyle_visibility)
  on public.user_settings to authenticated;

alter table public.profile_prompt_answers drop constraint if exists profile_prompt_answers_prompt_key_check;
alter table public.profile_prompt_answers add constraint profile_prompt_answers_prompt_key_check
  check (prompt_key ~ '^[a-z0-9_]{2,60}$');

create or replace function public.set_profile_prompt(p_key text,p_answer text)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false);
begin
  if p_key is null or p_key !~ '^[a-z0-9_]{2,60}$' then perform app_private.fail('invalid_prompt'); end if;
  if p_answer is null or btrim(p_answer)='' then
    delete from public.profile_prompt_answers where user_id=v and prompt_key=p_key;
  else
    if char_length(btrim(p_answer)) not between 3 and 240 then perform app_private.fail('invalid_answer'); end if;
    if not exists(select 1 from public.profile_prompt_answers where user_id=v and prompt_key=p_key)
       and (select count(*) from public.profile_prompt_answers where user_id=v)>=3 then
      perform app_private.fail('too_many_prompts','Choose up to 3 prompts');
    end if;
    insert into public.profile_prompt_answers(user_id,prompt_key,answer) values(v,p_key,btrim(p_answer))
      on conflict(user_id,prompt_key) do update set answer=excluded.answer,updated_at=now();
  end if;
end $$;

-- Photos and a prompt are collected before complete_onboarding_profile marks the profile onboarded.
-- Keep media reservations limited to the two profile buckets until onboarding is complete.
create or replace function public.reserve_media_upload(p_bucket text,p_path text,p_bytes bigint)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false); parent_id uuid; bucket_limit bigint; used_bytes bigint; is_onboarded boolean;
begin
  select onboarded_at is not null into is_onboarded from public.profiles where id=v;
  if not is_onboarded and p_bucket not in ('avatars','profile-photos') then perform app_private.fail('onboarding_required'); end if;
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
  if p_bucket in ('activity-media','server-avatars') then perform pg_advisory_xact_lock(hashtext('media:server:'||parent_id::text)); end if;
  select coalesce(sum(greatest(coalesce(actual_bytes,reserved_bytes),reserved_bytes)),0) into used_bytes
    from app_private.media_uploads where owner_id=v and status in ('reserved','uploaded','attached');
  if used_bytes+p_bytes>209715200 then perform app_private.fail('media_quota_exceeded'); end if;
  if p_bucket in ('activity-media','server-avatars') then
    select coalesce(sum(greatest(coalesce(actual_bytes,reserved_bytes),reserved_bytes)),0) into used_bytes
      from app_private.media_uploads where bucket in ('activity-media','server-avatars')
      and split_part(path,'/',1)=parent_id::text and status in ('reserved','uploaded','attached');
    if used_bytes+p_bytes>524288000 then perform app_private.fail('server_media_quota_exceeded'); end if;
  end if;
  insert into app_private.media_uploads(bucket,path,owner_id,reserved_bytes) values(p_bucket,p_path,v,p_bytes);
exception when unique_violation then perform app_private.fail('media_path_taken');
end $$;

create or replace function public.add_profile_photo(p_path text,p_position integer default null)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false); new_id uuid; slot integer;
begin
  perform app_private.rate_limit('profile_photo',30,interval '1 day');
  if p_path is null or split_part(p_path,'/',1)<>v::text or p_path like '%-thumb.jpg' then perform app_private.fail('invalid_photo'); end if;
  if not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path and owner=v) then
    perform app_private.fail('missing_upload','The photo did not finish uploading. Please try again.');
  end if;
  perform pg_advisory_xact_lock(hashtext('profile_photos:'||v::text));
  select min(g) into slot from generate_series(1,6) g
    where not exists(select 1 from public.profile_photos where user_id=v and position=g);
  if slot is null then perform app_private.fail('too_many_photos','You can add up to 6 extra photos.'); end if;
  insert into public.profile_photos(user_id,storage_path,position) values(v,p_path,slot)
    on conflict(storage_path) do update set storage_path=excluded.storage_path returning id into new_id;
  return new_id;
end $$;

create or replace function public.complete_onboarding_profile(p_payload jsonb)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(false); genders public.gender_identity[];
begin
  if jsonb_typeof(p_payload)<>'object' then perform app_private.fail('invalid_profile'); end if;
  select coalesce(array_agg(x::public.gender_identity),'{}'::public.gender_identity[]) into genders
    from jsonb_array_elements_text(coalesce(p_payload->'talk_to_genders','[]'::jsonb)) x
    where x in ('woman','man','nonbinary');
  if cardinality(genders)=0 then perform app_private.fail('conversation_preference_required'); end if;

  perform public.complete_onboarding(
    p_payload->>'username', p_payload->>'display_name', (p_payload->>'date_of_birth')::date,
    nullif(p_payload->>'gender','')::public.gender_identity,
    coalesce(nullif(p_payload->>'discovery_audience','')::public.discovery_audience,'everyone'));

  update public.profiles set
    height_cm=nullif(p_payload->>'height_cm','')::smallint,
    education_level=nullif(p_payload->>'education_level',''), school_name=nullif(btrim(p_payload->>'school_name'),''),
    workplace=nullif(btrim(p_payload->>'workplace'),''), job_title=nullif(btrim(p_payload->>'job_title'),''),
    hometown=nullif(btrim(p_payload->>'hometown'),''), relationship_status=nullif(p_payload->>'relationship_status',''),
    drinking=nullif(p_payload->>'drinking',''), smoking=nullif(p_payload->>'smoking',''),
    university=coalesce(nullif(btrim(p_payload->>'school_name'),''),university),
    occupation=coalesce(nullif(btrim(concat_ws(' at ',nullif(p_payload->>'job_title',''),nullif(p_payload->>'workplace',''))),''),occupation)
    where id=v;
  update public.profile_private set talk_to_genders=genders where user_id=v;
  update public.user_settings set
    height_visibility=coalesce(nullif(p_payload#>>'{visibility,height}','')::public.field_visibility,height_visibility),
    education_visibility=coalesce(nullif(p_payload#>>'{visibility,education}','')::public.field_visibility,education_visibility),
    occupation_visibility=coalesce(nullif(p_payload#>>'{visibility,occupation}','')::public.field_visibility,occupation_visibility),
    hometown_visibility=coalesce(nullif(p_payload#>>'{visibility,hometown}','')::public.field_visibility,hometown_visibility),
    relationship_visibility=coalesce(nullif(p_payload#>>'{visibility,relationship}','')::public.field_visibility,relationship_visibility),
    lifestyle_visibility=coalesce(nullif(p_payload#>>'{visibility,lifestyle}','')::public.field_visibility,lifestyle_visibility)
    where user_id=v;
end $$;

create or replace function app_private.onboarding_details_json(v uuid,target uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.profiles; s public.user_settings; connected boolean; shared boolean;
begin
  select * into p from public.profiles where id=target; select * into s from public.user_settings where user_id=target;
  connected:=v=target or exists(select 1 from public.connections c where c.status='active' and c.user_a=least(v,target) and c.user_b=greatest(v,target));
  shared:=v=target or exists(select 1 from public.server_members a join public.server_members b using(server_id)
    join public.servers srv on srv.id=a.server_id where a.user_id=v and b.user_id=target and a.status='active' and b.status='active'
      and not srv.is_archived and (srv.kind<>'short_term' or srv.ends_at>now()));
  return jsonb_build_object(
    'connection_count',(select count(*) from public.connections c where c.status='active'
      and target in(c.user_a,c.user_b) and (c.expires_at is null or c.expires_at>now())),
    'height_cm',case when v=target or s.height_visibility='members' and shared or s.height_visibility='connections' and connected then p.height_cm end,
    'education_level',case when v=target or s.education_visibility='members' and shared or s.education_visibility='connections' and connected then p.education_level end,
    'school_name',case when v=target or s.education_visibility='members' and shared or s.education_visibility='connections' and connected then p.school_name end,
    'workplace',case when v=target or s.occupation_visibility='members' and shared or s.occupation_visibility='connections' and connected then p.workplace end,
    'job_title',case when v=target or s.occupation_visibility='members' and shared or s.occupation_visibility='connections' and connected then p.job_title end,
    'hometown',case when v=target or s.hometown_visibility='members' and shared or s.hometown_visibility='connections' and connected then p.hometown end,
    'relationship_status',case when v=target or s.relationship_visibility='members' and shared or s.relationship_visibility='connections' and connected then p.relationship_status end,
    'drinking',case when v=target or s.lifestyle_visibility='members' and shared or s.lifestyle_visibility='connections' and connected then p.drinking end,
    'smoking',case when v=target or s.lifestyle_visibility='members' and shared or s.lifestyle_visibility='connections' and connected then p.smoking end);
end $$;

create or replace function public.get_profile(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.profile_json(app_private.require_user(false),p_user_id)
    || app_private.onboarding_details_json(app_private.require_user(false),p_user_id);
$$;
create or replace function public.get_profile_in_server(p_user_id uuid,p_server_id uuid)
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.profile_json_in_server(app_private.require_user(false),p_user_id,p_server_id)
    || app_private.onboarding_details_json(app_private.require_user(false),p_user_id);
$$;
create or replace function public.preview_my_profile()
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.profile_json_render(app_private.require_user(false),app_private.require_user(false),true)
    || app_private.onboarding_details_json(app_private.require_user(false),app_private.require_user(false));
$$;

create table public.chat_notes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  body text check (body is null or char_length(btrim(body)) between 1 and 80),
  song_title text check (song_title is null or char_length(song_title) <= 100),
  song_artist text check (song_artist is null or char_length(song_artist) <= 100),
  song_url text check (song_url is null or char_length(song_url) <= 300),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (body is not null or song_title is not null)
);
create index chat_notes_active on public.chat_notes(expires_at) where expires_at is not null;
alter table public.chat_notes enable row level security;
create policy chat_notes_own on public.chat_notes for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update,delete on public.chat_notes to authenticated;

create or replace function public.set_chat_note(p_body text,p_song_title text default null,p_song_artist text default null,p_song_url text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid:=app_private.require_user();
begin
  perform app_private.rate_limit('chat_note',30,interval '1 day');
  if nullif(btrim(coalesce(p_body,'')),'') is null and nullif(btrim(coalesce(p_song_title,'')),'') is null then perform app_private.fail('empty_note'); end if;
  insert into public.chat_notes(user_id,body,song_title,song_artist,song_url,expires_at,updated_at)
    values(v,nullif(btrim(p_body),''),nullif(btrim(p_song_title),''),nullif(btrim(p_song_artist),''),nullif(btrim(p_song_url),''),now()+interval '24 hours',now())
    on conflict(user_id) do update set body=excluded.body,song_title=excluded.song_title,song_artist=excluded.song_artist,
      song_url=excluded.song_url,expires_at=excluded.expires_at,updated_at=now();
end $$;
create or replace function public.clear_chat_note() returns void language sql security definer set search_path=public,pg_temp as $$ delete from public.chat_notes where user_id=auth.uid() $$;
create or replace function public.list_chat_notes()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with v as (select app_private.require_user(false) id), allowed as (
    select v.id user_id from v union
    select case when c.user_a=v.id then c.user_b else c.user_a end from public.connections c,v
      where c.status='active' and v.id in(c.user_a,c.user_b) and (c.expires_at is null or c.expires_at>now()))
  select coalesce(jsonb_agg(jsonb_build_object('user',app_private.mini_card(n.user_id),'body',n.body,'song_title',n.song_title,
    'song_artist',n.song_artist,'song_url',n.song_url,'expires_at',n.expires_at) order by (n.user_id=(select id from v)) desc,n.updated_at desc),'[]'::jsonb)
  from public.chat_notes n join allowed a using(user_id) where n.expires_at>now();
$$;

create or replace function public.available_people_for_chat(p_limit integer default 30)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with v as (select app_private.require_user(false) id), candidates as (
    select distinct on(p.id) p.id,sm.server_id,s.name server_name
    from v join public.server_members mine on mine.user_id=v.id and mine.status='active'
    join public.server_members sm on sm.server_id=mine.server_id and sm.status='active' and sm.discoverable
    join public.servers s on s.id=sm.server_id and not s.is_archived and (s.kind<>'short_term' or s.ends_at>now())
    join public.profiles p on p.id=sm.user_id and p.id<>v.id and p.account_status='active' and p.onboarded_at is not null
    join public.presence pr on pr.user_id=p.id and pr.is_available
    join public.profile_private pp on pp.user_id=p.id
    join public.profile_private vp on vp.user_id=v.id
    where not app_private.is_blocked_between(v.id,p.id) and app_private.audience_compatible(v.id,p.id)
      and (pp.gender is null or pp.gender=any(vp.talk_to_genders))
      and (vp.gender is null or vp.gender=any(pp.talk_to_genders))
      and not exists(select 1 from public.connections c where c.status='active' and c.user_a=least(v.id,p.id) and c.user_b=greatest(v.id,p.id))
    order by p.id,s.kind='short_term' desc,s.name)
  select coalesce(jsonb_agg(jsonb_build_object('user',app_private.mini_card(c.id),'server_id',c.server_id,'server_name',c.server_name,
    'request_state',case when r.sender_id=(select id from v) then 'outgoing' when r.recipient_id=(select id from v) then 'incoming' else 'none' end)),'[]'::jsonb)
  from (select * from candidates limit least(greatest(p_limit,1),50)) c
  left join public.connection_requests r on r.status='pending' and least(r.sender_id,r.recipient_id)=least((select id from v),c.id)
    and greatest(r.sender_id,r.recipient_id)=greatest((select id from v),c.id);
$$;

revoke execute on all functions in schema public from public,anon;
revoke execute on function app_private.onboarding_details_json(uuid,uuid) from authenticated;
grant execute on function public.complete_onboarding_profile(jsonb),public.set_profile_prompt(text,text),public.get_profile(uuid),
  public.get_profile_in_server(uuid,uuid),public.preview_my_profile(),public.set_chat_note(text,text,text,text),public.clear_chat_note(),
  public.list_chat_notes(),public.available_people_for_chat(integer),public.reserve_media_upload(text,text,bigint),
  public.add_profile_photo(text,integer) to authenticated;

-- Permanent-Server discovery follows the compact Available switch. Open to Talk remains a venue-only intent.
create or replace function public.discover_available_people(p_server_id uuid,p_limit integer default 20,p_offset integer default 0)
returns table(user_id uuid,username text,display_name text,avatar_path text,occupation text,university text,craving text,
  shared_tags text[],reasons text[],badges jsonb,score numeric,request_state text)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(); viewer_talk public.gender_identity[];
begin
  if not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden','Join this Server to discover people here'); end if;
  if not app_private.server_is_live(p_server_id) then perform app_private.fail('server_closed','This Server has ended'); end if;
  if not exists(select 1 from public.presence where user_id=v and is_available) then perform app_private.fail('not_available','Go Available to discover people'); end if;
  if not (select sm.discoverable from public.server_members sm where sm.server_id=p_server_id and sm.user_id=v) then perform app_private.fail('not_available'); end if;
  select talk_to_genders into viewer_talk from public.profile_private where user_id=v;
  return query
  with candidates as (
    select p.id,p.username::text uname,p.display_name,p.avatar_path,p.occupation,p.university,p.last_active_at,
      st.occupation_visibility occ_vis,st.education_visibility edu_vis,st.craving_visibility craving_vis,
      coalesce((select array_agg(distinct t.name::text order by t.name::text)
        from public.profile_tags mine join public.tags mt on mt.id=mine.tag_id
        join public.tags t on lower(t.name::text)=lower(mt.name::text)
        join public.profile_tags theirs on theirs.tag_id=t.id and theirs.user_id=p.id
        where mine.user_id=v and (mt.kind=t.kind or (mt.kind<>'language' and t.kind<>'language'))),'{}') shared
    from public.server_members m join public.profiles p on p.id=m.user_id and p.account_status='active' and p.onboarded_at is not null
    join public.presence pr on pr.user_id=p.id and pr.is_available
    join public.profile_private pp on pp.user_id=p.id
    join public.profile_private vp on vp.user_id=v
    join public.user_settings st on st.user_id=p.id
    where m.server_id=p_server_id and m.status='active' and m.discoverable and p.id<>v
      and (pp.gender is null or pp.gender=any(viewer_talk)) and (vp.gender is null or vp.gender=any(pp.talk_to_genders))
      and app_private.audience_compatible(v,p.id) and not app_private.is_blocked_between(v,p.id)
      and not exists(select 1 from public.connections c where c.status='active' and c.user_a=least(v,p.id) and c.user_b=greatest(v,p.id))
      and not exists(select 1 from public.discovery_dismissals d where d.viewer_id=v and d.target_id=p.id and d.until>now())
  ), ranked as (
    select c.*,cardinality(c.shared)*3 + case when c.last_active_at>now()-interval '15 minutes' then 1 else 0 end total
    from candidates c order by total desc,last_active_at desc nulls last,id limit least(greatest(p_limit,1),30) offset greatest(p_offset,0))
  select r.id,r.uname,r.display_name,r.avatar_path,
    case when r.occ_vis='members' then r.occupation end,
    case when r.edu_vis='members' then r.university end,
    case when r.craving_vis='members' then (select c.body from public.cravings c where c.user_id=r.id and c.expires_at>now() and (c.server_id is null or c.server_id=p_server_id)) end,
    r.shared[1:6],array_remove(array[case when cardinality(r.shared)>0 then 'You both like '||array_to_string(r.shared[1:3],', ') end],null),
    coalesce((select jsonb_agg(jsonb_build_object('label',b.label,'kind',b.kind,'is_official',s.is_official)) from public.server_badges b join public.servers s on s.id=b.server_id where b.user_id=r.id and b.server_id=p_server_id and b.status='active' and (b.expires_at is null or b.expires_at>now())),'[]'::jsonb),
    r.total::numeric,case when cr.sender_id=v then 'outgoing' when cr.recipient_id=v then 'incoming' else 'none' end
  from ranked r left join public.connection_requests cr on cr.status='pending' and least(cr.sender_id,cr.recipient_id)=least(v,r.id) and greatest(cr.sender_id,cr.recipient_id)=greatest(v,r.id)
  order by r.total desc,r.last_active_at desc nulls last,r.id;
end $$;
revoke execute on function public.discover_available_people(uuid,integer,integer) from public,anon;
grant execute on function public.discover_available_people(uuid,integer,integer) to authenticated;
