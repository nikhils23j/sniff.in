-- QR join and the member's sharing decision commit atomically.
create or replace function public.join_server_with_preferences(
  p_token text,p_mode text default 'personal',p_note text default null,
  p_open boolean default false,p_minutes integer default 120,
  p_topic text default null,p_location_hint text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); result jsonb; sid uuid; kind public.server_kind;
begin
  if p_mode not in ('personal','professional','both') then perform app_private.fail('invalid_mode'); end if;
  result:=public.join_server_with_token(p_token);
  if result->>'status'='invalid' then return result; end if;
  sid:=(result->>'server_id')::uuid;
  select s.kind into kind from public.servers s where s.id=sid;
  if result->>'status'='active' then
    perform public.set_server_profile(sid,p_mode,case when kind='long_term' then p_note end);
    if kind='short_term' then
      perform public.set_venue_session(sid,p_open,p_minutes,p_topic,p_location_hint,p_mode);
    end if;
  else
    update public.server_members set profile_mode=p_mode
      where server_id=sid and user_id=v and status='pending';
  end if;
  return result;
end $$;
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.join_server_with_preferences(text,text,text,boolean,integer,text,text) to authenticated;
