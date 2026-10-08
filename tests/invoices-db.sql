begin;
do $$ begin perform set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);end $$;
set local role authenticated;
do $$
declare
 driver uuid:=auth.uid();today date:=(now() at time zone 'Europe/London')::date;
 payload jsonb;request uuid:=gen_random_uuid();first_id uuid;second_id uuid;third_id uuid;income_id uuid;prior_count bigint;
 payment_day date;
begin
 select d::date into payment_day from generate_series(date '2026-04-06',today,interval '1 day') d
 where not exists(select 1 from public.period_entries where user_id=driver and d::date between period_start and period_end)
 and not exists(select 1 from public.income where user_id=driver and earned_on=d::date and amount=57.05) order by d limit 1;
 if payment_day is null then raise exception 'No isolated payment day';end if;
 payload:=jsonb_build_object('seller_name','Test Driver','trading_name','Test Travel','seller_address','1 Test Road, Birmingham','seller_contact','driver@example.test',
 'customer_name','Test Customer','customer_address','2 Test Road, Birmingham','customer_email','customer@example.test','invoice_date',today,'supply_date',today,'due_date',today+7,
 'items',jsonb_build_array(jsonb_build_object('description','Airport transfer','quantity',3,'unit_price',12.345),jsonb_build_object('description','Waiting','quantity',2,'unit_price',10)),
 'non_vat_confirmed',true,'total',999);
 first_id:=public.create_driver_invoice(payload,request);
 if public.create_driver_invoice(payload,request)<>first_id then raise exception 'Issue retry not idempotent';end if;
 if not exists(select 1 from public.invoices where id=first_id and total=57.05 and status='unpaid') then raise exception 'Server total wrong';end if;
 second_id:=public.create_driver_invoice(payload,gen_random_uuid());
 if (select invoice_number from public.invoices where id=second_id)=(select invoice_number from public.invoices where id=first_id) then raise exception 'Number duplicated';end if;
 select count(*) into prior_count from public.income where user_id=driver;
 income_id:=public.pay_driver_invoice(first_id,payment_day);
 if public.pay_driver_invoice(first_id,payment_day)<>income_id then raise exception 'Payment retry duplicated income';end if;
 if (select count(*) from public.income where user_id=driver)<>prior_count+1 then raise exception 'Unexpected income count';end if;
 begin perform public.pay_driver_invoice(second_id,payment_day);raise exception 'Duplicate income accepted';
 exception when others then if sqlerrm<>'invoice_possible_duplicate_income' then raise;end if;end;
 begin perform public.pay_driver_invoice(second_id,payment_day,income_id);raise exception 'Same income linked twice';
 exception when others then if sqlerrm<>'That income is already linked to another invoice' then raise;end if;end;
 insert into public.income(user_id,source,amount,earned_on) values(driver,'Private booking',57.05,payment_day) returning id into income_id;
 select count(*) into prior_count from public.income where user_id=driver;
 perform public.pay_driver_invoice(second_id,payment_day,income_id);
 if (select count(*) from public.income where user_id=driver)<>prior_count then raise exception 'Linking added income';end if;
 begin update public.income set amount=1 where id=income_id;raise exception 'Linked amount changed';
 exception when others then if sqlerrm<>'This income is linked to a paid invoice; its amount, date and owner cannot be changed' then raise;end if;end;
 begin update public.invoices set seller_name='Changed' where id=first_id;raise exception 'Issued details changed';
 exception when others then if sqlerrm<>'Issued invoice details cannot be changed. Cancel an unpaid invoice and issue a replacement.' then raise;end if;end;
 third_id:=public.create_driver_invoice(payload,gen_random_uuid());perform public.cancel_driver_invoice(third_id);
 begin perform public.pay_driver_invoice(third_id,payment_day);raise exception 'Cancelled invoice paid';
 exception when others then if sqlerrm<>'A cancelled invoice cannot be paid' then raise;end if;end;
 begin perform public.create_driver_invoice(payload||jsonb_build_object('non_vat_confirmed',false),gen_random_uuid());raise exception 'VAT accepted';
 exception when others then if sqlerrm<>'This feature supports non-VAT invoices only' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.invoices where id=first_id) then raise exception 'Other driver invoice visible';end if;
 begin perform public.pay_driver_invoice(first_id,payment_day);raise exception 'Other driver payment accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
