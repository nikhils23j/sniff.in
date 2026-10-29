-- Record the first-run tour in the same transaction that finishes onboarding.
-- A dropped connection after onboarding cannot skip the tour, and returning users
-- never have it reset by profile edits.
create or replace function app_private.queue_first_intro()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.onboarded_at is null and new.onboarded_at is not null then
    update public.user_settings set intro_pending=true where user_id=new.id;
  end if;
  return new;
end $$;
create trigger profiles_first_intro after update of onboarded_at on public.profiles
  for each row execute function app_private.queue_first_intro();
