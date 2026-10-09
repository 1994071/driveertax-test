-- VAT Returns & Flat Rate: ordinary domestic UK return preparation. No HMRC submission.
alter table public.vat_profiles drop constraint vat_profiles_scheme_check;
alter table public.vat_profiles add constraint vat_profiles_scheme_check check(scheme in ('standard','cash','flat_invoice','flat_cash')),
 add column flat_rate numeric(4,2),add column flat_start_date date,
 add column flat_discount_eligible boolean not null default false,add column flat_authorised boolean not null default false;
alter table public.vat_profiles add constraint vat_profiles_flat_settings check(scheme not like 'flat_%' or (registered and flat_authorised and flat_start_date is not null and flat_start_date>=registration_date and flat_rate is not null and flat_rate in (4,5,6.5,7.5,8,8.5,9,9.5,10,10.5,11,12,12.5,13,13.5,14,14.5)));
alter table public.invoices drop constraint invoices_vat_scheme_check;
alter table public.invoices add constraint invoices_vat_scheme_check check(vat_scheme in ('none','standard','cash','flat_invoice','flat_cash')),
 add column flat_rate numeric(4,2),add column flat_discount_eligible boolean not null default false,
 add column flat_registration_date date,add column flat_start_date date,add column capital_sale boolean not null default false;
alter table public.invoices add constraint invoices_flat_snapshot check(vat_scheme not like 'flat_%' or (flat_rate is not null and flat_registration_date is not null and flat_start_date is not null and flat_start_date>=flat_registration_date and flat_start_date<=invoice_date));
create table public.vat_classifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 income_id uuid unique references public.income(id) on delete cascade,
 expense_id uuid unique references public.expenses(id) on delete cascade,
 source_type text generated always as (case when income_id is not null then 'income' else 'expense' end) stored,
 source_id uuid generated always as (coalesce(income_id,expense_id)) stored,
 gross_snapshot numeric(14,2) not null check(gross_snapshot>=0),source_date date not null,tax_point date not null,
 treatment text not null check(treatment in ('20','5','0','exempt','excluded','unsupported')),
 vat_on_document numeric(14,2) not null default 0 check(vat_on_document>=0),
 eligible_percent numeric(5,2) not null default 0 check(eligible_percent between 0 and 100),
 claim_amount numeric(14,2) not null default 0 check(claim_amount>=0),
 scheme text not null check(scheme in ('standard','cash','flat_invoice','flat_cash')),
 flat_rate numeric(4,2),flat_discount_eligible boolean not null default false,registration_date date not null,flat_start_date date,
 capital_goods boolean not null default false,capital_sale boolean not null default false,
 evidence_confirmed boolean not null default false,review_note text not null default '' check(length(review_note)<=500),
 updated_at timestamptz not null default now(),check((income_id is null)<>(expense_id is null)),unique(user_id,source_type,source_id)
);
create index vat_classifications_user_taxpoint on public.vat_classifications(user_id,tax_point);
alter table public.vat_classifications enable row level security;
create policy vat_classifications_owner on public.vat_classifications for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.vat_classifications from public,anon;
grant select,insert,update,delete on public.vat_classifications to authenticated;
create function public.guard_vat_classification() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.vat_profiles%rowtype;gross numeric;record_date date;driver uuid:=auth.uid();today date:=(now() at time zone 'Europe/London')::date;rate numeric;
begin
 if driver is null or new.user_id<>driver then raise exception 'Sign in to classify your VAT records' using errcode='42501';end if;
 if tg_op='UPDATE' and (new.income_id is distinct from old.income_id or new.expense_id is distinct from old.expense_id or new.user_id is distinct from old.user_id) then raise exception 'Classification source cannot change';end if;
 select * into p from public.vat_profiles where user_id=driver;
 if not found or not p.registered then raise exception 'Save VAT registration first';end if;
 if new.income_id is not null then
   select amount,earned_on into gross,record_date from public.income where id=new.income_id and user_id=driver for update;
   if exists(select 1 from public.invoices where income_id=new.income_id and vat_enabled) then raise exception 'VAT invoice payments are already classified';end if;
 else
   select amount,expense_date into gross,record_date from public.expenses where id=new.expense_id and user_id=driver for update;
   if exists(select 1 from public.vat_purchases where expense_id=new.expense_id) then raise exception 'Purchase VAT is already recorded. Remove that claim before reclassifying.';end if;
 end if;
 if gross is null or new.gross_snapshot is distinct from gross or new.source_date is distinct from record_date then raise exception 'Source record changed. Refresh before classifying.';end if;
 if new.tax_point<p.registration_date or new.tax_point>today or record_date>today then raise exception 'Check VAT registration, tax point and payment date';end if;
 new.scheme:=p.scheme;new.flat_rate:=p.flat_rate;new.flat_discount_eligible:=p.flat_discount_eligible;new.registration_date:=p.registration_date;new.flat_start_date:=p.flat_start_date;
 if p.scheme like 'flat_%' and (case when p.scheme='flat_cash' then record_date else new.tax_point end)<p.flat_start_date then raise exception 'Record precedes Flat Rate Scheme start';end if;
 if new.treatment in ('excluded','unsupported') and nullif(btrim(new.review_note),'') is null then raise exception 'Explain the exclusion or unsupported transaction';end if;
 rate:=case when new.treatment in ('20','5','0') then new.treatment::numeric else 0 end;
 if new.income_id is not null then
   new.vat_on_document:=round(gross-gross/(1+rate/100),2);new.eligible_percent:=0;new.claim_amount:=0;new.capital_goods:=false;
 else
   if new.capital_sale then raise exception 'Capital sale applies to income only';end if;
   if new.treatment not in ('20','5') then new.vat_on_document:=0;new.eligible_percent:=0;end if;
   if new.vat_on_document>round(gross-gross/(1+rate/100),2) then raise exception 'VAT exceeds the selected rate within the recorded gross expense';end if;
   if p.scheme like 'flat_%' and not new.capital_goods then new.eligible_percent:=0;end if;
   if new.capital_goods and (p.scheme not like 'flat_%' or gross<2000 or new.treatment not in ('20','5')) then raise exception 'Flat Rate capital reclaim requires a single eligible goods purchase of at least 2000 including VAT';end if;
   new.claim_amount:=round(new.vat_on_document*new.eligible_percent/100,2);
   if new.claim_amount>0 and not new.evidence_confirmed then raise exception 'Confirm a valid VAT invoice and eligible reclaim';end if;
 end if;
 if new.capital_sale and (p.scheme not like 'flat_%' or new.treatment not in ('20','5','0')) then raise exception 'Capital disposal outside Flat Rate requires a supported VAT sales rate';end if;
 new.updated_at:=now();return new;
