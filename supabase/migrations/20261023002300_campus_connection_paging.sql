-- R09: page connections before building profile cards, so older friends remain
-- reachable and large accounts never render the entire directory at once.
create or replace function public.list_connections_page(
  p_friends_only boolean default false, p_before_at timestamptz default null,
  p_before_id uuid default null, p_snapshot_at timestamptz default null,
  p_limit integer default 30)
returns table (
  connection_id uuid, conversation_id uuid, other jsonb, is_friend boolean,
  i_saved boolean, they_saved boolean, expires_at timestamptz,
  origin_server_id uuid, origin_server_name text, created_at timestamptz,
  cursor_at text, snapshot_at text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with boundary as (select coalesce(p_snapshot_at, now()) as at),
  candidates as materialized (
    select c.* from boundary join public.connections c on c.created_at <= boundary.at
    where (c.user_a = auth.uid() or c.user_b = auth.uid())
      and c.status = 'active'
      and (not p_friends_only or (c.a_saved and c.b_saved))
      and (p_before_at is null or (c.created_at, c.id) < (p_before_at, p_before_id))
    order by c.created_at desc, c.id desc
    limit least(greatest(p_limit, 1), 50)
  )
  select c.id, cv.id,
    app_private.mini_card(case when c.user_a = auth.uid() then c.user_b else c.user_a end),
    c.a_saved and c.b_saved,
    case when c.user_a = auth.uid() then c.a_saved else c.b_saved end,
    case when c.user_a = auth.uid() then c.b_saved else c.a_saved end,
    c.expires_at, c.origin_server_id, s.name, c.created_at,
    to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(boundary.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  from candidates c cross join boundary
  left join public.conversations cv on cv.connection_id = c.id
  left join public.servers s on s.id = c.origin_server_id
  order by c.created_at desc, c.id desc;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
grant execute on function public.list_connections_page(boolean,timestamptz,uuid,timestamptz,integer)
  to authenticated;
