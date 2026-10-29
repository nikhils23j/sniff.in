-- R04: durable push jobs. A provider ticket is not device delivery.
drop trigger if exists notifications_dispatch_push on public.notifications;

create table app_private.push_jobs (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  generation integer not null default 1,
  status text not null default 'pending' check(status in ('pending','leased','completed','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_jobs_ready on app_private.push_jobs(next_attempt_at) where status in ('pending','leased');
create table app_private.push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references app_private.push_jobs(notification_id) on delete cascade,
  generation integer not null,
  token_id uuid references public.push_tokens(id) on delete set null,
  attempt integer not null,
  status text not null check(status in ('accepted','retry','invalid','failed')),
  ticket_id text unique,
  error_code text,
  receipt_status text check(receipt_status in ('ok','error','missing')),
  receipt_error text,
  receipt_checked_at timestamptz,
  receipt_lease_until timestamptz,
  created_at timestamptz not null default now()
);
create index push_receipts_pending on app_private.push_delivery_attempts(created_at)
  where ticket_id is not null and receipt_status is null;
revoke all on app_private.push_jobs,app_private.push_delivery_attempts from public,anon,authenticated;
grant all on app_private.push_jobs,app_private.push_delivery_attempts to service_role;

create or replace function app_private.enqueue_push()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.read_at is null and new.pushed_at is null then
    insert into app_private.push_jobs(notification_id,next_attempt_at)
      values(new.id,case when new.type='message' then now()+interval '10 seconds' else now() end)
    on conflict(notification_id) do update set generation=app_private.push_jobs.generation+1,
      status='pending',attempts=0,next_attempt_at=excluded.next_attempt_at,lease_id=null,lease_until=null,
      last_error=null,updated_at=now();
    perform app_private.call_function('send-push','{}'::jsonb);
  end if;
  return null;
end $$;
create trigger notifications_enqueue_push after insert or update of created_at on public.notifications
for each row execute function app_private.enqueue_push();

create or replace function public.claim_push_jobs(p_limit integer default 20)
returns table(notification_id uuid,lease_id uuid,generation integer,attempt integer)
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
begin
  return query with picked as (
    select j.notification_id from app_private.push_jobs j
    where (j.status='pending' and j.next_attempt_at<=now())
       or (j.status='leased' and j.lease_until<now())
    order by j.next_attempt_at,j.notification_id
    for update skip locked limit least(greatest(p_limit,1),30)
  )
  update app_private.push_jobs j set status='leased',lease_id=gen_random_uuid(),
    lease_until=now()+interval '90 seconds',attempts=j.attempts+1,updated_at=now()
  from picked where j.notification_id=picked.notification_id
  returning j.notification_id,j.lease_id,j.generation,j.attempts;
end $$;

create or replace function public.pending_push_devices(p_notification_id uuid,p_lease_id uuid)
returns table(token_id uuid,token text)
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
begin
  return query select t.id,t.token from app_private.push_jobs j
    join public.notifications n on n.id=j.notification_id
    join public.push_tokens t on t.user_id=n.user_id and t.provider='expo'
  where j.notification_id=p_notification_id and j.lease_id=p_lease_id and j.status='leased'
    and not exists(select 1 from app_private.push_delivery_attempts d
      where d.notification_id=j.notification_id and d.generation=j.generation
        and d.token_id=t.id and d.status='accepted' and d.receipt_status is distinct from 'error')
  order by t.id limit 100;
end $$;

create or replace function public.finish_push_job(p_notification_id uuid,p_lease_id uuid,p_outcomes jsonb,p_error text default null)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare j app_private.push_jobs; o jsonb; retry_count integer:=0; accepted_count integer:=0;
begin
  select * into j from app_private.push_jobs where notification_id=p_notification_id and lease_id=p_lease_id and status='leased' for update;
  if not found then return; end if;
  for o in select value from jsonb_array_elements(coalesce(p_outcomes,'[]'::jsonb)) loop
    if o->>'status' not in ('accepted','retry','invalid','failed') then continue; end if;
    insert into app_private.push_delivery_attempts(notification_id,generation,token_id,attempt,status,ticket_id,error_code)
      values(j.notification_id,j.generation,nullif(o->>'token_id','')::uuid,j.attempts,o->>'status',nullif(o->>'ticket_id',''),left(o->>'error',100));
    if o->>'status'='retry' then retry_count:=retry_count+1; end if;
    if o->>'status'='accepted' then accepted_count:=accepted_count+1; end if;
  end loop;
  if accepted_count>0 then
    update public.notifications set pushed_at=now() where id=j.notification_id and pushed_at is null;
  end if;
  if retry_count>0 or p_error is not null then
    update app_private.push_jobs set status=case when attempts>=8 then 'failed' else 'pending' end,
      next_attempt_at=now()+make_interval(secs=>least(3600,(2^least(attempts,8))::integer*5)),
      lease_id=null,lease_until=null,last_error=left(p_error,100),updated_at=now()
    where notification_id=j.notification_id;
  else
    update app_private.push_jobs set status='completed',lease_id=null,lease_until=null,updated_at=now()
      where notification_id=j.notification_id;
  end if;
end $$;

create or replace function public.claim_push_receipts(p_limit integer default 100)
returns table(delivery_id uuid,ticket_id text)
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
#variable_conflict use_column
begin
  return query with picked as (
    select d.id from app_private.push_delivery_attempts d
    where d.ticket_id is not null and d.receipt_status is null
      and d.created_at<now()-interval '15 minutes'
      and (d.receipt_lease_until is null or d.receipt_lease_until<now())
    order by d.created_at,d.id for update skip locked limit least(greatest(p_limit,1),100)
  )
  update app_private.push_delivery_attempts d set receipt_lease_until=now()+interval '90 seconds'
  from picked where d.id=picked.id returning d.id,d.ticket_id;
end $$;

create or replace function public.finish_push_receipt(p_delivery_id uuid,p_status text,p_error text default null)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare d app_private.push_delivery_attempts;
begin
  if p_status not in ('ok','error','missing') then return; end if;
  update app_private.push_delivery_attempts set receipt_status=p_status,receipt_error=left(p_error,100),
    receipt_checked_at=now(),receipt_lease_until=null where id=p_delivery_id and receipt_status is null
    returning * into d;
  if not found then return; end if;
  if p_error='DeviceNotRegistered' and d.token_id is not null then
    delete from public.push_tokens where id=d.token_id;
  elsif p_error='MessageRateExceeded' then
    update app_private.push_jobs set status='pending',next_attempt_at=now()+interval '5 minutes',attempts=0,
      updated_at=now() where notification_id=d.notification_id
      and exists(select 1 from public.notifications n where n.id=d.notification_id and n.read_at is null);
  end if;
end $$;

revoke execute on all functions in schema public from public,anon;
revoke execute on all functions in schema app_private from public,anon;
revoke execute on function app_private.enqueue_push() from authenticated;
revoke execute on function public.claim_push_jobs(integer),public.pending_push_devices(uuid,uuid),
  public.finish_push_job(uuid,uuid,jsonb,text),public.claim_push_receipts(integer),
  public.finish_push_receipt(uuid,text,text) from authenticated;
grant execute on function public.claim_push_jobs(integer),public.pending_push_devices(uuid,uuid),
  public.finish_push_job(uuid,uuid,jsonb,text),public.claim_push_receipts(integer),
  public.finish_push_receipt(uuid,text,text) to service_role;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('sniffin-push-worker','* * * * *',
      'select app_private.call_function(''send-push'',''{}''::jsonb)');
  end if;
exception when others then raise notice 'Push worker schedule skipped: %',sqlerrm;
end $$;
