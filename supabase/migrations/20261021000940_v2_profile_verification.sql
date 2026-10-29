-- V2 profiles: verified college/employer affiliations (email code), endorsement names + revocation.

-- ---------------------------------------------------------------- domain registry & blocklist
create table public.org_domains (
  domain extensions.citext primary key check (domain::text ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  org_name text not null check (char_length(org_name) between 2 and 200),
  kind text not null check (kind in ('college', 'employer')),
  country text,
  source text not null check (source in ('university_registry', 'admin', 'verified_email')),
  created_at timestamptz not null default now()
);
create index org_domains_name_trgm on public.org_domains using gin (org_name extensions.gin_trgm_ops);
alter table public.org_domains enable row level security;
create policy org_domains_read on public.org_domains for select to authenticated using (true);
revoke all on public.org_domains from anon, authenticated;
grant select on public.org_domains to authenticated;
grant all on public.org_domains to service_role;

create table public.free_email_domains (domain extensions.citext primary key);
alter table public.free_email_domains enable row level security;
revoke all on public.free_email_domains from anon, authenticated;
grant all on public.free_email_domains to service_role;
insert into public.free_email_domains (domain) values
  ('gmail.com'),('googlemail.com'),('yahoo.com'),('yahoo.co.in'),('ymail.com'),('rocketmail.com'),('outlook.com'),
  ('hotmail.com'),('live.com'),('msn.com'),('icloud.com'),('me.com'),('mac.com'),('aol.com'),('protonmail.com'),
  ('proton.me'),('pm.me'),('zoho.com'),('zohomail.in'),('rediffmail.com'),('rediff.com'),('gmx.com'),('gmx.net'),
  ('mail.com'),('yandex.com'),('yandex.ru'),('tutanota.com'),('tuta.io'),('fastmail.com'),('hey.com'),('inbox.com'),
  ('mailinator.com'),('guerrillamail.com'),('10minutemail.com'),('tempmail.com'),('temp-mail.org'),('sharklasers.com'),
  ('yopmail.com'),('trashmail.com'),('getnada.com'),('dispostable.com'),('maildrop.cc'),('sniff-test.invalid'),
  ('hotmail.co.uk'),('hotmail.fr'),('hotmail.de'),('hotmail.it'),('hotmail.es'),('live.in'),('live.co.uk'),
  ('outlook.in'),('outlook.co.uk'),('yahoo.in'),('yahoo.co.uk'),('yahoo.fr'),('yahoo.de'),('yahoo.co.jp'),
  ('icloud.in'),('qq.com'),('163.com'),('126.com'),('sina.com'),('web.de'),('gmx.de'),('mail.ru'),('bk.ru'),
  ('list.ru'),('inbox.ru'),('naver.com'),('daum.net'),('hanmail.net'),('libero.it'),('orange.fr'),('free.fr'),
  ('laposte.net'),('t-online.de'),('btinternet.com'),('comcast.net'),('verizon.net'),('att.net'),('sbcglobal.net'),
  ('cox.net'),('optonline.net'),('earthlink.net'),('juno.com'),('lycos.com'),('excite.com'),('aim.com'),
  ('yahoo.com.sg'),('yahoo.com.au'),('bigpond.com'),('sify.com'),('vsnl.net'),('indiatimes.com'),('in.com'),
  ('duck.com'),('simplelogin.com'),('anonaddy.com'),('relay.firefox.com'),('mozmail.com'),('passmail.net'),
  ('privaterelay.appleid.com'),('emailondeck.com'),('throwawaymail.com'),('mintemail.com'),('fakeinbox.com')
on conflict do nothing;

-- ---------------------------------------------------------------- verification state (server-side only)
create table public.affiliation_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  email extensions.citext not null,
  domain extensions.citext not null,
  kind text not null check (kind in ('college', 'employer')),
  org_name text not null check (char_length(org_name) between 2 and 200),
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index affiliation_verifications_user on public.affiliation_verifications (user_id, created_at desc);
alter table public.affiliation_verifications enable row level security;   -- no client policies
revoke all on public.affiliation_verifications from anon, authenticated;
grant all on public.affiliation_verifications to service_role;

-- What other people see: the verified fact (domain) plus the organisation name.
create table public.verified_affiliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('college', 'employer')),
  org_name text not null check (char_length(org_name) between 2 and 200),
  domain extensions.citext not null,
  method text not null default 'email_code' check (method in ('email_code')),
  -- 'registry' = name from the university registry; 'self' = typed by the user (shown as self-described).
  org_name_source text not null default 'self' check (org_name_source in ('registry', 'self')),
  -- SHA-256 of the verified mailbox: one mailbox can back only one Sniff.in account.
  email_hash text unique,
  verified_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, domain)
);
alter table public.verified_affiliations enable row level security;
create policy verified_affiliations_own on public.verified_affiliations for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.verified_affiliations from anon, authenticated;
grant select, delete on public.verified_affiliations to authenticated;
create policy verified_affiliations_delete_own on public.verified_affiliations for delete to authenticated
  using (user_id = (select auth.uid()));
