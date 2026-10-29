-- R09: an inbox snapshot and composite cursor keep older conversations reachable
-- when many chats have the same last-message timestamp.
create or replace function public.list_conversations_page(
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_snapshot_at timestamptz default null,
  p_limit integer default 30)
returns table (
  conversation_id uuid, connection_id uuid, other jsonb, last_message text,
  last_message_at timestamptz, last_sender_id uuid, unread_count bigint,
  expires_at timestamptz, is_friend boolean, cursor_at text, snapshot_at text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with boundary as (select coalesce(p_snapshot_at, now()) as at),
  page as (
    select cv.id, cv.connection_id, cv.created_at, c.user_a, c.user_b,
      c.expires_at, c.a_saved, c.b_saved, me.last_read_at,
      lm.body, lm.kind, lm.media_name, lm.created_at as message_at, lm.sender_id,
      coalesce(lm.created_at, cv.created_at) as sort_at, boundary.at as snapshot_at
    from boundary
    join public.conversation_participants me on me.user_id = auth.uid() and me.hidden_at is null
    join public.conversations cv on cv.id = me.conversation_id and cv.created_at <= boundary.at
    join public.connections c on c.id = cv.connection_id and c.status = 'active'
    left join lateral (
      select m.body, m.kind, m.media_name, m.created_at, m.sender_id
      from public.messages m
      where m.conversation_id = cv.id and m.created_at <= boundary.at
      order by m.created_at desc, m.id desc limit 1
    ) lm on true
    where p_before_at is null or (coalesce(lm.created_at, cv.created_at), cv.id) < (p_before_at, p_before_id)
    order by sort_at desc, cv.id desc
    limit least(greatest(p_limit, 1), 50)
  )
  select p.id, p.connection_id,
    app_private.mini_card(case when p.user_a = auth.uid() then p.user_b else p.user_a end),
    case p.kind when 'image' then '📷 Photo' when 'file' then '📎 ' || coalesce(p.media_name, 'File')
      when 'gif' then 'GIF' when 'sticker' then 'Sticker' when 'location' then '📍 Location'
      else p.body end,
    p.sort_at, p.sender_id,
    (select count(*) from public.messages m where m.conversation_id = p.id
      and m.sender_id <> auth.uid() and m.created_at > coalesce(p.last_read_at, '-infinity')
      and m.created_at <= p.snapshot_at),
    p.expires_at, p.a_saved and p.b_saved,
    to_char(p.sort_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    to_char(p.snapshot_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  from page p order by p.sort_at desc, p.id desc;
$$;

-- R10: the tab badge does not need to download every conversation and request card.
create or replace function public.get_chat_badge_count()
returns integer language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select least(99, (
    select count(*) from public.connection_requests r
    where r.recipient_id = auth.uid() and r.status = 'pending'
      and not app_private.is_blocked_between(r.sender_id, r.recipient_id)
  ) + coalesce((
    select sum(u.n) from public.conversation_participants me
    join public.conversations cv on cv.id = me.conversation_id
    join public.connections c on c.id = cv.connection_id and c.status = 'active'
    cross join lateral (
      select count(*) as n from public.messages m
      where m.conversation_id = cv.id and m.sender_id <> auth.uid()
        and m.created_at > coalesce(me.last_read_at, '-infinity')
    ) u
    where me.user_id = auth.uid() and me.hidden_at is null
  ), 0))::integer;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
grant execute on function public.list_conversations_page(timestamptz,uuid,timestamptz,integer),
  public.get_chat_badge_count() to authenticated;
