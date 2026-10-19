create table if not exists public.api_request_windows (
 user_id uuid not null references auth.users(id) on delete cascade,
 service text not null check(service in ('receipt_scan','report_email')),
 window_start timestamptz not null,
 calls integer not null check(calls>0),
 primary key(user_id,service)
);
alter table public.api_request_windows enable row level security;
revoke all on public.api_request_windows from public,anon,authenticated;
grant select,insert,update on public.api_request_windows to service_role;
create or replace function public.consume_api_request(p_user_id uuid,p_service text)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare bucket timestamptz:=date_trunc('minute',clock_timestamp());maximum integer;used integer;
begin
 maximum:=case p_service when 'receipt_scan' then 30 when 'report_email' then 5 else null end;
 if maximum is null or p_user_id is null then raise exception 'Invalid request quota';end if;
 insert into public.api_request_windows(user_id,service,window_start,calls) values(p_user_id,p_service,bucket,1)
 on conflict(user_id,service) do update set window_start=excluded.window_start,
 calls=case when public.api_request_windows.window_start=excluded.window_start then public.api_request_windows.calls+1 else 1 end
 where public.api_request_windows.window_start<excluded.window_start or public.api_request_windows.calls<maximum
 returning calls into used;
 return used is not null;
end $$;
revoke all on function public.consume_api_request(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_api_request(uuid,text) to service_role;


create policy api_request_windows_deny_clients on public.api_request_windows for all to anon,authenticated using(false) with check(false);
