-- V2 jobs: automatic push dispatch from the database (pg_net), media cleanup, extra maintenance.
-- Configuration lives in Supabase Vault (never in code):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'sniffin_functions_url');
--   select vault.create_secret('<random>', 'sniffin_internal_secret');   -- same value as PUSH_WEBHOOK_SECRET
-- If pg_net or the secrets are missing, dispatch is a no-op and in-app notifications still work.

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

create or replace function app_private.internal_config(p_name text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare val text;
begin
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into val using p_name;
  return val;
exception when others then
  return null;  -- Vault not available (local tests)
end $$;
revoke all on function app_private.internal_config(text) from public, anon, authenticated;

create or replace function app_private.call_function(p_function text, p_body jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  base text := app_private.internal_config('sniffin_functions_url');
  secret text := app_private.internal_config('sniffin_internal_secret');
begin
  if base is null or secret is null or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using base || '/' || p_function, p_body,
          jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret);
exception when others then
  return;  -- never break the user's transaction because a push couldn't be queued
end $$;
revoke all on function app_private.call_function(text, jsonb) from public, anon, authenticated;

-- Push for every new (or re-armed, e.g. deduped "new messages") unread notification.
create or replace function app_private.dispatch_push()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.pushed_at is null and new.read_at is null then
    perform app_private.call_function('send-push', jsonb_build_object('record', to_jsonb(new)));
  end if;
  return null;
end $$;
create trigger notifications_dispatch_push after insert or update of created_at, pushed_at on public.notifications
  for each row execute function app_private.dispatch_push();

-- ---------------------------------------------------------------- maintenance additions
create or replace function app_private.run_maintenance_v2()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare base jsonb := app_private.run_maintenance();
begin
  delete from public.location_cells where updated_at < now() - interval '30 minutes';  -- matches the UI promise
  update public.affiliation_verifications set status = 'expired' where status = 'pending' and expires_at < now();
  delete from public.affiliation_verifications where created_at < now() - interval '30 days';
  delete from public.server_visits where day < current_date - 60;
  if exists (select 1 from app_private.storage_deletions) then
    perform app_private.call_function('media-cleanup', '{}'::jsonb);
  end if;
  return base || jsonb_build_object('v2', true);
end $$;
revoke all on function app_private.run_maintenance_v2() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('sniffin-maintenance');
    perform cron.schedule('sniffin-maintenance', '*/5 * * * *', 'select app_private.run_maintenance_v2()');
  end if;
exception when others then
  raise notice 'pg_cron reschedule skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- lockdown (every migration that creates functions)
-- Postgres grants EXECUTE to PUBLIC on new functions by default; schema-level default-privilege revokes cannot
-- remove that, so revoke explicitly. Signed-in access is granted per function above.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
