-- Version 3.3: onboarding, home, announcements, activity, chat history, feedback.


alter table public.user_settings add column if not exists intro_pending boolean not null default false;
grant update(intro_pending) on public.user_settings to authenticated;


create or replace function app_private.accept_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.connection_requests;
  s public.servers;
  conn_id uuid;
  conv_id uuid;
  exp timestamptz;
  a uuid; b uuid;
begin
  select * into r from public.connection_requests where id = p_request_id for update;
  if r.status <> 'pending' then perform app_private.fail('invalid_transition', 'This request is no longer pending'); end if;
  update public.connection_requests set status = 'accepted', responded_at = now() where id = r.id;
  a := least(r.sender_id, r.recipient_id);
  b := greatest(r.sender_id, r.recipient_id);
  if r.server_id is not null then
    select * into s from public.servers where id = r.server_id;
    if s.kind = 'short_term' and s.ephemeral_chats and s.ends_at > now() then exp := s.ends_at; end if;
  end if;
  -- A previously blocked (now unblocked) pair starts fresh: old history is not resurrected.
  delete from public.connections where user_a = a and user_b = b and status = 'blocked';
  insert into public.connections (user_a, user_b, request_id, origin_server_id, expires_at)
    values (a, b, r.id, r.server_id, exp)
    on conflict (user_a, user_b) do nothing
    returning id into conn_id;
  if conn_id is null then
    select id into conn_id from public.connections where user_a = a and user_b = b;
  end if;
  insert into public.conversations (connection_id) values (conn_id)
    on conflict (connection_id) do nothing returning id into conv_id;
  if conv_id is null then select id into conv_id from public.conversations where connection_id = conn_id; end if;
  insert into public.conversation_participants (conversation_id, user_id)
    values (conv_id, r.sender_id), (conv_id, r.recipient_id) on conflict do nothing;
  if nullif(btrim(r.message), '') is not null then
    insert into public.messages(conversation_id,sender_id,client_id,body)
      values(conv_id,r.sender_id,r.id,r.message) on conflict(sender_id,client_id) do nothing;
  end if;
  perform app_private.notify(r.sender_id, 'request_accepted',
    (select display_name from public.profiles where id = r.recipient_id) || ' accepted your request',
    'Say hello. Your chat is open.', r.recipient_id, r.server_id, r.id, conv_id, null, 'accepted:' || r.id);
  return conn_id;
end $$;

create or replace function public.post_announcement(p_server_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  new_id uuid;
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  perform app_private.rate_limit('announcement', 5, interval '1 day');
  insert into public.server_announcements (server_id, author_id, title, body)
    values (p_server_id, v, btrim(p_title), btrim(p_body)) returning id into new_id;
  perform app_private.notify(m.user_id, 'server_announcement', left(btrim(p_title), 120), left(btrim(p_body), 300),
                             v, p_server_id, null, null, null, 'ann:' || new_id)
  from public.server_members m
  where m.server_id = p_server_id and m.status = 'active' and m.user_id <> v
  limit 10000;
  perform app_private.audit('announcement_posted', p_server_id, null, null, null, jsonb_build_object('announcement_id', new_id));
  return new_id;
end $$;

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
        and (p_sort='for_you' or (p_sort='mine' and p.author_id=v) or (p_sort='latest' and p.author_id<>v))
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

create or replace function public.list_my_servers()
returns table (
  id uuid, name text, kind public.server_kind, category text, parent_id uuid, parent_name text,
  is_official boolean, ends_at timestamptz, ephemeral_chats boolean, member_count integer,
  role public.member_role, status public.member_status, discoverable boolean, is_live boolean, available_now text,
  avatar_path text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.id, s.name, s.kind, s.category, s.parent_id, p.name, s.is_official, s.ends_at, s.ephemeral_chats,
         s.member_count, m.role, m.status, m.discoverable, app_private.server_is_live(s.id),
         case when m.status = 'active' then app_private.server_available_count(s.id, auth.uid())::text end,
         s.avatar_path
  from public.server_members m
  join public.servers s on s.id = m.server_id
  left join public.servers p on p.id = s.parent_id
  where m.user_id = auth.uid() and m.status <> 'banned'
  order by app_private.server_is_live(s.id) desc, s.kind, s.name;
$$;

create or replace function public.get_server(p_server_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  s public.servers;
  m public.server_members;
  result jsonb;
begin
  if not app_private.can_see_server(p_server_id, v) then
    perform app_private.fail('not_found', 'Server not found');
  end if;
  select * into s from public.servers where id = p_server_id;
  select * into m from public.server_members where server_id = p_server_id and user_id = v;
  result := jsonb_build_object(
    'id', s.id, 'name', s.name, 'avatar_path', s.avatar_path, 'kind', s.kind, 'category', s.category, 'description', s.description,
    'join_policy', s.join_policy, 'visibility', s.visibility, 'is_official', s.is_official,
    'requires_parent_membership', s.requires_parent_membership,
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'ephemeral_chats', s.ephemeral_chats,
    'city', s.city, 'venue_lat', s.venue_lat, 'venue_lng', s.venue_lng,
    'member_count', s.member_count, 'member_field_label', s.member_field_label, 'member_field_hint', s.member_field_hint,
    'creator', case when app_private.is_active_member(s.id,v) then app_private.mini_card(s.created_by) end, 'is_archived', s.is_archived, 'created_at', s.created_at,
    'is_live', app_private.server_is_live(s.id),
    'parent', (select jsonb_build_object('id', p.id, 'name', p.name, 'avatar_path', p.avatar_path) from public.servers p where p.id = s.parent_id),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'member_count', c.member_count, 'avatar_path', c.avatar_path)
                       order by c.name)
      from public.servers c
      where c.parent_id = s.id and not c.is_archived and app_private.can_see_server(c.id, v)), '[]'::jsonb),
    'membership', case when m.user_id is null then null else jsonb_build_object(
      'role', m.role, 'status', m.status, 'discoverable', m.discoverable, 'profile_mode', m.profile_mode,
      'member_note', m.member_note, 'joined_at', m.created_at) end,
    'can_manage', app_private.has_server_role(s.id, v, 'moderator'),
    'is_admin', app_private.has_server_role(s.id, v, 'admin'),
    -- Live availability is only shown to active members, and bucketed.
    'available_now', case when m.status = 'active'
      then app_private.server_available_count(s.id, v)::text end,
    'my_badges', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'issued_at', b.issued_at, 'expires_at', b.expires_at))
      from public.server_badges b
      where b.server_id = s.id and b.user_id = v and b.status = 'active' and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
  );
  return result;
