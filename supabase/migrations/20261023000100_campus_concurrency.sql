-- Campus pilot: bounded, transactionally correct counters and limits.

create or replace function app_private.server_member_count()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_active integer := 0;
  new_active integer := 0;
begin
  if tg_op <> 'INSERT' and old.status = 'active' then old_active := 1; end if;
  if tg_op <> 'DELETE' and new.status = 'active' then new_active := 1; end if;
  if tg_op = 'UPDATE' and new.server_id <> old.server_id then
    update public.servers set member_count = greatest(0, member_count - old_active) where id = old.server_id;
    update public.servers set member_count = member_count + new_active where id = new.server_id;
  elsif tg_op = 'INSERT' then
    if new_active <> 0 then update public.servers set member_count = member_count + 1 where id = new.server_id; end if;
  elsif tg_op = 'DELETE' then
    if old_active <> 0 then update public.servers set member_count = greatest(0, member_count - 1) where id = old.server_id; end if;
  elsif old_active <> new_active then
    update public.servers set member_count = greatest(0, member_count + new_active - old_active) where id = new.server_id;
  end if;
  return null;
end $$;

-- Operators can repair counts after bulk imports or an interrupted maintenance operation.
create or replace function public.reconcile_server_member_counts()
returns integer language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare changed integer;
begin
  if current_user <> 'service_role' and session_user <> 'postgres' then
    perform app_private.fail('forbidden');
  end if;
  with counts as (
    select s.id, count(m.user_id)::integer as actual
    from public.servers s left join public.server_members m on m.server_id = s.id and m.status = 'active'
    group by s.id
  )
  update public.servers s set member_count = c.actual
  from counts c where s.id = c.id and s.member_count <> c.actual;
  get diagnostics changed = row_count;
  return changed;
end $$;

-- Serialize attempts for the same actor and action. The lock is held until transaction end.
create or replace function app_private.rate_limit(p_action text, max_count integer, win interval)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v uuid := auth.uid();
  n integer;
begin
  if v is null then perform app_private.fail('not_authenticated'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text || ':' || p_action, 0));
  select count(*) into n from public.rate_limit_events
    where user_id = v and action = p_action and created_at > clock_timestamp() - win;
  if n >= max_count then
    perform app_private.fail('rate_limited', 'Too many attempts. Please wait a little and try again.');
  end if;
  insert into public.rate_limit_events (user_id, action) values (v, p_action);
end $$;

-- set_post_response locks the post row before reserving a seat. Capacity edits must
-- obey the same row lock and may never evict committed attendees implicitly.
create or replace function app_private.activity_capacity_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare attending integer;
begin
  if new.capacity is distinct from old.capacity and new.capacity is not null then
    select count(*) into attending from public.activity_responses
      where post_id = new.id and kind = 'in';
    if attending > new.capacity then
      perform app_private.fail('capacity_below_attendance', 'Capacity cannot be lower than current attendance');
    end if;
  end if;
  return new;
end $$;
create trigger activity_capacity_guard before update of capacity on public.activity_posts
  for each row execute function app_private.activity_capacity_guard();

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
revoke execute on function public.reconcile_server_member_counts() from authenticated;
grant execute on function public.reconcile_server_member_counts() to service_role;
