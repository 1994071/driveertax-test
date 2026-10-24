begin;
create temp table reminder_fixture(name text,id uuid);
grant select,insert on reminder_fixture to authenticated,service_role;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
do $test$
declare owner_id uuid:=auth.uid();inv uuid;sample jsonb;n text;
begin
 delete from public.vat_profiles where user_id=owner_id;
 sample:=jsonb_build_object('invoice_date',(now() at time zone 'Europe/London')::date,'supply_date',(now() at time zone 'Europe/London')::date,'due_date',(now() at time zone 'Europe/London')::date,'seller_name','Reminder rollback fixture','seller_address','Test address','seller_contact','owner@example.test','customer_name','Reminder fixture','customer_address','Test address','non_vat_confirmed',true,'items',jsonb_build_array(jsonb_build_object('description','Rollback only','quantity',1,'unit_price',123.45)));
 foreach n in array array['unpaid','paid','archived','off','cancelled'] loop
  inv:=public.create_driver_invoice(sample,gen_random_uuid());insert into reminder_fixture values(n,inv);
  insert into public.invoice_reminder_settings(invoice_id,user_id,enabled,recipient) values(inv,owner_id,n<>'off','customer@example.test');
  if n='paid' then perform public.pay_driver_invoice(inv,(now() at time zone 'Europe/London')::date,null);end if;
  if n='cancelled' then perform public.cancel_driver_invoice(inv);end if;
  if n='archived' then perform public.set_driver_invoice_archived(inv,true);end if;
 end loop;
 begin perform public.list_due_invoice_reminders();raise exception 'Client can run worker';exception when insufficient_privilege then null;end;
 begin perform token_hash from public.invoice_reminder_worker;raise exception 'Client can read worker auth';exception when insufficient_privilege then null;end;
 begin insert into public.invoice_reminder_deliveries(invoice_id,user_id,stage) values(inv,owner_id,'due');raise exception 'Client can forge delivery';exception when insufficient_privilege then null;end;
 begin update public.invoice_reminder_settings set enabled=true where invoice_id=(select id from reminder_fixture where name='paid');raise exception 'Paid reminder enabled';exception when raise_exception then if sqlerrm='Paid reminder enabled' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.invoice_reminder_settings where invoice_id in(select id from reminder_fixture)) then raise exception 'Other account saw reminder';end if;
 update public.invoice_reminder_settings set enabled=true where invoice_id=inv;
 if found then raise exception 'Other account changed reminder';end if;
end $test$;
reset role;
set local role service_role;
do $test$
declare moment timestamptz:=((now() at time zone 'Europe/London')::date+time '10:00') at time zone 'Europe/London';inv uuid;result jsonb;
begin
 select id into inv from reminder_fixture where name='unpaid';
 if exists(select 1 from public.list_due_invoice_reminders(moment-interval '3 hours') where invoice_id in(select id from reminder_fixture)) then raise exception 'Outside business hours';end if;
 if (select count(*) from public.list_due_invoice_reminders(moment) where invoice_id in(select id from reminder_fixture))<>1 then raise exception 'Unpaid/archived/off/paid eligibility wrong';end if;
 result:=public.claim_invoice_reminder(inv,'due',moment);if result->>'recipient'<>'customer@example.test' then raise exception 'Recipient missing';end if;
 if public.claim_invoice_reminder(inv,'due',moment) is not null then raise exception 'Duplicate claim';end if;
 perform public.finish_invoice_reminder(inv,'due','mock-only-provider-id',null);
 if not exists(select 1 from public.invoice_reminder_deliveries where invoice_id=inv and status='accepted') then raise exception 'Acceptance not recorded';end if;
 if public.claim_invoice_reminder(inv,'overdue',moment+interval '6 days') is not null then raise exception 'Early overdue';end if;
 result:=public.claim_invoice_reminder(inv,'overdue',moment+interval '7 days');if result is null then raise exception 'Overdue not claimed across DST';end if;
 perform public.finish_invoice_reminder(inv,'overdue',null,'Mock rejection');
 if not exists(select 1 from public.invoice_reminder_deliveries where invoice_id=inv and stage='overdue' and status='failed') then raise exception 'Failure not recorded';end if;
 if public.claim_invoice_reminder(inv,'overdue',moment+interval '7 days') is not null then raise exception 'Failed reminder automatically repeated';end if;
 if public.claim_invoice_reminder((select id from reminder_fixture where name='paid'),'due',moment) is not null then raise exception 'Paid invoice claimed';end if;
 if public.claim_invoice_reminder((select id from reminder_fixture where name='archived'),'due',moment) is not null then raise exception 'Archived invoice claimed';end if;
 if public.claim_invoice_reminder((select id from reminder_fixture where name='cancelled'),'due',moment) is not null then raise exception 'Cancelled invoice claimed';end if;
 if public.claim_invoice_reminder((select id from reminder_fixture where name='off'),'due',moment) is not null then raise exception 'Disabled reminder claimed';end if;
end $test$;
rollback;
select 'PASS rollback-only owner isolation, service-only worker, eligible/unpaid/off/paid/archive, UK hours, DST, duplicate claims and provider-result recording. No emails sent.' as result;