end $$;

-- Home chips only represent communities with something happening now.
create or replace function public.home_relevant_server_ids()
returns uuid[] language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(array_agg(s.id order by s.name),'{}'::uuid[])
  from public.server_members me
  join public.servers s on s.id=me.server_id
  where me.user_id=app_private.require_user(false) and me.status='active'
    and not s.is_archived
    and (s.kind<>'short_term' or (s.starts_at<=now() and s.ends_at>now()))
    and (
      exists(select 1 from public.activity_posts p where p.server_id=s.id and p.status='active'
        and (p.expires_at is null or p.expires_at>now()))
      or app_private.server_available_count(s.id,app_private.require_user(false))>0
      or exists(select 1 from public.venue_sessions vs where vs.server_id=s.id and vs.open_to_talk and vs.ends_at>now())
    );
$$;
revoke execute on function public.home_relevant_server_ids() from public,anon;
grant execute on function public.home_relevant_server_ids() to authenticated;

-- Feedback is saved privately and emailed from an authenticated Edge Function.
-- Client IDs make a failed delivery retry safe to repeat.
alter table app_private.feedback_submissions
  add column if not exists client_id uuid,
  add column if not exists emailed_at timestamptz;
create unique index if not exists feedback_submissions_client on app_private.feedback_submissions(user_id,client_id)
  where client_id is not null;
create table if not exists app_private.feedback_attachments (
  feedback_id uuid not null references app_private.feedback_submissions(id) on delete cascade,
  storage_path text not null unique,
  position smallint not null check(position between 1 and 5),
  primary key(feedback_id,position)
);
revoke all on app_private.feedback_attachments from public,anon,authenticated;
grant all on app_private.feedback_attachments to service_role;

create or replace function public.submit_feedback_v33(p_client_id uuid,p_category text,p_body text,p_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v uuid:=app_private.require_user(); new_id uuid; attachments text[]:=coalesce(p_paths,'{}');
begin
  perform app_private.rate_limit('feedback',10,interval '1 day');
  if p_client_id is null or p_category not in ('bug','suggestion','other')
    or char_length(btrim(coalesce(p_body,''))) not between 10 and 2000
    or cardinality(attachments)>5 or array_position(attachments,null) is not null
    or (select count(distinct path) from unnest(attachments) path)<>cardinality(attachments)
  then perform app_private.fail('invalid_feedback'); end if;
  if exists(select 1 from unnest(attachments) path where split_part(path,'/',1)<>v::text
    or not exists(select 1 from storage.objects o where o.bucket_id='feedback-media' and o.name=path and o.owner=v))
  then perform app_private.fail('invalid_screenshot'); end if;
  insert into app_private.feedback_submissions(user_id,category,body,client_id)
    values(v,p_category,btrim(p_body),p_client_id) on conflict do nothing returning id into new_id;
  if new_id is null then
    select id into new_id from app_private.feedback_submissions where user_id=v and client_id=p_client_id;
    if new_id is null then perform app_private.fail('invalid_feedback'); end if;
    return new_id;
  end if;
  insert into app_private.feedback_attachments(feedback_id,storage_path,position)
    select new_id,path,ordinality::smallint from unnest(attachments) with ordinality as x(path,ordinality);
  return new_id;
end $$;
revoke execute on function public.submit_feedback_v33(uuid,text,text,text[]) from public,anon;
grant execute on function public.submit_feedback_v33(uuid,text,text,text[]) to authenticated;

create or replace function public.feedback_email_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',f.id,'user_id',f.user_id,'category',f.category,'body',f.body,
    'emailed_at',f.emailed_at,'paths',coalesce((select jsonb_agg(a.storage_path order by a.position)
      from app_private.feedback_attachments a where a.feedback_id=f.id),'[]'::jsonb))
  from app_private.feedback_submissions f where f.id=p_id;
