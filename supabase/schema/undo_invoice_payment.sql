CREATE OR REPLACE FUNCTION public.guard_driver_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare linked public.income%rowtype;item jsonb;n numeric:=0;v numeric:=0;gross numeric;
begin
 if tg_op='INSERT' and new.vat_scheme like 'flat_%' and not exists(select 1 from public.vat_profiles where user_id=new.user_id and flat_rate=new.flat_rate and flat_discount_eligible=new.flat_discount_eligible and registration_date=new.flat_registration_date and flat_start_date=new.flat_start_date and flat_authorised) then raise exception 'Flat Rate snapshot does not match your authorised settings';end if;
 if new.status='paid' and new.vat_scheme like 'flat_%' and new.paid_on<new.flat_start_date then raise exception 'Payment precedes Flat Rate start; scheme-transition review required';end if;
 if tg_op='UPDATE' then
   if (to_jsonb(new)-array['status','paid_on','income_id','payment_mode','updated_at','archived']) is distinct from (to_jsonb(old)-array['status','paid_on','income_id','payment_mode','updated_at','archived']) then raise exception 'Issued invoice details cannot be changed. Cancel an unpaid invoice and issue a replacement.';end if;
   if old.status<>'unpaid' and (to_jsonb(new)-array['archived','updated_at']) is distinct from (to_jsonb(old)-array['archived','updated_at'])
      and not (old.status='paid' and new.status='unpaid' and new.paid_on is null and new.income_id is null and new.payment_mode is null)
      then raise exception 'Paid or cancelled invoices cannot be changed except to undo a recorded payment';end if;
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
end $function$
;
create or replace function public.undo_driver_invoice_payment(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare driver uuid:=auth.uid();inv public.invoices%rowtype;linked public.income%rowtype;removed boolean:=false;can_remove boolean:=false;
begin
 if driver is null then raise exception 'Sign in to undo a payment' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(driver::text||':invoices',0));
 select * into inv from public.invoices where id=p_id and user_id=driver for update;
 if not found then raise exception 'Invoice not found' using errcode='42501';end if;
 if inv.status='unpaid' then return jsonb_build_object('status','unpaid','already_undone',true,'income_removed',false);end if;
 if inv.status<>'paid' then raise exception 'Only a recorded payment can be undone';end if;
 select * into linked from public.income where id=inv.income_id and user_id=driver for update;
 can_remove:=inv.payment_mode='new' and linked.id is not null and linked.source='Invoice payment'
   and linked.amount=inv.total and linked.earned_on=inv.paid_on and linked.notes=inv.invoice_number||' - '||inv.customer_name;
 update public.invoices set status='unpaid',paid_on=null,income_id=null,payment_mode=null,updated_at=now() where id=inv.id and user_id=driver;
 if can_remove then
   delete from public.income where id=linked.id and user_id=driver;
   removed:=found;
 end if;
 return jsonb_build_object('status','unpaid','already_undone',false,'income_removed',removed,'income_retained',linked.id is not null and not removed);
end $$;
revoke all on function public.undo_driver_invoice_payment(uuid) from public,anon;
grant execute on function public.undo_driver_invoice_payment(uuid) to authenticated;

