-- Additive Invoice Centre & VAT Foundations migration. Existing invoice amounts are preserved.
create table public.vat_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 registered boolean not null default false,
 vat_number text not null default '',
 registration_date date,
 scheme text not null default 'standard' check(scheme in ('standard','cash')),
 updated_at timestamptz not null default now(),
 check(not registered or (vat_number ~ '^[0-9]{9}([0-9]{3})?$' and registration_date is not null))
);
create table public.invoice_drafts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object' and length(data::text)<=30000),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now()
);
create index invoice_drafts_user_updated on public.invoice_drafts(user_id,updated_at desc);
alter table public.vat_profiles enable row level security;
alter table public.invoice_drafts enable row level security;
create policy vat_profiles_owner on public.vat_profiles for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy invoice_drafts_owner on public.invoice_drafts for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.vat_profiles,public.invoice_drafts from public,anon;
grant select,insert,update,delete on public.invoice_drafts to authenticated;
grant select,insert,update on public.vat_profiles to authenticated;
-- The trigger is replaced within this same atomic migration; old rows remain non-VAT.
drop trigger invoices_guard on public.invoices;
alter table public.invoices add column archived boolean not null default false,
 add column vat_enabled boolean not null default false,
 add column vat_number text not null default '',
 add column vat_scheme text not null default 'none' check(vat_scheme in ('none','standard','cash')),
 add column price_basis text not null default 'exclusive' check(price_basis in ('exclusive','inclusive')),
 add column subtotal numeric(14,2),add column vat_total numeric(14,2) not null default 0,
 add column tax_point date;
update public.invoices set subtotal=total;
alter table public.invoices alter column subtotal set not null;
alter table public.invoices add constraint invoices_vat_totals check(subtotal>=0 and vat_total>=0 and total=subtotal+vat_total),
 add constraint invoices_vat_snapshot check((vat_enabled and vat_scheme<>'none' and vat_number ~ '^[0-9]{9}([0-9]{3})?$' and tax_point is not null and tax_point<=invoice_date) or (not vat_enabled and vat_scheme='none' and vat_number='' and vat_total=0 and tax_point is null));
create table public.invoice_credits (
 invoice_id uuid primary key references public.invoices(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete cascade,
 credit_number text not null,credit_date date not null,net_total numeric(14,2) not null,vat_total numeric(14,2) not null,
 created_at timestamptz not null default now(),unique(user_id,credit_number)
);
create index invoice_credits_user_date on public.invoice_credits(user_id,credit_date);
alter table public.invoice_credits enable row level security;
create policy invoice_credits_owner on public.invoice_credits for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.invoice_credits from public,anon;
grant select,insert on public.invoice_credits to authenticated;
create function public.guard_invoice_credit() returns trigger language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;
begin
 select * into inv from public.invoices where id=new.invoice_id and user_id=auth.uid() for update;
 if not found or new.user_id<>auth.uid() or not inv.vat_enabled or inv.status<>'unpaid' or new.credit_number<>inv.invoice_number||'-CN'
 or new.net_total<>inv.subtotal or new.vat_total<>inv.vat_total or new.credit_date<inv.invoice_date or new.credit_date>(now() at time zone 'Europe/London')::date then raise exception 'Credit must exactly reverse your unpaid VAT invoice';end if;
 return new;
end $$;
create trigger invoice_credits_guard before insert on public.invoice_credits for each row execute function public.guard_invoice_credit();
create or replace function public.guard_driver_invoice() returns trigger language plpgsql security invoker set search_path='' as $$
declare linked public.income%rowtype;item jsonb;n numeric:=0;v numeric:=0;gross numeric;
begin
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
create trigger invoices_guard before insert or update on public.invoices for each row execute function public.guard_driver_invoice();
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
   if not found or not profile.registered or profile.scheme not in ('standard','cash') or profile.registration_date>issued then raise exception 'Save a supported VAT registration before issuing';end if;
   if basis not in ('exclusive','inclusive') then raise exception 'Choose prices including or excluding VAT';end if;
 else
   if exists(select 1 from public.vat_profiles where user_id=driver and registered and registration_date<=issued) then raise exception 'Use a VAT invoice for this VAT-registered business';end if;
   if (p_invoice->>'non_vat_confirmed')::boolean is distinct from true then raise exception 'Confirm that you are not VAT registered';end if;
 end if;
 taxpoint:=case when supply<issued-14 then supply else issued end;
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
 invoice_date,supply_date,due_date,items,total,payment_details,notes,vat_enabled,vat_number,vat_scheme,price_basis,subtotal,vat_total,tax_point)
 values(driver,p_request_id,'DT-'||to_char(issued,'YYYY')||'-'||lpad(seq::text,greatest(4,length(seq::text)),'0'),btrim(p_invoice->>'seller_name'),coalesce(btrim(p_invoice->>'trading_name'),''),
 btrim(p_invoice->>'seller_address'),btrim(p_invoice->>'seller_contact'),btrim(p_invoice->>'customer_name'),btrim(p_invoice->>'customer_address'),coalesce(btrim(p_invoice->>'customer_email'),''),
 issued,supply,due,clean_items,amount,coalesce(p_invoice->>'payment_details',''),coalesce(p_invoice->>'notes',''),vat,case when vat then profile.vat_number else '' end,case when vat then profile.scheme else 'none' end,basis,net_sum,tax_sum,case when vat then taxpoint else null end) returning id into result;
 return result;
end $$;


