-- R07: read only the viewer's live communities before applying the full post
-- privacy predicate, then aggregate response counts in one pass per page.
create or replace function public.list_activity_page(
  p_server_id uuid default null, p_before timestamptz default null, p_limit integer default 20,
  p_sort text default 'latest', p_offset integer default 0, p_before_id uuid default null)
returns table (
  id uuid, server_id uuid, server_name text, server_avatar_path text, author jsonb, body text, category text,
  expires_at timestamptz, created_at timestamptz, updated_at timestamptz,
  response_count bigint, in_count bigint, not_in_count bigint, capacity integer, is_full boolean,
  my_response text, i_responded boolean, is_mine boolean, image_path text, relevance numeric, relevance_reason text)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare v uuid := app_private.require_user();
begin
  return query
  with my_servers as materialized (
    select s.id,s.name,s.avatar_path
    from public.server_members vm join public.servers s on s.id=vm.server_id
    where vm.user_id=v and vm.status='active'
      and (p_server_id is null or s.id=p_server_id)
      and not s.is_archived and (s.kind<>'short_term' or s.ends_at>now())
  ),
  visible as materialized (
    select p.*, ms.name as s_name, ms.avatar_path as s_avatar
    from my_servers ms
    cross join lateral (
      select p.* from public.activity_posts p
      where p.server_id=ms.id and p.status='active'
        and (p.expires_at is null or p.expires_at>now())
        and (p_sort='for_you' or p_before is null or (p.created_at,p.id)<(p_before,p_before_id))
        and (p.author_id=v or (
          app_private.is_active_member(ms.id,p.author_id)
          and not app_private.is_blocked_between(v,p.author_id)
          and app_private.audience_compatible(v,p.author_id)
          and exists(select 1 from public.profiles a where a.id=p.author_id and a.account_status='active')))
      order by p.created_at desc,p.id desc
      limit case when p_sort='for_you' then 1000 else least(greatest(p_limit,1),50) end
    ) p
    order by p.created_at desc,p.id desc
    limit case when p_sort='for_you' then 1000 else least(greatest(p_limit,1),50) end
  ),
  stats as (
    select vi.id,count(r.post_id) as total,
      count(r.post_id) filter(where r.kind='in') as ins,
      count(r.post_id) filter(where r.kind='not_in') as outs,
      max(r.kind) filter(where r.responder_id=v) as mine
    from visible vi left join public.activity_responses r on r.post_id=vi.id
    group by vi.id
  ),
  my_tags as (
    select t.name::text as name from public.profile_tags pt join public.tags t on t.id=pt.tag_id where pt.user_id=v
  ),
  affinity as (
    select p2.category,count(*) as n from public.activity_responses r
    join public.activity_posts p2 on p2.id=r.post_id
    where r.responder_id=v and r.kind='in' group by p2.category
  ),
  scored as (
    select vi.*,st.total,st.ins,st.outs,st.mine,
      (select mt.name from my_tags mt where char_length(mt.name)>=3
        and lower(vi.body) like '%' || lower(mt.name) || '%' limit 1) as tag_hit,
      coalesce((select least(a.n,5) from affinity a where a.category=vi.category),0) as aff
    from visible vi join stats st on st.id=vi.id
  )
  select sc.id,sc.server_id,sc.s_name,sc.s_avatar,app_private.mini_card(sc.author_id),sc.body,sc.category,
    sc.expires_at,sc.created_at,sc.updated_at,sc.total,sc.ins,sc.outs,sc.capacity,
    (sc.capacity is not null and sc.ins>=sc.capacity),sc.mine,sc.mine is not null,sc.author_id=v,sc.image_path,
    round((case when sc.tag_hit is not null then 5 else 0 end
           + sc.aff*0.8
           + 5*exp(-extract(epoch from (now()-sc.created_at))/3600.0/48.0)
           + least(sc.ins,10)*0.2
           - case when sc.mine='not_in' then 3 else 0 end)::numeric,3),
    case when sc.tag_hit is not null then 'Matches your interest in ' || sc.tag_hit
         when sc.aff>0 then 'You often join ' || sc.category || ' plans'
         else null end
  from scored sc
  order by
    case when p_sort='for_you' then
      (case when sc.tag_hit is not null then 5 else 0 end + sc.aff*0.8
       + 5*exp(-extract(epoch from (now()-sc.created_at))/3600.0/48.0) + least(sc.ins,10)*0.2
       - case when sc.mine='not_in' then 3 else 0 end) end desc nulls last,
    sc.created_at desc,sc.id desc
  limit least(greatest(p_limit,1),50)
  offset case when p_sort='for_you' then greatest(p_offset,0) else 0 end;
end $$;
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.list_activity_page(uuid,timestamptz,integer,text,integer,uuid) to authenticated;
