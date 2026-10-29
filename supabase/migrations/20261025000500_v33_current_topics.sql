-- Short-lived, shared cache for sourced current-event conversation prompts.
-- Only Edge Functions can read or write it; profile context remains in the caller-authorised RPC.
create table public.icebreaker_current_topics (
  topic text primary key,
  checked_at timestamptz not null,
  suggestion text,
  source_url text,
  source_title text,
  event_date date
);
alter table public.icebreaker_current_topics enable row level security;
revoke all on public.icebreaker_current_topics from anon, authenticated;
grant all on public.icebreaker_current_topics to service_role;
