-- Client RPCs: profile view, discovery/matching, requests, connections, chat, activity, safety,
-- notifications, admin dashboards, Vibe Map, scheduled maintenance.

-- ================================================================ profile view
create or replace function app_private.mini_card(u uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', p.id, 'username', p.username::text, 'display_name', p.display_name, 'avatar_path', p.avatar_path)
  from public.profiles p where p.id = u;
$$;

create or replace function public.get_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  p public.profiles;
  st public.user_settings;
  rel jsonb;
  conn public.connections;
  req public.connection_requests;
  conv_id uuid;
begin
  if not app_private.can_view_profile(v, p_user_id) then
    perform app_private.fail('not_found', 'This profile is not available');
  end if;
  select * into p from public.profiles where id = p_user_id;
  select * into st from public.user_settings where user_id = p_user_id;

  select * into conn from public.connections
    where user_a = least(v, p_user_id) and user_b = greatest(v, p_user_id) and status = 'active';
  select * into req from public.connection_requests
    where status = 'pending' and ((sender_id = v and recipient_id = p_user_id) or (sender_id = p_user_id and recipient_id = v));
  select id into conv_id from public.conversations where connection_id = conn.id;
  rel := jsonb_build_object(
    'state', case when v = p_user_id then 'self'
                  when conn.id is not null then 'connected'
                  when req.sender_id = v then 'pending_outgoing'
                  when req.recipient_id = v then 'pending_incoming'
                  else 'none' end,
    'request_id', req.id, 'connection_id', conn.id, 'conversation_id', conv_id,
    'is_friend', coalesce(conn.a_saved and conn.b_saved, false));

  return jsonb_build_object(
    'id', p.id, 'username', p.username::text, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
    'bio', case when app_private.visible_to(v, p.id, st.bio_visibility) then p.bio end,
    'university', case when app_private.visible_to(v, p.id, st.education_visibility) then p.university end,
    'occupation', case when app_private.visible_to(v, p.id, st.occupation_visibility) then p.occupation end,
    'career_goals', case when app_private.visible_to(v, p.id, st.career_goals_visibility) then p.career_goals end,
    'website_url', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.website_url end,
    'instagram_handle', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.instagram_handle end,
    'linkedin_url', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.linkedin_url end,
    'spotify_url', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.spotify_url end,
    'socials_hidden', not app_private.visible_to(v, p.id, st.socials_visibility)
                      and (p.website_url is not null or p.instagram_handle is not null or p.linkedin_url is not null or p.spotify_url is not null),
    'tags', case when app_private.visible_to(v, p.id, st.tags_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('kind', t.kind, 'name', t.name::text) order by t.kind, t.name)
        from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = p.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'shared_tags', case when v <> p.id and app_private.visible_to(v, p.id, st.tags_visibility) then coalesce((
        select jsonb_agg(distinct t.name::text)
        from public.profile_tags a join public.tags t on t.id = a.tag_id
        join public.tags t2 on t2.name = t.name and (t2.kind = t.kind or (t.kind <> 'language' and t2.kind <> 'language'))
        join public.profile_tags b on b.tag_id = t2.id and b.user_id = v
        where a.user_id = p.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'craving', case when app_private.visible_to(v, p.id, st.craving_visibility) then (
        select jsonb_build_object('body', c.body, 'expires_at', c.expires_at, 'server_id', c.server_id,
                                  'server_name', (select name from public.servers where id = c.server_id))
        from public.cravings c
        where c.user_id = p.id and c.expires_at > now()
          and (c.server_id is null or v = p.id or app_private.is_active_member(c.server_id, v))) end,
    'badges', case when app_private.visible_to(v, p.id, st.badges_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'issued_at', b.issued_at,
                                            'expires_at', b.expires_at, 'server_id', s.id, 'server_name', s.name,
                                            'server_is_official', s.is_official) order by s.is_official desc, b.issued_at)
        from public.server_badges b join public.servers s on s.id = b.server_id
        where b.user_id = p.id and b.status = 'active' and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
      else '[]'::jsonb end,
    'endorsements', case when app_private.visible_to(v, p.id, st.endorsements_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'body', e.body, 'created_at', e.created_at,
                                            'author', app_private.mini_card(e.author_id)) order by e.created_at desc)
        from public.endorsements e
        where e.subject_id = p.id and e.status = 'approved'
          and not app_private.is_blocked_between(v, e.author_id)), '[]'::jsonb)
      else '[]'::jsonb end,
    'relationship', rel);
end $$;

