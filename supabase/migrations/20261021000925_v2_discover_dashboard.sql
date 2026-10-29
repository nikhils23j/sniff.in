-- V2 Discover dashboard: one call returning small, curated sections from real data.

create or replace function app_private.server_card(s public.servers)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'category', s.category, 'city', s.city,
    'avatar_path', s.avatar_path, 'member_count', s.member_count, 'is_official', s.is_official,
    'join_policy', s.join_policy, 'ends_at', s.ends_at,
    'parent_name', (select p.name from public.servers p where p.id = s.parent_id));
$$;

create or replace function public.discover_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  global_on boolean := exists (select 1 from public.feature_flags f where f.key = 'global_discovery' and f.enabled);
  result jsonb;
begin
  with explorable as (
    -- Listed, live Servers the user has no membership row in.
    select s.* from public.servers s
    where s.visibility = 'listed' and not s.is_archived
      and (s.kind <> 'short_term' or s.ends_at > now())
      and (s.kind <> 'global' or global_on)
      and not exists (select 1 from public.server_members m where m.server_id = s.id and m.user_id = v)
  ),
  engagement as (
    select e.id,
      (select count(*) from public.activity_posts p where p.server_id = e.id and p.created_at > now() - interval '7 days') as posts_7d,
      (select count(*) from public.server_members m where m.server_id = e.id and m.status = 'active' and m.created_at > now() - interval '7 days') as joins_7d,
      (select count(*) from public.server_members m where m.server_id = e.id and m.status = 'active'
         and m.created_at between now() - interval '14 days' and now() - interval '7 days') as joins_prev_7d,
      (select count(distinct sv.user_id) from public.server_visits sv where sv.server_id = e.id and sv.day > current_date - 7) as visitors_7d,
      (select count(distinct sv.user_id) from public.server_visits sv where sv.server_id = e.id
         and sv.day between current_date - 14 and current_date - 7) as visitors_prev_7d
    from explorable e
  ),
  popular as (
    select app_private.server_card(e) || jsonb_build_object(
             'reason', e.member_count || ' members' || case when g.joins_7d > 0 then ' · ' || g.joins_7d || ' joined this week' else '' end) as card,
           (e.member_count + 3 * g.posts_7d + 2 * g.joins_7d + g.visitors_7d) as score
    from explorable e join engagement g on g.id = e.id
    where e.member_count > 0
    order by score desc, e.member_count desc, e.name limit 6
  ),
  trending as (
    select app_private.server_card(e) || jsonb_build_object(
             'reason', (g.joins_7d + g.visitors_7d) || ' new visitors & members this week') as card,
           ((g.joins_7d + g.visitors_7d) - (g.joins_prev_7d + g.visitors_prev_7d))::numeric
             / (g.joins_prev_7d + g.visitors_prev_7d + 1) as growth
    from explorable e join engagement g on g.id = e.id
    where (g.joins_7d + g.visitors_7d) >= 3                                    -- enough real signal
      and (g.joins_7d + g.visitors_7d) > (g.joins_prev_7d + g.visitors_prev_7d)
    order by growth desc, e.name limit 6
  ),
  my_servers as (
    select m.server_id from public.server_members m where m.user_id = v and m.status = 'active'
  ),
  my_tags as (
    select t.name::text as name from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = v
  ),
  suggested as (
    select app_private.server_card(e) || jsonb_build_object('reason',
             case when e.parent_id in (select server_id from my_servers)
                  then 'Inside ' || (select p.name from public.servers p where p.id = e.parent_id)
                  else 'Matches your interest in ' || (
                    select mt.name from my_tags mt where char_length(mt.name) >= 3
                      and (e.name ilike '%' || mt.name || '%' or coalesce(e.description, '') ilike '%' || mt.name || '%') limit 1)
             end) as card,
           (case when e.parent_id in (select server_id from my_servers) then 5 else 0 end
            + (select count(*) from my_tags mt where char_length(mt.name) >= 3
                and (e.name ilike '%' || mt.name || '%' or coalesce(e.description, '') ilike '%' || mt.name || '%')) * 3) as score
    from explorable e
    -- Children of my Servers are suggestable even when unlisted only if I could see them; keep to explorable.
  ),
  activities as (
    select to_jsonb(a) as item from public.list_activity(null, null, 30, 'for_you', 0) a
    where not a.is_mine and not a.is_full and a.my_response is null
    limit 6
  )
  select jsonb_build_object(
    'popular_servers', coalesce((select jsonb_agg(card order by score desc) from popular), '[]'::jsonb),
    'trending_servers', coalesce((select jsonb_agg(card order by growth desc) from trending), '[]'::jsonb),
    'suggested_servers', coalesce((select jsonb_agg(card order by score desc) from (select * from suggested where score > 0 order by score desc limit 6) x), '[]'::jsonb),
    'activities_for_you', coalesce((select jsonb_agg(item) from activities), '[]'::jsonb),
    'open_to_talk_nearby', app_private.available_bucket((
       select count(distinct tm.user_id) from public.server_members vm
       join public.server_members tm on tm.server_id = vm.server_id and tm.status = 'active' and tm.discoverable and tm.user_id <> v
       join public.presence pr on pr.user_id = tm.user_id and pr.is_available and pr.open_to_talk
       join public.profiles p on p.id = tm.user_id and p.account_status = 'active'
                             and coalesce(p.last_active_at, p.created_at) > now() - interval '14 days'
       where vm.user_id = v and vm.status = 'active'
         and not app_private.is_blocked_between(v, tm.user_id))),
    'my_server_count', (select count(*) from my_servers),
    'computed_at', now()
  ) into result;
  return result;
end $$;

grant execute on function public.discover_dashboard() to authenticated;
grant execute on function app_private.server_card(public.servers) to authenticated, service_role;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
