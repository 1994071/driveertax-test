-- Roll back all fixtures; no notifications are sent.
begin;
do $$
declare u uuid; h text:='bookkeeping-test-'||gen_random_uuid()::text; result jsonb;
begin
 select id into u from auth.users limit 1;
 if u is null then raise exception 'A fixture owner is required';end if;
 insert into public.owner_push_devices(endpoint_hash,user_id,subscription,binding,enabled,sound,bookkeeping_enabled,bookkeeping_time)
 values(h,u,'{}',gen_random_uuid(),true,true,true,'20:00');
 if public.claim_owner_bookkeeping_push(h,u,'2026-10-28 19:59:00+00') is not null then raise exception 'Reminder sent early';end if;
 if public.claim_owner_bookkeeping_push(h,gen_random_uuid(),'2026-10-28 20:00:00+00') is not null then raise exception 'Wrong owner claimed reminder';end if;
 result:=public.claim_owner_bookkeeping_push(h,u,'2026-10-28 20:00:00+00');
 if result is null then raise exception 'Due reminder missing';end if;
 if public.claim_owner_bookkeeping_push(h,u,'2026-10-28 20:10:00+00') is not null then raise exception 'Duplicate daily claim';end if;
 if public.claim_owner_bookkeeping_push(h,u,'2026-07-20 18:59:00+00') is not null then raise exception 'Summer reminder sent early';end if;
 if public.claim_owner_bookkeeping_push(h,u,'2026-07-20 19:00:00+00') is null then raise exception 'Summer reminder missing';end if;
 update public.owner_push_devices set bookkeeping_enabled=false where endpoint_hash=h;
 if public.claim_owner_bookkeeping_push(h,u,'2026-10-29 20:00:00+00') is not null then raise exception 'Opt-out ignored';end if;
 update public.owner_push_devices set bookkeeping_enabled=true,enabled=false where endpoint_hash=h;
 if public.claim_owner_bookkeeping_push(h,u,'2026-10-29 20:00:00+00') is not null then raise exception 'Disabled device received reminder';end if;
 if has_table_privilege('authenticated','public.owner_bookkeeping_push_deliveries','SELECT') then raise exception 'Client can read delivery log';end if;
 if has_function_privilege('authenticated','public.claim_owner_bookkeeping_push(text,uuid,timestamp with time zone)','EXECUTE') then raise exception 'Client can claim reminder';end if;
end $$;
rollback;
select 'PASS: daily claims, duplicate prevention, opt-out, owner isolation, DST, disabled devices and restricted privileges' as verification;