create or replace function public.get_profile_cards(p_ids uuid[])
returns table (id uuid, username text, display_name text, avatar_path text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select p.id, p.username::text, p.display_name, p.avatar_path
  from public.profiles p
  where p.id = any (p_ids[1:100]) and app_private.can_view_profile(auth.uid(), p.id);
$$;

-- ================================================================ discovery & matching
-- Stage 1 (eligibility) decides WHO may be shown; stage 2 (ranking) only orders that set.
-- Ranking uses only data the candidate exposes at 'members' level. See docs/MATCHING.md.
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
  if not app_private.is_available(v) then
    perform app_private.fail('not_available', 'Go Available to see who''s around');
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
    join public.presence pr on pr.user_id = m.user_id and pr.available_until > now()
    join public.profiles p on p.id = m.user_id and p.account_status = 'active' and p.onboarded_at is not null
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

create or replace function public.dismiss_candidate(p_user_id uuid, p_hours integer default 168)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  insert into public.discovery_dismissals (viewer_id, target_id, until)
    values (v, p_user_id, now() + make_interval(hours => least(greatest(p_hours, 1), 24 * 90)))
  on conflict (viewer_id, target_id) do update set until = excluded.until;
end $$;

-- ================================================================ connection requests
create or replace function app_private.accept_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.connection_requests;
  s public.servers;
  conn_id uuid;
  conv_id uuid;
  exp timestamptz;
  a uuid; b uuid;
begin
  select * into r from public.connection_requests where id = p_request_id for update;
  if r.status <> 'pending' then perform app_private.fail('invalid_transition', 'This request is no longer pending'); end if;
  update public.connection_requests set status = 'accepted', responded_at = now() where id = r.id;
  a := least(r.sender_id, r.recipient_id);
  b := greatest(r.sender_id, r.recipient_id);
  if r.server_id is not null then
    select * into s from public.servers where id = r.server_id;
    if s.kind = 'short_term' and s.ephemeral_chats and s.ends_at > now() then exp := s.ends_at; end if;
  end if;
  -- A previously blocked (now unblocked) pair starts fresh: old history is not resurrected.
  delete from public.connections where user_a = a and user_b = b and status = 'blocked';
  insert into public.connections (user_a, user_b, request_id, origin_server_id, expires_at)
    values (a, b, r.id, r.server_id, exp)
    on conflict (user_a, user_b) do nothing
    returning id into conn_id;
  if conn_id is null then
    select id into conn_id from public.connections where user_a = a and user_b = b;
  end if;
  insert into public.conversations (connection_id) values (conn_id)
    on conflict (connection_id) do nothing returning id into conv_id;
  if conv_id is null then select id into conv_id from public.conversations where connection_id = conn_id; end if;
  insert into public.conversation_participants (conversation_id, user_id)
    values (conv_id, r.sender_id), (conv_id, r.recipient_id) on conflict do nothing;
  perform app_private.notify(r.sender_id, 'request_accepted',
    (select display_name from public.profiles where id = r.recipient_id) || ' accepted your request',
    'Say hello. Your chat is open.', r.recipient_id, r.server_id, r.id, conv_id, null, 'accepted:' || r.id);
  return conn_id;
end $$;

create or replace function app_private.create_request(
  v uuid, p_recipient uuid, p_server_id uuid, p_post_id uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  reverse_req uuid;
  new_id uuid;
  conn_id uuid;
  ctx_ok boolean;
begin
  if p_recipient = v then perform app_private.fail('invalid_target', 'You cannot connect with yourself'); end if;
  if not app_private.can_view_profile(v, p_recipient) then
    perform app_private.fail('unavailable', 'This person is not available right now');
  end if;
  if app_private.are_connected(v, p_recipient) then perform app_private.fail('already_connected', 'You are already connected'); end if;
  -- Context: a live Server both belong to (explicit or implied by an activity post).
  ctx_ok := p_server_id is not null and app_private.server_is_live(p_server_id)
            and app_private.is_active_member(p_server_id, v) and app_private.is_active_member(p_server_id, p_recipient);
  if not ctx_ok then
    perform app_private.fail('no_shared_context', 'You can connect with people in Servers you share');
  end if;
  if exists (select 1 from public.connection_requests where sender_id = v and recipient_id = p_recipient
             and status = 'declined' and responded_at > now() - interval '7 days') then
    perform app_private.fail('cooldown', 'You can''t send another request to this person yet');
  end if;
  select id into reverse_req from public.connection_requests
    where sender_id = p_recipient and recipient_id = v and status = 'pending';
  if reverse_req is not null then
    -- Mutual intent: treat as acceptance of their request.
    conn_id := app_private.accept_request(reverse_req);
    return jsonb_build_object('status', 'accepted', 'request_id', reverse_req, 'connection_id', conn_id,
      'conversation_id', (select id from public.conversations where connection_id = conn_id));
  end if;
  if exists (select 1 from public.connection_requests where sender_id = v and recipient_id = p_recipient and status = 'pending') then
    perform app_private.fail('already_requested', 'Request already sent');
  end if;
  begin
    insert into public.connection_requests (sender_id, recipient_id, server_id, activity_post_id, message)
      values (v, p_recipient, p_server_id, p_post_id, nullif(btrim(left(p_message, 280)), ''))
      returning id into new_id;
  exception when unique_violation then
    perform app_private.fail('already_requested', 'A request between you is already pending');
  end;
  perform app_private.notify(p_recipient, 'connection_request',
    (select display_name from public.profiles where id = v) || ' wants to connect',
    case when p_post_id is not null then 'They responded to your post' else (select 'In ' || name from public.servers where id = p_server_id) end,
    v, p_server_id, new_id, null, p_post_id, 'req:' || new_id);
  return jsonb_build_object('status', 'pending', 'request_id', new_id);
end $$;

create or replace function public.send_connection_request(p_recipient uuid, p_server_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  perform app_private.rate_limit('connection_request', 30, interval '1 hour');
  perform app_private.rate_limit('connection_request_day', 100, interval '1 day');
  return app_private.create_request(v, p_recipient, p_server_id, null, p_message);
end $$;

create or replace function public.respond_to_request(p_request_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  r public.connection_requests;
  conn_id uuid;
begin
  select * into r from public.connection_requests where id = p_request_id for update;
  if not found or r.recipient_id <> v then perform app_private.fail('not_found', 'Request not found'); end if;
  if r.status <> 'pending' then perform app_private.fail('invalid_transition', 'This request is no longer pending'); end if;
  if not p_accept then
    update public.connection_requests set status = 'declined' where id = r.id;
    return jsonb_build_object('status', 'declined');
  end if;
  if app_private.is_blocked_between(v, r.sender_id) then perform app_private.fail('unavailable'); end if;
  if not exists (select 1 from public.profiles where id = r.sender_id and account_status = 'active') then
    perform app_private.fail('unavailable', 'This account is no longer available');
  end if;
  conn_id := app_private.accept_request(r.id);
  return jsonb_build_object('status', 'accepted', 'connection_id', conn_id,
    'conversation_id', (select id from public.conversations where connection_id = conn_id));
end $$;

create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  r public.connection_requests;
begin
  select * into r from public.connection_requests where id = p_request_id for update;
  if not found or r.sender_id <> v then perform app_private.fail('not_found', 'Request not found'); end if;
  if r.status <> 'pending' then perform app_private.fail('invalid_transition', 'This request is no longer pending'); end if;
  update public.connection_requests set status = 'cancelled' where id = r.id;
  delete from public.notifications where request_id = r.id and type = 'connection_request';
end $$;

create or replace function public.list_requests(p_direction text default 'incoming')
returns table (
  id uuid, other jsonb, server_id uuid, server_name text, message text, activity_post_id uuid,
  post_excerpt text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select r.id,
         app_private.mini_card(case when p_direction = 'incoming' then r.sender_id else r.recipient_id end),
         r.server_id, s.name, r.message, r.activity_post_id, left(ap.body, 120), r.created_at
  from public.connection_requests r
  left join public.servers s on s.id = r.server_id
  left join public.activity_posts ap on ap.id = r.activity_post_id
  where r.status = 'pending'
    and ((p_direction = 'incoming' and r.recipient_id = auth.uid()) or (p_direction = 'outgoing' and r.sender_id = auth.uid()))
    and not app_private.is_blocked_between(r.sender_id, r.recipient_id)
  order by r.created_at desc
  limit 100;
$$;

-- ================================================================ connections & friends
create or replace function public.list_connections(p_friends_only boolean default false)
returns table (
  connection_id uuid, conversation_id uuid, other jsonb, is_friend boolean, i_saved boolean, they_saved boolean,
  expires_at timestamptz, origin_server_id uuid, origin_server_name text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select c.id, cv.id,
         app_private.mini_card(case when c.user_a = auth.uid() then c.user_b else c.user_a end),
         c.a_saved and c.b_saved,
         case when c.user_a = auth.uid() then c.a_saved else c.b_saved end,
         case when c.user_a = auth.uid() then c.b_saved else c.a_saved end,
         c.expires_at, c.origin_server_id, s.name, c.created_at
  from public.connections c
  left join public.conversations cv on cv.connection_id = c.id
  left join public.servers s on s.id = c.origin_server_id
  where (c.user_a = auth.uid() or c.user_b = auth.uid()) and c.status = 'active'
    and (not p_friends_only or (c.a_saved and c.b_saved))
  order by c.created_at desc
  limit 500;
$$;

-- "Save connection" / add as friend. Mutual save makes an ephemeral connection permanent.
create or replace function public.save_connection(p_connection_id uuid, p_saved boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  c public.connections;
  s public.servers;
  other uuid;
begin
  select * into c from public.connections where id = p_connection_id for update;
  if not found or v not in (c.user_a, c.user_b) or c.status <> 'active' then perform app_private.fail('not_found'); end if;
  other := case when c.user_a = v then c.user_b else c.user_a end;
  if c.user_a = v then c.a_saved := p_saved; else c.b_saved := p_saved; end if;
  if c.a_saved and c.b_saved then
    c.expires_at := null;
  elsif c.origin_server_id is not null then
    select * into s from public.servers where id = c.origin_server_id;
    if s.kind = 'short_term' and s.ephemeral_chats and s.ends_at > now() then c.expires_at := s.ends_at; end if;
  end if;
  update public.connections set a_saved = c.a_saved, b_saved = c.b_saved, expires_at = c.expires_at where id = c.id;
  if p_saved then
    perform app_private.notify(other, 'connection_saved',
      case when c.a_saved and c.b_saved then 'You''re now friends with ' || (select display_name from public.profiles where id = v)
           else (select display_name from public.profiles where id = v) || ' wants to stay connected' end,
      case when c.a_saved and c.b_saved then 'Your chat will be kept.' else 'Save the connection to keep your chat after the event.' end,
      v, c.origin_server_id, null, (select id from public.conversations where connection_id = c.id), null, 'saved:' || c.id || ':' || v);
  end if;
  return jsonb_build_object('is_friend', c.a_saved and c.b_saved, 'expires_at', c.expires_at);
end $$;

create or replace function public.remove_connection(p_connection_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  delete from public.connections where id = p_connection_id and v in (user_a, user_b) and status = 'active';
  if not found then perform app_private.fail('not_found'); end if;
end $$;

create or replace function public.rate_connection(p_user_id uuid, p_rating smallint)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not exists (select 1 from public.connections where user_a = least(v, p_user_id) and user_b = greatest(v, p_user_id)) then
    perform app_private.fail('forbidden', 'You can only give feedback on people you connected with');
  end if;
  insert into public.interaction_feedback (rater_id, subject_id, rating) values (v, p_user_id, p_rating)
    on conflict (rater_id, subject_id) do update set rating = excluded.rating, created_at = now();
end $$;

-- ================================================================ blocking
create or replace function public.block_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  if p_user_id = v then perform app_private.fail('invalid_target'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then perform app_private.fail('not_found'); end if;
  insert into public.blocks (blocker_id, blocked_id) values (v, p_user_id) on conflict do nothing;
  update public.connection_requests set status = 'cancelled'
    where status = 'pending' and ((sender_id = v and recipient_id = p_user_id) or (sender_id = p_user_id and recipient_id = v));
  update public.connections set status = 'blocked', blocked_by = v
    where user_a = least(v, p_user_id) and user_b = greatest(v, p_user_id) and status = 'active';
  delete from public.notifications where user_id = v and actor_id = p_user_id;
end $$;

create or replace function public.unblock_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  delete from public.blocks where blocker_id = v and blocked_id = p_user_id;
  -- Unblocking does not restore the old connection; both sides must reconnect.
  if not exists (select 1 from public.blocks where blocker_id = p_user_id and blocked_id = v) then
    delete from public.connections
      where user_a = least(v, p_user_id) and user_b = greatest(v, p_user_id) and status = 'blocked';
  end if;
end $$;

create or replace function public.list_blocked()
returns table (user_id uuid, username text, display_name text, blocked_at timestamptz)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select b.blocked_id, p.username::text, p.display_name, b.created_at
  from public.blocks b join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid() order by b.created_at desc;
$$;

-- ================================================================ chat
create or replace function app_private.can_send_message(p_conversation uuid, u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.conversations cv
    join public.connections c on c.id = cv.connection_id
    join public.conversation_participants me on me.conversation_id = cv.id and me.user_id = u
    join public.profiles p on p.id = u and p.account_status = 'active'
    where cv.id = p_conversation and c.status = 'active' and (c.expires_at is null or c.expires_at > now())
      and not app_private.is_blocked_between(c.user_a, c.user_b)
  );
$$;

create or replace function app_private.is_conversation_member(p_conversation uuid, u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.conversation_participants cp
    join public.conversations cv on cv.id = cp.conversation_id
    join public.connections c on c.id = cv.connection_id and c.status = 'active'
    where cp.conversation_id = p_conversation and cp.user_id = u
  );
$$;

create or replace function app_private.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.created_at := now();  -- server-authoritative timestamps
  new.body := btrim(new.body);
  perform app_private.rate_limit('message', 40, interval '1 minute');
  return new;
end $$;
create trigger messages_before_insert before insert on public.messages
  for each row execute function app_private.messages_before_insert();

create or replace function app_private.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  other uuid;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_participants set last_read_at = new.created_at, hidden_at = null
    where conversation_id = new.conversation_id and user_id = new.sender_id;
  update public.conversation_participants set hidden_at = null
    where conversation_id = new.conversation_id and user_id <> new.sender_id;
  select user_id into other from public.conversation_participants
    where conversation_id = new.conversation_id and user_id <> new.sender_id limit 1;
  -- Body is deliberately NOT copied into the notification (lock-screen privacy).
  perform app_private.notify(other, 'message',
    'New message from ' || (select display_name from public.profiles where id = new.sender_id),
    null, new.sender_id, null, null, new.conversation_id, null, 'msg:' || new.conversation_id);
  return null;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function app_private.messages_after_insert();

create or replace function public.list_conversations()
returns table (
  conversation_id uuid, connection_id uuid, other jsonb, last_message text, last_message_at timestamptz,
  last_sender_id uuid, unread_count bigint, expires_at timestamptz, is_friend boolean)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select cv.id, c.id,
         app_private.mini_card(case when c.user_a = auth.uid() then c.user_b else c.user_a end),
         lm.body, coalesce(lm.created_at, cv.created_at), lm.sender_id,
         (select count(*) from public.messages m
           where m.conversation_id = cv.id and m.sender_id <> auth.uid()
             and m.created_at > coalesce(me.last_read_at, '-infinity')),
         c.expires_at, c.a_saved and c.b_saved
  from public.conversation_participants me
  join public.conversations cv on cv.id = me.conversation_id
  join public.connections c on c.id = cv.connection_id and c.status = 'active'
  left join lateral (
    select m.body, m.created_at, m.sender_id from public.messages m
    where m.conversation_id = cv.id order by m.created_at desc limit 1) lm on true
  where me.user_id = auth.uid() and me.hidden_at is null
  order by coalesce(lm.created_at, cv.created_at) desc
  limit 200;
$$;

create or replace function public.get_conversation(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  c public.connections;
  other uuid;
begin
  if not app_private.is_conversation_member(p_conversation_id, v) then perform app_private.fail('not_found'); end if;
  select c2.* into c from public.connections c2 join public.conversations cv on cv.connection_id = c2.id where cv.id = p_conversation_id;
  other := case when c.user_a = v then c.user_b else c.user_a end;
  return jsonb_build_object(
    'conversation_id', p_conversation_id, 'connection_id', c.id, 'other', app_private.mini_card(other),
    'expires_at', c.expires_at, 'is_friend', c.a_saved and c.b_saved,
    'i_saved', case when c.user_a = v then c.a_saved else c.b_saved end,
    'they_saved', case when c.user_a = v then c.b_saved else c.a_saved end,
    'origin_server_name', (select name from public.servers where id = c.origin_server_id),
    'can_send', app_private.can_send_message(p_conversation_id, v),
    'their_last_read_at', (select last_read_at from public.conversation_participants where conversation_id = p_conversation_id and user_id = other));
end $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  update public.conversation_participants set last_read_at = now()
    where conversation_id = p_conversation_id and user_id = v;
  update public.notifications set read_at = now()
    where user_id = v and conversation_id = p_conversation_id and type = 'message' and read_at is null;
end $$;

create or replace function public.hide_conversation(p_conversation_id uuid)
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  update public.conversation_participants set hidden_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
$$;

-- Shared, members-visible context for icebreakers (used by the Edge Function and the template fallback).
create or replace function public.get_icebreaker_context(p_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  c public.connections;
  other uuid;
  sto public.user_settings;
  po public.profiles;
  pm public.profiles;
begin
  select * into c from public.connections where id = p_connection_id and status = 'active';
  if not found or v not in (c.user_a, c.user_b) then perform app_private.fail('not_found'); end if;
  other := case when c.user_a = v then c.user_b else c.user_a end;
  select * into sto from public.user_settings where user_id = other;
  select * into po from public.profiles where id = other;
  select * into pm from public.profiles where id = v;
  return jsonb_build_object(
    'other_name', split_part(po.display_name, ' ', 1),
    'shared_tags', coalesce((
      select jsonb_agg(distinct jsonb_build_object('kind', t.kind, 'name', t.name::text))
      from public.profile_tags a join public.tags t on t.id = a.tag_id
      join public.tags t2 on t2.name = t.name and (t2.kind = t.kind or (t.kind <> 'language' and t2.kind <> 'language'))
      join public.profile_tags b on b.tag_id = t2.id and b.user_id = v
      where a.user_id = other and sto.tags_visibility <> 'only_me'), '[]'::jsonb),
    'same_university', case when sto.education_visibility <> 'only_me' and po.university is not null
      and lower(btrim(po.university)) = lower(btrim(pm.university)) then po.university end,
    'their_craving', case when sto.craving_visibility <> 'only_me' then
      (select body from public.cravings where user_id = other and expires_at > now()) end,
    'their_occupation', case when sto.occupation_visibility <> 'only_me' then po.occupation end,
    'server_name', (select name from public.servers where id = c.origin_server_id),
    'ai_allowed', (select ai_features_consent from public.user_settings where user_id = v) and sto.ai_features_consent
  );
end $$;

-- ================================================================ activity hub
create or replace function app_private.post_visible(p public.activity_posts, viewer uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p.status = 'active'
     and (p.expires_at is null or p.expires_at > now())
     and app_private.server_is_live(p.server_id)
     and app_private.is_active_member(p.server_id, viewer)
     and (p.author_id = viewer or (
           app_private.is_active_member(p.server_id, p.author_id)
           and not app_private.is_blocked_between(viewer, p.author_id)
           and app_private.audience_compatible(viewer, p.author_id)
           and exists (select 1 from public.profiles a where a.id = p.author_id and a.account_status = 'active')));
$$;

create or replace function public.create_activity_post(
  p_server_id uuid, p_body text, p_category text default 'social', p_expires_hours integer default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
  exp timestamptz;
  new_id uuid;
begin
  if not app_private.is_active_member(p_server_id, v) then perform app_private.fail('forbidden', 'Join this Server to post'); end if;
  if not app_private.server_is_live(p_server_id) then perform app_private.fail('server_closed', 'This Server has ended'); end if;
  perform app_private.rate_limit('activity_post', 3, interval '10 minutes');
  perform app_private.rate_limit('activity_post_day', 10, interval '1 day');
  select * into s from public.servers where id = p_server_id;
  if p_expires_hours is not null and p_expires_hours not between 1 and 720 then
    perform app_private.fail('invalid_duration', 'Posts can last between 1 hour and 30 days');
  end if;
  exp := now() + make_interval(hours => coalesce(p_expires_hours, 168));
  if s.kind = 'short_term' then exp := least(exp, s.ends_at); end if;
  insert into public.activity_posts (server_id, author_id, body, category, expires_at)
    values (p_server_id, v, btrim(p_body), coalesce(p_category, 'social'), exp)
    returning id into new_id;
  return new_id;
end $$;

create or replace function public.update_activity_post(p_post_id uuid, p_body text, p_category text, p_expires_hours integer default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  p public.activity_posts;
  s public.servers;
  exp timestamptz;
begin
  select * into p from public.activity_posts where id = p_post_id;
  if not found or p.author_id <> v or p.status <> 'active' then perform app_private.fail('not_found'); end if;
  select * into s from public.servers where id = p.server_id;
  exp := case when p_expires_hours is null then p.expires_at
              else least(now() + make_interval(hours => least(greatest(p_expires_hours, 1), 720)), p.created_at + interval '30 days') end;
  if s.kind = 'short_term' then exp := least(exp, s.ends_at); end if;
  update public.activity_posts set body = btrim(p_body), category = coalesce(p_category, category), expires_at = exp
    where id = p_post_id;
end $$;

create or replace function public.delete_activity_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  delete from public.activity_posts where id = p_post_id and author_id = v;
  if not found then perform app_private.fail('not_found'); end if;
end $$;

create or replace function public.list_activity(
  p_server_id uuid default null, p_before timestamptz default null, p_limit integer default 20)
returns table (
  id uuid, server_id uuid, server_name text, author jsonb, body text, category text,
  expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  response_count bigint, i_responded boolean, is_mine boolean)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select p.id, p.server_id, s.name, app_private.mini_card(p.author_id), p.body, p.category,
         p.expires_at, p.created_at, p.updated_at,
         (select count(*) from public.activity_responses r where r.post_id = p.id),
         exists (select 1 from public.activity_responses r where r.post_id = p.id and r.responder_id = auth.uid()),
         p.author_id = auth.uid()
  from public.activity_posts p
  join public.servers s on s.id = p.server_id
  join public.server_members vm on vm.server_id = p.server_id and vm.user_id = auth.uid() and vm.status = 'active'
  where (p_server_id is null or p.server_id = p_server_id)
    and (p_before is null or p.created_at < p_before)
    and app_private.post_visible(p, auth.uid())
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.respond_to_activity_post(p_post_id uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  p public.activity_posts;
  resp_id uuid;
  req jsonb;
begin
  select * into p from public.activity_posts where id = p_post_id;
  if not found or not app_private.post_visible(p, v) then perform app_private.fail('not_found', 'This post is no longer available'); end if;
  if p.author_id = v then perform app_private.fail('invalid_target', 'This is your own post'); end if;
  perform app_private.rate_limit('activity_response', 20, interval '1 hour');
  begin
    insert into public.activity_responses (post_id, responder_id, message)
      values (p.id, v, nullif(btrim(left(p_message, 280)), '')) returning id into resp_id;
  exception when unique_violation then
    perform app_private.fail('already_responded', 'You already responded to this post');
  end;
  if not app_private.are_connected(v, p.author_id)
     and not exists (select 1 from public.connection_requests r where r.status = 'pending'
                     and ((r.sender_id = v and r.recipient_id = p.author_id) or (r.sender_id = p.author_id and r.recipient_id = v))) then
    begin
      req := app_private.create_request(v, p.author_id, p.server_id, p.id, p_message);
      update public.activity_responses set request_id = (req ->> 'request_id')::uuid where id = resp_id;
    exception when others then
      req := jsonb_build_object('status', 'not_sent');  -- e.g. cooldown; the response still reaches the author
    end;
  end if;
  perform app_private.notify(p.author_id, 'activity_response',
    (select display_name from public.profiles where id = v) || ' responded to your post', left(p.body, 80),
    v, p.server_id, null, null, p.id, 'resp:' || resp_id);
  return jsonb_build_object('response_id', resp_id, 'request', req);
end $$;

create or replace function public.list_post_responses(p_post_id uuid)
returns table (id uuid, responder jsonb, message text, request_status public.request_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not exists (select 1 from public.activity_posts where id = p_post_id and author_id = v) then
    perform app_private.fail('forbidden');
  end if;
  return query
    select r.id, app_private.mini_card(r.responder_id), r.message, cr.status, r.created_at
    from public.activity_responses r
    left join public.connection_requests cr on cr.id = r.request_id
    where r.post_id = p_post_id and not app_private.is_blocked_between(v, r.responder_id)
    order by r.created_at desc;
end $$;

create or replace function public.moderate_remove_post(p_post_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  p public.activity_posts;
begin
  select * into p from public.activity_posts where id = p_post_id;
  if not found or not app_private.has_server_role(p.server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  update public.activity_posts set status = 'removed', removed_by = v, removed_reason = left(p_reason, 300) where id = p_post_id;
  perform app_private.audit('post_removed', p.server_id, p.author_id, p.id, null, jsonb_build_object('reason', p_reason));
  perform app_private.notify(p.author_id, 'moderation', 'A post of yours was removed', coalesce(left(p_reason, 200), 'It broke the Server''s rules.'),
    v, p.server_id, null, null, null, 'postremoved:' || p.id);
end $$;

-- ================================================================ endorsements
create or replace function public.write_endorsement(p_user_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  new_id uuid;
begin
  if not app_private.are_connected(v, p_user_id) then perform app_private.fail('forbidden', 'You can endorse people you are connected with'); end if;
  perform app_private.rate_limit('endorsement', 10, interval '1 day');
  insert into public.endorsements (author_id, subject_id, body) values (v, p_user_id, btrim(p_body))
    on conflict (author_id, subject_id) do update set body = excluded.body, status = 'pending'
    returning id into new_id;
  perform app_private.notify(p_user_id, 'endorsement', (select display_name from public.profiles where id = v) || ' endorsed you',
    'Review it before it appears on your profile.', v, null, null, null, null, 'endorse:' || new_id);
  return new_id;
end $$;

create or replace function public.set_endorsement_status(p_endorsement_id uuid, p_status public.endorsement_status)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  update public.endorsements set status = p_status where id = p_endorsement_id and subject_id = v;
  if not found then perform app_private.fail('not_found'); end if;
end $$;

-- ================================================================ reports & moderation
create or replace function public.create_report(
  p_reason public.report_reason, p_details text default null, p_target_user uuid default null,
  p_target_post uuid default null, p_target_message uuid default null, p_server_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  snap text;
  tgt uuid := p_target_user;
  srv uuid := p_server_id;
  new_id uuid;
  msg public.messages;
  post public.activity_posts;
begin
  perform app_private.rate_limit('report', 20, interval '1 day');
  if p_target_message is not null then
    select * into msg from public.messages where id = p_target_message;
    if not found or not exists (select 1 from public.conversation_participants where conversation_id = msg.conversation_id and user_id = v) then
      perform app_private.fail('not_found');
    end if;
    snap := msg.body; tgt := msg.sender_id;
  end if;
  if p_target_post is not null then
    select * into post from public.activity_posts where id = p_target_post;
    if not found or not app_private.is_active_member(post.server_id, v) then perform app_private.fail('not_found'); end if;
    snap := post.body; tgt := post.author_id; srv := post.server_id;
  end if;
  if tgt is null then perform app_private.fail('invalid_target'); end if;
  if tgt = v then perform app_private.fail('invalid_target', 'You cannot report yourself'); end if;
  if srv is not null and not app_private.is_active_member(srv, v) then srv := null; end if;
  insert into public.reports (reporter_id, target_user_id, target_post_id, target_message_id, server_id, reason, details, content_snapshot)
    values (v, tgt, p_target_post, p_target_message, srv, p_reason, left(p_details, 1000), left(snap, 2000))
    returning id into new_id;
  return new_id;
end $$;

create or replace function public.review_report(p_report_id uuid, p_status public.report_status, p_note text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  r public.reports;
begin
  select * into r from public.reports where id = p_report_id;
  if not found or not (app_private.is_platform_admin(v)
                       or (r.server_id is not null and r.target_user_id is distinct from v
                           and app_private.has_server_role(r.server_id, v, 'moderator'))) then
    perform app_private.fail('forbidden');
  end if;
  update public.reports set status = p_status, reviewed_by = v, reviewed_at = now(), resolution_note = left(p_note, 1000) where id = p_report_id;
  perform app_private.audit('report_' || p_status::text, r.server_id, r.target_user_id, r.target_post_id, r.id, jsonb_build_object('note', p_note));
end $$;

create or replace function public.list_reports(p_server_id uuid default null, p_status public.report_status default 'open')
returns table (
  id uuid, reason public.report_reason, details text, content_snapshot text, status public.report_status,
  server_id uuid, server_name text, target jsonb, target_post_id uuid, reporter jsonb, created_at timestamptz, resolution_note text)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if p_server_id is null and not app_private.is_platform_admin(v) then perform app_private.fail('forbidden'); end if;
  if p_server_id is not null and not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  return query
    select r.id, r.reason, r.details, r.content_snapshot, r.status, r.server_id, s.name,
           app_private.mini_card(r.target_user_id), r.target_post_id,
           -- Reporter identity is visible to platform admins only (protects reporters from retaliation).
           case when app_private.is_platform_admin(v) then app_private.mini_card(r.reporter_id) end,
           r.created_at, r.resolution_note
    from public.reports r left join public.servers s on s.id = r.server_id
    where (p_server_id is null or r.server_id = p_server_id) and (p_status is null or r.status = p_status)
      and (app_private.is_platform_admin(v) or r.target_user_id is distinct from v)
    order by r.created_at desc limit 200;
end $$;

create or replace function public.list_audit_log(p_server_id uuid, p_limit integer default 100)
returns table (id bigint, action text, actor jsonb, target jsonb, details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  return query
    select a.id, a.action, app_private.mini_card(a.actor_id), app_private.mini_card(a.target_user_id), a.details, a.created_at
    from public.moderation_actions a where a.server_id = p_server_id
    order by a.created_at desc limit least(greatest(p_limit, 1), 500);
end $$;

-- Platform-level restriction (Sniff.in staff).
create or replace function public.set_account_status(p_user_id uuid, p_status public.account_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.is_platform_admin(v) then perform app_private.fail('forbidden'); end if;
  update public.profiles set account_status = p_status where id = p_user_id;
  if p_status = 'suspended' then
    update public.presence set available_until = null where user_id = p_user_id;
  end if;
  perform app_private.audit('account_' || p_status::text, null, p_user_id, null, null, jsonb_build_object('reason', p_reason));
end $$;

-- ================================================================ announcements & admin dashboard
create or replace function public.post_announcement(p_server_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  new_id uuid;
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  perform app_private.rate_limit('announcement', 5, interval '1 day');
  insert into public.server_announcements (server_id, author_id, title, body)
    values (p_server_id, v, btrim(p_title), btrim(p_body)) returning id into new_id;
  perform app_private.notify(m.user_id, 'server_announcement', left(btrim(p_title), 120), left(btrim(p_body), 300),
                             v, p_server_id, null, null, null, 'ann:' || new_id)
  from public.server_members m
  where m.server_id = p_server_id and m.status = 'active' and m.user_id <> v
  limit 10000;
  perform app_private.audit('announcement_posted', p_server_id, null, null, null, jsonb_build_object('announcement_id', new_id));
  return new_id;
end $$;

create or replace function public.list_announcements(p_server_id uuid)
returns table (id uuid, title text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user(false);
begin
  if not (app_private.is_active_member(p_server_id, v) or app_private.has_server_role(p_server_id, v, 'moderator')) then
    perform app_private.fail('forbidden');
  end if;
  return query select a.id, a.title, a.body, a.created_at from public.server_announcements a
    where a.server_id = p_server_id order by a.created_at desc limit 50;
end $$;

-- Aggregate-only stats. Small counts of live users are bucketed.
create or replace function public.server_stats(p_server_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  return jsonb_build_object(
    'active_members', (select count(*) from public.server_members where server_id = p_server_id and status = 'active'),
    'pending_members', (select count(*) from public.server_members where server_id = p_server_id and status = 'pending'),
    'banned_members', (select count(*) from public.server_members where server_id = p_server_id and status = 'banned'),
    'joined_last_7d', (select count(*) from public.server_members where server_id = p_server_id and status = 'active' and created_at > now() - interval '7 days'),
    'available_now', app_private.available_bucket(app_private.server_available_count(p_server_id, null)),
    'posts_last_7d', (select count(*) from public.activity_posts where server_id = p_server_id and created_at > now() - interval '7 days'),
    'connections_last_7d', (select count(*) from public.connections where origin_server_id = p_server_id and created_at > now() - interval '7 days'),
    'open_reports', (select count(*) from public.reports where server_id = p_server_id and status in ('open','reviewing')),
    'active_badges', (select count(*) from public.server_badges where server_id = p_server_id and status = 'active'),
    'computed_at', now());
end $$;

-- ================================================================ notifications & push
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

create or replace function public.register_push_token(p_token text, p_platform text, p_provider text default 'expo')
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  -- A device token belongs to whoever is signed in on that device now.
  insert into public.push_tokens (user_id, token, platform, provider) values (v, p_token, p_platform, p_provider)
  on conflict (token) do update set user_id = v, platform = excluded.platform, provider = excluded.provider, last_seen_at = now();
end $$;

create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

-- ================================================================ Vibe Map (aggregates only)
-- Venue-level counts of currently-available, discoverable members; venues under 5 are suppressed.
-- No user coordinates exist anywhere in the system.
create or replace function public.get_vibe_map()
returns table (
  server_id uuid, name text, category text, city text, venue_lat numeric, venue_lng numeric,
  activity text, is_member boolean, computed_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not exists (select 1 from public.feature_flags where key = 'vibe_map' and enabled) then
    perform app_private.fail('feature_disabled', 'The Vibe Map is not enabled');
  end if;
  return query
    select s.id, s.name, s.category, s.city, s.venue_lat, s.venue_lng,
           app_private.available_bucket(x.n), app_private.has_membership_row(s.id, v), now()
    from public.servers s
    cross join lateral (select app_private.server_available_count(s.id, null) as n) x
    where s.venue_lat is not null and s.venue_lng is not null and not s.is_archived
      and (s.kind <> 'short_term' or (s.ends_at > now() and (s.starts_at is null or s.starts_at <= now())))
      and (s.visibility = 'listed' or app_private.has_membership_row(s.id, v))
      and x.n >= 5
    order by x.n desc
    limit 200;
end $$;

-- ================================================================ scheduled maintenance (service role / pg_cron only)
create or replace function app_private.run_maintenance()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  expired_conns integer;
  archived integer;
begin
  -- 1. Warn about ephemeral chats expiring within 30 minutes (once per connection per user).
  perform app_private.notify(x.uid, 'ephemeral_expiring', 'Your chat disappears soon',
            'Save the connection to keep talking after the event.', null, c.origin_server_id, null, cv.id, null, 'eph:' || c.id)
  from public.connections c
  join public.conversations cv on cv.connection_id = c.id
  cross join lateral (values (c.user_a), (c.user_b)) x(uid)
  where c.status = 'active' and c.expires_at between now() and now() + interval '30 minutes';

  -- 2. Expire ephemeral connections. Cascades to conversations, participants, messages, icebreakers.
  delete from public.connections where expires_at is not null and expires_at <= now();
  get diagnostics expired_conns = row_count;

  -- 3. Close ended short-term Servers and drop their temporary content.
  with ended as (
    update public.servers set is_archived = true
    where kind = 'short_term' and not is_archived and ends_at <= now()
    returning id)
  select count(*) into archived from ended;
  delete from public.activity_posts p using public.servers s
    where p.server_id = s.id and s.kind = 'short_term' and s.is_archived;
  delete from public.cravings c using public.servers s where c.server_id = s.id and s.is_archived;
  update public.server_join_tokens t set revoked_at = now()
    from public.servers s where t.server_id = s.id and s.is_archived and t.revoked_at is null;
  update public.connection_requests r set status = 'expired'
    from public.servers s
    where r.server_id = s.id and r.status = 'pending' and s.kind = 'short_term' and s.ends_at <= now();

  -- 4. Housekeeping.
  update public.connection_requests set status = 'expired' where status = 'pending' and created_at < now() - interval '30 days';
  delete from public.activity_posts where expires_at < now() - interval '1 day';
  delete from public.cravings where expires_at < now();
  update public.presence set available_until = null, available_since = null where available_until <= now();
  delete from public.discovery_dismissals where until <= now();
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
  delete from public.notifications where created_at < now() - interval '90 days';

  return jsonb_build_object('expired_connections', expired_conns, 'archived_servers', archived, 'ran_at', now());
end $$;
