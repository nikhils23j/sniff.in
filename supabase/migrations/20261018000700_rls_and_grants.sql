-- Row Level Security, least-privilege grants, Realtime publication, Storage, scheduling.
-- Model: deny by default. Clients get SELECT on a few tables (filtered by RLS), a handful of
-- column-scoped UPDATEs on their own rows, INSERT on messages, and EXECUTE on public RPCs.

-- ---------------------------------------------------------------- enable RLS everywhere
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------- strip default grants
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;
-- Maintenance is never callable by end users.
revoke execute on function app_private.run_maintenance() from authenticated;

-- Future objects must be granted explicitly in their migration.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- service_role (Edge Functions) keeps full access; it bypasses RLS.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------- table privileges (authenticated)
grant select on public.profiles, public.profile_private, public.user_settings, public.platform_admins,
  public.tags, public.presence, public.servers, public.server_members, public.server_join_tokens,
  public.server_badges, public.cravings, public.activity_posts, public.connection_requests,
  public.connections, public.conversations, public.conversation_participants, public.messages,
  public.blocks, public.reports, public.endorsements, public.activity_responses, public.notifications,
  public.push_tokens, public.feature_flags, public.entitlements, public.icebreakers, public.profile_tags
  to authenticated;

grant update (display_name, bio, avatar_path, university, occupation, career_goals,
              website_url, instagram_handle, linkedin_url, spotify_url)
  on public.profiles to authenticated;
grant update (gender, discovery_audience) on public.profile_private to authenticated;
grant update (bio_visibility, education_visibility, occupation_visibility, career_goals_visibility,
              tags_visibility, socials_visibility, craving_visibility, badges_visibility,
              endorsements_visibility, ai_features_consent, notify_requests, notify_messages,
              notify_activity, notify_servers, notify_announcements, push_previews)
  on public.user_settings to authenticated;
grant update (name, description, join_policy, visibility, starts_at, ends_at, ephemeral_chats,
              city, venue_lat, venue_lng, requires_parent_membership)
  on public.servers to authenticated;
grant update (discoverable) on public.server_members to authenticated;
grant insert (conversation_id, sender_id, client_id, body) on public.messages to authenticated;
grant delete on public.notifications, public.push_tokens to authenticated;

-- ---------------------------------------------------------------- policies
-- profiles: only your own row directly; everyone else goes through get_profile().
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy profile_private_own on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()));
create policy profile_private_update_own on public.profile_private for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy user_settings_own on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

create policy tags_read on public.tags for select to authenticated using (true);
create policy profile_tags_own on public.profile_tags for select to authenticated
  using (user_id = (select auth.uid()));

create policy presence_own on public.presence for select to authenticated
  using (user_id = (select auth.uid()));

create policy servers_select on public.servers for select to authenticated
  using (app_private.can_see_server(id, (select auth.uid())));
create policy servers_update_admin on public.servers for update to authenticated
  using (app_private.has_server_role(id, (select auth.uid()), 'admin'))
  with check (app_private.has_server_role(id, (select auth.uid()), 'admin'));

-- Membership is private: you see your own rows; staff see their Server's rows.
create policy server_members_select on public.server_members for select to authenticated
  using (user_id = (select auth.uid()) or app_private.has_server_role(server_id, (select auth.uid()), 'moderator'));
create policy server_members_update_self on public.server_members for update to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()) and status = 'active');

create policy join_tokens_staff on public.server_join_tokens for select to authenticated
  using (app_private.has_server_role(server_id, (select auth.uid()), 'moderator'));

create policy badges_select on public.server_badges for select to authenticated
  using (user_id = (select auth.uid()) or app_private.has_server_role(server_id, (select auth.uid()), 'moderator'));

create policy cravings_own on public.cravings for select to authenticated
  using (user_id = (select auth.uid()));

create policy activity_posts_select on public.activity_posts for select to authenticated
  using (author_id = (select auth.uid()) or app_private.has_server_role(server_id, (select auth.uid()), 'moderator'));

create policy requests_participants on public.connection_requests for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy connections_participants on public.connections for select to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

create policy conversations_participants on public.conversations for select to authenticated
  using (app_private.is_conversation_member(id, (select auth.uid())));

create policy conversation_participants_select on public.conversation_participants for select to authenticated
  using (app_private.is_conversation_member(conversation_id, (select auth.uid())));

-- Messages: readable only by participants of an ACTIVE (non-blocked) connection; writable only
-- as yourself into a conversation that is active, unexpired and unblocked.
create policy messages_select on public.messages for select to authenticated
  using (app_private.is_conversation_member(conversation_id, (select auth.uid())));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and app_private.can_send_message(conversation_id, (select auth.uid())));

create policy blocks_own on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy reports_select on public.reports for select to authenticated
  using (reporter_id = (select auth.uid())
         or app_private.is_platform_admin((select auth.uid()))
         -- Server staff see their Server's reports, except reports about themselves (escalated to platform admins).
         or (server_id is not null and target_user_id is distinct from (select auth.uid())
             and app_private.has_server_role(server_id, (select auth.uid()), 'moderator')));

create policy endorsements_select on public.endorsements for select to authenticated
  using (author_id = (select auth.uid()) or subject_id = (select auth.uid()));

create policy activity_responses_select on public.activity_responses for select to authenticated
  using (responder_id = (select auth.uid())
         or exists (select 1 from public.activity_posts p where p.id = post_id and p.author_id = (select auth.uid())));

create policy notifications_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy push_tokens_own on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

create policy feature_flags_read on public.feature_flags for select to authenticated using (true);

create policy entitlements_select on public.entitlements for select to authenticated
  using (user_id = (select auth.uid())
         or (server_id is not null and app_private.has_server_role(server_id, (select auth.uid()), 'admin')));

create policy icebreakers_participants on public.icebreakers for select to authenticated
  using (exists (select 1 from public.connections c where c.id = connection_id
                 and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid())) and c.status = 'active'));

-- Tables with NO client policy (service role / SECURITY DEFINER only):
--   rate_limit_events, moderation_actions, discovery_dismissals, interaction_feedback,
--   server_announcements, profile_embeddings.

-- ---------------------------------------------------------------- public RPCs
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------- Realtime
-- postgres_changes honours RLS per subscriber, so these only stream rows the user may read.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications, public.conversation_participants;
  end if;
end $$;

-- ---------------------------------------------------------------- Storage: private avatar bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path convention: avatars/<user_id>/<random>.jpg
create policy avatars_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Reading an avatar follows the same rule as seeing the profile card (signed URLs are minted per viewer).
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or app_private.can_view_profile((select auth.uid()), ((storage.foldername(name))[1])::uuid)));

-- ---------------------------------------------------------------- scheduling
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sniffin-maintenance', '*/5 * * * *', 'select app_private.run_maintenance()');
  else
    raise notice 'pg_cron not available: call app_private.run_maintenance() from a scheduler instead';
  end if;
end $$;
