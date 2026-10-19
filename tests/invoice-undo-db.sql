begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
do $test$
declare driver uuid:=auth.uid();inv uuid;inc uuid;result jsonb;sample jsonb;
begin
 sample:=jsonb_build_object('invoice_date',(now() at time zone 'Europe/London')::date,'supply_date',(now() at time zone 'Europe/London')::date,'due_date',(now() at time zone 'Europe/London')::date,'seller_name','Audit fixture','seller_address','Test address','seller_contact','audit@example.test','customer_name','Audit fixture','customer_address','Test address','non_vat_confirmed',true,'items',jsonb_build_array(jsonb_build_object('description','Audit rollback only','quantity',1,'unit_price',123.45)));
 -- Use a non-VAT test actor; all changes are rolled back.
 delete from public.vat_profiles where user_id=driver;
 inv:=public.create_driver_invoice(sample,gen_random_uuid());
 inc:=public.pay_driver_invoice(inv,(now() at time zone 'Europe/London')::date,null);
 result:=public.undo_driver_invoice_payment(inv);
 if result->>'income_removed'<>'true' or exists(select 1 from public.income where id=inc) then raise exception 'Auto-created payment was not removed';end if;
 if not exists(select 1 from public.invoices where id=inv and status='unpaid' and income_id is null and paid_on is null) then raise exception 'Invoice did not become unpaid';end if;
 result:=public.undo_driver_invoice_payment(inv);if result->>'already_undone'<>'true' then raise exception 'Undo retry not idempotent';end if;
 insert into public.income(user_id,source,amount,earned_on,notes) values(driver,'Audit independent income',123.45,(now() at time zone 'Europe/London')::date,'Keep this record') returning id into inc;
 perform public.pay_driver_invoice(inv,(now() at time zone 'Europe/London')::date,inc);
 result:=public.undo_driver_invoice_payment(inv);
 if result->>'income_retained'<>'true' or not exists(select 1 from public.income where id=inc) then raise exception 'Existing income was deleted';end if;
 perform public.pay_driver_invoice(inv,(now() at time zone 'Europe/London')::date,inc);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.undo_driver_invoice_payment(inv);raise exception 'Other owner allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',driver::text,true);
 if not exists(select 1 from public.invoices where id=inv and status='paid') then raise exception 'Other owner changed invoice';end if;
end $test$;
rollback;

