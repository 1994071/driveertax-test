-- Owner-visible deletion requests; processing/fulfilment remains an operator task.
create table public.account_deletion_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 requested_at timestamptz not null default now(),
 cancelled_at timestamptz,
 processing_at timestamptz,
 completed_at timestamptz
);
create unique index one_open_account_deletion_request on public.account_deletion_requests(user_id) where cancelled_at is null and completed_at is null;
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select on public.account_deletion_requests to authenticated;
grant insert(user_id) on public.account_deletion_requests to authenticated;
grant update(cancelled_at) on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;
create policy deletion_request_read on public.account_deletion_requests for select to authenticated using(user_id=(select auth.uid()));
create policy deletion_request_create on public.account_deletion_requests for insert to authenticated with check(user_id=(select auth.uid()) and cancelled_at is null and processing_at is null and completed_at is null);
create policy deletion_request_cancel on public.account_deletion_requests for update to authenticated using(user_id=(select auth.uid()) and cancelled_at is null and processing_at is null and completed_at is null) with check(user_id=(select auth.uid()) and cancelled_at is not null and processing_at is null and completed_at is null);

-- Bounded operational counters: at most six rows per account, overwritten each day.
create table public.app_health_counters (
 user_id uuid not null references auth.users(id) on delete cascade,
 code text not null check(code in ('runtime_error','unhandled_rejection','cloud_load_failed','receipt_scan_failed','invoice_email_failed','slow_scan')),
 day date not null default (now() at time zone 'UTC')::date,
 count integer not null check(count>0),
 last_seen timestamptz not null default now(),
 primary key(user_id,code)
);
alter table public.app_health_counters enable row level security;
revoke all on public.app_health_counters from public,anon,authenticated;
grant all on public.app_health_counters to service_role;
create policy health_counters_deny_clients on public.app_health_counters for all to anon,authenticated using(false) with check(false);
alter table public.api_request_windows drop constraint api_request_windows_service_check;
alter table public.api_request_windows add constraint api_request_windows_service_check check(service in ('receipt_scan','report_email','app_health'));
create or replace function public.consume_api_request(p_user_id uuid,p_service text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bucket timestamptz:=date_trunc('minute',clock_timestamp());maximum integer;used integer;
begin
 maximum:=case p_service when 'receipt_scan' then 30 when 'report_email' then 5 when 'app_health' then 10 else null end;
 if maximum is null or p_user_id is null then raise exception 'Invalid request quota';end if;
 insert into public.api_request_windows(user_id,service,window_start,calls) values(p_user_id,p_service,bucket,1)
 on conflict(user_id,service) do update set window_start=excluded.window_start,
 calls=case when public.api_request_windows.window_start=excluded.window_start then public.api_request_windows.calls+1 else 1 end
 where public.api_request_windows.window_start<excluded.window_start or public.api_request_windows.calls<maximum returning calls into used;
 return used is not null;
end $$;
revoke all on function public.consume_api_request(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_api_request(uuid,text) to service_role;
create function public.record_app_health(p_user_id uuid,p_code text)
returns integer language plpgsql security invoker set search_path='' as $$
declare used integer; today date:=(now() at time zone 'UTC')::date;
begin
 insert into public.app_health_counters(user_id,code,day,count) values(p_user_id,p_code,today,1)
 on conflict(user_id,code) do update set day=excluded.day,last_seen=now(),count=case when public.app_health_counters.day=excluded.day then least(public.app_health_counters.count+1,1000000) else 1 end returning count into used;
 return used;
end $$;
revoke all on function public.record_app_health(uuid,text) from public,anon,authenticated;
grant execute on function public.record_app_health(uuid,text) to service_role;
-- Global cap for optional operator emails, including bursts across different users.
create table public.app_health_alert_windows (
 code text primary key check(code in ('runtime_error','unhandled_rejection','cloud_load_failed','receipt_scan_failed','invoice_email_failed','slow_scan')),
 claimed_at timestamptz not null
);
alter table public.app_health_alert_windows enable row level security;
revoke all on public.app_health_alert_windows from public,anon,authenticated;
grant all on public.app_health_alert_windows to service_role;
create policy health_alerts_deny_clients on public.app_health_alert_windows for all to anon,authenticated using(false) with check(false);
create function public.claim_app_health_alert(p_code text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed text;
begin
 insert into public.app_health_alert_windows(code,claimed_at) values(p_code,now())
 on conflict(code) do update set claimed_at=excluded.claimed_at where public.app_health_alert_windows.claimed_at<now()-interval '1 hour' returning code into claimed;
 return claimed is not null;
end $$;
revoke all on function public.claim_app_health_alert(text) from public,anon,authenticated;
grant execute on function public.claim_app_health_alert(text) to service_role;
