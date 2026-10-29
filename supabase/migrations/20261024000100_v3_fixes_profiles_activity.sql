-- V3.1 fixes found by replaying every read RPC over upgraded V2 data.
--  * get_activity_images: ORDER BY referenced names that don't exist in the UNION output (every Activity load failed).
--  * set_post_extra_images: re-ordering images collided on the (post_id, position) key.
--  * profile_json_in_server: parameter `server_id` was ambiguous with the column (every in-Server profile failed,
--    and the comparison `server_id = server_id` would have matched any row).
--  * Profiles become one universal view: personal and professional sections are both shown to anyone allowed to see
--    the profile. Per-field privacy settings (members / connections / only me) still apply.
--  * Members of the same live permanent Server can open each other's profile from the member directory.

-- ------------------------------------------------------------------ activity images
create or replace function public.get_activity_images(p_post_ids uuid[])
returns table(post_id uuid,storage_path text,image_position smallint)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user();
begin
  return query
  select x.pid,x.spath,x.pos from (
    select p.id as pid,p.image_path as spath,1::smallint as pos from public.activity_posts p
    where p.id=any(p_post_ids[1:50]) and p.image_path is not null
      and app_private.is_active_member(p.server_id,v) and app_private.post_visible(p,v)
    union all
    select p.id,i.storage_path,i.position from public.activity_post_images i
      join public.activity_posts p on p.id=i.post_id
    where p.id=any(p_post_ids[1:50]) and app_private.is_active_member(p.server_id,v)
      and app_private.post_visible(p,v)
  ) x
  order by x.pid,x.pos;
end $$;

-- Re-ordering moves rows through positions that are temporarily taken; check uniqueness at commit.
alter table public.activity_post_images drop constraint activity_post_images_pkey;
alter table public.activity_post_images add constraint activity_post_images_pkey
  primary key(post_id,position) deferrable initially deferred;

-- ------------------------------------------------------------------ profiles
-- Shared-membership rule for profile media and directory profiles: both active in a live Server, not blocked.
create or replace function app_private.share_live_server(a uuid,b uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.server_members ma
    join public.server_members mb on mb.server_id=ma.server_id and mb.user_id=b and mb.status='active'
    join public.servers s on s.id=ma.server_id
    where ma.user_id=a and ma.status='active' and not s.is_archived
      and (s.kind<>'short_term' or s.ends_at>now()));
$$;

