create table public.invoice_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_number bigint not null default 0 check(last_number>=0)
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  invoice_number text not null,
  seller_name text not null check(length(seller_name) between 1 and 160),
  trading_name text not null default '' check(length(trading_name)<=160),
  seller_address text not null check(length(seller_address) between 1 and 1000),
  seller_contact text not null check(length(seller_contact) between 1 and 180),
  customer_name text not null check(length(customer_name) between 1 and 160),
  customer_address text not null check(length(customer_address) between 1 and 1000),
  customer_email text not null default '' check(length(customer_email)<=180),
  invoice_date date not null,
  supply_date date not null,
  due_date date not null check(due_date>=invoice_date),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 20),
  total numeric(14,2) not null check(total>0),
  payment_details text not null default '' check(length(payment_details)<=1000),
  notes text not null default '' check(length(notes)<=2000),
  status text not null default 'unpaid' check(status in ('unpaid','paid','cancelled')),
  paid_on date,
  income_id uuid references public.income(id) on delete restrict,
  payment_mode text check(payment_mode in ('new','existing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,request_id),unique(user_id,invoice_number),unique(income_id),
  check((status='paid' and paid_on is not null and payment_mode is not null) or (status<>'paid' and paid_on is null and income_id is null and payment_mode is null))
);
create index invoices_user_created on public.invoices(user_id,created_at desc);
alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
create policy invoice_counters_owner on public.invoice_counters for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy invoices_owner on public.invoices for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,insert,update on public.invoice_counters,public.invoices to authenticated;
revoke all on public.invoice_counters,public.invoices from anon;

create function public.guard_driver_invoice()
returns trigger language plpgsql security invoker set search_path='' as $$
declare linked public.income%rowtype;
begin
 if tg_op='UPDATE' then
   if (to_jsonb(new)-array['status','paid_on','income_id','payment_mode','updated_at']) is distinct from (to_jsonb(old)-array['status','paid_on','income_id','payment_mode','updated_at']) then
     raise exception 'Issued invoice details cannot be changed. Cancel an unpaid invoice and issue a replacement.';
   end if;
   if old.status<>'unpaid' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Paid or cancelled invoices cannot be changed';end if;
 elsif new.status<>'unpaid' then raise exception 'New invoices must be unpaid';end if;
 if new.status='paid' then
   select * into linked from public.income where id=new.income_id and user_id=new.user_id;
   if not found or linked.amount<>new.total or linked.earned_on<>new.paid_on then raise exception 'Payment must link to matching income owned by the driver';end if;
 end if;
 return new;
end $$;
create trigger invoices_guard before insert or update on public.invoices for each row execute function public.guard_driver_invoice();
create function public.guard_invoice_income()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.amount is distinct from old.amount or new.earned_on is distinct from old.earned_on or new.user_id is distinct from old.user_id)
 and exists(select 1 from public.invoices where income_id=old.id) then raise exception 'This income is linked to a paid invoice; its amount, date and owner cannot be changed';end if;
 return new;
end $$;
create trigger invoice_income_guard before update on public.income for each row execute function public.guard_invoice_income();
revoke all on function public.guard_driver_invoice(),public.guard_invoice_income() from public,anon;

