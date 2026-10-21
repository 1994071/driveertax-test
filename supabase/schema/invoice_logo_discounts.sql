-- Invoice logo snapshots and unconditional invoice discounts.
create table public.invoice_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object' and octet_length(data::text)<=40000),
 updated_at timestamptz not null default now()
);
alter table public.invoice_preferences enable row level security;
create policy invoice_preferences_owner on public.invoice_preferences for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.invoice_preferences from public,anon;
grant select,insert,update,delete on public.invoice_preferences to authenticated;
alter table public.invoices add column logo_data text not null default '' check(octet_length(logo_data)<=24000 and (logo_data='' or logo_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$')),
 add column discount_type text not null default 'none' check(discount_type in ('none','percent','fixed')),
 add column discount_value numeric not null default 0 check(discount_value>=0 and discount_value<=10000000 and discount_value::text not in ('NaN','Infinity','-Infinity')),
 add column discount_amount numeric(14,2) not null default 0 check(discount_amount>=0);
alter table public.invoice_drafts drop constraint invoice_drafts_data_check;
alter table public.invoice_drafts add constraint invoice_drafts_data_check check(jsonb_typeof(data)='object' and octet_length(data::text)<=65536);
-- Integer pennies and cumulative proportional allocation conserve the exact discount.
create function public.calculate_invoice_items_v2(p_items jsonb,p_vat boolean,p_basis text,p_discount_type text default 'none',p_discount_value numeric default 0)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb;clean jsonb:='[]'::jsonb;raw_items jsonb:='[]'::jsonb;q numeric;price numeric;r numeric;raw numeric;base numeric:=0;disc numeric;used numeric:=0;cum numeric:=0;share numeric;adjusted numeric;n numeric;v numeric;ns numeric:=0;vs numeric:=0;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'Add between 1 and 20 invoice items';end if;
 if p_basis is null or p_basis not in ('exclusive','inclusive') or p_discount_type is null or p_discount_type not in ('none','percent','fixed') or p_discount_value is null or p_discount_value<0 or p_discount_value>10000000 or p_discount_value::text in ('NaN','Infinity','-Infinity') or p_discount_value<>round(p_discount_value,2) then raise exception 'Check discount and price basis';end if;
 if p_discount_type='percent' and p_discount_value>100 then raise exception 'Percentage discount cannot exceed 100';end if;
 if p_discount_type='none' and p_discount_value<>0 then raise exception 'Choose a discount type';end if;
 for item in select value from jsonb_array_elements(p_items) loop
   q:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;r:=case when p_vat then (item->>'vat_rate')::numeric else 0 end;
   if q is null or price is null or r is null or q<=0 or q>100000 or price<0 or price>10000000 or q::text in ('NaN','Infinity','-Infinity') or price::text in ('NaN','Infinity','-Infinity') or r not in (0,5,20) or nullif(btrim(item->>'description'),'') is null or length(item->>'description')>200 then raise exception 'Check item description, quantity, price and VAT rate';end if;
   q:=round(q,2);price:=round(price,2);if q<=0 then raise exception 'Quantity is too small';end if;
   raw:=round(q*price,2)*100;base:=base+raw;
   raw_items:=raw_items||jsonb_build_array(jsonb_build_object('description',btrim(item->>'description'),'quantity',q,'unit_price',price,'vat_rate',r,'raw',raw));
 end loop;
 disc:=case p_discount_type when 'percent' then round(base*p_discount_value/100) when 'fixed' then round(p_discount_value*100) else 0 end;
 if disc>base then raise exception 'Discount cannot exceed the items total';end if;
 for item in select value from jsonb_array_elements(raw_items) loop
   raw:=(item->>'raw')::numeric;cum:=cum+raw;
   share:=case when base=0 then 0 else round(cum*disc/base)-used end;used:=used+share;adjusted:=(raw-share)/100;r:=(item->>'vat_rate')::numeric;
   if p_vat and p_basis='inclusive' then n:=round(adjusted/(1+r/100),2);v:=adjusted-n;
   else n:=adjusted;v:=round(n*r/100,2);end if;
   ns:=ns+n;vs:=vs+v;
   clean:=clean||jsonb_build_array((item-'raw')||jsonb_build_object('discount_amount',share/100,'net_total',n,'vat_total',v,'line_total',n+v));
 end loop;
 return jsonb_build_object('items',clean,'subtotal',ns,'vat_total',vs,'total',ns+vs,'discount_amount',disc/100,'before_discount',base/100);
end $$;
revoke all on function public.calculate_invoice_items_v2(jsonb,boolean,text,text,numeric) from public,anon;
grant execute on function public.calculate_invoice_items_v2(jsonb,boolean,text,text,numeric) to authenticated;

create or replace function public.create_driver_invoice(p_invoice jsonb,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
 driver uuid:=auth.uid();result uuid;seq bigint;item jsonb;clean_items jsonb:='[]'::jsonb;
 quantity numeric;rate numeric;line_total numeric;amount numeric:=0;
 issued date:=(p_invoice->>'invoice_date')::date;supply date:=(p_invoice->>'supply_date')::date;due date:=(p_invoice->>'due_date')::date;
 vat boolean:=coalesce((p_invoice->>'vat_enabled')::boolean,false);profile public.vat_profiles%rowtype;basis text:=coalesce(p_invoice->>'price_basis','exclusive');vat_rate numeric;net numeric;tax numeric;net_sum numeric:=0;tax_sum numeric:=0;taxpoint date;
 today date:=(now() at time zone 'Europe/London')::date;calc jsonb;dtype text:=coalesce(p_invoice->>'discount_type','none');dvalue numeric:=coalesce((p_invoice->>'discount_value')::numeric,0);logo text:=coalesce(p_invoice->>'logo_data','');
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
 calc:=public.calculate_invoice_items_v2(p_invoice->'items',vat,basis,dtype,dvalue);
 clean_items:=calc->'items';amount:=(calc->>'total')::numeric;net_sum:=(calc->>'subtotal')::numeric;tax_sum:=(calc->>'vat_total')::numeric;
 if amount<=0 or amount>10000000 then raise exception 'Enter a positive total of no more than 10000000';end if;
 if nullif(btrim(p_invoice->>'seller_name'),'') is null or nullif(btrim(p_invoice->>'seller_address'),'') is null or nullif(btrim(p_invoice->>'seller_contact'),'') is null
   or nullif(btrim(p_invoice->>'customer_name'),'') is null or nullif(btrim(p_invoice->>'customer_address'),'') is null then raise exception 'Add your name, address and contact, plus customer name and address';end if;
 insert into public.invoice_counters(user_id,last_number) values(driver,1)
 on conflict(user_id) do update set last_number=public.invoice_counters.last_number+1 returning last_number into seq;
 insert into public.invoices(user_id,request_id,invoice_number,seller_name,trading_name,seller_address,seller_contact,customer_name,customer_address,customer_email,
 invoice_date,supply_date,due_date,items,total,payment_details,notes,vat_enabled,vat_number,vat_scheme,price_basis,subtotal,vat_total,tax_point,flat_rate,flat_discount_eligible,flat_registration_date,flat_start_date,capital_sale,logo_data,discount_type,discount_value,discount_amount)
 values(driver,p_request_id,'DT-'||to_char(issued,'YYYY')||'-'||lpad(seq::text,greatest(4,length(seq::text)),'0'),btrim(p_invoice->>'seller_name'),coalesce(btrim(p_invoice->>'trading_name'),''),
 btrim(p_invoice->>'seller_address'),btrim(p_invoice->>'seller_contact'),btrim(p_invoice->>'customer_name'),btrim(p_invoice->>'customer_address'),coalesce(btrim(p_invoice->>'customer_email'),''),
 issued,supply,due,clean_items,amount,coalesce(p_invoice->>'payment_details',''),coalesce(p_invoice->>'notes',''),vat,case when vat then profile.vat_number else '' end,case when vat then profile.scheme else 'none' end,basis,net_sum,tax_sum,case when vat then taxpoint else null end,case when vat and profile.scheme like 'flat_%' then profile.flat_rate else null end,case when vat and profile.scheme like 'flat_%' then profile.flat_discount_eligible else false end,case when vat and profile.scheme like 'flat_%' then profile.registration_date else null end,case when vat and profile.scheme like 'flat_%' then profile.flat_start_date else null end,coalesce((p_invoice->>'capital_sale')::boolean,false),logo,dtype,dvalue,(calc->>'discount_amount')::numeric) returning id into result;
 return result;
end $$;
CREATE OR REPLACE FUNCTION public.guard_driver_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare linked public.income%rowtype;item jsonb;n numeric:=0;v numeric:=0;gross numeric;calc jsonb;
begin
 if tg_op='INSERT' and new.vat_scheme like 'flat_%' and not exists(select 1 from public.vat_profiles where user_id=new.user_id and flat_rate=new.flat_rate and flat_discount_eligible=new.flat_discount_eligible and registration_date=new.flat_registration_date and flat_start_date=new.flat_start_date and flat_authorised) then raise exception 'Flat Rate snapshot does not match your authorised settings';end if;
 if new.status='paid' and new.vat_scheme like 'flat_%' and new.paid_on<new.flat_start_date then raise exception 'Payment precedes Flat Rate start; scheme-transition review required';end if;
 if tg_op='UPDATE' then
   if (to_jsonb(new)-array['status','paid_on','income_id','payment_mode','updated_at','archived']) is distinct from (to_jsonb(old)-array['status','paid_on','income_id','payment_mode','updated_at','archived']) then raise exception 'Issued invoice details cannot be changed. Cancel an unpaid invoice and issue a replacement.';end if;
   if old.status<>'unpaid' and (to_jsonb(new)-array['archived','updated_at']) is distinct from (to_jsonb(old)-array['archived','updated_at'])
      and not (old.status='paid' and new.status='unpaid' and new.paid_on is null and new.income_id is null and new.payment_mode is null)
      then raise exception 'Paid or cancelled invoices cannot be changed except to undo a recorded payment';end if;
 elsif new.status<>'unpaid' then raise exception 'New invoices must be unpaid';
 end if;
 if tg_op='INSERT' then
   if new.vat_enabled and not exists(select 1 from public.vat_profiles where user_id=new.user_id and registered and registration_date<=new.invoice_date and vat_number=new.vat_number and scheme=new.vat_scheme) then raise exception 'VAT registration does not match';end if;
   calc:=public.calculate_invoice_items_v2(new.items,new.vat_enabled,new.price_basis,new.discount_type,new.discount_value);
   if new.items is distinct from calc->'items' or new.subtotal is distinct from (calc->>'subtotal')::numeric or new.vat_total is distinct from (calc->>'vat_total')::numeric or new.total is distinct from (calc->>'total')::numeric or new.discount_amount is distinct from (calc->>'discount_amount')::numeric then raise exception 'Invalid invoice discount or VAT arithmetic';end if;
 end if;
 if new.status='cancelled' and new.vat_enabled and not exists(select 1 from public.invoice_credits where invoice_id=new.id and user_id=new.user_id) then raise exception 'Cancel VAT invoices with a full credit note';end if;
 if new.status='paid' then
   select * into linked from public.income where id=new.income_id and user_id=new.user_id;
   if not found or linked.amount<>new.total or linked.earned_on<>new.paid_on then raise exception 'Payment must link to matching income owned by the driver';end if;
 end if;
 return new;
end $function$
;