grant all on public.verified_affiliations to service_role;

create or replace function public.search_org_domains(p_query text, p_kind text default null)
returns table (domain text, org_name text, kind text, country text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select o.domain::text, o.org_name, o.kind, o.country
  from public.org_domains o
  where (p_kind is null or o.kind = p_kind)
    and char_length(btrim(coalesce(p_query, ''))) >= 2
    and (o.org_name ilike '%' || btrim(p_query) || '%' or o.domain::text ilike btrim(p_query) || '%')
  order by (o.org_name ilike btrim(p_query) || '%') desc, (o.country = 'India') desc, o.org_name
  limit 15;
$$;

-- ---------------------------------------------------------------- atomic verification steps (service role only)
-- Start: per-user (5/day) and per-mailbox (3/day) limits, serialised per user so parallel calls can't race.
create or replace function public.affiliation_begin(
  p_user uuid, p_email text, p_domain text, p_kind text, p_org_name text,
  p_code_hash text, p_ttl_minutes integer)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('affiliation:' || p_user::text, 0));
  if (select count(*) from public.affiliation_verifications where user_id = p_user and created_at > now() - interval '1 day') >= 5 then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.affiliation_verifications where email = lower(p_email)::citext and created_at > now() - interval '1 day') >= 3 then
    raise exception 'rate_limited';
  end if;
  insert into public.affiliation_verifications (user_id, email, domain, kind, org_name, code_hash, expires_at)
    values (p_user, lower(p_email), lower(p_domain), p_kind, p_org_name, p_code_hash, now() + make_interval(mins => p_ttl_minutes))
    returning id into new_id;
  return new_id;
end $$;

-- Confirm: atomically consume one attempt; returns the code hash only if an attempt was available.
create or replace function public.affiliation_consume_attempt(p_id uuid, p_user uuid)
returns table (code_hash text, email text, domain text, kind text, org_name text)
language sql security definer set search_path = public, extensions, pg_temp as $$
  update public.affiliation_verifications a
     set attempts = a.attempts + 1
   where a.id = p_id and a.user_id = p_user and a.status = 'pending' and a.attempts < 5 and a.expires_at > now()
  returning a.code_hash, a.email::text, a.domain::text, a.kind, a.org_name;
