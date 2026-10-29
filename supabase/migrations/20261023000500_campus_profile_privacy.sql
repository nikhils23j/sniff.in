-- One renderer for ordinary views and exact viewer previews.
create or replace function app_private.profile_json(p_viewer_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := p_viewer_id;
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
    'bio', case when app_private.visible_to(v, p.id, st.bio_visibility) and app_private.context_allowed(v,p.id,'personal') then p.bio end,
    'university', case when app_private.visible_to(v, p.id, st.education_visibility) and app_private.context_allowed(v,p.id,'professional') then p.university end,
    'occupation', case when app_private.visible_to(v, p.id, st.occupation_visibility) and app_private.context_allowed(v,p.id,'professional') then p.occupation end,
    'career_goals', case when app_private.visible_to(v, p.id, st.career_goals_visibility) and app_private.context_allowed(v,p.id,'professional') then p.career_goals end,
    'website_url', case when app_private.visible_to(v, p.id, st.socials_visibility) and app_private.context_allowed(v,p.id,'professional') then p.website_url end,
    'instagram_handle', case when app_private.visible_to(v, p.id, st.socials_visibility) and app_private.context_allowed(v,p.id,'personal') then p.instagram_handle end,
    'linkedin_url', case when app_private.visible_to(v, p.id, st.socials_visibility) and app_private.context_allowed(v,p.id,'professional') then p.linkedin_url end,
    'spotify_url', case when app_private.visible_to(v, p.id, st.socials_visibility) and app_private.context_allowed(v,p.id,'personal') then p.spotify_url end,
    'socials_hidden', not app_private.visible_to(v, p.id, st.socials_visibility)
                      and (p.website_url is not null or p.instagram_handle is not null or p.linkedin_url is not null or p.spotify_url is not null),
    'tags', case when app_private.visible_to(v, p.id, st.tags_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('kind', t.kind, 'name', t.name::text) order by t.kind, t.name)
        from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = p.id
          and ((t.kind in ('interest','hobby','language') and app_private.context_allowed(v,p.id,'personal'))
            or (t.kind in ('skill','career') and app_private.context_allowed(v,p.id,'professional')))), '[]'::jsonb)
      else '[]'::jsonb end,
    'shared_tags', case when v <> p.id and app_private.visible_to(v, p.id, st.tags_visibility) then coalesce((
        select jsonb_agg(distinct t.name::text)
        from public.profile_tags a join public.tags t on t.id = a.tag_id
        join public.tags t2 on t2.name = t.name and (t2.kind = t.kind or (t.kind <> 'language' and t2.kind <> 'language'))
        join public.profile_tags b on b.tag_id = t2.id and b.user_id = v
        where a.user_id = p.id
          and ((t.kind in ('interest','hobby','language') and app_private.context_allowed(v,p.id,'personal'))
            or (t.kind in ('skill','career') and app_private.context_allowed(v,p.id,'professional')))), '[]'::jsonb)
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
        where b.user_id = p.id and b.status = 'active' and s.kind = 'long_term'
          and (v = p.id or (app_private.is_active_member(s.id,v) and app_private.is_active_member(s.id,p.id)))
          and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
      else '[]'::jsonb end,
    'affiliations', case when app_private.visible_to(v, p.id, st.badges_visibility) and app_private.context_allowed(v,p.id,'professional') then coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'org_name', a.org_name, 'domain', a.domain,
                                            'org_name_source', a.org_name_source, 'verified_at', a.verified_at) order by a.verified_at desc)
        from public.verified_affiliations a where a.user_id = p.id and (a.expires_at is null or a.expires_at > now())), '[]'::jsonb)
      else '[]'::jsonb end,
    'endorsements', case when app_private.visible_to(v, p.id, st.endorsements_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'body', e.body, 'created_at', e.created_at,
                                            'author', app_private.mini_card(e.author_id)) order by e.created_at desc)
        from public.endorsements e
        where e.subject_id = p.id and e.status = 'approved'
          and not app_private.is_blocked_between(v, e.author_id)), '[]'::jsonb)
      else '[]'::jsonb end,
    'professional_bio', case when app_private.visible_to(v,p.id,st.bio_visibility) and app_private.context_allowed(v,p.id,'professional') then p.professional_bio end,
    'work_experience', case when app_private.visible_to(v,p.id,st.occupation_visibility) and app_private.context_allowed(v,p.id,'professional') then p.work_experience end,
    'professional_interests', case when app_private.visible_to(v,p.id,st.career_goals_visibility) and app_private.context_allowed(v,p.id,'professional') then p.professional_interests end,
    'social_preferences', case when app_private.visible_to(v,p.id,st.bio_visibility) and app_private.context_allowed(v,p.id,'personal') then p.social_preferences end,
    'prompt_answers', case when app_private.visible_to(v,p.id,st.bio_visibility) and app_private.context_allowed(v,p.id,'personal') then coalesce((
      select jsonb_agg(jsonb_build_object('prompt_key',q.prompt_key,'answer',q.answer) order by q.updated_at desc)
      from public.profile_prompt_answers q where q.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end,
    'photos', case when app_private.context_allowed(v,p.id,'personal') then coalesce((
      select jsonb_agg(jsonb_build_object('id',ph.id,'storage_path',ph.storage_path,'position',ph.position) order by ph.position)
      from public.profile_photos ph where ph.user_id=p.id),'[]'::jsonb) else '[]'::jsonb end,
    'relationship', rel);
end $$;

create or replace function public.get_profile(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select app_private.profile_json(app_private.require_user(false),p_user_id);
$$;

create or replace function public.preview_profile(p_viewer_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare owner_id uuid:=app_private.require_user(false);
begin
  if p_viewer_id is null or p_viewer_id=owner_id or not exists(
    select 1 from public.profiles where id=p_viewer_id and account_status='active') then
    perform app_private.fail('invalid_viewer');
  end if;
  return app_private.profile_json(p_viewer_id,owner_id);
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function app_private.profile_json(uuid,uuid) from authenticated;
grant execute on function public.get_profile(uuid),public.preview_profile(uuid) to authenticated;
