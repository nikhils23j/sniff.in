-- Apply one Server's profile mode to both real views and owner previews.
create or replace function app_private.profile_json_in_server(viewer uuid,target uuid,server_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare mode text; s public.servers; result jsonb;
begin
  select * into s from public.servers where id=server_id;
  if s.id is null or not app_private.is_active_member(server_id,viewer)
     or not app_private.is_active_member(server_id,target) then perform app_private.fail('not_found'); end if;
  select profile_mode into mode from public.server_members where server_id=server_id and user_id=target;
  if s.kind='short_term' and not exists(select 1 from public.venue_sessions vs
    where vs.server_id=server_id and vs.user_id=target and vs.open_to_talk and vs.ends_at>now()) then
    perform app_private.fail('not_found');
  end if;
  result:=app_private.profile_json(viewer,target);
  if mode='personal' then
    result:=result || jsonb_build_object('university',null,'occupation',null,'career_goals',null,
      'professional_bio',null,'work_experience',null,'professional_interests',null,
      'linkedin_url',null,'website_url',null,'affiliations','[]'::jsonb);
    result:=jsonb_set(result,'{tags}',coalesce((select jsonb_agg(t) from jsonb_array_elements(result->'tags') t
      where t->>'kind' in ('interest','hobby','language')),'[]'::jsonb));
  elsif mode='professional' then
    result:=result || jsonb_build_object('bio',null,'social_preferences',null,'instagram_handle',null,
      'spotify_url',null,'prompt_answers','[]'::jsonb,'photos','[]'::jsonb);
    result:=jsonb_set(result,'{tags}',coalesce((select jsonb_agg(t) from jsonb_array_elements(result->'tags') t
      where t->>'kind' in ('skill','career')),'[]'::jsonb));
  end if;
  if s.kind='short_term' then
    result:=result || (select jsonb_build_object('venue_topic',vs.topic,'venue_location_hint',vs.location_hint,
      'venue_expires_at',vs.ends_at) from public.venue_sessions vs
      where vs.server_id=server_id and vs.user_id=target);
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

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function app_private.profile_json_in_server(uuid,uuid,uuid) from authenticated;
grant execute on function public.get_profile_in_server(uuid,uuid),public.preview_profile_in_server(uuid,uuid) to authenticated;
