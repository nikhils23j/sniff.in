-- Spotify links are set only after a server-side /me check of a short-lived OAuth token.
-- Tokens, passwords and refresh tokens are never stored in this database.
create table app_private.spotify_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  account_id text not null unique check (char_length(account_id) between 1 and 128),
  profile_url text not null check (profile_url ~ '^https://open\.spotify\.com/user/[^[:space:]]+$'),
  display_name text check (char_length(display_name) <= 200),
  connected_at timestamptz not null default now()
);
revoke all on app_private.spotify_connections from public,anon,authenticated;
grant all on app_private.spotify_connections to service_role;

-- The Edge Function calls this as service_role after Spotify has verified the token.
create or replace function public.save_spotify_connection(
  p_user_id uuid,p_account_id text,p_profile_url text,p_display_name text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_user_id is null or char_length(p_account_id) not between 1 and 128
     or p_profile_url !~ '^https://open\.spotify\.com/user/[^[:space:]]+$'
     or char_length(coalesce(p_display_name,'')) > 200 then
    perform app_private.fail('invalid_spotify_profile');
  end if;
  if not exists(select 1 from public.profiles where id=p_user_id and account_status='active') then
    perform app_private.fail('not_found');
  end if;
  insert into app_private.spotify_connections(user_id,account_id,profile_url,display_name,connected_at)
    values(p_user_id,p_account_id,p_profile_url,p_display_name,now())
    on conflict(user_id) do update set account_id=excluded.account_id,
      profile_url=excluded.profile_url,display_name=excluded.display_name,connected_at=now();
  update public.profiles set spotify_url=p_profile_url where id=p_user_id;
end $$;

create or replace function public.disconnect_spotify()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid := app_private.require_user();
begin
  delete from app_private.spotify_connections where user_id=v;
  update public.profiles set spotify_url=null where id=v;
end $$;

-- Remove the former free-form field from client write privileges.
revoke update(spotify_url) on public.profiles from authenticated;
revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function public.save_spotify_connection(uuid,text,text,text) from authenticated;
grant execute on function public.save_spotify_connection(uuid,text,text,text) to service_role;
grant execute on function public.disconnect_spotify() to authenticated;
