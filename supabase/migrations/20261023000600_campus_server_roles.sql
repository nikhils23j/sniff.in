-- Moderator powers are deliberately narrower than admin powers.
create or replace function public.review_membership(p_server_id uuid, p_user_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  s public.servers;
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  select * into s from public.servers where id = p_server_id;
  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id and status = 'pending') then
    perform app_private.fail('not_found', 'No pending request');
  end if;
  if p_approve then
    update public.server_members set status = 'active', approved_at = now(), approved_by = v
      where server_id = p_server_id and user_id = p_user_id;
    perform app_private.notify(p_user_id, 'server_membership', 'You''re in: ' || s.name, 'Your request to join was approved.',
      v, p_server_id, null, null, null, 'joined:' || p_server_id);
  else
    delete from public.server_members where server_id = p_server_id and user_id = p_user_id;
  end if;
  perform app_private.audit(case when p_approve then 'membership_approved' else 'membership_rejected' end, p_server_id, p_user_id);
end $$;

create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  if p_user_id = v or app_private.effective_rank(p_server_id, p_user_id) >= app_private.effective_rank(p_server_id, v) then
    perform app_private.fail('forbidden', 'You cannot ban someone with an equal or higher role');
  end if;
  insert into public.server_members (server_id, user_id, role, status, joined_via, banned_at, banned_by, ban_reason, discoverable)
    values (p_server_id, p_user_id, 'member', 'banned', 'admin', now(), v, left(p_reason, 300), false)
  on conflict (server_id, user_id) do update
    set status = 'banned', role = 'member', banned_at = now(), banned_by = v, ban_reason = left(p_reason, 300), discoverable = false;
  delete from public.cravings where user_id = p_user_id and server_id = p_server_id;
  update public.activity_posts set status = 'removed', removed_by = v, removed_reason = 'Author banned'
    where server_id = p_server_id and author_id = p_user_id and status = 'active';
  perform app_private.audit('member_banned', p_server_id, p_user_id, null, null, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.remove_member(p_server_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user();
begin
  if not app_private.has_server_role(p_server_id, v, 'admin') then perform app_private.fail('forbidden'); end if;
  if p_user_id = v or app_private.effective_rank(p_server_id, p_user_id) >= app_private.effective_rank(p_server_id, v) then
    perform app_private.fail('forbidden', 'You cannot remove someone with an equal or higher role');
  end if;
  delete from public.server_members where server_id = p_server_id and user_id = p_user_id and status <> 'banned';
  delete from public.cravings where user_id = p_user_id and server_id = p_server_id;
  perform app_private.audit('member_removed', p_server_id, p_user_id);
end $$;

create or replace function public.grant_badge(
  p_server_id uuid, p_user_id uuid, p_kind text, p_label text, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  new_id uuid;
  sname text;
begin
  if not app_private.has_server_role(p_server_id, v, 'moderator') then perform app_private.fail('forbidden'); end if;
  if not exists(select 1 from public.servers where id=p_server_id and kind='long_term') then perform app_private.fail('permanent_only'); end if;
  if not app_private.has_server_role(p_server_id,v,'admin') and p_kind not in ('custom','member','attendee','organizer') then perform app_private.fail('forbidden'); end if;
  if not app_private.is_active_member(p_server_id, p_user_id) then
    perform app_private.fail('not_member', 'Badges can only be granted to active members');
  end if;
  if p_expires_at is not null and p_expires_at <= now() then perform app_private.fail('invalid_expiry'); end if;
  if exists (select 1 from public.server_badges where server_id = p_server_id and user_id = p_user_id and kind = p_kind and status = 'active') then
    perform app_private.fail('badge_exists', 'This member already has that badge');
  end if;
  insert into public.server_badges (server_id, user_id, kind, label, issued_by, expires_at)
    values (p_server_id, p_user_id, p_kind, btrim(p_label), v, p_expires_at)
    returning id into new_id;
  select name into sname from public.servers where id = p_server_id;
  perform app_private.audit('badge_granted', p_server_id, p_user_id, null, null, jsonb_build_object('badge_id', new_id, 'kind', p_kind, 'label', p_label));
  perform app_private.notify(p_user_id, 'badge_granted', 'New verified badge', btrim(p_label) || ', verified by ' || sname,
    v, p_server_id, null, null, null, 'badge:' || new_id);
  return new_id;
end $$;

create or replace function public.revoke_badge(p_badge_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user();
  b public.server_badges;
begin
  select * into b from public.server_badges where id = p_badge_id;
  if not found or not (app_private.has_server_role(b.server_id,v,'admin') or (b.issued_by=v and app_private.has_server_role(b.server_id,v,'moderator'))) then perform app_private.fail('forbidden'); end if;
  update public.server_badges set status = 'revoked', revoked_at = now(), revoked_by = v, revoke_reason = left(p_reason, 300)
    where id = p_badge_id and status = 'active';
  perform app_private.audit('badge_revoked', b.server_id, b.user_id, null, null, jsonb_build_object('badge_id', p_badge_id, 'reason', p_reason));
end $$;

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
      then app_private.available_bucket(app_private.server_available_count(s.id, v)) end,
    'my_badges', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'issued_at', b.issued_at, 'expires_at', b.expires_at))
      from public.server_badges b
      where b.server_id = s.id and b.user_id = v and b.status = 'active' and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
  );
  return result;
end $$;

create or replace function app_private.permanent_badges_only()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.servers where id=new.server_id and kind='long_term') then
   perform app_private.fail('permanent_only','Badges belong to permanent Servers');
 end if;
 return new;
end $$;
create trigger permanent_badges_only before insert or update of server_id on public.server_badges
 for each row execute function app_private.permanent_badges_only();

create or replace function public.server_directory(p_server_id uuid,p_limit integer default 50,p_offset integer default 0)
returns table(user_id uuid,username text,display_name text,avatar_path text,role public.member_role,
  joined_at timestamptz,profile_mode text,member_note text,badges jsonb)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
declare v uuid:=app_private.require_user();
begin
 if not app_private.is_active_member(p_server_id,v) then perform app_private.fail('forbidden'); end if;
 return query select m.user_id,p.username::text,p.display_name,p.avatar_path,m.role,m.created_at,
   m.profile_mode,m.member_note,
   case when s.kind='long_term' then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'kind',b.kind,'label',b.label,'expires_at',b.expires_at))
     from public.server_badges b where b.server_id=p_server_id and b.user_id=m.user_id and b.status='active'
       and (b.expires_at is null or b.expires_at>now())),'[]'::jsonb) else '[]'::jsonb end
 from public.server_members m join public.profiles p on p.id=m.user_id
 join public.servers s on s.id=m.server_id
 where m.server_id=p_server_id and m.status='active' and p.account_status='active'
   and not app_private.is_blocked_between(v,m.user_id)
 order by (m.role='admin') desc,(m.role='moderator') desc,m.created_at,m.user_id
 limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
grant execute on function public.server_directory(uuid,integer,integer) to authenticated;
