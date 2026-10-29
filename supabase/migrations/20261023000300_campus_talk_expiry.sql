-- Expiry must be checked by every reader, not only by the UI/heartbeat.
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
           case when st.occupation_visibility = 'members' then p.occupation end as occupation,
           case when st.education_visibility = 'members' then p.university end as university,
           case when st.bio_visibility = 'members' then p.bio end as bio,
           pr.talk_topic, pr.talk_embedding,
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
    join my_tags mt on mt.name = t.name and (mt.kind = t.kind or (t.kind <> 'language' and mt.kind <> 'language'))
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
        where my_topic is not null and pt.user_id = c.uid and c.tags_ok and char_length(t.name::text) >= 3
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
           case when st.occupation_visibility = 'members' then p.occupation end as occupation,
           case when st.education_visibility = 'members' then p.university end as university,
           case when st.craving_visibility = 'members' then cr.body end as craving,
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
    join my_tags mt on mt.name = t.name and (mt.kind = t.kind or (t.kind <> 'language' and mt.kind <> 'language'))
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
        where v_craving is not null and pt.user_id = c.uid and c.tags_ok and char_length(t.name::text) >= 3
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

create or replace function public.discover_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  global_on boolean := exists (select 1 from public.feature_flags f where f.key = 'global_discovery' and f.enabled);
  result jsonb;
begin
  with explorable as (
    -- Listed, live Servers the user has no membership row in.
    select s.* from public.servers s
    where s.visibility = 'listed' and not s.is_archived
      and (s.kind <> 'short_term' or s.ends_at > now())
      and (s.kind <> 'global' or global_on)
      and not exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = v)
  ),
  engagement as (
    select e.id,
      (select count(*) from public.activity_posts p where p.server_id = e.id and p.created_at > now() - interval '7 days') as posts_7d,
      (select count(*) from public.server_members m where m.server_id = e.id and m.status = 'active' and m.created_at > now() - interval '7 days') as joins_7d,
      (select count(*) from public.server_members m where m.server_id = e.id and m.status = 'active'
         and m.created_at between now() - interval '14 days' and now() - interval '7 days') as joins_prev_7d,
      (select count(distinct sv.user_id) from public.server_visits sv where sv.server_id = e.id and sv.day > current_date - 7) as visitors_7d,
      (select count(distinct sv.user_id) from public.server_visits sv where sv.server_id = e.id
         and sv.day between current_date - 14 and current_date - 7) as visitors_prev_7d
    from explorable e
  ),
  popular as (
    select app_private.server_card(e) || jsonb_build_object(
             'reason', e.member_count || ' members' || case when g.joins_7d > 0 then ' · ' || g.joins_7d || ' joined this week' else '' end) as card,
           (e.member_count + 3 * g.posts_7d + 2 * g.joins_7d + g.visitors_7d) as score
    from explorable e join engagement g on g.id = e.id
    where e.member_count > 0
    order by score desc, e.member_count desc, e.name limit 6
  ),
  trending as (
    select app_private.server_card(e) || jsonb_build_object(
             'reason', (g.joins_7d + g.visitors_7d) || ' new visitors & members this week') as card,
           ((g.joins_7d + g.visitors_7d) - (g.joins_prev_7d + g.visitors_prev_7d))::numeric
             / (g.joins_prev_7d + g.visitors_prev_7d + 1) as growth
    from explorable e join engagement g on g.id = e.id
    where (g.joins_7d + g.visitors_7d) >= 3                                    -- enough real signal
      and (g.joins_7d + g.visitors_7d) > (g.joins_prev_7d + g.visitors_prev_7d)
    order by growth desc, e.name limit 6
  ),
  my_servers as (
    select m.server_id from public.server_members m where m.user_id = v and m.status = 'active'
  ),
  my_tags as (
    select t.name::text as name from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = v
  ),
  suggested as (
    select app_private.server_card(e) || jsonb_build_object('reason',
             case when e.parent_id in (select server_id from my_servers)
                  then 'Inside ' || (select p.name from public.servers p where p.id = e.parent_id)
                  else 'Matches your interest in ' || (
                    select mt.name from my_tags mt where char_length(mt.name) >= 3
                      and (e.name ilike '%' || mt.name || '%' or coalesce(e.description, '') ilike '%' || mt.name || '%') limit 1)
             end) as card,
           (case when e.parent_id in (select server_id from my_servers) then 5 else 0 end
            + (select count(*) from my_tags mt where char_length(mt.name) >= 3
                and (e.name ilike '%' || mt.name || '%' or coalesce(e.description, '') ilike '%' || mt.name || '%')) * 3) as score
    from explorable e
    -- Children of my Servers are suggestable even when unlisted only if I could see them; keep to explorable.
  ),
  activities as (
    select to_jsonb(a) as item from public.list_activity(null, null, 30, 'for_you', 0) a
    where not a.is_mine and not a.is_full and a.my_response is null
    limit 6
  )
  select jsonb_build_object(
    'popular_servers', coalesce((select jsonb_agg(card order by score desc) from popular), '[]'::jsonb),
    'trending_servers', coalesce((select jsonb_agg(card order by growth desc) from trending), '[]'::jsonb),
    'suggested_servers', coalesce((select jsonb_agg(card order by score desc) from (select * from suggested where score > 0 order by score desc limit 6) x), '[]'::jsonb),
    'activities_for_you', coalesce((select jsonb_agg(item) from activities), '[]'::jsonb),
    'open_to_talk_nearby', app_private.available_bucket((
       select count(distinct tm.user_id) from public.server_members vm
       join public.server_members tm on tm.server_id = vm.server_id and tm.status = 'active' and tm.discoverable and tm.user_id <> v
       join public.presence pr on pr.user_id = tm.user_id and pr.is_available and pr.open_to_talk and pr.talk_expires_at > now()
       join public.profiles p on p.id = tm.user_id and p.account_status = 'active'
                             and coalesce(p.last_active_at, p.created_at) > now() - interval '14 days'
       where vm.user_id = v and vm.status = 'active'
         and not app_private.is_blocked_between(v, tm.user_id))),
    'my_server_count', (select count(*) from my_servers),
    'computed_at', now()
  ) into result;
  return result;
end $$;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
