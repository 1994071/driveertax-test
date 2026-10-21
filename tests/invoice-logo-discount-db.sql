-- Execute inside a transaction. The caller rolls back, including isolated fixture users.
create temporary table invoice_test_actors (a uuid,b uuid);
insert into invoice_test_actors values(gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select a,a::text||'@example.test' from invoice_test_actors union all select b,b::text||'@example.test' from invoice_test_actors;
grant select on invoice_test_actors to authenticated;
select set_config('request.jwt.claim.sub',(select a::text from invoice_test_actors),true);
set local role authenticated;
do $test$
declare d uuid:=auth.uid();today date:=(now() at time zone 'Europe/London')::date;p jsonb;inv uuid;req uuid:=gen_random_uuid();v public.invoices%rowtype;inc uuid;outcome jsonb;draft uuid:=gen_random_uuid();rev integer;
begin
 insert into public.invoice_preferences(user_id,data) values(d,'{"seller-name":"Fixture","number_prefix":"EV","logo_data":"data:image/jpeg;base64,/9j/2Q=="}');
 insert into public.vat_profiles(user_id,registered,vat_number,registration_date,scheme) values(d,true,'123456789',today-30,'standard');
 p:=jsonb_build_object('seller_name','Fixture Business','seller_address','Fixture address','seller_contact','fixture@example.test','customer_name','Fixture Customer','customer_address','Fixture customer address','invoice_date',today,'supply_date',today,'due_date',today+7,'vat_enabled',true,'price_basis','exclusive','discount_type','percent','discount_value',10,'logo_data','data:image/jpeg;base64,/9j/2Q==','items',jsonb_build_array(jsonb_build_object('description','Work','quantity',1,'unit_price',100,'vat_rate',20)));
 inv:=public.create_driver_invoice(p,req);select * into v from public.invoices where id=inv;
 if v.invoice_number not like 'EV-%' or v.total<>108 or v.subtotal<>90 or v.vat_total<>18 or v.discount_amount<>10 or v.logo_data<>p->>'logo_data' then raise exception 'Discount VAT/logo snapshot incorrect';end if;
 if public.create_driver_invoice(p,req)<>inv then raise exception 'Retry duplicated invoice';end if;
 begin update public.invoices set logo_data='' where id=inv;raise exception 'Logo changed after issue';exception when others then if sqlerrm not like 'Issued invoice details cannot be changed%' then raise;end if;end;
 begin update public.invoices set discount_value=0 where id=inv;raise exception 'Discount changed after issue';exception when others then if sqlerrm not like 'Issued invoice details cannot be changed%' then raise;end if;end;
 begin
   insert into public.invoices select (jsonb_populate_record(null::public.invoices,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'request_id',gen_random_uuid(),'invoice_number','TAMPER','items',jsonb_set(v.items,'{0,discount_amount}','0'::jsonb)))).*;
   raise exception 'Forged discount arithmetic accepted';
 exception when others then if sqlerrm<>'Invalid invoice discount or VAT arithmetic' then raise;end if;end;
 inc:=public.pay_driver_invoice(inv,today,null);if (select amount from public.income where id=inc)<>108 then raise exception 'Income used pre-discount amount';end if;
 if public.pay_driver_invoice(inv,today,null)<>inc then raise exception 'Retry duplicated income';end if;
 perform public.set_driver_invoice_archived(inv,true);if (select amount from public.income where id=inc)<>108 then raise exception 'Archive changed income';end if;
 outcome:=public.undo_driver_invoice_payment(inv);if outcome->>'income_removed'<>'true' or exists(select 1 from public.income where id=inc) then raise exception 'Undo did not remove generated income';end if;
 perform public.cancel_driver_invoice(inv);if not exists(select 1 from public.invoice_credits where invoice_id=inv and net_total=90 and vat_total=18) then raise exception 'Discounted credit incorrect';end if;
 p:=p||jsonb_build_object('price_basis','inclusive','discount_type','fixed','discount_value',12,'items',jsonb_build_array(jsonb_build_object('description','Work','quantity',1,'unit_price',120,'vat_rate',20)));
 rev:=public.save_driver_invoice_draft(draft,p,0);inv:=public.issue_driver_invoice_draft(draft,rev,p);select * into v from public.invoices where id=inv;
 if v.total<>108 or v.subtotal<>90 or v.vat_total<>18 or v.discount_amount<>12 or v.logo_data<>p->>'logo_data' then raise exception 'Draft issue lost inclusive discount/logo';end if;
 if public.issue_driver_invoice_draft(draft,rev,p)<>inv then raise exception 'Draft retry duplicated invoice';end if;
 inv:=public.create_driver_invoice(p-array['discount_type','discount_value','logo_data'],gen_random_uuid());select * into v from public.invoices where id=inv;if v.total<>120 or v.discount_amount<>0 or v.logo_data<>'' then raise exception 'Older client compatibility failed';end if;
 begin perform public.create_driver_invoice(p||jsonb_build_object('discount_value',1000),gen_random_uuid());raise exception 'Excess discount accepted';exception when others then if sqlerrm<>'Discount cannot exceed the items total' then raise;end if;end;
 begin perform public.create_driver_invoice(p||jsonb_build_object('logo_data','data:image/svg+xml;base64,xxx'),gen_random_uuid());raise exception 'SVG accepted';exception when check_violation then null;end;
end $test$;
select set_config('request.jwt.claim.sub',(select b::text from invoice_test_actors),true);
do $test$
begin
 if exists(select 1 from public.invoice_preferences) or exists(select 1 from public.invoices) then raise exception 'Another account can read invoices or defaults';end if;
 begin insert into public.invoice_preferences(user_id,data) select a,'{}'::jsonb from invoice_test_actors;raise exception 'Another account can write defaults';exception when insufficient_privilege then null;end;
end $test$;
reset role;
