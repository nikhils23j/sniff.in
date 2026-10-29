-- Audience-level profile privacy. Field-level controls remain as an additional restriction.
alter table public.user_settings
  add column if not exists connected_audience text not null default 'both'
    check(connected_audience in ('personal','professional','both')),
  add column if not exists unconnected_audience text not null default 'both'
    check(unconnected_audience in ('personal','professional','both'));
grant update(connected_audience,unconnected_audience) on public.user_settings to authenticated;

create or replace function app_private.profile_audience_mode(viewer uuid,target uuid,preview boolean default false)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select case when viewer=target and not preview then 'both'
    when not preview and exists(select 1 from public.connections c where c.status='active'
      and c.user_a=least(viewer,target) and c.user_b=greatest(viewer,target)
      and (c.expires_at is null or c.expires_at>now()))
      then coalesce(st.connected_audience,'both')
    else coalesce(st.unconnected_audience,'both') end
  from public.user_settings st where st.user_id=target;
$$;

create or replace function app_private.audience_allows(viewer uuid,target uuid,section text,preview boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(app_private.profile_audience_mode(viewer,target,preview),'both') in (section,'both');
$$;

create or replace function app_private.apply_audience_visibility(profile jsonb,viewer uuid,target uuid,preview boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare mode text:=coalesce(app_private.profile_audience_mode(viewer,target,preview),'both'); result jsonb:=profile; filtered jsonb;
begin
  if mode='personal' then
    result:=result||jsonb_build_object(
      'university',null,'occupation',null,'career_goals',null,'professional_bio',null,
      'work_experience',null,'professional_interests',null,'website_url',null,'linkedin_url',null,
      'education_level',null,'school_name',null,'workplace',null,'job_title',null,
      'affiliations','[]'::jsonb,'endorsements','[]'::jsonb);
    select coalesce(jsonb_agg(item),'[]'::jsonb) into filtered
      from jsonb_array_elements(coalesce(result->'tags','[]'::jsonb)) item
      where item->>'kind' in ('interest','hobby','language');
    result:=result||jsonb_build_object('tags',filtered,'shared_tags','[]'::jsonb);
  elsif mode='professional' then
    result:=result||jsonb_build_object(
      'bio',null,'social_preferences',null,'instagram_handle',null,'spotify_url',null,
      'craving',null,'prompt_answers','[]'::jsonb,'photos','[]'::jsonb,
      'height_cm',null,'hometown',null,'relationship_status',null,'drinking',null,'smoking',null);
    select coalesce(jsonb_agg(item),'[]'::jsonb) into filtered
      from jsonb_array_elements(coalesce(result->'tags','[]'::jsonb)) item
      where item->>'kind' in ('skill','career');
    result:=result||jsonb_build_object('tags',filtered,'shared_tags','[]'::jsonb);
  end if;
  -- Retired lifestyle answers are never returned, even if they remain in old rows.
  return result||jsonb_build_object('drinking',null,'smoking',null);
end $$;

-- The existing image policy calls this helper. Respect audience choice there too,
-- so a guessed storage path cannot reveal a hidden personal photo.
create or replace function app_private.context_allowed(viewer uuid,target uuid,section text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select app_private.audience_allows(viewer,target,section) and (
    viewer=target or app_private.is_platform_admin(viewer) or exists(
      select 1 from public.server_members owner_m
      join public.server_members viewer_m on viewer_m.server_id=owner_m.server_id
        and viewer_m.user_id=viewer and viewer_m.status='active'
      join public.servers s on s.id=owner_m.server_id
      where owner_m.user_id=target and owner_m.status='active' and not s.is_archived
        and (s.kind<>'short_term' or s.ends_at>now())
        and owner_m.profile_mode in (section,'both')));
$$;

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

  return app_private.apply_audience_visibility(jsonb_build_object(
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
    'photos',case when p_public or v=p.id or app_private.context_allowed(v,p.id,'personal') then coalesce((
        select jsonb_agg(jsonb_build_object('id',ph.id,'storage_path',ph.storage_path,'position',ph.position) order by ph.position)
        from public.profile_photos ph where ph.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end,
    'available',app_private.is_available(p.id),
    'relationship',rel),v,p.id,p_public);
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
  return app_private.apply_audience_visibility(jsonb_build_object(
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
    'smoking',null),v,target,false);
end $$;

create or replace function public.preview_my_profile()
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.apply_audience_visibility(
    app_private.profile_json_render(app_private.require_user(false),app_private.require_user(false),true)
    || app_private.onboarding_details_json(app_private.require_user(false),app_private.require_user(false)),
    app_private.require_user(false),app_private.require_user(false),true);
$$;

-- Discovery cards obey the same audience choices as full profiles.
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
        where mine.user_id=v and app_private.audience_allows(v,p.id,case when t.kind in ('interest','hobby','language') then 'personal' else 'professional' end) and (mt.kind=t.kind or (mt.kind<>'language' and t.kind<>'language'))),'{}') shared
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
    case when r.occ_vis='members' and app_private.audience_allows(v,r.id,'professional') then r.occupation end,
    case when r.edu_vis='members' and app_private.audience_allows(v,r.id,'professional') then r.university end,
    case when r.craving_vis='members' and app_private.audience_allows(v,r.id,'personal') then (select c.body from public.cravings c where c.user_id=r.id and c.expires_at>now() and (c.server_id is null or c.server_id=p_server_id)) end,
    r.shared[1:6],array_remove(array[case when cardinality(r.shared)>0 then 'You both like '||array_to_string(r.shared[1:3],', ') end],null),
    coalesce((select jsonb_agg(jsonb_build_object('label',b.label,'kind',b.kind,'is_official',s.is_official)) from public.server_badges b join public.servers s on s.id=b.server_id where b.user_id=r.id and b.server_id=p_server_id and b.status='active' and (b.expires_at is null or b.expires_at>now())),'[]'::jsonb),
    r.total::numeric,case when cr.sender_id=v then 'outgoing' when cr.recipient_id=v then 'incoming' else 'none' end
  from ranked r left join public.connection_requests cr on cr.status='pending' and least(cr.sender_id,cr.recipient_id)=least(v,r.id) and greatest(cr.sender_id,cr.recipient_id)=greatest(v,r.id)
  order by r.total desc,r.last_active_at desc nulls last,r.id;
end $$;
create or replace function public.talk_matches(p_limit integer default 5)
returns table (
  user_id uuid, username text, display_name text, avatar_path text, occupation text, university text,
  talk_topic text, shared_server_id uuid, shared_server_name text, shared_tags text[], reasons text[],
  score numeric, request_state text)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  v uuid := app_private.require_user();
  my_topic text;
  my_topic_vec extensions.vector;
  my_profile_vec extensions.vector;
  v_gender public.gender_identity;
  v_audience public.discovery_audience;
  ai_on boolean;
begin
  if not app_private.is_open_to_talk(v) then
    perform app_private.fail('not_open_to_talk', 'Turn on Open to Talk to see people to meet');
  end if;
  select lower(pr.talk_topic), pr.talk_embedding into my_topic, my_topic_vec from public.presence pr where pr.user_id = v;
  select pp.gender, coalesce(pp.discovery_audience, 'everyone') into v_gender, v_audience
    from public.profile_private pp where pp.user_id = v;
  v_audience := coalesce(v_audience, 'everyone');
  ai_on := exists (select 1 from public.feature_flags f where f.key = 'semantic_matching' and f.enabled)
       and exists (select 1 from public.user_settings us where us.user_id = v and us.ai_features_consent);
  if ai_on then
    select pe.embedding into my_profile_vec from public.profile_embeddings pe where pe.user_id = v;
    my_topic_vec := coalesce(my_topic_vec, my_profile_vec);
  end if;

  return query
  with shared_servers as (
    -- Name and id must come from the SAME Server (largest shared one, ties by id).
    select tm.user_id as uid,
           (array_agg(s.name order by s.member_count desc, s.id))[1] as server_name,
           (array_agg(s.id order by s.member_count desc, s.id))[1] as server_id
    from public.server_members vm
    join public.servers s on s.id = vm.server_id and not s.is_archived and (s.kind <> 'short_term' or s.ends_at > now())
    join public.server_members tm on tm.server_id = vm.server_id and tm.status = 'active' and tm.discoverable and tm.user_id <> v
    where vm.user_id = v and vm.status = 'active' and vm.discoverable
    group by tm.user_id
  ),
  eligible as (
    select ss.uid, ss.server_id, ss.server_name
    from shared_servers ss
    join public.presence pr on pr.user_id = ss.uid and pr.is_available and pr.open_to_talk and pr.talk_expires_at > now()
    join public.profiles p on p.id = ss.uid and p.account_status = 'active' and p.onboarded_at is not null
                          and coalesce(p.last_active_at, p.created_at) > now() - interval '14 days'
    left join public.profile_private pp on pp.user_id = ss.uid
    where (v_audience = 'everyone' or (v_gender is not null and pp.gender = v_gender))
      and (coalesce(pp.discovery_audience, 'everyone') = 'everyone' or (pp.gender is not null and pp.gender = v_gender))
      and not exists (select 1 from public.blocks b where (b.blocker_id = v and b.blocked_id = ss.uid) or (b.blocker_id = ss.uid and b.blocked_id = v))
      and not exists (select 1 from public.connections c where c.user_a = least(v, ss.uid) and c.user_b = greatest(v, ss.uid) and c.status = 'active')
      and not exists (select 1 from public.discovery_dismissals d where d.viewer_id = v and d.target_id = ss.uid and d.until > now())
      and not exists (select 1 from public.interaction_feedback f where f.rater_id = v and f.subject_id = ss.uid and f.rating = -1)
    limit 1000
  ),
  cand as (
    select e.uid, e.server_id, e.server_name, p.username::text as username, p.display_name, p.avatar_path, p.last_active_at,
           case when st.occupation_visibility = 'members' and app_private.audience_allows(v,p.id,'professional') then p.occupation end as occupation,
           case when st.education_visibility = 'members' and app_private.audience_allows(v,p.id,'professional') then p.university end as university,
           case when st.bio_visibility = 'members' and app_private.audience_allows(v,p.id,'personal') then p.bio end as bio,
           case when app_private.audience_allows(v,p.id,'personal') then pr.talk_topic end as talk_topic, pr.talk_embedding,
           st.tags_visibility = 'members' as tags_ok,
           st.ai_features_consent as ai_ok
    from eligible e
    join public.profiles p on p.id = e.uid
    join public.user_settings st on st.user_id = e.uid
    join public.presence pr on pr.user_id = e.uid
  ),
  my_tags as (
    select t.id, t.kind, t.name from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = v
  ),
  shared as (
    select distinct on (c.uid, lower(t.name::text)) c.uid, t.kind, t.name::text as name
    from cand c
    join public.profile_tags a on a.user_id = c.uid and c.tags_ok
    join public.tags t on t.id = a.tag_id
    join my_tags mt on app_private.audience_allows(v,c.uid,case when t.kind in ('interest','hobby','language') then 'personal' else 'professional' end) and mt.name = t.name and (mt.kind = t.kind or (t.kind <> 'language' and mt.kind <> 'language'))
    order by c.uid, lower(t.name::text), t.kind
  ),
  shared_agg as (
    select sh.uid, array_agg(sh.name order by sh.name) as names,
           sum(case sh.kind when 'language' then 1 when 'skill' then 2 else 3 end)::numeric as tag_score
    from shared sh group by sh.uid
  ),
  topic_hits as (
    select c.uid,
      -- my topic mentions one of their tags
      (select t.name::text from public.profile_tags pt join public.tags t on t.id = pt.tag_id
        where my_topic is not null and pt.user_id = c.uid and c.tags_ok and app_private.audience_allows(v,c.uid,case when t.kind in ('interest','hobby','language') then 'personal' else 'professional' end) and char_length(t.name::text) >= 3
          and my_topic like '%' || lower(t.name::text) || '%' limit 1) as mine_hits_them,
      -- their topic mentions one of my tags
      (select mt.name::text from my_tags mt
        where c.talk_topic is not null and char_length(mt.name::text) >= 3
          and lower(c.talk_topic) like '%' || lower(mt.name::text) || '%' limit 1) as theirs_hits_me,
      case when my_topic is not null and c.talk_topic is not null
           then extensions.word_similarity(my_topic, lower(c.talk_topic)) else 0 end as topic_sim
    from cand c
  ),
  semantic as (
    select c.uid, greatest(
      coalesce(1 - (my_topic_vec <=> c.talk_embedding), 0),
      coalesce(1 - (my_topic_vec <=> pe.embedding), 0),
      coalesce(1 - (my_profile_vec <=> pe.embedding), 0)) as sim
    from cand c
    left join public.profile_embeddings pe on pe.user_id = c.uid
    where ai_on and c.ai_ok
  ),
  ranked as (
    select c.*, coalesce(sa.names, '{}') as shared_names, th.mine_hits_them, th.theirs_hits_me, th.topic_sim, sm.sim,
      coalesce(sa.tag_score, 0)
        + case when th.mine_hits_them is not null then 5 else 0 end
        + case when th.theirs_hits_me is not null then 5 else 0 end
        + 6 * coalesce(th.topic_sim, 0)
        + coalesce(8 * greatest(sm.sim - 0.2, 0) / 0.8, 0)
        + case when c.last_active_at > now() - interval '30 minutes' then 0.5 else 0 end as total
    from cand c
    left join shared_agg sa on sa.uid = c.uid
    left join topic_hits th on th.uid = c.uid
    left join semantic sm on sm.uid = c.uid
    order by total desc, c.last_active_at desc nulls last, c.uid
    limit least(greatest(p_limit, 1), 5)
  )
  select r.uid, r.username, r.display_name, r.avatar_path, r.occupation, r.university, r.talk_topic,
    r.server_id, r.server_name, r.shared_names[1:6],
    array_remove(array[
      case when cardinality(r.shared_names) > 0 then 'You both like ' || array_to_string(r.shared_names[1:3], ', ') end,
      case when r.mine_hits_them is not null then 'They''re into ' || r.mine_hits_them || ', which you want to talk about' end,
      case when r.theirs_hits_me is not null then 'They want to talk about ' || r.theirs_hits_me || ', which you''re into' end,
      case when r.topic_sim >= 0.35 then 'You want to talk about similar things' end,
      case when r.sim is not null and r.sim > 0.75 then 'Similar interests overall' end,
      'You''re both in ' || r.server_name
    ], null),
    round(r.total::numeric, 2),
    case
      when exists (select 1 from public.connection_requests q where q.status = 'pending' and q.sender_id = v and q.recipient_id = r.uid) then 'outgoing'
      when exists (select 1 from public.connection_requests q where q.status = 'pending' and q.sender_id = r.uid and q.recipient_id = v) then 'incoming'
      else 'none' end
  from ranked r
  order by r.total desc, r.last_active_at desc nulls last, r.uid;
end $$;
create or replace function public.discover_people(p_server_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (
  user_id uuid, username text, display_name text, avatar_path text,
  occupation text, university text, craving text, shared_tags text[], reasons text[],
  badges jsonb, score numeric, request_state text)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  v uuid := app_private.require_user();
  v_univ text;
  v_craving text;
  v_gender public.gender_identity;
  v_audience public.discovery_audience;
  v_has_vec boolean;
  semantic_on boolean;
begin
  if not app_private.is_active_member(p_server_id, v) then
    perform app_private.fail('forbidden', 'Join this Server to discover people here');
  end if;
  if not app_private.server_is_live(p_server_id) then
    perform app_private.fail('server_closed', 'This Server has ended');
  end if;
  -- Reciprocity: only people who are visible themselves can look around.
  if not app_private.is_open_to_talk(v) then
    perform app_private.fail('not_open_to_talk', 'Turn on Open to Talk to see people to meet');
  end if;
  if not (select sm.discoverable from public.server_members sm where sm.server_id = p_server_id and sm.user_id = v) then
    perform app_private.fail('not_available', 'You''re hidden in this Server. Turn on visibility here to look around.');
  end if;

  select lower(btrim(pr.university)) into v_univ from public.profiles pr where pr.id = v;
  select pp.gender, pp.discovery_audience into v_gender, v_audience from public.profile_private pp where pp.user_id = v;
  v_audience := coalesce(v_audience, 'everyone');
  select lower(c.body) into v_craving from public.cravings c
    where c.user_id = v and c.expires_at > now() and (c.server_id is null or c.server_id = p_server_id);
  semantic_on := exists (select 1 from public.feature_flags f where f.key = 'semantic_matching' and f.enabled)
             and exists (select 1 from public.user_settings us where us.user_id = v and us.ai_features_consent);
  v_has_vec := semantic_on and exists (select 1 from public.profile_embeddings pe where pe.user_id = v);

  return query
  -- ---------------------------------------------------------------- stage 1: eligibility (set-based)
  with eligible as (
    select m.user_id as uid
    from public.server_members m
    join public.presence pr on pr.user_id = m.user_id and pr.is_available and pr.open_to_talk and pr.talk_expires_at > now()
    join public.profiles p on p.id = m.user_id and p.account_status = 'active' and p.onboarded_at is not null
                          and coalesce(p.last_active_at, p.created_at) > now() - interval '14 days'
    left join public.profile_private pp on pp.user_id = m.user_id
    where m.server_id = p_server_id and m.status = 'active' and m.discoverable and m.user_id <> v
      -- symmetric safety filter (same semantics as app_private.audience_compatible)
      and (v_audience = 'everyone' or (v_gender is not null and pp.gender = v_gender))
      and (coalesce(pp.discovery_audience, 'everyone') = 'everyone' or (pp.gender is not null and pp.gender = v_gender))
      and not exists (select 1 from public.blocks b
                      where (b.blocker_id = v and b.blocked_id = m.user_id) or (b.blocker_id = m.user_id and b.blocked_id = v))
      and not exists (select 1 from public.connections c
                      where c.user_a = least(v, m.user_id) and c.user_b = greatest(v, m.user_id) and c.status = 'active')
      and not exists (select 1 from public.discovery_dismissals d where d.viewer_id = v and d.target_id = m.user_id and d.until > now())
      and not exists (select 1 from public.interaction_feedback f where f.rater_id = v and f.subject_id = m.user_id and f.rating = -1)
    limit 1000  -- bounded candidate set per request
  ),
  cand as (
    select e.uid, p.username::text as username, p.display_name, p.avatar_path, p.last_active_at,
           case when st.occupation_visibility = 'members' and app_private.audience_allows(v,p.id,'professional') then p.occupation end as occupation,
           case when st.education_visibility = 'members' and app_private.audience_allows(v,p.id,'professional') then p.university end as university,
           case when st.craving_visibility = 'members' and app_private.audience_allows(v,p.id,'personal') then cr.body end as craving,
           st.tags_visibility = 'members' as tags_ok,
           st.ai_features_consent as ai_ok
    from eligible e
    join public.profiles p on p.id = e.uid
    join public.user_settings st on st.user_id = e.uid
    left join public.cravings cr on cr.user_id = e.uid and cr.expires_at > now()
                                 and (cr.server_id is null or cr.server_id = p_server_id)
  ),
  -- ---------------------------------------------------------------- stage 2: ranking signals
  my_tags as (
    select t.id, t.kind, t.name from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = v
  ),
  -- Same name matches across interest/hobby/skill/career ("Badminton" as interest ≈ as hobby);
  -- languages only match languages.
  shared as (
    select distinct on (c.uid, lower(t.name::text)) c.uid, t.kind, t.name::text as name
    from cand c
    join public.profile_tags a on a.user_id = c.uid and c.tags_ok
    join public.tags t on t.id = a.tag_id
    join my_tags mt on app_private.audience_allows(v,c.uid,case when t.kind in ('interest','hobby','language') then 'personal' else 'professional' end) and mt.name = t.name and (mt.kind = t.kind or (t.kind <> 'language' and mt.kind <> 'language'))
    order by c.uid, lower(t.name::text), t.kind
  ),
  shared_agg as (
    select sh.uid,
           array_agg(sh.name order by case sh.kind when 'interest' then 1 when 'career' then 2 when 'hobby' then 3 when 'skill' then 4 else 5 end, sh.name) as names,
           sum(case sh.kind when 'interest' then 3 when 'hobby' then 3 when 'career' then 3 when 'skill' then 2 else 1 end)::numeric as tag_score,
           count(*) filter (where sh.kind = 'language') as lang_n
    from shared sh group by sh.uid
  ),
  -- Craving ↔ tags: their craving mentions something I have, or my craving mentions something they have.
  craving_hits as (
    select c.uid,
      (select mt.name::text from my_tags mt
        where c.craving is not null and char_length(mt.name::text) >= 3
          and lower(c.craving) like '%' || lower(mt.name::text) || '%' limit 1) as theirs_matches_me,
      (select t.name::text from public.profile_tags pt join public.tags t on t.id = pt.tag_id
        where v_craving is not null and pt.user_id = c.uid and c.tags_ok and app_private.audience_allows(v,c.uid,case when t.kind in ('interest','hobby','language') then 'personal' else 'professional' end) and char_length(t.name::text) >= 3
          and v_craving like '%' || lower(t.name::text) || '%' limit 1) as mine_matches_them
    from cand c
    where c.craving is not null or v_craving is not null
  ),
  semantic as (
    select c.uid, 1 - (me.embedding <=> pe.embedding) as sim
    from cand c
    join public.profile_embeddings pe on pe.user_id = c.uid and c.ai_ok
    cross join (select pe2.embedding from public.profile_embeddings pe2 where pe2.user_id = v) me
    where v_has_vec
  ),
  positive as (
    select f.subject_id as uid, count(*) as n
    from public.interaction_feedback f join cand c on c.uid = f.subject_id
    where f.rating = 1
    group by f.subject_id
  ),
  ranked as (
    select c.*,
      coalesce(sa.names, '{}') as shared_names,
      coalesce(sa.tag_score, 0)
        - greatest(coalesce(sa.lang_n, 0) - 2, 0)  -- languages count, but cap their contribution
        + case when v_univ is not null and c.university is not null and lower(btrim(c.university)) = v_univ then 4 else 0 end
        + case when ch.theirs_matches_me is not null then 4 else 0 end
        + case when ch.mine_matches_them is not null then 4 else 0 end
        + coalesce(8 * greatest(sm.sim - 0.2, 0) / 0.8, 0)
        + case when c.last_active_at > now() - interval '15 minutes' then 0.5 else 0 end
        + least(coalesce(po.n, 0) / 3, 1) * 1.0
      as total,
      ch.theirs_matches_me, ch.mine_matches_them, sm.sim
    from cand c
    left join shared_agg sa on sa.uid = c.uid
    left join craving_hits ch on ch.uid = c.uid
    left join semantic sm on sm.uid = c.uid
    left join positive po on po.uid = c.uid
    order by total desc, c.last_active_at desc nulls last, c.uid
    limit least(greatest(p_limit, 1), 30) offset greatest(p_offset, 0)
  )
  -- ---------------------------------------------------------------- presentation (page only)
  select sc.uid, sc.username, sc.display_name, sc.avatar_path, sc.occupation, sc.university, sc.craving,
    sc.shared_names[1:6],
    array_remove(array[
      case when cardinality(sc.shared_names) > 0 then 'You both like ' || array_to_string(sc.shared_names[1:3], ', ') end,
      case when v_univ is not null and sc.university is not null and lower(btrim(sc.university)) = v_univ then 'Both from ' || sc.university end,
      case when sc.theirs_matches_me is not null then 'Their craving matches your ' || sc.theirs_matches_me end,
      case when sc.mine_matches_them is not null then 'They have ' || sc.mine_matches_them || ', which you''re looking for' end,
      case when sc.sim is not null and sc.sim > 0.75 then 'Similar overall vibe' end
    ], null),
    coalesce((select jsonb_agg(jsonb_build_object('label', b.label, 'kind', b.kind, 'is_official', sv.is_official))
              from public.server_badges b join public.servers sv on sv.id = b.server_id
              join public.user_settings bs on bs.user_id = b.user_id and bs.badges_visibility = 'members'
              where b.user_id = sc.uid and b.server_id = p_server_id and b.status = 'active'
                and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb),
    round(sc.total::numeric, 2),
    case
      when exists (select 1 from public.connection_requests r where r.status = 'pending' and r.sender_id = v and r.recipient_id = sc.uid) then 'outgoing'
      when exists (select 1 from public.connection_requests r where r.status = 'pending' and r.sender_id = sc.uid and r.recipient_id = v) then 'incoming'
      else 'none' end
  from ranked sc
  order by sc.total desc, sc.last_active_at desc nulls last, sc.uid;
end $$;
