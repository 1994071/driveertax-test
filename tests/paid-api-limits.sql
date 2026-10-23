-- Run after the migration against a test database, or in this rollback-only transaction.
-- Synthetic identities, no provider calls, no permanent records or quota consumption.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
update public.paid_api_limits set user_minute=2,user_day=3,global_minute=3,global_day=4 where service='receipt_scan';
delete from public.paid_api_windows where service='receipt_scan';
set local role service_role;
do $$
declare u uuid:='00000000-0000-4000-8000-000000000001';v uuid:='00000000-0000-4000-8000-000000000002';before_count bigint;
begin
 if public.consume_paid_api_request(null,'receipt_scan') or public.consume_paid_api_request(u,'unknown') then raise exception 'Invalid arguments accepted';end if;
 if not public.consume_paid_api_request(u,'receipt_scan') or not public.consume_paid_api_request(u,'receipt_scan') then raise exception 'Allowed requests denied';end if;
 select sum(calls) into before_count from public.paid_api_windows where service='receipt_scan';
 if public.consume_paid_api_request(u,'receipt_scan') then raise exception 'User minute cap bypass';end if;
 if (select sum(calls) from public.paid_api_windows where service='receipt_scan')<>before_count then raise exception 'Denied request consumed quota';end if;
 if not public.consume_paid_api_request(v,'receipt_scan') or public.consume_paid_api_request(v,'receipt_scan') then raise exception 'Global minute cap bypass';end if;
 update public.paid_api_windows set window_start=window_start-interval '2 minutes' where service='receipt_scan' and period='minute';
 if not public.consume_paid_api_request(u,'receipt_scan') then raise exception 'Minute reset failed';end if;
 if public.consume_paid_api_request(u,'receipt_scan') then raise exception 'User daily cap bypass';end if;
 if public.consume_paid_api_request(v,'receipt_scan') then raise exception 'Global daily cap bypass';end if;
 update public.paid_api_windows set window_start=window_start-interval '2 days' where service='receipt_scan';
 if not public.consume_paid_api_request(v,'receipt_scan') then raise exception 'Daily reset failed';end if;
 update public.paid_api_limits set enabled=false where service='receipt_scan';
 if public.consume_paid_api_request(v,'receipt_scan') then raise exception 'Kill switch bypass';end if;
 if has_function_privilege('anon','public.consume_paid_api_request(uuid,text)','execute') or has_function_privilege('authenticated','public.consume_paid_api_request(uuid,text)','execute') then raise exception 'Client can consume or choose quota identity';end if;
 if has_table_privilege('authenticated','public.paid_api_limits','update') or has_table_privilege('anon','public.paid_api_windows','select') then raise exception 'Client can read/change private quotas';end if;
 if exists(select 1 from pg_class where oid in ('public.paid_api_limits'::regclass,'public.paid_api_windows'::regclass) and not relrowsecurity) then raise exception 'Missing RLS';end if;
 if (select count(*) from public.paid_api_windows where service='receipt_scan')<>6 then raise exception 'Counters grew beyond fixed user/global slots';end if;
end $$;
rollback;
