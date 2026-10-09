begin;
do $$ begin perform set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);end $$;
set local role authenticated;
do $$
declare driver uuid:=auth.uid();today date:=(now() at time zone 'Europe/London')::date;start_date date:=today-90;
 inv_id uuid;inc_id uuid;exp_id uuid;cap_id uuid;request_id uuid:=gen_random_uuid();class_id uuid;review_id uuid;payload jsonb;amount numeric;
begin
 insert into public.vat_profiles(user_id,registered,vat_number,registration_date,scheme,flat_rate,flat_start_date,flat_authorised,flat_discount_eligible)
 values(driver,true,'123456789',start_date,'flat_invoice',10,start_date,true,true)
 on conflict(user_id) do update set registered=true,vat_number='123456789',registration_date=start_date,scheme='flat_invoice',flat_rate=10,flat_start_date=start_date,flat_authorised=true,flat_discount_eligible=true;
 begin update public.vat_profiles set flat_authorised=false where user_id=driver;raise exception 'Unauthorised Flat Rate accepted';exception when check_violation then null;end;
 payload:=jsonb_build_object('seller_name','Flat Rate Test','seller_address','Test address','seller_contact','test@example.test','customer_name','Test customer','customer_address','Test address','invoice_date',today,'supply_date',today,'due_date',today+7,'vat_enabled',true,'price_basis','exclusive','items',jsonb_build_array(jsonb_build_object('description','Transport','quantity',1,'unit_price',100,'vat_rate',20)));
 inv_id:=public.create_driver_invoice(payload,request_id);
 if not exists(select 1 from public.invoices where id=inv_id and total=120 and vat_total=20 and flat_rate=10 and flat_discount_eligible and flat_registration_date=start_date and vat_scheme='flat_invoice') then raise exception 'Flat Rate changed normal customer VAT or lost snapshot';end if;
 if public.create_driver_invoice(payload,request_id)<>inv_id then raise exception 'Flat invoice retry duplicated';end if;
 begin perform public.create_driver_invoice(payload||jsonb_build_object('invoice_date',start_date-1,'supply_date',start_date-1),gen_random_uuid());raise exception 'Pre-scheme invoice accepted';exception when others then if sqlerrm not in ('Invoice precedes Flat Rate Scheme start','Save a supported VAT registration before issuing') then raise;end if;end;
 begin perform public.create_driver_invoice(payload||jsonb_build_object('supply_date',start_date-1),gen_random_uuid());raise exception 'Pre-registration tax point accepted';exception when others then if sqlerrm<>'Tax point precedes VAT registration; check the sale before charging VAT' then raise;end if;end;
 begin update public.vat_profiles set registration_date=start_date-30 where user_id=driver;perform public.create_driver_invoice(payload||jsonb_build_object('supply_date',start_date-1),gen_random_uuid());raise exception 'Pre-Flat Rate tax point accepted';exception when others then if sqlerrm<>'Tax point precedes Flat Rate start; scheme-transition review required' then raise;end if;end;
 insert into public.income(user_id,source,amount,earned_on) values(driver,'Flat test',120,today) returning id into inc_id;
 insert into public.vat_classifications(user_id,income_id,gross_snapshot,source_date,tax_point,treatment,vat_on_document,eligible_percent,scheme,registration_date)
 values(driver,inc_id,120,today,today,'20',999,100,'standard',start_date) returning id into class_id;
 if not exists(select 1 from public.vat_classifications where id=class_id and vat_on_document=20 and claim_amount=0 and eligible_percent=0 and scheme='flat_invoice' and flat_rate=10 and flat_discount_eligible) then raise exception 'Sales class arithmetic not canonical';end if;
 begin update public.vat_classifications set gross_snapshot=121 where id=class_id;raise exception 'Stale source accepted';exception when others then if sqlerrm<>'Source record changed. Refresh before classifying.' then raise;end if;end;
 insert into public.expenses(user_id,category,merchant,amount,expense_date) values(driver,'Other Expense','Ordinary goods',120,today) returning id into exp_id;
 insert into public.vat_classifications(user_id,expense_id,gross_snapshot,source_date,tax_point,treatment,vat_on_document,eligible_percent,scheme,registration_date,evidence_confirmed)
 values(driver,exp_id,120,today,today,'20',20,100,'flat_invoice',start_date,true);
 if not exists(select 1 from public.vat_classifications where expense_id=exp_id and claim_amount=0 and eligible_percent=0) then raise exception 'Ordinary Flat Rate VAT reclaimed';end if;
 begin update public.vat_classifications set capital_goods=true,eligible_percent=100 where expense_id=exp_id;raise exception 'Under-2000 capital reclaim accepted';exception when others then if sqlerrm<>'Flat Rate capital reclaim requires a single eligible goods purchase of at least 2000 including VAT' then raise;end if;end;
 insert into public.expenses(user_id,category,merchant,amount,expense_date) values(driver,'Other Expense','Capital goods',3000,today) returning id into cap_id;
 insert into public.vat_classifications(user_id,expense_id,gross_snapshot,source_date,tax_point,treatment,vat_on_document,eligible_percent,scheme,registration_date,capital_goods,evidence_confirmed)
 values(driver,cap_id,3000,today,today,'20',500,100,'flat_invoice',start_date,true,true);
 if (select claim_amount from public.vat_classifications where expense_id=cap_id)<>500 then raise exception 'Capital reclaim not calculated';end if;
 begin update public.vat_classifications set evidence_confirmed=false where expense_id=cap_id;raise exception 'No-evidence reclaim accepted';exception when others then if sqlerrm<>'Confirm a valid VAT invoice and eligible reclaim' then raise;end if;end;
 -- A classification is mutable, but an amount/date change invalidates its snapshot rather than silently reusing VAT.
 update public.expenses set amount=3100 where id=cap_id;
 if (select gross_snapshot from public.vat_classifications where expense_id=cap_id)<>3000 then raise exception 'Source edit silently reclassified';end if;
 -- Delete classification then link the income to a VAT invoice: the same sale cannot be counted twice.
 delete from public.vat_classifications where id=class_id;perform public.pay_driver_invoice(inv_id,today,inc_id);
 begin insert into public.vat_classifications(user_id,income_id,gross_snapshot,source_date,tax_point,treatment,scheme,registration_date) values(driver,inc_id,120,today,today,'20','flat_invoice',start_date);raise exception 'Invoice income classified twice';exception when others then if sqlerrm<>'VAT invoice payments are already classified' then raise;end if;end;
 update public.vat_profiles set scheme='standard' where user_id=driver;
 delete from public.vat_classifications where expense_id=exp_id;
 insert into public.vat_purchases(expense_id,user_id,tax_point,paid_on,scheme,supplier_vat_number,vat_on_document,business_percent,claim_amount,evidence_confirmed) values(exp_id,driver,today,today,'standard','987654321',20,50,10,true);
 begin insert into public.vat_classifications(user_id,expense_id,gross_snapshot,source_date,tax_point,treatment,scheme,registration_date) values(driver,exp_id,120,today,today,'20','standard',start_date);raise exception 'Purchase classified twice';exception when others then if sqlerrm<>'Purchase VAT is already recorded. Remove that claim before reclassifying.' then raise;end if;end;
 delete from public.vat_purchases where expense_id=exp_id;
 insert into public.vat_classifications(user_id,expense_id,gross_snapshot,source_date,tax_point,treatment,vat_on_document,eligible_percent,scheme,registration_date,evidence_confirmed) values(driver,exp_id,120,today,today,'20',20,50,'standard',start_date,true);
 if (select claim_amount from public.vat_classifications where expense_id=exp_id)<>10 then raise exception 'Standard eligible share wrong';end if;
 begin insert into public.vat_purchases(expense_id,user_id,tax_point,paid_on,scheme,supplier_vat_number,vat_on_document,business_percent,claim_amount,evidence_confirmed) values(exp_id,driver,today,today,'standard','987654321',20,50,10,true);raise exception 'Classified expense got duplicate purchase VAT';exception when others then if sqlerrm<>'Expense is already VAT classified' then raise;end if;end;
 begin update public.vat_classifications set treatment='excluded',review_note='' where expense_id=exp_id;raise exception 'Unexplained exclusion accepted';exception when others then if sqlerrm<>'Explain the exclusion or unsupported transaction' then raise;end if;end;
 insert into public.vat_return_reviews(user_id,period_start,period_end,settings,record_fingerprint) values(driver,today-29,today,jsonb_build_object('scheme','flat_invoice','relevant_goods',300,'goods_confirmed',true,'scope_confirmed',true,'records_confirmed',true),'fixture-v2') returning id into review_id;
 insert into public.vat_return_reviews(user_id,period_start,period_end,settings,record_fingerprint) values(driver,today-29,today,jsonb_build_object('scheme','flat_invoice','relevant_goods',350,'goods_confirmed',true,'scope_confirmed',true,'records_confirmed',true),'resaved-v2') on conflict(user_id,period_start,period_end) do update set settings=excluded.settings,record_fingerprint=excluded.record_fingerprint;
 if (select record_fingerprint from public.vat_return_reviews where id=review_id)<>'resaved-v2' then raise exception 'Review could not be resaved';end if;
 begin insert into public.vat_return_reviews(user_id,period_start,period_end,settings,record_fingerprint) values(driver,today-20,today-1,jsonb_build_object('scheme','standard','scope_confirmed',true,'records_confirmed',true),'fixture-v2');raise exception 'Overlapping review accepted';exception when others then if sqlerrm<>'VAT review periods must not overlap. Reopen the existing period.' then raise;end if;end;
 begin update public.vat_return_reviews set settings=jsonb_build_object('scheme','standard','scope_confirmed',false,'records_confirmed',true) where id=review_id;raise exception 'Unconfirmed scope accepted';exception when others then if sqlerrm<>'Confirm supported scope and complete records' then raise;end if;end;
 begin update public.vat_return_reviews set period_end=today+1 where id=review_id;raise exception 'Future review saved';exception when others then if sqlerrm<>'Review a completed VAT period' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.vat_classifications where user_id=driver) or exists(select 1 from public.vat_return_reviews where id=review_id) then raise exception 'Cross-driver VAT records visible';end if;
 begin insert into public.vat_classifications(user_id,expense_id,gross_snapshot,source_date,tax_point,treatment,scheme,registration_date) values(auth.uid(),exp_id,120,today,today,'20','standard',start_date);raise exception 'Other driver expense classified';exception when others then if sqlerrm not in ('Save VAT registration first','Source record changed. Refresh before classifying.') then raise;end if;end;
end $$;
rollback;
