-- R09/R10: pending requests can exceed the former 100-row cap; a cheap badge
-- query avoids loading request cards on Home and Chats.
create or replace function public.list_requests_page(
  p_direction text default 'incoming',p_before_at timestamptz default null,
  p_before_id uuid default null,p_snapshot_at timestamptz default null,p_limit integer default 30)
returns table(id uuid,other jsonb,server_id uuid,server_name text,message text,
  activity_post_id uuid,post_excerpt text,created_at timestamptz,cursor_at text,snapshot_at text)
language sql stable security definer set search_path=public,extensions,pg_temp as $$
  with boundary as (select coalesce(p_snapshot_at,now()) as at)
  select r.id,
    app_private.mini_card(case when p_direction='incoming' then r.sender_id else r.recipient_id end),
    r.server_id,s.name,r.message,r.activity_post_id,left(ap.body,120),r.created_at,
    to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(boundary.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  from boundary join public.connection_requests r on r.created_at<=boundary.at
  left join public.servers s on s.id=r.server_id
  left join public.activity_posts ap on ap.id=r.activity_post_id
  where r.status='pending'
    and ((p_direction='incoming' and r.recipient_id=auth.uid())
      or (p_direction='outgoing' and r.sender_id=auth.uid()))
    and not app_private.is_blocked_between(r.sender_id,r.recipient_id)
    and (p_before_at is null or (r.created_at,r.id)<(p_before_at,p_before_id))
  order by r.created_at desc,r.id desc
  limit least(greatest(p_limit,1),50);
$$;

create or replace function public.get_pending_request_count(p_direction text default 'incoming')
returns integer language sql stable security definer set search_path=public,extensions,pg_temp as $$
  select least(99,count(*))::integer from public.connection_requests r
  where r.status='pending'
    and ((p_direction='incoming' and r.recipient_id=auth.uid())
      or (p_direction='outgoing' and r.sender_id=auth.uid()))
    and not app_private.is_blocked_between(r.sender_id,r.recipient_id);
$$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.list_requests_page(text,timestamptz,uuid,timestamptz,integer),
  public.get_pending_request_count(text) to authenticated;
