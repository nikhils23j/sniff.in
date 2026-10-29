-- V3.1 server-side fixes from the code review.
--  * Profile text limits now match the app's form limits (long professional bios failed the whole save).
--  * Member directory: temporary Servers list only people Open to Talk (plus staff/self); permanent Servers respect
--    "Visible in this Server". Every listed card can be opened.
--  * venue_people returns an empty list after the event ends instead of failing (Home showed an error screen),
--    and includes each person's interests for the Home cards.
--  * venue_hot_map returns nothing for a zoomed-out view instead of failing.
--  * Only admins create/revoke invites (adding members is an admin power; moderators assign badges).
--  * Join preview includes the Server's member-field label so the app can ask for it while joining.
--  * Staff member list hides expired badges.

-- ------------------------------------------------------------------ profile text limits
alter table public.profiles drop constraint if exists profiles_professional_bio_check;
alter table public.profiles drop constraint if exists profiles_work_experience_check;
alter table public.profiles drop constraint if exists profiles_social_preferences_check;
alter table public.profiles drop constraint if exists profiles_professional_interests_check;
alter table public.profiles
  add constraint profiles_professional_bio_check check (char_length(professional_bio) <= 500),
  add constraint profiles_work_experience_check check (char_length(work_experience) <= 400),
  add constraint profiles_social_preferences_check check (char_length(social_preferences) <= 300),
  add constraint profiles_professional_interests_check check (char_length(professional_interests) <= 300);

-- ------------------------------------------------------------------ directory
create or replace function public.server_directory(p_server_id uuid,p_limit integer default 50,p_offset integer default 0)
returns table(user_id uuid,username text,display_name text,avatar_path text,role public.member_role,
  joined_at timestamptz,profile_mode text,member_note text,badges jsonb)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(); k public.server_kind;
begin
 if not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden'); end if;
 select s.kind into k from public.servers s where s.id=p_server_id;
 return query select m.user_id,p.username::text,p.display_name,p.avatar_path,m.role,m.created_at,
   m.profile_mode,m.member_note,
   case when k='long_term' then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'kind',b.kind,'label',b.label,'expires_at',b.expires_at))
     from public.server_badges b where b.server_id=p_server_id and b.user_id=m.user_id and b.status='active'
       and (b.expires_at is null or b.expires_at>now())),'[]'::jsonb) else '[]'::jsonb end
 from public.server_members m join public.profiles p on p.id=m.user_id
 where m.server_id=p_server_id and m.status='active' and p.account_status='active'
   and not app_private.is_blocked_between(v,m.user_id)
   and (m.user_id=v or m.role<>'member' or (
     case when k='short_term' then exists(select 1 from public.venue_sessions vs where vs.server_id=m.server_id
            and vs.user_id=m.user_id and vs.open_to_talk and vs.ends_at>now())
          else m.discoverable end))
 order by (m.role='admin') desc,(m.role='moderator') desc,m.created_at,m.user_id
 limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $$;

-- ------------------------------------------------------------------ venue people
drop function if exists public.venue_people(uuid,integer);
create function public.venue_people(p_server_id uuid, p_limit integer default 30)
returns table(user_id uuid, username text, display_name text, avatar_path text,
  topic text, location_hint text, profile_mode text, ends_at timestamptz, interests text[], shared_interests text[])
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden'); end if;
  if not app_private.server_is_live(p_server_id) then return; end if;
  return query
    select vs.user_id, p.username::text, p.display_name, p.avatar_path,
      vs.topic, vs.location_hint, vs.profile_mode, vs.ends_at,
      case when coalesce(st.tags_visibility,'members')='members' then coalesce((
        select array_agg(t.name::text order by t.name) from public.profile_tags pt join public.tags t on t.id=pt.tag_id
        where pt.user_id=vs.user_id and t.kind in ('interest','hobby')),'{}') else '{}' end,
      case when coalesce(st.tags_visibility,'members')='members' then coalesce((
        select array_agg(distinct t.name::text) from public.profile_tags pt join public.tags t on t.id=pt.tag_id
        join public.profile_tags mine on mine.tag_id=t.id and mine.user_id=v
        where pt.user_id=vs.user_id),'{}') else '{}' end
    from public.venue_sessions vs join public.profiles p on p.id = vs.user_id
    join public.server_members m on m.server_id = vs.server_id and m.user_id = vs.user_id
    left join public.user_settings st on st.user_id = vs.user_id
    where vs.server_id = p_server_id and vs.user_id <> v and vs.open_to_talk
      and vs.ends_at > now() and m.status = 'active' and m.discoverable
      and p.account_status = 'active' and not app_private.is_blocked_between(v,vs.user_id)
      and app_private.audience_compatible(v,vs.user_id)
    order by vs.updated_at desc, vs.user_id limit least(greatest(p_limit,1),50);
end $$;

-- ------------------------------------------------------------------ hot map: zoomed out = no data, not an error
create or replace function public.venue_hot_map(
  p_min_lat double precision,p_min_lng double precision,p_max_lat double precision,p_max_lng double precision)