create function public.create_driver_invoice(p_invoice jsonb,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
 driver uuid:=auth.uid();result uuid;seq bigint;item jsonb;clean_items jsonb:='[]'::jsonb;
 quantity numeric;rate numeric;line_total numeric;amount numeric:=0;
 issued date:=(p_invoice->>'invoice_date')::date;supply date:=(p_invoice->>'supply_date')::date;due date:=(p_invoice->>'due_date')::date;
 today date:=(now() at time zone 'Europe/London')::date;
begin
 if driver is null then raise exception 'Sign in to create an invoice' using errcode='42501';end if;
 if p_request_id is null then raise exception 'Missing save request';end if;
 perform pg_advisory_xact_lock(hashtextextended(driver::text||':invoices',0));
 select id into result from public.invoices where user_id=driver and request_id=p_request_id;
 if found then return result;end if;
 if (p_invoice->>'non_vat_confirmed')::boolean is distinct from true then raise exception 'This feature supports non-VAT invoices only';end if;
 if issued is null or supply is null or due is null or due<issued or issued>today then raise exception 'Check invoice, supply and due dates';end if;
 if jsonb_typeof(p_invoice->'items') is distinct from 'array' or jsonb_array_length(p_invoice->'items') not between 1 and 20 then raise exception 'Add between 1 and 20 invoice items';end if;
 for item in select value from jsonb_array_elements(p_invoice->'items') loop
   quantity:=(item->>'quantity')::numeric;rate:=(item->>'unit_price')::numeric;
   if nullif(btrim(item->>'description'),'') is null or length(item->>'description')>200 or quantity is null or rate is null
      or quantity<=0 or quantity>100000 or rate<0 or rate>10000000 or quantity::text in ('NaN','Infinity','-Infinity') or rate::text in ('NaN','Infinity','-Infinity') then raise exception 'Check item description, quantity and price';end if;
   quantity:=round(quantity,2);rate:=round(rate,2);if quantity<=0 then raise exception 'Quantity is too small';end if;
   line_total:=round(quantity*rate,2);amount:=amount+line_total;
   clean_items:=clean_items||jsonb_build_array(jsonb_build_object('description',btrim(item->>'description'),'quantity',quantity,'unit_price',rate,'line_total',line_total));
 end loop;
 if amount<=0 or amount>10000000 then raise exception 'Enter a positive total of no more than 10000000';end if;
 if nullif(btrim(p_invoice->>'seller_name'),'') is null or nullif(btrim(p_invoice->>'seller_address'),'') is null or nullif(btrim(p_invoice->>'seller_contact'),'') is null
   or nullif(btrim(p_invoice->>'customer_name'),'') is null or nullif(btrim(p_invoice->>'customer_address'),'') is null then raise exception 'Add your name, address and contact, plus customer name and address';end if;
 insert into public.invoice_counters(user_id,last_number) values(driver,1)
 on conflict(user_id) do update set last_number=public.invoice_counters.last_number+1 returning last_number into seq;
 insert into public.invoices(user_id,request_id,invoice_number,seller_name,trading_name,seller_address,seller_contact,customer_name,customer_address,customer_email,
 invoice_date,supply_date,due_date,items,total,payment_details,notes)
 values(driver,p_request_id,'DT-'||to_char(issued,'YYYY')||'-'||lpad(seq::text,greatest(4,length(seq::text)),'0'),btrim(p_invoice->>'seller_name'),coalesce(btrim(p_invoice->>'trading_name'),''),
 btrim(p_invoice->>'seller_address'),btrim(p_invoice->>'seller_contact'),btrim(p_invoice->>'customer_name'),btrim(p_invoice->>'customer_address'),coalesce(btrim(p_invoice->>'customer_email'),''),
 issued,supply,due,clean_items,amount,coalesce(p_invoice->>'payment_details',''),coalesce(p_invoice->>'notes','')) returning id into result;
 return result;
end $$;

create function public.pay_driver_invoice(p_id uuid,p_paid_on date,p_income_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare driver uuid:=auth.uid();inv public.invoices%rowtype;linked public.income%rowtype;result uuid;
begin
 if driver is null then raise exception 'Sign in to record a payment' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(driver::text||':invoices',0));
 select * into inv from public.invoices where id=p_id and user_id=driver for update;
 if not found then raise exception 'Invoice not found' using errcode='42501';end if;
 if inv.status='paid' then return inv.income_id;end if;
 if inv.status<>'unpaid' then raise exception 'A cancelled invoice cannot be paid';end if;
 if p_paid_on is null or p_paid_on>(now() at time zone 'Europe/London')::date then raise exception 'Check the payment date';end if;
 if p_income_id is not null then
   select * into linked from public.income where id=p_income_id and user_id=driver for update;
   if not found then raise exception 'Income record not found' using errcode='42501';end if;
   if linked.amount<>inv.total or linked.earned_on<>p_paid_on then raise exception 'Choose income with the same amount and payment date';end if;
   if exists(select 1 from public.invoices where income_id=p_income_id and id<>p_id) then raise exception 'That income is already linked to another invoice';end if;
   result:=linked.id;
 else
   if exists(select 1 from public.income where user_id=driver and amount=inv.total and earned_on=p_paid_on) then raise exception 'invoice_possible_duplicate_income';end if;
   if exists(select 1 from public.period_entries where user_id=driver and p_paid_on between period_start and period_end) then raise exception 'Payment date is in a catch-up summary. Add or find its dated income first, then link that income here.';end if;
   insert into public.income(user_id,source,amount,earned_on,notes) values(driver,'Invoice payment',inv.total,p_paid_on,inv.invoice_number||' - '||inv.customer_name) returning id into result;
 end if;
 update public.invoices set status='paid',paid_on=p_paid_on,income_id=result,payment_mode=case when p_income_id is null then 'new' else 'existing' end,updated_at=now() where id=p_id and user_id=driver;
 return result;
end $$;

create function public.cancel_driver_invoice(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':invoices',0));
 update public.invoices set status='cancelled',updated_at=now() where id=p_id and user_id=auth.uid() and status='unpaid';
 if not found then raise exception 'Only an unpaid invoice can be cancelled';end if;
end $$;
revoke all on function public.create_driver_invoice(jsonb,uuid),public.pay_driver_invoice(uuid,date,uuid),public.cancel_driver_invoice(uuid) from public,anon;
grant execute on function public.create_driver_invoice(jsonb,uuid),public.pay_driver_invoice(uuid,date,uuid),public.cancel_driver_invoice(uuid) to authenticated;