end $$;
create trigger vat_classifications_guard before insert or update on public.vat_classifications for each row execute function public.guard_vat_classification();
-- Reviews store settings and a record fingerprint, never client-supplied VAT totals.
create table public.vat_return_reviews (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 period_start date not null,period_end date not null check(period_end>=period_start),
 settings jsonb not null check(jsonb_typeof(settings)='object' and length(settings::text)<=8000),
 record_fingerprint text not null check(length(record_fingerprint) between 1 and 200000),
 updated_at timestamptz not null default now(),unique(user_id,period_start,period_end)
);
create index vat_return_reviews_user_period on public.vat_return_reviews(user_id,period_start,period_end);
alter table public.vat_return_reviews enable row level security;
create policy vat_return_reviews_owner on public.vat_return_reviews for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.vat_return_reviews from public,anon;
grant select,insert,update,delete on public.vat_return_reviews to authenticated;
create function public.guard_vat_return_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.user_id<>auth.uid() or auth.uid() is null then raise exception 'Sign in' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':vat-review',0));
 if new.period_end>(now() at time zone 'Europe/London')::date then raise exception 'Review a completed VAT period';end if;
 if (new.settings->>'scope_confirmed')::boolean is distinct from true or (new.settings->>'records_confirmed')::boolean is distinct from true then raise exception 'Confirm supported scope and complete records';end if;
 if new.settings->>'scheme' not in ('standard','cash','flat_invoice','flat_cash') or new.settings->>'scheme' is null then raise exception 'Choose a VAT method';end if;
 if new.settings->>'scheme' like 'flat_%' and ((new.settings->>'goods_confirmed')::boolean is distinct from true or (new.settings->>'relevant_goods')::numeric is null or (new.settings->>'relevant_goods')::numeric<0 or (new.settings->>'relevant_goods')::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Check relevant goods for the limited-cost test';end if;
 if exists(select 1 from public.vat_return_reviews where user_id=auth.uid() and id<>new.id and not(period_start=new.period_start and period_end=new.period_end) and period_start<=new.period_end and period_end>=new.period_start) then raise exception 'VAT review periods must not overlap. Reopen the existing period.';end if;
 new.updated_at:=now();return new;
end $$;
create trigger vat_return_reviews_guard before insert or update on public.vat_return_reviews for each row execute function public.guard_vat_return_review();
revoke all on function public.guard_vat_classification(),public.guard_vat_return_review() from public,anon;
create or replace function public.create_driver_invoice(p_invoice jsonb,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
 driver uuid:=auth.uid();result uuid;seq bigint;item jsonb;clean_items jsonb:='[]'::jsonb;
 quantity numeric;rate numeric;line_total numeric;amount numeric:=0;
 issued date:=(p_invoice->>'invoice_date')::date;supply date:=(p_invoice->>'supply_date')::date;due date:=(p_invoice->>'due_date')::date;
 vat boolean:=coalesce((p_invoice->>'vat_enabled')::boolean,false);profile public.vat_profiles%rowtype;basis text:=coalesce(p_invoice->>'price_basis','exclusive');vat_rate numeric;net numeric;tax numeric;net_sum numeric:=0;tax_sum numeric:=0;taxpoint date;
 today date:=(now() at time zone 'Europe/London')::date;
begin
 if driver is null then raise exception 'Sign in to create an invoice' using errcode='42501';end if;
 if p_request_id is null then raise exception 'Missing save request';end if;
 perform pg_advisory_xact_lock(hashtextextended(driver::text||':invoices',0));
 select id into result from public.invoices where user_id=driver and request_id=p_request_id;
 if found then return result;end if;
 if vat then
   select * into profile from public.vat_profiles where user_id=driver;
   if not found or not profile.registered or profile.scheme not in ('standard','cash','flat_invoice','flat_cash') or profile.registration_date>issued then raise exception 'Save a supported VAT registration before issuing';end if;
   if profile.scheme like 'flat_%' and issued<profile.flat_start_date then raise exception 'Invoice precedes Flat Rate Scheme start';end if;
   if basis not in ('exclusive','inclusive') then raise exception 'Choose prices including or excluding VAT';end if;
 else
   if exists(select 1 from public.vat_profiles where user_id=driver and registered and registration_date<=issued) then raise exception 'Use a VAT invoice for this VAT-registered business';end if;
   if (p_invoice->>'non_vat_confirmed')::boolean is distinct from true then raise exception 'Confirm that you are not VAT registered';end if;
 end if;
 taxpoint:=case when supply<issued-14 then supply else issued end;
 if vat and taxpoint<profile.registration_date then raise exception 'Tax point precedes VAT registration; check the sale before charging VAT';end if;
 if vat and profile.scheme='flat_invoice' and taxpoint<profile.flat_start_date then raise exception 'Tax point precedes Flat Rate start; scheme-transition review required';end if;
 if issued is null or supply is null or due is null or due<issued or issued>today then raise exception 'Check invoice, supply and due dates';end if;
 if jsonb_typeof(p_invoice->'items') is distinct from 'array' or jsonb_array_length(p_invoice->'items') not between 1 and 20 then raise exception 'Add between 1 and 20 invoice items';end if;
 for item in select value from jsonb_array_elements(p_invoice->'items') loop
   quantity:=(item->>'quantity')::numeric;rate:=(item->>'unit_price')::numeric;
   if nullif(btrim(item->>'description'),'') is null or length(item->>'description')>200 or quantity is null or rate is null
      or quantity<=0 or quantity>100000 or rate<0 or rate>10000000 or quantity::text in ('NaN','Infinity','-Infinity') or rate::text in ('NaN','Infinity','-Infinity') then raise exception 'Check item description, quantity and price';end if;
   quantity:=round(quantity,2);rate:=round(rate,2);if quantity<=0 then raise exception 'Quantity is too small';end if;
   line_total:=round(quantity*rate,2);vat_rate:=case when vat then (item->>'vat_rate')::numeric else 0 end;
   if vat_rate is null or vat_rate not in (0,5,20) then raise exception 'Choose a supported VAT rate: 0, 5 or 20';end if;
   if vat and basis='inclusive' then net:=round(line_total/(1+vat_rate/100),2);tax:=line_total-net;
   else net:=line_total;tax:=round(net*vat_rate/100,2);line_total:=net+tax;end if;
   amount:=amount+line_total;net_sum:=net_sum+net;tax_sum:=tax_sum+tax;
   clean_items:=clean_items||jsonb_build_array(jsonb_build_object('description',btrim(item->>'description'),'quantity',quantity,'unit_price',rate,'line_total',line_total,'net_total',net,'vat_total',tax,'vat_rate',vat_rate));
 end loop;
 if amount<=0 or amount>10000000 then raise exception 'Enter a positive total of no more than 10000000';end if;
 if nullif(btrim(p_invoice->>'seller_name'),'') is null or nullif(btrim(p_invoice->>'seller_address'),'') is null or nullif(btrim(p_invoice->>'seller_contact'),'') is null
   or nullif(btrim(p_invoice->>'customer_name'),'') is null or nullif(btrim(p_invoice->>'customer_address'),'') is null then raise exception 'Add your name, address and contact, plus customer name and address';end if;
 insert into public.invoice_counters(user_id,last_number) values(driver,1)
 on conflict(user_id) do update set last_number=public.invoice_counters.last_number+1 returning last_number into seq;
 insert into public.invoices(user_id,request_id,invoice_number,seller_name,trading_name,seller_address,seller_contact,customer_name,customer_address,customer_email,
 invoice_date,supply_date,due_date,items,total,payment_details,notes,vat_enabled,vat_number,vat_scheme,price_basis,subtotal,vat_total,tax_point,flat_rate,flat_discount_eligible,flat_registration_date,flat_start_date,capital_sale)
 values(driver,p_request_id,'DT-'||to_char(issued,'YYYY')||'-'||lpad(seq::text,greatest(4,length(seq::text)),'0'),btrim(p_invoice->>'seller_name'),coalesce(btrim(p_invoice->>'trading_name'),''),
 btrim(p_invoice->>'seller_address'),btrim(p_invoice->>'seller_contact'),btrim(p_invoice->>'customer_name'),btrim(p_invoice->>'customer_address'),coalesce(btrim(p_invoice->>'customer_email'),''),
 issued,supply,due,clean_items,amount,coalesce(p_invoice->>'payment_details',''),coalesce(p_invoice->>'notes',''),vat,case when vat then profile.vat_number else '' end,case when vat then profile.scheme else 'none' end,basis,net_sum,tax_sum,case when vat then taxpoint else null end,case when vat and profile.scheme like 'flat_%' then profile.flat_rate else null end,case when vat and profile.scheme like 'flat_%' then profile.flat_discount_eligible else false end,case when vat and profile.scheme like 'flat_%' then profile.registration_date else null end,case when vat and profile.scheme like 'flat_%' then profile.flat_start_date else null end,coalesce((p_invoice->>'capital_sale')::boolean,false)) returning id into result;
 return result;
end $$;


create or replace function public.guard_vat_purchase() returns trigger language plpgsql security invoker set search_path='' as $$
declare e public.expenses%rowtype;p public.vat_profiles%rowtype;today date:=(now() at time zone 'Europe/London')::date;
begin
 select * into e from public.expenses where id=new.expense_id and user_id=auth.uid() for update;
 if exists(select 1 from public.vat_classifications where expense_id=new.expense_id) then raise exception 'Expense is already VAT classified';end if;
 select * into p from public.vat_profiles where user_id=auth.uid();
 if e.id is null or new.user_id<>auth.uid() or not coalesce(p.registered,false) or p.scheme not in ('standard','cash') or new.scheme<>p.scheme or new.tax_point<p.registration_date or new.tax_point>today or new.paid_on<>e.expense_date or new.paid_on>today
   or new.vat_on_document>round(e.amount/6,2) or new.claim_amount<>round(new.vat_on_document*new.business_percent/100,2) then raise exception 'Check eligible purchase VAT, registration, tax point and recorded expense payment date';end if;
 return new;
end $$;

create or replace function public.guard_driver_invoice() returns trigger language plpgsql security invoker set search_path='' as $$
declare linked public.income%rowtype;item jsonb;n numeric:=0;v numeric:=0;gross numeric;
begin
 if tg_op='INSERT' and new.vat_scheme like 'flat_%' and not exists(select 1 from public.vat_profiles where user_id=new.user_id and flat_rate=new.flat_rate and flat_discount_eligible=new.flat_discount_eligible and registration_date=new.flat_registration_date and flat_start_date=new.flat_start_date and flat_authorised) then raise exception 'Flat Rate snapshot does not match your authorised settings';end if;
 if new.status='paid' and new.vat_scheme like 'flat_%' and new.paid_on<new.flat_start_date then raise exception 'Payment precedes Flat Rate start; scheme-transition review required';end if;
 if tg_op='UPDATE' then
   if (to_jsonb(new)-array['status','paid_on','income_id','payment_mode','updated_at','archived']) is distinct from (to_jsonb(old)-array['status','paid_on','income_id','payment_mode','updated_at','archived']) then raise exception 'Issued invoice details cannot be changed. Cancel an unpaid invoice and issue a replacement.';end if;
   if old.status<>'unpaid' and (to_jsonb(new)-array['archived','updated_at']) is distinct from (to_jsonb(old)-array['archived','updated_at']) then raise exception 'Paid or cancelled invoices cannot be changed';end if;
 elsif new.status<>'unpaid' then raise exception 'New invoices must be unpaid';
 elsif new.vat_enabled then
   if not exists(select 1 from public.vat_profiles where user_id=new.user_id and registered and registration_date<=new.invoice_date and vat_number=new.vat_number and scheme=new.vat_scheme) then raise exception 'VAT registration does not match';end if;
   for item in select value from jsonb_array_elements(new.items) loop
     if (item->>'vat_rate')::numeric not in (0,5,20) or (item->>'quantity')::numeric<=0 or (item->>'unit_price')::numeric<0 then raise exception 'Invalid VAT item';end if;
     gross:=round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2);
     if new.price_basis='inclusive' then gross:=round(gross/(1+(item->>'vat_rate')::numeric/100),2);end if;
     if (item->>'net_total')::numeric is distinct from gross or (item->>'vat_total')::numeric is distinct from (case when new.price_basis='inclusive' then round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2)-gross else round(gross*(item->>'vat_rate')::numeric/100,2) end)
       or (item->>'line_total')::numeric is distinct from ((item->>'net_total')::numeric+(item->>'vat_total')::numeric) then raise exception 'Invalid VAT arithmetic';end if;
     n:=n+gross;v:=v+(item->>'vat_total')::numeric;
   end loop;
   if new.subtotal is distinct from n or new.vat_total is distinct from v then raise exception 'Invalid VAT totals';end if;
 end if;
 if new.status='cancelled' and new.vat_enabled and not exists(select 1 from public.invoice_credits where invoice_id=new.id and user_id=new.user_id) then raise exception 'Cancel VAT invoices with a full credit note';end if;
 if new.status='paid' then
   select * into linked from public.income where id=new.income_id and user_id=new.user_id;
   if not found or linked.amount<>new.total or linked.earned_on<>new.paid_on then raise exception 'Payment must link to matching income owned by the driver';end if;
 end if;
 return new;
end $$;