create function public.save_driver_invoice_draft(p_id uuid,p_data jsonb,p_revision integer default 0)
returns integer language plpgsql security invoker set search_path='' as $$
declare d public.invoice_drafts%rowtype;result integer;
begin
 if auth.uid() is null then raise exception 'Sign in' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':invoices',0));
 if exists(select 1 from public.invoices where user_id=auth.uid() and request_id=p_id) then raise exception 'This draft has already been issued';end if;
 select * into d from public.invoice_drafts where id=p_id and user_id=auth.uid() for update;
 if found then
   if d.revision<>p_revision then raise exception 'Draft changed in another window. Reopen it before saving.';end if;
   update public.invoice_drafts set data=p_data,revision=revision+1,updated_at=now() where id=p_id and user_id=auth.uid() returning revision into result;
 else
   if p_revision<>0 then raise exception 'Draft no longer exists. Refresh your invoices.';end if;
   insert into public.invoice_drafts(id,user_id,data) values(p_id,auth.uid(),p_data) returning revision into result;
 end if;
 return result;
end $$;
create function public.issue_driver_invoice_draft(p_id uuid,p_revision integer,p_data jsonb default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.invoice_drafts%rowtype;result uuid;
begin
 if auth.uid() is null then raise exception 'Sign in' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':invoices',0));
 select id into result from public.invoices where user_id=auth.uid() and request_id=p_id;
 if found then return result;end if;
 select * into d from public.invoice_drafts where id=p_id and user_id=auth.uid() for update;
 if not found or d.revision<>p_revision then raise exception 'Draft changed or was deleted. Reopen it before issuing.';end if;
 if p_data is not null then d.data:=p_data;end if;
 if (d.data->>'invoice_date')::date<>(now() at time zone 'Europe/London')::date then raise exception 'Set the invoice date to today before issuing this draft';end if;
 result:=public.create_driver_invoice(d.data,p_id);
 delete from public.invoice_drafts where id=p_id and user_id=auth.uid();return result;
end $$;
create function public.set_driver_invoice_archived(p_id uuid,p_archived boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':invoices',0));
 update public.invoices set archived=p_archived,updated_at=now() where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Invoice not found' using errcode='42501';end if;
end $$;
create or replace function public.cancel_driver_invoice(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':invoices',0));
 select * into inv from public.invoices where id=p_id and user_id=auth.uid() and status='unpaid' for update;
 if not found then raise exception 'Only an unpaid invoice can be cancelled';end if;
 if inv.vat_enabled then
   insert into public.invoice_credits(invoice_id,user_id,credit_number,credit_date,net_total,vat_total)
   values(inv.id,auth.uid(),inv.invoice_number||'-CN',(now() at time zone 'Europe/London')::date,inv.subtotal,inv.vat_total);
 end if;
 update public.invoices set status='cancelled',updated_at=now() where id=p_id and user_id=auth.uid();
end $$;
-- Purchase VAT is entered from a valid VAT invoice, never inferred from a receipt image or expense category.
create table public.vat_purchases (
 expense_id uuid primary key references public.expenses(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete cascade,
 tax_point date not null,paid_on date not null,scheme text not null check(scheme in ('standard','cash')),
 supplier_vat_number text not null check(supplier_vat_number ~ '^[0-9]{9}([0-9]{3})?$'),
 vat_on_document numeric(14,2) not null check(vat_on_document>0),
 business_percent numeric(5,2) not null check(business_percent>0 and business_percent<=100),
 claim_amount numeric(14,2) not null check(claim_amount>=0),
 evidence_confirmed boolean not null check(evidence_confirmed),
 updated_at timestamptz not null default now()
);
create index vat_purchases_user_tax_point on public.vat_purchases(user_id,tax_point);
alter table public.vat_purchases enable row level security;
create policy vat_purchases_owner on public.vat_purchases for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.vat_purchases from public,anon;
grant select,insert,update,delete on public.vat_purchases to authenticated;
create function public.guard_vat_purchase() returns trigger language plpgsql security invoker set search_path='' as $$
declare e public.expenses%rowtype;p public.vat_profiles%rowtype;today date:=(now() at time zone 'Europe/London')::date;
begin
 select * into e from public.expenses where id=new.expense_id and user_id=auth.uid() for update;
 select * into p from public.vat_profiles where user_id=auth.uid();
 if e.id is null or new.user_id<>auth.uid() or not coalesce(p.registered,false) or new.scheme<>p.scheme or new.tax_point<p.registration_date or new.tax_point>today or new.paid_on<>e.expense_date or new.paid_on>today
   or new.vat_on_document>round(e.amount/6,2) or new.claim_amount<>round(new.vat_on_document*new.business_percent/100,2) then raise exception 'Check eligible purchase VAT, registration, tax point and recorded expense payment date';end if;
 return new;
end $$;
create trigger vat_purchases_guard before insert or update on public.vat_purchases for each row execute function public.guard_vat_purchase();
create function public.guard_vat_expense() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.vat_purchases where expense_id=old.id) and (new.amount is distinct from old.amount or new.expense_date is distinct from old.expense_date or new.user_id is distinct from old.user_id) then raise exception 'Remove the purchase VAT record before changing its expense amount or date';end if;
 return new;
end $$;
create trigger vat_expense_guard before update on public.expenses for each row execute function public.guard_vat_expense();
revoke all on function public.guard_invoice_credit(),public.guard_vat_purchase(),public.guard_vat_expense() from public,anon;
revoke all on function public.save_driver_invoice_draft(uuid,jsonb,integer),public.issue_driver_invoice_draft(uuid,integer,jsonb),public.set_driver_invoice_archived(uuid,boolean) from public,anon;
grant execute on function public.save_driver_invoice_draft(uuid,jsonb,integer),public.issue_driver_invoice_draft(uuid,integer,jsonb),public.set_driver_invoice_archived(uuid,boolean) to authenticated;
