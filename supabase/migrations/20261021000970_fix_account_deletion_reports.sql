-- Fix: deleting a REPORTED user failed. reports.target_* are ON DELETE SET NULL, but the table CHECK required at
-- least one non-null target, so the cascade violated it and aborted the whole account deletion.
-- The "must have a target" rule is only meaningful when a report is created, so enforce it at INSERT time.
alter table public.reports drop constraint if exists reports_check;

create or replace function app_private.reports_require_target()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.target_user_id is null and new.target_post_id is null and new.target_message_id is null then
    perform app_private.fail('invalid_target', 'A report needs a target');
  end if;
  return new;
end $$;
create trigger reports_require_target before insert on public.reports
  for each row execute function app_private.reports_require_target();

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app_private from public, anon;
