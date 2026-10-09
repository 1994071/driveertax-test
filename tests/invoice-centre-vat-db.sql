begin;
do $$ begin perform set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);end $$;
set local role authenticated;
do $$
declare driver uuid:=auth.uid();today date:=(now() at time zone 'Europe/London')::date;
 p jsonb;issued_id uuid;id2 uuid;draft uuid:=gen_random_uuid();req uuid:=gen_random_uuid();inc uuid;exp uuid;rev integer;c bigint;n bigint;v public.invoices%rowtype;
begin
 select count(*) into c from public.invoices where user_id=driver;
 select coalesce(last_number,0) into n from public.invoice_counters where user_id=driver;
 rev:=public.save_driver_invoice_draft(draft,jsonb_build_object('customer_name','Incomplete draft','invoice_date',today+30),0);
 if rev<>1 or (select count(*) from public.invoices where user_id=driver)<>c then raise exception 'Draft issued an invoice';end if;
 if (select coalesce(last_number,0) from public.invoice_counters where user_id=driver) is distinct from n then raise exception 'Draft used an invoice number';end if;
 begin perform public.save_driver_invoice_draft(draft,'{}',0);raise exception 'Stale draft overwritten';exception when others then if sqlerrm<>'Draft changed in another window. Reopen it before saving.' then raise;end if;end;
 begin perform public.issue_driver_invoice_draft(draft,rev);raise exception 'Future draft issued';exception when others then if sqlerrm<>'Set the invoice date to today before issuing this draft' then raise;end if;end;
 delete from public.invoice_drafts where invoice_drafts.id=draft;
 if exists(select 1 from public.invoice_drafts where invoice_drafts.id=draft) then raise exception 'Draft not deleted';end if;
 insert into public.vat_profiles(user_id,registered,vat_number,registration_date,scheme) values(driver,true,'123456789',today-30,'standard')
 on conflict(user_id) do update set registered=true,vat_number='123456789',registration_date=today-30,scheme='standard';
 p:=jsonb_build_object('seller_name','VAT Test Driver','seller_address','Test business address','seller_contact','test@example.test','customer_name','Test customer','customer_address','Test address','invoice_date',today,'supply_date',today,'due_date',today+7,'vat_enabled',true,'price_basis','exclusive','total',999,'vat_total',999,
 'items',jsonb_build_array(jsonb_build_object('description','Standard','quantity',1,'unit_price',100,'vat_rate',20),jsonb_build_object('description','Reduced','quantity',1,'unit_price',100,'vat_rate',5),jsonb_build_object('description','Zero','quantity',1,'unit_price',100,'vat_rate',0)));
 issued_id:=public.create_driver_invoice(p,req);select * into v from public.invoices where invoices.id=issued_id;
 if v.total<>325 or v.subtotal<>300 or v.vat_total<>25 or v.vat_number<>'123456789' or v.vat_scheme<>'standard' then raise exception 'Mixed-rate totals or snapshot wrong';end if;
 if public.create_driver_invoice(p,req)<>issued_id then raise exception 'VAT issue retry duplicated';end if;
 begin perform public.create_driver_invoice(p||jsonb_build_object('vat_enabled',false,'non_vat_confirmed',true),gen_random_uuid());raise exception 'VAT-registered driver issued non-VAT';exception when others then if sqlerrm<>'Use a VAT invoice for this VAT-registered business' then raise;end if;end;
 begin perform public.create_driver_invoice(p||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('description','Invalid','quantity',1,'unit_price',100,'vat_rate',17))),gen_random_uuid());raise exception 'Invalid VAT rate accepted';exception when others then if sqlerrm<>'Choose a supported VAT rate: 0, 5 or 20' then raise;end if;end;
 perform public.cancel_driver_invoice(issued_id);
 if not exists(select 1 from public.invoice_credits where invoice_id=issued_id and vat_total=25 and net_total=300) then raise exception 'VAT cancellation missing credit';end if;
 perform public.set_driver_invoice_archived(issued_id,true);perform public.set_driver_invoice_archived(issued_id,false);
 p:=p||jsonb_build_object('price_basis','inclusive','items',jsonb_build_array(jsonb_build_object('description','VAT-inclusive job','quantity',1,'unit_price',120,'vat_rate',20)));
 draft:=gen_random_uuid();rev:=public.save_driver_invoice_draft(draft,p,0);id2:=public.issue_driver_invoice_draft(draft,rev,p);
 if public.issue_driver_invoice_draft(draft,rev,p)<>id2 then raise exception 'Draft issue retry duplicated';end if;
 if exists(select 1 from public.invoice_drafts where invoice_drafts.id=draft) then raise exception 'Issued draft remains editable';end if;
 select * into v from public.invoices where invoices.id=id2;
 if v.total<>120 or v.subtotal<>100 or v.vat_total<>20 then raise exception 'Inclusive VAT total wrong';end if;
 insert into public.income(user_id,source,amount,earned_on) values(driver,'VAT fixture',120,today) returning income.id into inc;
 select count(*) into c from public.income where user_id=driver;
 perform public.pay_driver_invoice(id2,today,inc);perform public.set_driver_invoice_archived(id2,true);
 if (select count(*) from public.income where user_id=driver)<>c or (select amount from public.income where income.id=inc)<>120 or (select status from public.invoices where invoices.id=id2)<>'paid' then raise exception 'Archive changed paid income';end if;
 perform public.set_driver_invoice_archived(id2,false);
 begin update public.invoices set vat_total=0,subtotal=120 where invoices.id=id2;raise exception 'VAT snapshot changed';exception when others then if sqlerrm<>'Issued invoice details cannot be changed. Cancel an unpaid invoice and issue a replacement.' then raise;end if;end;
 insert into public.expenses(user_id,category,merchant,amount,expense_date) values(driver,'Other Expense','VAT fixture',120,today) returning expenses.id into exp;
 insert into public.vat_purchases(expense_id,user_id,tax_point,paid_on,scheme,supplier_vat_number,vat_on_document,business_percent,claim_amount,evidence_confirmed) values(exp,driver,today,today,'standard','987654321',20,50,10,true);
 if (select amount from public.expenses where expenses.id=exp)<>120 then raise exception 'Purchase VAT changed original cash expense';end if;
 begin update public.vat_purchases set claim_amount=20 where expense_id=exp;raise exception 'Excess business reclaim accepted';exception when others then if sqlerrm<>'Check eligible purchase VAT, registration, tax point and recorded expense payment date' then raise;end if;end;
 begin update public.expenses set amount=100 where expenses.id=exp;raise exception 'VAT-linked expense changed';exception when others then if sqlerrm<>'Remove the purchase VAT record before changing its expense amount or date' then raise;end if;end;
 delete from public.vat_purchases where expense_id=exp;
 update public.vat_profiles set scheme='cash' where user_id=driver;
 issued_id:=public.create_driver_invoice(p,gen_random_uuid());
 if (select vat_scheme from public.invoices where invoices.id=issued_id)<>'cash' or (select vat_scheme from public.invoices where invoices.id=id2)<>'standard' then raise exception 'Scheme snapshot not retained';end if;
 perform public.cancel_driver_invoice(issued_id);
 -- Every new table is isolated by owner RLS; anonymous users have no access.
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.invoices where invoices.id=id2) or exists(select 1 from public.vat_profiles where user_id=driver) or exists(select 1 from public.invoice_credits where invoice_id=issued_id) then raise exception 'Cross-driver data visible';end if;
 begin perform public.set_driver_invoice_archived(id2,true);raise exception 'Cross-driver archive accepted';exception when others then if sqlerrm<>'Invoice not found' then raise;end if;end;
end $$;
rollback;
