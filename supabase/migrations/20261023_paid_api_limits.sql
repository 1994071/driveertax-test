-- Apply before deploying the paid endpoints. Only trusted backend calls may consume quota.
create table public.paid_api_limits (
 service text primary key,
 enabled boolean not null default true,
 user_minute integer not null check(user_minute>0),
 user_day integer not null check(user_day>0),
 global_minute integer not null check(global_minute>0),
 global_day integer not null check(global_day>0)
);
insert into public.paid_api_limits(service,user_minute,user_day,global_minute,global_day) values
 ('receipt_scan',30,100,100,1000),
 ('bank_pdf',3,10,10,100),
 ('report_email',5,20,20,200),
 ('operator_email',1,5,6,24);
create table public.paid_api_windows (
 service text not null references public.paid_api_limits(service),
 scope text not null,
 user_id uuid references auth.users(id) on delete cascade,
 period text not null check(period in ('minute','day')),
 window_start timestamptz not null,
 calls integer not null check(calls>0),
 primary key(service,scope,period),
 check((user_id is null and scope='global') or (user_id is not null and scope=user_id::text))
);
alter table public.paid_api_limits enable row level security;
alter table public.paid_api_windows enable row level security;
revoke all on public.paid_api_limits,public.paid_api_windows from public,anon,authenticated;
grant select,update on public.paid_api_limits to service_role;
grant select,insert,update,delete on public.paid_api_windows to service_role;
create policy paid_api_limits_server_only on public.paid_api_limits for all to anon,authenticated using(false) with check(false);
create policy paid_api_windows_server_only on public.paid_api_windows for all to anon,authenticated using(false) with check(false);
create function public.consume_paid_api_request(p_user_id uuid,p_service text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare limits public.paid_api_limits%rowtype;moment timestamptz;bucket timestamptz;
 current_calls integer;ceiling integer;subject text;window_kind text;
begin
 if p_user_id is null then return false;end if;
 -- This row lock serializes all workers for a service, including different users.
 -- Check all four counters before incrementing any: denial cannot drain other quotas.
 select * into limits from public.paid_api_limits where service=p_service for update;
 if not found or not limits.enabled then return false;end if;
 moment:=clock_timestamp();
 foreach subject in array array['global',p_user_id::text] loop
  foreach window_kind in array array['minute','day'] loop
   bucket:=date_trunc(window_kind,moment,'UTC');
   ceiling:=case when subject='global' then case when window_kind='minute' then limits.global_minute else limits.global_day end
            else case when window_kind='minute' then limits.user_minute else limits.user_day end end;
   select calls into current_calls from public.paid_api_windows
    where service=p_service and scope=subject and period=window_kind and window_start=bucket;
   if coalesce(current_calls,0)>=ceiling then return false;end if;
  end loop;
 end loop;
 foreach subject in array array['global',p_user_id::text] loop
  foreach window_kind in array array['minute','day'] loop
   bucket:=date_trunc(window_kind,moment,'UTC');
   insert into public.paid_api_windows(service,scope,user_id,period,window_start,calls)
    values(p_service,subject,case when subject='global' then null else p_user_id end,window_kind,bucket,1)
   on conflict(service,scope,period) do update set window_start=excluded.window_start,
    calls=case when public.paid_api_windows.window_start=excluded.window_start then public.paid_api_windows.calls+1 else 1 end;
  end loop;
 end loop;
 return true;
end $$;
revoke all on function public.consume_paid_api_request(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_paid_api_request(uuid,text) to service_role;
