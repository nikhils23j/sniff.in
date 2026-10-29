-- Sniff.in foundation: extensions, private schema, enums, shared trigger helpers.
-- Convention: internal helpers live in `app_private` (NOT exposed through PostgREST);
-- client-callable RPCs live in `public`.

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- ---------------------------------------------------------------- enums
create type public.field_visibility as enum ('members', 'connections', 'only_me');
create type public.gender_identity as enum ('woman', 'man', 'nonbinary');
create type public.discovery_audience as enum ('everyone', 'same_gender');
create type public.account_status as enum ('active', 'suspended');
create type public.server_kind as enum ('long_term', 'short_term', 'global');
create type public.server_join_policy as enum ('invite_only', 'approval', 'open');
create type public.server_visibility as enum ('listed', 'unlisted');
create type public.member_role as enum ('member', 'moderator', 'admin');
create type public.member_status as enum ('pending', 'active', 'banned');
create type public.tag_kind as enum ('interest', 'hobby', 'skill', 'language', 'career');
create type public.badge_status as enum ('active', 'revoked');
create type public.request_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'expired');
create type public.connection_status as enum ('active', 'blocked');
create type public.report_reason as enum ('spam', 'harassment', 'inappropriate', 'fake_profile', 'safety', 'underage', 'other');
create type public.report_status as enum ('open', 'reviewing', 'actioned', 'dismissed');
create type public.post_status as enum ('active', 'removed');
create type public.endorsement_status as enum ('pending', 'approved', 'hidden');

-- ---------------------------------------------------------------- helpers
create or replace function app_private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Raises a client-facing error with a stable machine code in the message ("code: human text").
create or replace function app_private.fail(code text, msg text default null)
returns void language plpgsql as $$
begin
  raise exception '%', code || coalesce(': ' || msg, '') using errcode = 'P0001';
end $$;
