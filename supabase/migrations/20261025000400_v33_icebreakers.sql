-- One shared short-lived feed cache avoids a paid API call per connection.
create table if not exists public.icebreaker_cricket_cache (
  id boolean primary key default true check (id),
  fetched_at timestamptz not null,
  matches jsonb not null default '[]'::jsonb
);
alter table public.icebreaker_cricket_cache enable row level security;
revoke all on public.icebreaker_cricket_cache from anon, authenticated;
grant all on public.icebreaker_cricket_cache to service_role;

-- Shared-context suggestions must obey the same section privacy controls as profile views.
create or replace function public.get_icebreaker_context(p_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  c public.connections;
  other uuid;
  sto public.user_settings;
  po public.profiles;
  pm public.profiles;
  personal_ok boolean;
  professional_ok boolean;
begin
  select * into c from public.connections where id = p_connection_id and status = 'active';
  if not found or v not in (c.user_a, c.user_b) then perform app_private.fail('not_found'); end if;
  other := case when c.user_a = v then c.user_b else c.user_a end;
  select * into sto from public.user_settings where user_id = other;
  select * into po from public.profiles where id = other;
  select * into pm from public.profiles where id = v;
  personal_ok := app_private.audience_allows(v,other,'personal');
  professional_ok := app_private.audience_allows(v,other,'professional');
  return jsonb_build_object(
    'other_name', split_part(po.display_name, ' ', 1),
    'shared_tags', coalesce((
      select jsonb_agg(distinct jsonb_build_object('kind', t.kind, 'name', t.name::text))
      from public.profile_tags a join public.tags t on t.id = a.tag_id
      join public.tags t2 on t2.name = t.name and (t2.kind = t.kind or (t.kind <> 'language' and t2.kind <> 'language'))
      join public.profile_tags b on b.tag_id = t2.id and b.user_id = v
      where a.user_id = other
        and (sto.tags_visibility = 'members' or app_private.visible_to(v,other,sto.tags_visibility))
        and ((t.kind in ('interest','hobby','language') and personal_ok)
          or (t.kind in ('skill','career') and professional_ok))), '[]'::jsonb),
    'same_university', case when professional_ok
      and (sto.education_visibility = 'members' or app_private.visible_to(v,other,sto.education_visibility))
      and po.university is not null and lower(btrim(po.university)) = lower(btrim(pm.university))
      then po.university end,
    'their_craving', case when personal_ok
      and (sto.craving_visibility = 'members' or app_private.visible_to(v,other,sto.craving_visibility)) then
      (select body from public.cravings where user_id = other and expires_at > now()
        and (server_id is null or app_private.is_active_member(server_id,v)) limit 1) end,
    'their_occupation', case when professional_ok
      and (sto.occupation_visibility = 'members' or app_private.visible_to(v,other,sto.occupation_visibility))
      then po.occupation end,
    'server_name', (select name from public.servers where id = c.origin_server_id),
    'ai_allowed', (select ai_features_consent from public.user_settings where user_id = v) and sto.ai_features_consent
  );
end $$;