returns table(lat numeric,lng numeric,people integer,people_label text,intensity numeric,
  as_of timestamptz,server_ids uuid[],server_names text[])
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(false); span double precision;
begin
  span:=greatest(p_max_lat-p_min_lat,p_max_lng-p_min_lng);
  if span is null or span<=0 or span>20 then return; end if;
  return query with live as (
    select s.id,s.name,s.venue_lat,s.venue_lng,vs.user_id
    from public.servers s join public.venue_sessions vs on vs.server_id=s.id and vs.ends_at>now()
    join public.server_members m on m.server_id=s.id and m.user_id=vs.user_id and m.status='active'
    join public.profiles p on p.id=vs.user_id and p.account_status='active'
    where s.kind='short_term' and s.visibility='listed' and not s.is_archived and s.ends_at>now()
      and s.venue_lat between p_min_lat and p_max_lat and s.venue_lng between p_min_lng and p_max_lng
  ), agg as (
    select venue_lat,venue_lng,count(distinct user_id)::integer as n,
      array_agg(distinct id) as ids,array_agg(distinct name) as names
    from live group by venue_lat,venue_lng having count(distinct user_id)>=3
  ), bucketed as (
    select a.*,case when n>=50 then 50 when n>=20 then 20 when n>=10 then 10 when n>=5 then 5 else 3 end as floor_n
    from agg a
  )
  select b.venue_lat,b.venue_lng,b.floor_n,
    case b.floor_n when 50 then '50+' when 20 then '20–49' when 10 then '10–19'
      when 5 then '5–9' else '3–4' end,
    round(b.floor_n::numeric/greatest((select max(floor_n) from bucketed),1),2),
    date_trunc('hour',now())+floor(extract(minute from now())/5)*interval '5 minutes',
    b.ids,b.names
  from bucketed b order by b.floor_n desc limit 250;
end $$;

-- ------------------------------------------------------------------ invites: admins only
create or replace function public.create_join_token(
  p_server_id uuid, p_kind text default 'qr', p_expires_minutes integer default null,
  p_max_uses integer default null, p_label text default null)
returns public.server_join_tokens language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
  tok text;
  exp timestamptz;
  row public.server_join_tokens;
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then
    perform app_private.fail('forbidden', 'Only Server admins can create invites');
  end if;
  perform app_private.rate_limit('create_join_token', 50, interval '1 hour');
  select * into s from public.servers where id = p_server_id;
  if not app_private.server_is_live(p_server_id) then
    perform app_private.fail('server_closed', 'This Server has ended or is archived');
  end if;
  if p_kind not in ('qr','link','code') then perform app_private.fail('invalid_kind'); end if;
  if p_expires_minutes is not null and p_expires_minutes not between 5 and 525600 then
    perform app_private.fail('invalid_duration');
  end if;
  exp := case when p_expires_minutes is not null then now() + make_interval(mins => p_expires_minutes) end;
  if s.kind = 'short_term' then exp := least(coalesce(exp, s.ends_at), s.ends_at); end if;
  tok := case when p_kind = 'code' then app_private.random_code(8)
              else translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_') end;
  insert into public.server_join_tokens (server_id, kind, token, label, created_by, expires_at, max_uses)
    values (p_server_id, p_kind, tok, nullif(btrim(p_label), ''), v, exp, p_max_uses)
    returning * into row;
  perform app_private.audit('join_token_created', p_server_id, null, null, null, jsonb_build_object('token_id', row.id, 'kind', p_kind));
  return row;
end $$;

create or replace function public.revoke_join_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s uuid;
begin
  select server_id into s from public.server_join_tokens where id = p_token_id;
  if s is null or not app_private.has_server_role(s, v, 'admin') then perform app_private.fail('forbidden'); end if;
  update public.server_join_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_token_id;
  perform app_private.audit('join_token_revoked', s, null, null, null, jsonb_build_object('token_id', p_token_id));
end $$;

-- ------------------------------------------------------------------ join preview: member field
create or replace function public.preview_join_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  t public.server_join_tokens;
  s public.servers;
begin
  perform app_private.rate_limit('join_attempt', 20, interval '10 minutes');
  t := app_private.valid_token(p_token);
  if t.id is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into s from public.servers where id = t.server_id;
  return jsonb_build_object('status', 'valid',
    'server_id', s.id, 'name', s.name, 'kind', s.kind, 'category', s.category, 'description', s.description,
    'is_official', s.is_official, 'member_count', s.member_count, 'join_policy', s.join_policy,
    'ends_at', s.ends_at, 'ephemeral_chats', s.ephemeral_chats, 'avatar_path', s.avatar_path,
    'member_field_label', s.member_field_label, 'member_field_hint', s.member_field_hint,
    'parent_name', (select name from public.servers where id = s.parent_id),
    'requires_parent_membership', s.requires_parent_membership,
    'my_status', (select status from public.server_members where server_id = s.id and user_id = v));
end $$;

-- ------------------------------------------------------------------ staff list: hide expired badges
create or replace function public.list_server_members(
  p_server_id uuid, p_status public.member_status default 'active', p_query text default '', p_limit integer default 50, p_offset integer default 0)
returns table (
  user_id uuid, username text, display_name text, avatar_path text, role public.member_role,
  status public.member_status, joined_at timestamptz, ban_reason text, badges jsonb)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  return query
    select m.user_id, pr.username::text, pr.display_name, pr.avatar_path, m.role, m.status, m.created_at, m.ban_reason,
           coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'expires_at', b.expires_at,
                                                         'issued_by', b.issued_by))
                     from public.server_badges b where b.server_id = p_server_id and b.user_id = m.user_id and b.status = 'active'
                       and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
    from public.server_members m join public.profiles pr on pr.id = m.user_id
    where m.server_id = p_server_id and m.status = p_status
      and (coalesce(p_query, '') = '' or pr.display_name ilike '%' || p_query || '%' or pr.username::text ilike '%' || p_query || '%')
    order by (m.role = 'admin') desc, (m.role = 'moderator') desc, m.created_at desc
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.server_directory(uuid,integer,integer),public.venue_people(uuid,integer),
  public.venue_hot_map(double precision,double precision,double precision,double precision),
  public.create_join_token(uuid,text,integer,integer,text),public.revoke_join_token(uuid),
  public.preview_join_token(text),
  public.list_server_members(uuid,public.member_status,text,integer,integer) to authenticated;
