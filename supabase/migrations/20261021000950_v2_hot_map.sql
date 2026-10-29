-- V2 Hot Map: opt-in, coarse (~1 km), expiring location → aggregated counts only (k ≥ 3).

alter table public.user_settings add column if not exists hot_map_opt_in boolean not null default false;
grant update (hot_map_opt_in) on public.user_settings to authenticated;

-- One row per opted-in user: ONLY the rounded grid cell is stored (0.01° ≈ 1.1 km), never raw coordinates.
create table public.location_cells (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  cell_lat numeric(6,2) not null check (cell_lat between -90 and 90),
  cell_lng numeric(6,2) not null check (cell_lng between -180 and 180),
  updated_at timestamptz not null default now()
);
create index location_cells_recent on public.location_cells (updated_at);
alter table public.location_cells enable row level security;   -- no client access at all
revoke all on public.location_cells from anon, authenticated;
grant all on public.location_cells to service_role;

-- Opting out deletes the stored cell immediately.
create or replace function app_private.hot_map_opt_out()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.hot_map_opt_in then delete from public.location_cells where user_id = new.user_id; end if;
  return new;
end $$;
create trigger user_settings_hot_map_opt_out after update of hot_map_opt_in on public.user_settings
  for each row execute function app_private.hot_map_opt_out();

-- Going unavailable also removes you from the map.
create or replace function app_private.presence_hot_map_clear()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.is_available then delete from public.location_cells where user_id = new.user_id; end if;
  return new;
end $$;
create trigger presence_hot_map_clear after update of is_available on public.presence
  for each row execute function app_private.presence_hot_map_clear();

create or replace function public.update_my_location(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not exists (select 1 from public.feature_flags where key = 'vibe_map' and enabled) then
    perform app_private.fail('feature_disabled', 'The Hot Map is not enabled');
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    perform app_private.fail('invalid_location');
  end if;
  if not exists (select 1 from public.user_settings where user_id = v and hot_map_opt_in) then
    perform app_private.fail('not_opted_in', 'Turn on Hot Map sharing first');
  end if;
  if not app_private.is_available(v) then
    delete from public.location_cells where user_id = v;
    return jsonb_build_object('shared', false);
  end if;
  perform app_private.rate_limit('update_location', 12, interval '1 hour');
  insert into public.location_cells (user_id, cell_lat, cell_lng, updated_at)
    values (v, round(p_lat::numeric, 2), round(p_lng::numeric, 2), now())
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng, updated_at = now();
  return jsonb_build_object('shared', true, 'expires_in_minutes', 30);
end $$;

create or replace function public.clear_my_location()
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from public.location_cells where user_id = auth.uid();
$$;

-- Aggregated activity inside a bounding box. Anti re-identification design:
--   * the SERVER picks the grid from the box size (client hint ignored), and the box is snapped OUTWARD to whole grid
--     cells, so trimming the box can't split a cell;
--   * counts are returned only as ranges (3–4, 5–9, 10–19, 20–49, 50+), never exact numbers, and cells < 3 are hidden;
--   * counting is the same for every viewer (no per-viewer block filtering, which would leak via differencing);
--   * only accounts older than 24 hours count (limits throwaway accounts used to "pad" a cell);
--   * "as of" is coarsened to 5 minutes.
create or replace function public.hot_map(
  p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision,
  p_cell_deg numeric default null)
returns table (lat numeric, lng numeric, people integer, people_label text, intensity numeric, as_of timestamptz)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  v uuid := app_private.require_user();
  span double precision := greatest(p_max_lat - p_min_lat, p_max_lng - p_min_lng);
  g numeric;
  lo_lat numeric; lo_lng numeric; hi_lat numeric; hi_lng numeric;
begin
  if not exists (select 1 from public.feature_flags where key = 'vibe_map' and enabled) then
    perform app_private.fail('feature_disabled', 'The Hot Map is not enabled');
  end if;
  if span > 20 or span <= 0 then
    perform app_private.fail('area_too_large', 'Zoom in to see activity');
  end if;
  g := case when span > 8 then 1 when span > 3 then 0.5 when span > 0.8 then 0.1 when span > 0.2 then 0.05 else 0.01 end;
  lo_lat := floor(p_min_lat::numeric / g) * g;  lo_lng := floor(p_min_lng::numeric / g) * g;
  hi_lat := ceil(p_max_lat::numeric / g) * g;   hi_lng := ceil(p_max_lng::numeric / g) * g;
  return query
  with live as (
    select floor(c.cell_lat / g) * g + g / 2 as clat, floor(c.cell_lng / g) * g + g / 2 as clng
    from public.location_cells c
    join public.presence p on p.user_id = c.user_id and p.is_available
    join public.profiles pr on pr.id = c.user_id and pr.account_status = 'active' and pr.created_at < now() - interval '24 hours'
    where c.updated_at > now() - interval '30 minutes'
      and c.cell_lat >= lo_lat and c.cell_lat < hi_lat and c.cell_lng >= lo_lng and c.cell_lng < hi_lng
  ),
  agg as (select clat, clng, count(*)::integer as n from live group by clat, clng having count(*) >= 3),
  bucketed as (
    select clat, clng,
      case when n >= 50 then 50 when n >= 20 then 20 when n >= 10 then 10 when n >= 5 then 5 else 3 end as floor_n
    from agg
  )
  select round(b.clat, 3), round(b.clng, 3), b.floor_n,
         case b.floor_n when 50 then '50+' when 20 then '20–49' when 10 then '10–19' when 5 then '5–9' else '3–4' end,
         round(b.floor_n::numeric / greatest((select max(floor_n) from bucketed), 1), 2),
         date_trunc('hour', now()) + floor(extract(minute from now()) / 5) * interval '5 minutes'
  from bucketed b
  order by b.floor_n desc
  limit 500;
end $$;

grant execute on function public.update_my_location(double precision, double precision), public.clear_my_location(),
  public.hot_map(double precision, double precision, double precision, double precision, numeric) to authenticated;
grant execute on function app_private.hot_map_opt_out(), app_private.presence_hot_map_clear() to authenticated, service_role;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