$$;
revoke execute on function public.affiliation_begin(uuid, text, text, text, text, text, integer),
  public.affiliation_consume_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.affiliation_begin(uuid, text, text, text, text, text, integer),
  public.affiliation_consume_attempt(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- endorsements: names + revoke
create or replace function public.list_endorsements(p_direction text default 'received')
returns table (id uuid, other jsonb, body text, status public.endorsement_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select e.id,
         app_private.mini_card(case when p_direction = 'received' then e.author_id else e.subject_id end),
         e.body, e.status, e.created_at
  from public.endorsements e
  where (p_direction = 'received' and e.subject_id = auth.uid())
     or (p_direction = 'written' and e.author_id = auth.uid())
  order by e.created_at desc
  limit 200;
$$;

create or replace function public.revoke_endorsement(p_endorsement_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v uuid := app_private.require_user(false);
begin
  delete from public.endorsements where id = p_endorsement_id and author_id = v;
  if not found then perform app_private.fail('not_found', 'Endorsement not found'); end if;
  delete from public.notifications where type = 'endorsement' and dedupe_key = 'endorse:' || p_endorsement_id;
end $$;

create or replace function public.get_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v uuid := app_private.require_user(false);
  p public.profiles;
  st public.user_settings;
  rel jsonb;
  conn public.connections;
  req public.connection_requests;
  conv_id uuid;
begin
  if not app_private.can_view_profile(v, p_user_id) then
    perform app_private.fail('not_found', 'This profile is not available');
  end if;
  select * into p from public.profiles where id = p_user_id;
  select * into st from public.user_settings where user_id = p_user_id;

  select * into conn from public.connections
    where user_a = least(v, p_user_id) and user_b = greatest(v, p_user_id) and status = 'active';
  select * into req from public.connection_requests
    where status = 'pending' and ((sender_id = v and recipient_id = p_user_id) or (sender_id = p_user_id and recipient_id = v));
  select id into conv_id from public.conversations where connection_id = conn.id;
  rel := jsonb_build_object(
    'state', case when v = p_user_id then 'self'
                  when conn.id is not null then 'connected'
                  when req.sender_id = v then 'pending_outgoing'
                  when req.recipient_id = v then 'pending_incoming'
                  else 'none' end,
    'request_id', req.id, 'connection_id', conn.id, 'conversation_id', conv_id,
    'is_friend', coalesce(conn.a_saved and conn.b_saved, false));

  return jsonb_build_object(
    'id', p.id, 'username', p.username::text, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
    'bio', case when app_private.visible_to(v, p.id, st.bio_visibility) then p.bio end,
    'university', case when app_private.visible_to(v, p.id, st.education_visibility) then p.university end,
    'occupation', case when app_private.visible_to(v, p.id, st.occupation_visibility) then p.occupation end,
    'career_goals', case when app_private.visible_to(v, p.id, st.career_goals_visibility) then p.career_goals end,
    'website_url', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.website_url end,
    'instagram_handle', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.instagram_handle end,
    'linkedin_url', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.linkedin_url end,
    'spotify_url', case when app_private.visible_to(v, p.id, st.socials_visibility) then p.spotify_url end,
    'socials_hidden', not app_private.visible_to(v, p.id, st.socials_visibility)
                      and (p.website_url is not null or p.instagram_handle is not null or p.linkedin_url is not null or p.spotify_url is not null),
    'tags', case when app_private.visible_to(v, p.id, st.tags_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('kind', t.kind, 'name', t.name::text) order by t.kind, t.name)
        from public.profile_tags pt join public.tags t on t.id = pt.tag_id where pt.user_id = p.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'shared_tags', case when v <> p.id and app_private.visible_to(v, p.id, st.tags_visibility) then coalesce((
        select jsonb_agg(distinct t.name::text)
        from public.profile_tags a join public.tags t on t.id = a.tag_id
        join public.tags t2 on t2.name = t.name and (t2.kind = t.kind or (t.kind <> 'language' and t2.kind <> 'language'))
        join public.profile_tags b on b.tag_id = t2.id and b.user_id = v
        where a.user_id = p.id), '[]'::jsonb)
      else '[]'::jsonb end,
    'craving', case when app_private.visible_to(v, p.id, st.craving_visibility) then (
        select jsonb_build_object('body', c.body, 'expires_at', c.expires_at, 'server_id', c.server_id,
                                  'server_name', (select name from public.servers where id = c.server_id))
        from public.cravings c
        where c.user_id = p.id and c.expires_at > now()
          and (c.server_id is null or v = p.id or app_private.is_active_member(c.server_id, v))) end,
    'badges', case when app_private.visible_to(v, p.id, st.badges_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'label', b.label, 'issued_at', b.issued_at,
                                            'expires_at', b.expires_at, 'server_id', s.id, 'server_name', s.name,
                                            'server_is_official', s.is_official) order by s.is_official desc, b.issued_at)
        from public.server_badges b join public.servers s on s.id = b.server_id
        where b.user_id = p.id and b.status = 'active' and (b.expires_at is null or b.expires_at > now())), '[]'::jsonb)
      else '[]'::jsonb end,
    'affiliations', case when app_private.visible_to(v, p.id, st.badges_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'org_name', a.org_name, 'domain', a.domain,
                                            'org_name_source', a.org_name_source, 'verified_at', a.verified_at) order by a.verified_at desc)
        from public.verified_affiliations a where a.user_id = p.id and (a.expires_at is null or a.expires_at > now())), '[]'::jsonb)
      else '[]'::jsonb end,
    'endorsements', case when app_private.visible_to(v, p.id, st.endorsements_visibility) then coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'body', e.body, 'created_at', e.created_at,
                                            'author', app_private.mini_card(e.author_id)) order by e.created_at desc)
        from public.endorsements e
        where e.subject_id = p.id and e.status = 'approved'
          and not app_private.is_blocked_between(v, e.author_id)), '[]'::jsonb)
      else '[]'::jsonb end,
    'relationship', rel);
end $$;

grant execute on function public.search_org_domains(text, text), public.list_endorsements(text),
  public.revoke_endorsement(uuid), public.get_profile(uuid) to authenticated;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