create or replace function app_private.can_view_profile_media(viewer uuid,target uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select viewer is not null and target is not null and (viewer=target
    or app_private.can_view_profile(viewer,target)
    or (app_private.share_live_server(viewer,target)
        and not app_private.is_blocked_between(viewer,target)
        and exists(select 1 from public.profiles where id=target and account_status='active')));
$$;

-- One renderer. p_public = owner preview "as any member who isn't connected to me".
create or replace function app_private.profile_json_render(p_viewer_id uuid,p_user_id uuid,p_public boolean)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare
  v uuid:=p_viewer_id;
  p public.profiles;
  st public.user_settings;
  rel jsonb;
  conn public.connections;
  req public.connection_requests;
  conv_id uuid;
  show_bio boolean; show_edu boolean; show_occ boolean; show_goals boolean; show_tags boolean;
  show_socials boolean; show_craving boolean; show_badges boolean; show_endorse boolean;
begin
  select * into p from public.profiles where id=p_user_id;
  if p.id is null then perform app_private.fail('not_found','This profile is not available'); end if;
  select * into st from public.user_settings where user_id=p_user_id;

  if p_public then
    show_bio:=coalesce(st.bio_visibility,'members')='members';
    show_edu:=coalesce(st.education_visibility,'members')='members';
    show_occ:=coalesce(st.occupation_visibility,'members')='members';
    show_goals:=coalesce(st.career_goals_visibility,'members')='members';
    show_tags:=coalesce(st.tags_visibility,'members')='members';
    show_socials:=coalesce(st.socials_visibility,'connections')='members';
    show_craving:=coalesce(st.craving_visibility,'members')='members';
    show_badges:=coalesce(st.badges_visibility,'members')='members';
    show_endorse:=coalesce(st.endorsements_visibility,'members')='members';
  elsif v=p_user_id then
    show_bio:=true; show_edu:=true; show_occ:=true; show_goals:=true; show_tags:=true;
    show_socials:=true; show_craving:=true; show_badges:=true; show_endorse:=true;
  else
    -- 'members' means anyone who can see the profile at all (already checked by the caller).
    show_bio:=coalesce(st.bio_visibility,'members')='members' or app_private.visible_to(v,p.id,st.bio_visibility);
    show_edu:=coalesce(st.education_visibility,'members')='members' or app_private.visible_to(v,p.id,st.education_visibility);
    show_occ:=coalesce(st.occupation_visibility,'members')='members' or app_private.visible_to(v,p.id,st.occupation_visibility);
    show_goals:=coalesce(st.career_goals_visibility,'members')='members' or app_private.visible_to(v,p.id,st.career_goals_visibility);
    show_tags:=coalesce(st.tags_visibility,'members')='members' or app_private.visible_to(v,p.id,st.tags_visibility);
    show_socials:=coalesce(st.socials_visibility,'connections')='members' or app_private.visible_to(v,p.id,st.socials_visibility);
    show_craving:=coalesce(st.craving_visibility,'members')='members' or app_private.visible_to(v,p.id,st.craving_visibility);
    show_badges:=coalesce(st.badges_visibility,'members')='members' or app_private.visible_to(v,p.id,st.badges_visibility);
    show_endorse:=coalesce(st.endorsements_visibility,'members')='members' or app_private.visible_to(v,p.id,st.endorsements_visibility);
  end if;

  if not p_public and v<>p_user_id then
    select * into conn from public.connections
      where user_a=least(v,p_user_id) and user_b=greatest(v,p_user_id) and status='active';
    select * into req from public.connection_requests
      where status='pending' and ((sender_id=v and recipient_id=p_user_id) or (sender_id=p_user_id and recipient_id=v));
    select id into conv_id from public.conversations where connection_id=conn.id;
  end if;
  rel:=jsonb_build_object(
    'state',case when p_public then 'none'
                 when v=p_user_id then 'self'
                 when conn.id is not null then 'connected'
                 when req.sender_id=v then 'pending_outgoing'
                 when req.recipient_id=v then 'pending_incoming'
                 else 'none' end,
    'request_id',req.id,'connection_id',conn.id,'conversation_id',conv_id,
    'is_friend',coalesce(conn.a_saved and conn.b_saved,false));

  return jsonb_build_object(
    'id',p.id,'username',p.username::text,'display_name',p.display_name,'avatar_path',p.avatar_path,
    'bio',case when show_bio then p.bio end,
    'social_preferences',case when show_bio then p.social_preferences end,
    'university',case when show_edu then p.university end,
    'occupation',case when show_occ then p.occupation end,
    'career_goals',case when show_goals then p.career_goals end,
    'professional_bio',case when show_bio then p.professional_bio end,
    'work_experience',case when show_occ then p.work_experience end,
    'professional_interests',case when show_goals then p.professional_interests end,
    'website_url',case when show_socials then p.website_url end,
    'instagram_handle',case when show_socials then p.instagram_handle end,
    'linkedin_url',case when show_socials then p.linkedin_url end,
    'spotify_url',case when show_socials then p.spotify_url end,
    'socials_hidden',not show_socials
      and (p.website_url is not null or p.instagram_handle is not null or p.linkedin_url is not null or p.spotify_url is not null),
    'tags',case when show_tags then coalesce((
        select jsonb_agg(jsonb_build_object('kind',t.kind,'name',t.name::text) order by t.kind,t.name)
        from public.profile_tags pt join public.tags t on t.id=pt.tag_id where pt.user_id=p.id),'[]'::jsonb)
      else '[]'::jsonb end,
    'shared_tags',case when not p_public and v<>p.id and show_tags then coalesce((
        select jsonb_agg(distinct t.name::text)
        from public.profile_tags a join public.tags t on t.id=a.tag_id
        join public.tags t2 on t2.name=t.name and (t2.kind=t.kind or (t.kind<>'language' and t2.kind<>'language'))
        join public.profile_tags b on b.tag_id=t2.id and b.user_id=v
        where a.user_id=p.id),'[]'::jsonb)
      else '[]'::jsonb end,
    'craving',case when show_craving then (
        select jsonb_build_object('body',c.body,'expires_at',c.expires_at,'server_id',c.server_id,
                                  'server_name',(select name from public.servers where id=c.server_id))
        from public.cravings c
        where c.user_id=p.id and c.expires_at>now()
          and (c.server_id is null or v=p.id or p_public or app_private.is_active_member(c.server_id,v))) end,
    'badges',case when show_badges then coalesce((
        select jsonb_agg(jsonb_build_object('id',b.id,'kind',b.kind,'label',b.label,'issued_at',b.issued_at,
                                            'expires_at',b.expires_at,'server_id',s.id,'server_name',s.name,
                                            'server_is_official',s.is_official) order by s.is_official desc,b.issued_at)
        from public.server_badges b join public.servers s on s.id=b.server_id
        where b.user_id=p.id and b.status='active' and s.kind='long_term'
          and (v=p.id or (app_private.is_active_member(s.id,v) and app_private.is_active_member(s.id,p.id)))
          and (b.expires_at is null or b.expires_at>now())),'[]'::jsonb)
      else '[]'::jsonb end,
    'affiliations',case when show_badges then coalesce((
        select jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'org_name',a.org_name,'domain',a.domain,
                                            'org_name_source',a.org_name_source,'verified_at',a.verified_at) order by a.verified_at desc)
        from public.verified_affiliations a where a.user_id=p.id and (a.expires_at is null or a.expires_at>now())),'[]'::jsonb)
      else '[]'::jsonb end,
    'endorsements',case when show_endorse then coalesce((
        select jsonb_agg(jsonb_build_object('id',e.id,'body',e.body,'created_at',e.created_at,
                                            'author',app_private.mini_card(e.author_id)) order by e.created_at desc)
        from public.endorsements e
        where e.subject_id=p.id and e.status='approved'
          and (p_public or not app_private.is_blocked_between(v,e.author_id))),'[]'::jsonb)
      else '[]'::jsonb end,
    'prompt_answers',case when show_bio then coalesce((
        select jsonb_agg(jsonb_build_object('prompt_key',q.prompt_key,'answer',q.answer) order by q.updated_at desc)
        from public.profile_prompt_answers q where q.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end,
    'photos',coalesce((
        select jsonb_agg(jsonb_build_object('id',ph.id,'storage_path',ph.storage_path,'position',ph.position) order by ph.position)
        from public.profile_photos ph where ph.user_id=p.id),'[]'::jsonb),
    'available',app_private.is_available(p.id),
    'relationship',rel);
end $$;

create or replace function app_private.profile_json(p_viewer_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
begin
  if not app_private.can_view_profile(p_viewer_id,p_user_id) then
    perform app_private.fail('not_found','This profile is not available');
  end if;
  return app_private.profile_json_render(p_viewer_id,p_user_id,false);
end $$;

-- Profile opened from a Server (member directory, venue people): the universal profile plus that Server's context.
-- The old helper is dropped because Postgres can't rename its ambiguous `server_id` parameter in place.
drop function if exists app_private.profile_json_in_server(uuid,uuid,uuid) cascade;
create or replace function app_private.profile_json_in_server(p_viewer uuid,p_target uuid,p_server uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare s public.servers; m public.server_members; vs public.venue_sessions; result jsonb; allowed boolean;
begin
  select * into s from public.servers where id=p_server;
  if s.id is null or not app_private.is_active_member(p_server,p_viewer)
     or not app_private.is_active_member(p_server,p_target) then
    perform app_private.fail('not_found','This profile is not available');
  end if;
  select * into m from public.server_members where server_id=p_server and user_id=p_target;
  select * into vs from public.venue_sessions where server_id=p_server and user_id=p_target and ends_at>now();
  allowed:=p_viewer=p_target or app_private.can_view_profile(p_viewer,p_target) or (
    app_private.server_is_live(p_server)
    and not app_private.is_blocked_between(p_viewer,p_target)
    and exists(select 1 from public.profiles where id=p_target and account_status='active' and onboarded_at is not null)
    and (s.kind='long_term' or coalesce(vs.open_to_talk,false)));
  if not allowed then perform app_private.fail('not_found','This profile is not available'); end if;
  result:=app_private.profile_json_render(p_viewer,p_target,false);
  result:=result||jsonb_build_object('server_context',jsonb_build_object(
    'server_id',s.id,'server_name',s.name,'kind',s.kind,'role',m.role,'member_note',m.member_note,
    'member_field_label',s.member_field_label,'joined_at',m.created_at));
  if vs.server_id is not null and vs.open_to_talk then
    result:=result||jsonb_build_object('venue_topic',vs.topic,'venue_location_hint',vs.location_hint,
      'venue_expires_at',vs.ends_at);
  end if;
  return result;
end $$;

create or replace function public.get_profile_in_server(p_user_id uuid,p_server_id uuid)
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.profile_json_in_server(app_private.require_user(false),p_user_id,p_server_id);
$$;

create or replace function public.preview_profile_in_server(p_viewer_id uuid,p_server_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare owner_id uuid:=app_private.require_user(false);
begin
  if p_viewer_id is null or p_viewer_id=owner_id then perform app_private.fail('invalid_viewer'); end if;
  return app_private.profile_json_in_server(p_viewer_id,owner_id,p_server_id);
end $$;

-- What any member who isn't connected to you sees (the universal profile).
create or replace function public.preview_my_profile()
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.profile_json_render(app_private.require_user(false),app_private.require_user(false),true);
$$;

-- Extra photos follow the profile (no more personal/professional gating).
drop policy if exists profile_photos_read on storage.objects;
create policy profile_photos_read on storage.objects for select to authenticated
  using(bucket_id='profile-photos'
    and app_private.can_view_profile_media((select auth.uid()),app_private.uuid_or_null((storage.foldername(name))[1])));

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id='avatars' and (
    (storage.foldername(name))[1]=(select auth.uid())::text
    or app_private.can_view_profile_media((select auth.uid()),app_private.uuid_or_null((storage.foldername(name))[1]))));

-- Photo slots: the server picks the first free position, so removing a middle photo never blocks the next upload.
create or replace function public.add_profile_photo(p_path text,p_position integer default null)
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); new_id uuid; slot integer;
begin
  perform app_private.rate_limit('profile_photo',30,interval '1 day');
  if p_path is null or split_part(p_path,'/',1)<>v::text or p_path like '%-thumb.jpg' then
    perform app_private.fail('invalid_photo');
  end if;
  if not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path and owner=v) then
    perform app_private.fail('missing_upload','The photo did not finish uploading. Please try again.');
  end if;
  perform pg_advisory_xact_lock(hashtext('profile_photos:'||v::text));
  select min(g) into slot from generate_series(1,6) g
    where not exists(select 1 from public.profile_photos where user_id=v and position=g);
  if slot is null then perform app_private.fail('too_many_photos','You can add up to 6 extra photos.'); end if;
  insert into public.profile_photos(user_id,storage_path,position) values(v,p_path,slot)
    on conflict(storage_path) do update set storage_path=excluded.storage_path
    returning id into new_id;
  return new_id;
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function app_private.profile_json_render(uuid,uuid,boolean),
  app_private.profile_json_in_server(uuid,uuid,uuid) from authenticated;
grant execute on function app_private.can_view_profile_media(uuid,uuid),app_private.share_live_server(uuid,uuid)
  to authenticated;
grant execute on function public.get_activity_images(uuid[]),public.get_profile_in_server(uuid,uuid),
  public.preview_profile_in_server(uuid,uuid),public.preview_my_profile(),public.add_profile_photo(text,integer)
  to authenticated;

-- ------------------------------------------------------------------ media deletion safety
-- An image that moved from an activity cover into the extras (or back) is queued by the cover trigger before it is
-- re-attached. Never hand the cleaner a file that is still referenced; drop such queue rows instead.
create or replace function public.claim_storage_deletions(p_limit integer default 100)
returns table(id bigint,bucket text,path text)
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
  delete from app_private.storage_deletions d
  where d.id in (
    select x.id from app_private.storage_deletions x
    where ((x.status='pending' and x.next_attempt_at<=now()) or (x.status='leased' and x.lease_until<now()))
      and app_private.media_reference_exists(x.bucket,x.path)
    order by x.next_attempt_at,x.id limit 500 for update skip locked);
  return query with picked as (
    select d.id from app_private.storage_deletions d
    where (d.status='pending' and d.next_attempt_at<=now())
       or (d.status='leased' and d.lease_until<now())
    order by d.next_attempt_at,d.id for update skip locked limit least(greatest(p_limit,1),200)
  )
  update app_private.storage_deletions d set status='leased',lease_until=now()+interval '90 seconds',attempts=d.attempts+1
  from picked where d.id=picked.id returning d.id,d.bucket,d.path;
end $$;

-- Feedback screenshots can be removed by their owner before submitting.
drop policy if exists feedback_media_delete on storage.objects;
create policy feedback_media_delete on storage.objects for delete to authenticated
  using(bucket_id='feedback-media' and owner=(select auth.uid()));

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function public.claim_storage_deletions(integer) from authenticated;
