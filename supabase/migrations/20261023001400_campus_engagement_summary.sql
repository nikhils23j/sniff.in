-- R07: sharded daily engagement counters avoid repeated scans of all posts,
-- memberships and visits on every Home request. Daily windows are intentionally
-- calendar days; the UI describes them as recent activity, not unique visitors.
create table app_private.server_engagement_daily (
  server_id uuid not null references public.servers(id) on delete cascade,
  day date not null,
  shard smallint not null check(shard between 0 and 15),
  posts integer not null default 0 check(posts>=0),
  joins integer not null default 0 check(joins>=0),
  visits integer not null default 0 check(visits>=0),
  primary key(server_id,day,shard)
);
revoke all on app_private.server_engagement_daily from public,anon,authenticated;
grant all on app_private.server_engagement_daily to service_role;

insert into app_private.server_engagement_daily(server_id,day,shard,posts)
select server_id,created_at::date,(hashtext(id::text)&15)::smallint,count(*)::integer
from public.activity_posts group by server_id,created_at::date,(hashtext(id::text)&15)::smallint
on conflict(server_id,day,shard) do update set posts=excluded.posts;
insert into app_private.server_engagement_daily(server_id,day,shard,joins)
select server_id,created_at::date,(hashtext(user_id::text)&15)::smallint,count(*)::integer
from public.server_members where status='active'
group by server_id,created_at::date,(hashtext(user_id::text)&15)::smallint
on conflict(server_id,day,shard) do update set joins=excluded.joins;
insert into app_private.server_engagement_daily(server_id,day,shard,visits)
select server_id,day,(hashtext(user_id::text)&15)::smallint,count(*)::integer
from public.server_visits group by server_id,day,(hashtext(user_id::text)&15)::smallint
on conflict(server_id,day,shard) do update set visits=excluded.visits;

create or replace function app_private.engagement_delta(s uuid,d date,b smallint,kind text,delta integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if delta=0 then return; end if;
  if delta<0 then
    update app_private.server_engagement_daily
      set posts=posts+case when kind='posts' then delta else 0 end,
          joins=joins+case when kind='joins' then delta else 0 end,
          visits=visits+case when kind='visits' then delta else 0 end
      where server_id=s and day=d and shard=b;
    return;
  end if;
  insert into app_private.server_engagement_daily(server_id,day,shard,posts,joins,visits)
  values(s,d,b,case when kind='posts' then delta else 0 end,
    case when kind='joins' then delta else 0 end,case when kind='visits' then delta else 0 end)
  on conflict(server_id,day,shard) do update set
    posts=app_private.server_engagement_daily.posts+excluded.posts,
    joins=app_private.server_engagement_daily.joins+excluded.joins,
    visits=app_private.server_engagement_daily.visits+excluded.visits;
end $$;

create or replace function app_private.engagement_posts_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' then
    perform app_private.engagement_delta(old.server_id,old.created_at::date,(hashtext(old.id::text)&15)::smallint,'posts',-1);
  end if;
  if tg_op<>'DELETE' then
    perform app_private.engagement_delta(new.server_id,new.created_at::date,(hashtext(new.id::text)&15)::smallint,'posts',1);
  end if;
  return null;
end $$;
create trigger engagement_posts after insert or delete or update of server_id,created_at on public.activity_posts
for each row execute function app_private.engagement_posts_trigger();

create or replace function app_private.engagement_members_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' and old.status='active' then
    perform app_private.engagement_delta(old.server_id,old.created_at::date,(hashtext(old.user_id::text)&15)::smallint,'joins',-1);
  end if;
  if tg_op<>'DELETE' and new.status='active' then
    perform app_private.engagement_delta(new.server_id,new.created_at::date,(hashtext(new.user_id::text)&15)::smallint,'joins',1);
  end if;
  return null;
end $$;
create trigger engagement_members after insert or delete or update of status,server_id,created_at,user_id on public.server_members
for each row execute function app_private.engagement_members_trigger();

create or replace function app_private.engagement_visits_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' then
    perform app_private.engagement_delta(old.server_id,old.day,(hashtext(old.user_id::text)&15)::smallint,'visits',-1);
  end if;
  if tg_op<>'DELETE' then
    perform app_private.engagement_delta(new.server_id,new.day,(hashtext(new.user_id::text)&15)::smallint,'visits',1);
  end if;
  return null;
end $$;
create trigger engagement_visits after insert or delete or update of server_id,user_id,day on public.server_visits
for each row execute function app_private.engagement_visits_trigger();

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
      coalesce(sum(d.posts) filter(where d.day>=current_date-6),0) as posts_7d,
      coalesce(sum(d.joins) filter(where d.day>=current_date-6),0) as joins_7d,
      coalesce(sum(d.joins) filter(where d.day between current_date-13 and current_date-7),0) as joins_prev_7d,
      coalesce(sum(d.visits) filter(where d.day>=current_date-6),0) as visitors_7d,
      coalesce(sum(d.visits) filter(where d.day between current_date-13 and current_date-7),0) as visitors_prev_7d
    from explorable e left join app_private.server_engagement_daily d
      on d.server_id=e.id and d.day>=current_date-13
    group by e.id
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
             'reason', (g.joins_7d + g.visitors_7d) || ' recent visits & joins') as card,
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
    select to_jsonb(a) as item from public.list_activity_page(null, null, 30, 'for_you', 0, null) a
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
       join public.presence pr on pr.user_id = tm.user_id and pr.is_available and pr.open_to_talk and pr.talk_expires_at > now()
       join public.profiles p on p.id = tm.user_id and p.account_status = 'active'
                             and coalesce(p.last_active_at, p.created_at) > now() - interval '14 days'
       where vm.user_id = v and vm.status = 'active'
         and not app_private.is_blocked_between(v, tm.user_id))),
    'my_server_count', (select count(*) from my_servers),
    'computed_at', now()
  ) into result;
  return result;
end $$;
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