$$;
revoke execute on function public.feedback_email_payload(uuid) from public,anon,authenticated;
grant execute on function public.feedback_email_payload(uuid) to service_role;

create or replace function public.mark_feedback_emailed(p_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  update app_private.feedback_submissions set emailed_at=now() where id=p_id and emailed_at is null;
$$;
revoke execute on function public.mark_feedback_emailed(uuid) from public,anon,authenticated;
grant execute on function public.mark_feedback_emailed(uuid) to service_role;

create or replace function app_private.feedback_attachment_cleanup()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into app_private.storage_deletions(bucket,path) values('feedback-media',old.storage_path);
  return old;
end $$;
create trigger feedback_attachment_cleanup after delete on app_private.feedback_attachments
  for each row execute function app_private.feedback_attachment_cleanup();

create or replace function app_private.media_reference_exists(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case p_bucket
    when 'avatars' then exists(select 1 from public.profiles where avatar_path=p_path)
    when 'profile-photos' then exists(select 1 from public.profile_photos ph
      where ph.storage_path=p_path or (p_path ~ '-thumb\.jpg$'
        and ph.storage_path=regexp_replace(p_path,'-thumb\.jpg$','.jpg')))
    when 'server-avatars' then exists(select 1 from public.servers where avatar_path=p_path)
    when 'activity-media' then exists(select 1 from public.activity_posts p
      where p.image_path=p_path or (p_path ~ '-thumb\.jpg$'
        and p.image_path=regexp_replace(p_path,'-thumb\.jpg$','.jpg')))
      or exists(select 1 from public.activity_post_images i
      where i.storage_path=p_path or (p_path ~ '-thumb\.jpg$'
        and i.storage_path=regexp_replace(p_path,'-thumb\.jpg$','.jpg')))
    when 'chat-media' then exists(select 1 from public.messages where media_path=p_path)
    when 'feedback-media' then exists(select 1 from app_private.feedback_submissions where screenshot_path=p_path)
      or exists(select 1 from app_private.feedback_attachments where storage_path=p_path)
    else false end;
$$;

-- Scheduled event attendees can discover who plans to come before the venue opens.
create or replace function public.server_directory(p_server_id uuid,p_limit integer default 50,p_offset integer default 0)
returns table(user_id uuid,username text,display_name text,avatar_path text,role public.member_role,
  joined_at timestamptz,profile_mode text,member_note text,badges jsonb)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user(); k public.server_kind; event_start timestamptz;
begin
 if not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden'); end if;
 select s.kind,s.starts_at into k,event_start from public.servers s where s.id=p_server_id;
 return query select m.user_id,p.username::text,p.display_name,p.avatar_path,m.role,m.created_at,
   m.profile_mode,m.member_note,
   case when k='long_term' then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'kind',b.kind,'label',b.label,'expires_at',b.expires_at))
     from public.server_badges b where b.server_id=p_server_id and b.user_id=m.user_id and b.status='active'
       and (b.expires_at is null or b.expires_at>now())),'[]'::jsonb) else '[]'::jsonb end
 from public.server_members m join public.profiles p on p.id=m.user_id
 where m.server_id=p_server_id and m.status='active' and p.account_status='active'
   and not app_private.is_blocked_between(v,m.user_id)
   and (m.user_id=v or m.role<>'member' or (
     case when k='short_term' then event_start>now() or exists(select 1 from public.venue_sessions vs where vs.server_id=m.server_id
            and vs.user_id=m.user_id and vs.open_to_talk and vs.ends_at>now())
          else m.discoverable end))
 order by (m.role='admin') desc,(m.role='moderator') desc,m.created_at,m.user_id
 limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $$;
