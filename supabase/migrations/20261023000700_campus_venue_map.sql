-- On-site activity is counted at public venue coordinates; individual device
-- coordinates and location hints never enter the aggregate.

create or replace function public.venue_hot_map(
  p_min_lat double precision,p_min_lng double precision,p_max_lat double precision,p_max_lng double precision)
returns table(lat numeric,lng numeric,people integer,people_label text,intensity numeric,
  as_of timestamptz,server_ids uuid[],server_names text[])
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(false); span double precision;
begin
  span:=greatest(p_max_lat-p_min_lat,p_max_lng-p_min_lng);
  if span<=0 or span>20 then perform app_private.fail('area_too_large'); end if;
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

create or replace function public.venue_nearby(p_lat numeric,p_lng numeric,p_radius_km numeric default 5)
returns table(server_id uuid,name text,category text,venue_lat numeric,venue_lng numeric,
  participants integer,open_to_talk integer,ends_at timestamptz)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(false); delta numeric;
begin
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_km not between 1 and 20 then
    perform app_private.fail('invalid_location');
  end if;
  delta:=p_radius_km/100;
  return query
  select s.id,s.name,s.category,s.venue_lat,s.venue_lng,
    count(distinct vs.user_id)::integer,
    count(distinct vs.user_id) filter(where vs.open_to_talk)::integer,s.ends_at
  from public.servers s join public.venue_sessions vs on vs.server_id=s.id and vs.ends_at>now()
  join public.server_members m on m.server_id=s.id and m.user_id=vs.user_id and m.status='active'
  join public.profiles p on p.id=vs.user_id and p.account_status='active'
  where s.kind='short_term' and s.visibility='listed' and not s.is_archived and s.ends_at>now()
    and s.venue_lat between p_lat-delta and p_lat+delta
    and s.venue_lng between p_lng-delta and p_lng+delta
  group by s.id having count(distinct vs.user_id)>=3
  order by count(distinct vs.user_id) filter(where vs.open_to_talk) desc,s.id
  limit 20;
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.venue_hot_map(double precision,double precision,double precision,double precision),
  public.venue_nearby(numeric,numeric,numeric) to authenticated;
