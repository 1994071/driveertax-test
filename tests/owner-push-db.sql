begin;
create temp table push_fixture(name text,id uuid);
grant select,insert on push_fixture to authenticated,service_role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
do $test$
declare owner_id uuid:=auth.uid();inv uuid;sample jsonb;n text;
begin
 delete from public.vat_profiles where user_id=owner_id;
 sample:=jsonb_build_object('invoice_date',(now() at time zone 'Europe/London')::date,'supply_date',(now() at time zone 'Europe/London')::date,'due_date',(now() at time zone 'Europe/London')::date,'seller_name','Push rollback fixture','seller_address','Test address','seller_contact','owner@example.test','customer_name','Push fixture','customer_address','Test address','non_vat_confirmed',true,'items',jsonb_build_array(jsonb_build_object('description','Rollback only','quantity',1,'unit_price',123.45)));
 foreach n in array array['unpaid','paid','archived','cancelled','future'] loop
  if n='future' then sample:=jsonb_set(sample,'{due_date}',to_jsonb(((now() at time zone 'Europe/London')::date+7)::text));end if;
  inv:=public.create_driver_invoice(sample,gen_random_uuid());insert into push_fixture values(n,inv);
  if n='paid' then perform public.pay_driver_invoice(inv,(now() at time zone 'Europe/London')::date,null);end if;
  if n='archived' then perform public.set_driver_invoice_archived(inv,true);end if;
  if n='cancelled' then perform public.cancel_driver_invoice(inv);end if;
 end loop;
 begin perform private_key from public.owner_push_config;raise exception 'Client read signing key';exception when insufficient_privilege then null;end;
 begin perform public.list_owner_invoice_push();raise exception 'Client ran owner worker';exception when insufficient_privilege then null;end;
 begin insert into public.owner_push_devices(endpoint_hash,user_id,subscription,binding) values('client-attempt',owner_id,'{}',gen_random_uuid());raise exception 'Client forged device';exception when insufficient_privilege then null;end;
end $test$;
reset role;
insert into public.owner_push_devices(endpoint_hash,user_id,subscription,binding) values('rollback-only-device',(select (current_setting('request.jwt.claim.sub'))::uuid),'{}',gen_random_uuid());
set local role service_role;
do $test$
declare moment timestamptz:=((now() at time zone 'Europe/London')::date+time '10:00') at time zone 'Europe/London';owner_id uuid:=current_setting('request.jwt.claim.sub')::uuid;result jsonb;
begin
 if public.claim_owner_invoice_push('rollback-only-device',owner_id,moment-interval '3 hours') is not null then raise exception 'Outside UK daytime';end if;
 if public.claim_owner_invoice_push('rollback-only-device',gen_random_uuid(),moment) is not null then raise exception 'Other owner claimed device';end if;
 result:=public.claim_owner_invoice_push('rollback-only-device',owner_id,moment);
 if result is null or (result->>'due')::int<1 then raise exception 'Due summary missing';end if;
 if public.claim_owner_invoice_push('rollback-only-device',owner_id,moment) is not null then raise exception 'Daily duplicate';end if;
 result:=public.claim_owner_invoice_push('rollback-only-device',owner_id,moment+interval '7 days');
 if result is null or (result->>'overdue')::int<1 or (result->>'due')::int<1 then raise exception 'Due/overdue summary across DST failed';end if;
 update public.owner_push_devices set enabled=false where endpoint_hash='rollback-only-device';
 if public.claim_owner_invoice_push('rollback-only-device',owner_id,moment+interval '8 days') is not null then raise exception 'Disabled device claimed';end if;
end $test$;
rollback;
select 'PASS signing key/client restrictions, verified device owner, UK hours, due/overdue aggregation, DST, daily deduplication and disabled devices. Rollback only; no push sent.' as result;
