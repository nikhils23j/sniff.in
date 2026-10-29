-- A shared activity link resolves one authorized post regardless of feed position.
create or replace function public.get_activity_post(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); result jsonb;
begin
  select jsonb_build_object(
    'id',p.id,'server_id',p.server_id,'server_name',s.name,'server_avatar_path',s.avatar_path,
    'author',app_private.mini_card(p.author_id),'body',p.body,'category',p.category,
    'expires_at',p.expires_at,'created_at',p.created_at,'updated_at',p.updated_at,
    'response_count',(select count(*) from public.activity_responses r where r.post_id=p.id),
    'in_count',(select count(*) from public.activity_responses r where r.post_id=p.id and r.kind='in'),
    'not_in_count',(select count(*) from public.activity_responses r where r.post_id=p.id and r.kind='not_in'),
    'capacity',p.capacity,
    'is_full',(p.capacity is not null and (select count(*) from public.activity_responses r where r.post_id=p.id and r.kind='in')>=p.capacity),
    'my_response',(select r.kind from public.activity_responses r where r.post_id=p.id and r.responder_id=v),
    'i_responded',exists(select 1 from public.activity_responses r where r.post_id=p.id and r.responder_id=v),
    'is_mine',p.author_id=v,'image_path',p.image_path,
    'image_paths',coalesce((select jsonb_agg(path order by position) from (
      select p.image_path as path,1 as position where p.image_path is not null
      union all select i.storage_path,i.position from public.activity_post_images i where i.post_id=p.id
    ) x),'[]'::jsonb),
    'relevance',0,'relevance_reason',null)
  into result
  from public.activity_posts p join public.servers s on s.id=p.server_id
  where p.id=p_post_id and app_private.is_active_member(p.server_id,v) and app_private.post_visible(p,v);
  if result is null then perform app_private.fail('not_found'); end if;
  return result;
end $$;
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.get_activity_post(uuid) to authenticated;
