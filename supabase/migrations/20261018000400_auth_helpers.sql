-- Authorization predicates (app_private, not exposed via the API) and the new-user bootstrap trigger.
-- All are SECURITY DEFINER so they can read tables the caller cannot, and are used inside RLS policies/RPCs.

create or replace function app_private.is_platform_admin(u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select u is not null and exists (select 1 from public.platform_admins where user_id = u);
$$;

create or replace function app_private.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function app_private.is_active_member(s uuid, u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.server_members
    where server_id = s and user_id = u and status = 'active'
  );
$$;

create or replace function app_private.has_membership_row(s uuid, u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.server_members where server_id = s and user_id = u);
$$;

-- A Server is "live" if it is not archived and (for short-term) has not ended.
create or replace function app_private.server_is_live(s uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.servers
    where id = s and not is_archived and (kind <> 'short_term' or ends_at > now())
  );
$$;

-- Role check with downward admin inheritance:
--   * role >= min_role in the Server itself, OR
--   * 'admin' in any ancestor Server, OR
--   * platform admin.
-- Moderator rights are NOT inherited.
create or replace function app_private.has_server_role(s uuid, u uuid, min_role public.member_role)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select u is not null and (
    app_private.is_platform_admin(u)
    or exists (
      with recursive chain (id, parent_id) as (
        select id, parent_id from public.servers where id = s
        union all
        select p.id, p.parent_id from public.servers p join chain c on p.id = c.parent_id
      )
      select 1
      from chain c
      join public.server_members m on m.server_id = c.id and m.user_id = u and m.status = 'active'
      where (c.id = s and m.role >= min_role) or (c.id <> s and m.role = 'admin')
    )
  );
$$;

create or replace function app_private.are_connected(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.connections
    where user_a = least(a, b) and user_b = greatest(a, b) and status = 'active'
  );
$$;

create or replace function app_private.is_available(u uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.presence where user_id = u and available_until > now());
$$;

-- Voluntary gender-based safety filter. Symmetric: if either side chose "same gender only",
-- both must have self-declared the same gender. Gender is never inferred and never returned.
create or replace function app_private.audience_compatible(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select
    (coalesce(pa.discovery_audience, 'everyone') = 'everyone' or (pa.gender is not null and pa.gender = pb.gender))
    and
    (coalesce(pb.discovery_audience, 'everyone') = 'everyone' or (pb.gender is not null and pa.gender = pb.gender))
  from (select 1) x
  left join public.profile_private pa on pa.user_id = a
  left join public.profile_private pb on pb.user_id = b;
$$;

-- Can `viewer` see the (limited) card of `target`? This is the root of profile privacy.
-- Server co-membership alone is NOT sufficient: the target must be live-available there
-- (or have published an activity post there), and the safety filter must pass.
create or replace function app_private.can_view_profile(viewer uuid, target uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if viewer is null or target is null then return false; end if;
  if viewer = target then return true; end if;
  if app_private.is_platform_admin(viewer) then return true; end if;
  if not exists (select 1 from public.profiles where id = target and account_status = 'active' and onboarded_at is not null) then
    return false;
  end if;
  if app_private.is_blocked_between(viewer, target) then return false; end if;
  if app_private.are_connected(viewer, target) then return true; end if;
  if exists (
    select 1 from public.connection_requests
    where status = 'pending'
      and ((sender_id = viewer and recipient_id = target) or (sender_id = target and recipient_id = viewer))
  ) then return true; end if;
  -- Server staff can see members/applicants of Servers they manage.
  if exists (
    select 1 from public.server_members tm
    where tm.user_id = target and app_private.has_server_role(tm.server_id, viewer, 'moderator')
  ) then return true; end if;
  if not app_private.audience_compatible(viewer, target) then return false; end if;
  -- Live-available in a shared live Server.
  if app_private.is_available(target) and exists (
    select 1
    from public.server_members tm
    join public.server_members vm on vm.server_id = tm.server_id and vm.user_id = viewer and vm.status = 'active'
    join public.servers s on s.id = tm.server_id
    where tm.user_id = target and tm.status = 'active' and tm.discoverable
      and not s.is_archived and (s.kind <> 'short_term' or s.ends_at > now())
  ) then return true; end if;
  -- Author of an active post in a live Server the viewer belongs to.
  if exists (
    select 1
    from public.activity_posts p
    join public.server_members vm on vm.server_id = p.server_id and vm.user_id = viewer and vm.status = 'active'
    join public.server_members am on am.server_id = p.server_id and am.user_id = target and am.status = 'active'
    join public.servers s on s.id = p.server_id
    where p.author_id = target and p.status = 'active' and (p.expires_at is null or p.expires_at > now())
      and not s.is_archived and (s.kind <> 'short_term' or s.ends_at > now())
  ) then return true; end if;
  return false;
end $$;

-- Field-level visibility resolution.
create or replace function app_private.visible_to(viewer uuid, target uuid, vis public.field_visibility)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when viewer = target then true
    when vis = 'only_me' then false
    when vis = 'connections' then app_private.are_connected(viewer, target)
    else app_private.can_view_profile(viewer, target)
  end;
$$;

-- Returns the caller's id or raises. Suspended users cannot act; most actions require onboarding.
create or replace function app_private.require_user(require_onboarded boolean default true)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v uuid := auth.uid();
  st public.account_status;
  ob timestamptz;
begin
  if v is null then perform app_private.fail('not_authenticated'); end if;
  select account_status, onboarded_at into st, ob from public.profiles where id = v;
  if not found then perform app_private.fail('not_authenticated', 'Profile missing'); end if;
  if st = 'suspended' then perform app_private.fail('account_suspended', 'Your account is suspended'); end if;
  if require_onboarded and ob is null then perform app_private.fail('onboarding_required'); end if;
  return v;
end $$;

-- Sliding-window rate limiter keyed by the caller.
create or replace function app_private.rate_limit(p_action text, max_count integer, win interval)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v uuid := auth.uid();
  n integer;
begin
  if v is null then perform app_private.fail('not_authenticated'); end if;
  select count(*) into n from public.rate_limit_events
    where user_id = v and action = p_action and created_at > now() - win;
  if n >= max_count then
    perform app_private.fail('rate_limited', 'Too many attempts. Please wait a little and try again.');
  end if;
  insert into public.rate_limit_events (user_id, action) values (v, p_action);
end $$;

create or replace function app_private.audit(
  p_action text, p_server uuid default null, p_target_user uuid default null,
  p_target_post uuid default null, p_report uuid default null, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.moderation_actions (actor_id, action, server_id, target_user_id, target_post_id, report_id, details)
  values (auth.uid(), p_action, p_server, p_target_user, p_target_post, p_report, coalesce(p_details, '{}'::jsonb));
$$;

-- Notification fan-in with per-category preferences and idempotent dedupe keys.
create or replace function app_private.notify(
  p_user uuid, p_type text, p_title text, p_body text default null,
  p_actor uuid default null, p_server uuid default null, p_request uuid default null,
  p_conversation uuid default null, p_post uuid default null, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  st public.user_settings;
begin
  if p_user is null or p_user = p_actor then return; end if;
  select * into st from public.user_settings where user_id = p_user;
  if found and (
       (p_type = 'connection_request' and not st.notify_requests)
    or (p_type = 'message' and not st.notify_messages)
    or (p_type = 'activity_response' and not st.notify_activity)
    or (p_type in ('server_membership','badge_granted') and not st.notify_servers)
    or (p_type = 'server_announcement' and not st.notify_announcements)
  ) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, actor_id, server_id, request_id, conversation_id, post_id, dedupe_key)
  values (p_user, p_type, left(p_title, 120), left(p_body, 300), p_actor, p_server, p_request, p_conversation, p_post, p_dedupe)
  on conflict (user_id, dedupe_key) do update
    set title = excluded.title, body = excluded.body, created_at = now(), read_at = null, pushed_at = null;
end $$;

-- ---------------------------------------------------------------- new user bootstrap
create or replace function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'user_' || substr(md5(new.id::text), 1, 10),
    coalesce(left(btrim(new.raw_user_meta_data ->> 'display_name'), 60), '')
  );
  insert into public.profile_private (user_id) values (new.id);
  insert into public.user_settings (user_id) values (new.id);
  insert into public.presence (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
