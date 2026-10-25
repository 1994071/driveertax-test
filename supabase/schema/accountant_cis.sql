-- Accountant read access and subcontractor CIS records. No HMRC submission.
-- Existing financial-table RLS is deliberately unchanged.
create schema if not exists earnavik_private;
revoke all on schema earnavik_private from public, anon;
grant usage on schema earnavik_private to authenticated;

create table public.accountant_access (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 accountant_email text not null check(length(accountant_email) between 3 and 254 and accountant_email=lower(btrim(accountant_email)) and accountant_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 accountant_id uuid references auth.users(id) on delete cascade,
 invited_at timestamptz not null default now(),
 invitation_expires_at timestamptz not null default now()+interval '7 days',
 access_expires_at timestamptz not null default now()+interval '90 days',
 accepted_at timestamptz, revoked_at timestamptz,
 unique(user_id,accountant_email), check(accountant_id is null or accountant_id<>user_id)
);
create index accountant_access_accountant on public.accountant_access(accountant_id);
create table public.accountant_access_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null check(action in ('invite','accept','revoke','read')),
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index accountant_access_events_owner on public.accountant_access_events(user_id,created_at desc);
alter table public.accountant_access enable row level security;
alter table public.accountant_access_events enable row level security;
revoke all on public.accountant_access,public.accountant_access_events from public,anon,authenticated;
grant select on public.accountant_access,public.accountant_access_events to authenticated;
create policy accountant_owner_read on public.accountant_access for select to authenticated using((select auth.uid())=user_id);
create policy accountant_events_owner_read on public.accountant_access_events for select to authenticated using((select auth.uid())=user_id);

create table public.cis_deductions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 income_id uuid not null unique references public.income(id) on delete cascade,
 gross_snapshot numeric(14,2) not null check(gross_snapshot>0 and gross_snapshot<=1000000000),
 paid_on date not null,
 contractor text not null check(length(btrim(contractor)) between 1 and 160),
 statement_reference text not null check(length(btrim(statement_reference)) between 1 and 200),
 vat_amount numeric(14,2) not null default 0 check(vat_amount>=0),
 materials_cost numeric(14,2) not null default 0 check(materials_cost>=0),
 rate integer not null check(rate in (0,20,30)),
 deducted_amount numeric(14,2) not null check(deducted_amount>=0),
 evidence_confirmed boolean not null check(evidence_confirmed),
 created_at timestamptz not null default now(),
 check(vat_amount+materials_cost<=gross_snapshot)
);
create index cis_deductions_owner_date on public.cis_deductions(user_id,paid_on);
alter table public.cis_deductions enable row level security;
revoke all on public.cis_deductions from public,anon,authenticated;
grant select,insert,delete on public.cis_deductions to authenticated;
create policy cis_owner_read on public.cis_deductions for select to authenticated using((select auth.uid())=user_id);
create policy cis_owner_insert on public.cis_deductions for insert to authenticated with check((select auth.uid())=user_id);
create policy cis_owner_delete on public.cis_deductions for delete to authenticated using((select auth.uid())=user_id);

create function public.guard_cis_deduction() returns trigger language plpgsql security invoker set search_path='' as $$
declare inc public.income%rowtype; actual_vat numeric; is_registered boolean;
begin
 if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'CIS record owner mismatch' using errcode='42501';end if;
 select * into inc from public.income where id=new.income_id and user_id=auth.uid() for update;
 if inc.id is null or new.gross_snapshot is distinct from inc.amount or new.paid_on is distinct from inc.earned_on then raise exception 'Income changed. Refresh and select the gross income again.';end if;
 if new.paid_on<'2025-04-06' or new.paid_on>'2027-04-05' or new.paid_on>(now() at time zone 'Europe/London')::date then raise exception 'Choose a recorded payment in 2025/26 or 2026/27, no later than today.';end if;
 if not new.evidence_confirmed then raise exception 'Check the contractor payment and deduction statement first.';end if;
 if exists(select 1 from public.period_entries where user_id=auth.uid() and new.paid_on between period_start and period_end) then raise exception 'Resolve the catch-up summary covering this payment before recording CIS.';end if;
 select p.registered into is_registered from public.vat_profiles p where user_id=auth.uid();
 if not coalesce(is_registered,false) and new.vat_amount<>0 then raise exception 'A business not registered for VAT cannot enter VAT on its CIS payment.';end if;
 select vat_total into actual_vat from public.invoices where income_id=inc.id and vat_enabled;
 if actual_vat is null then select vat_on_document into actual_vat from public.vat_classifications where income_id=inc.id and gross_snapshot=inc.amount and source_date=inc.earned_on and treatment in ('20','5','0');end if;
 if actual_vat is not null and actual_vat<>new.vat_amount then raise exception 'CIS VAT must match the saved VAT classification or invoice.';end if;
 if coalesce(is_registered,false) and actual_vat is null then raise exception 'Classify the gross income for VAT first. Reverse charge and unsupported VAT need separate review.';end if;
 if new.deducted_amount<>round((new.gross_snapshot-new.vat_amount-new.materials_cost)*new.rate/100,2) then raise exception 'Deduction does not match the selected rate, VAT and actual eligible costs. Check the statement.';end if;
 return new;
end $$;
revoke all on function public.guard_cis_deduction() from public,anon;
create trigger cis_deduction_guard before insert on public.cis_deductions for each row execute function public.guard_cis_deduction();

create function public.guard_cis_income_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.amount,new.earned_on,new.user_id) is distinct from (old.amount,old.earned_on,old.user_id)
 and exists(select 1 from public.cis_deductions where income_id=old.id) then raise exception 'Remove the linked CIS deduction before changing this income amount or date.';end if;
 return new;
end $$;
revoke all on function public.guard_cis_income_change() from public,anon;
create trigger cis_income_change_guard before update on public.income for each row execute function public.guard_cis_income_change();

create function public.guard_cis_summary_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.cis_deductions where user_id=new.user_id and paid_on between new.period_start and new.period_end) then raise exception 'A CIS payment is already recorded in this period. Keep dated records instead of an overlapping catch-up summary.';end if;
 return new;
end $$;
revoke all on function public.guard_cis_summary_change() from public,anon;
create trigger cis_summary_change_guard before insert or update on public.period_entries for each row execute function public.guard_cis_summary_change();

create function public.guard_cis_vat_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.cis_deductions%rowtype;
begin
 select * into c from public.cis_deductions where income_id=case when tg_op='DELETE' then old.income_id else new.income_id end;
 -- Parent income deletion cascades to both records. Do not block that cascade.
 if tg_op='DELETE' and not exists(select 1 from public.income where id=old.income_id) then return old;end if;
 if c.id is not null and (tg_op='DELETE' or new.vat_on_document<>c.vat_amount or new.treatment not in ('20','5','0')) then raise exception 'Remove the linked CIS deduction before changing this VAT classification.';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_cis_vat_change() from public,anon;
-- Runs after the existing canonical VAT guard (trigger names sort alphabetically).
create trigger zz_cis_vat_change_guard before insert or update or delete on public.vat_classifications for each row execute function public.guard_cis_vat_change();

-- Privileged code is isolated from exposed schemas; all routes explicitly authorise
-- the verified caller. Invoking a read route never confers underlying table writes.
create function earnavik_private.accountant_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); email text; access public.accountant_access%rowtype;
 target uuid; dfrom date; dto date; page_no integer; dataset text; rows jsonb; result jsonb;
begin
 if actor is null then raise exception 'Sign in again' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>2000 then raise exception 'Invalid accountant request';end if;
 select lower(u.email) into email from auth.users u where u.id=actor and u.email_confirmed_at is not null;
 if email is null then raise exception 'Confirm your account email first' using errcode='42501';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,'owner_name',coalesce(p.full_name,'Business'),'accountant_email',a.accountant_email,'accepted_at',a.accepted_at,'revoked_at',a.revoked_at,'invitation_expires_at',a.invitation_expires_at,'access_expires_at',a.access_expires_at,'is_owner',a.user_id=actor) order by a.invited_at desc),'[]') into result
  from public.accountant_access a left join public.profiles p on p.id=a.user_id
  where a.user_id=actor or (a.accountant_email=email and (a.accountant_id is null or a.accountant_id=actor) and a.revoked_at is null and a.access_expires_at>now() and (a.accepted_at is not null or a.invitation_expires_at>now()));
  return result;
 elsif p_action='invite' then
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':accountant',0));
  if (select count(*) from public.accountant_access where user_id=actor and revoked_at is null and access_expires_at>now())>=10 then raise exception 'Revoke an existing invitation before adding another (maximum 10).';end if;
  if lower(btrim(p_data->>'email'))=email then raise exception 'Use your accountant email, not your own.';end if;
  insert into public.accountant_access(user_id,accountant_email) values(actor,lower(btrim(p_data->>'email')))
  on conflict(user_id,accountant_email) do update set accountant_id=null,accepted_at=null,revoked_at=null,invited_at=now(),invitation_expires_at=now()+interval '7 days',access_expires_at=now()+interval '90 days'
  returning * into access;
  insert into public.accountant_access_events(user_id,actor_id,action,details) values(actor,actor,'invite',jsonb_build_object('email',access.accountant_email,'access_id',access.id));
  return jsonb_build_object('id',access.id);
 elsif p_action in ('accept','revoke') then
  select * into access from public.accountant_access where id=(p_data->>'id')::uuid for update;
  if access.id is null then raise exception 'Invitation unavailable' using errcode='42501';end if;
  if p_action='accept' then
   if access.accountant_email<>email or access.user_id=actor or access.revoked_at is not null or access.access_expires_at<=now() or (access.accountant_id is not null and access.accountant_id<>actor) or (access.accepted_at is null and access.invitation_expires_at<=now()) then raise exception 'Invitation unavailable for this verified email' using errcode='42501';end if;
   if access.accepted_at is not null then return jsonb_build_object('accepted',true);end if;
   update public.accountant_access set accountant_id=actor,accepted_at=now() where id=access.id;
  else
   if access.user_id<>actor and access.accountant_id is distinct from actor then raise exception 'Access denied' using errcode='42501';end if;
   update public.accountant_access set revoked_at=coalesce(revoked_at,now()) where id=access.id;
  end if;
  insert into public.accountant_access_events(user_id,actor_id,action,details) values(access.user_id,actor,p_action,jsonb_build_object('access_id',access.id));
  return jsonb_build_object('ok',true);
 elsif p_action='read' then
  target:=(p_data->>'owner')::uuid;dfrom:=(p_data->>'from')::date;dto:=(p_data->>'to')::date;page_no:=coalesce((p_data->>'page')::int,0);dataset:=p_data->>'dataset';
  if target is null or dfrom is null or dto is null or dto<dfrom or dto-dfrom>366 or page_no<0 or page_no>10000 then raise exception 'Choose a date range of up to one year and a valid page.';end if;
  select * into access from public.accountant_access where user_id=target and accountant_id=actor and accountant_email=email and accepted_at is not null and revoked_at is null and access_expires_at>now() for share;
  if access.id is null then raise exception 'Accountant access expired or was revoked' using errcode='42501';end if;
  -- Static dataset allowlist: no arbitrary table names, keys, SQL or file paths.
  case dataset
   when 'income' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,source,amount,earned_on,notes from public.income where user_id=target and earned_on between dfrom and dto order by earned_on,id limit 200 offset page_no*200) r;
   when 'expenses' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,category,merchant,amount,expense_date,notes,tax_treatment,business_percent,item_allocations from public.expenses where user_id=target and expense_date between dfrom and dto order by expense_date,id limit 200 offset page_no*200) r;
   when 'invoices' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,invoice_number,customer_name,invoice_date,supply_date,due_date,status,paid_on,income_id,subtotal,vat_total,total,vat_enabled,vat_scheme,items from public.invoices where user_id=target and (invoice_date between dfrom and dto or paid_on between dfrom and dto or tax_point between dfrom and dto) order by invoice_date,id limit 200 offset page_no*200) r;
   when 'cis' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,income_id,gross_snapshot,paid_on,contractor,statement_reference,vat_amount,materials_cost,rate,deducted_amount from public.cis_deductions where user_id=target and paid_on between dfrom and dto order by paid_on,id limit 200 offset page_no*200) r;
   when 'vat_classifications' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,income_id,expense_id,gross_snapshot,source_date,tax_point,treatment,vat_on_document,eligible_percent,claim_amount,scheme,review_note from public.vat_classifications where user_id=target and (source_date between dfrom and dto or tax_point between dfrom and dto) order by tax_point,id limit 200 offset page_no*200) r;
   when 'vat_purchases' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select expense_id,tax_point,paid_on,vat_on_document,claim_amount,scheme from public.vat_purchases where user_id=target and (tax_point between dfrom and dto or paid_on between dfrom and dto) order by tax_point,expense_id limit 200 offset page_no*200) r;
   when 'vat_reviews' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select period_start,period_end,settings,updated_at from public.vat_return_reviews where user_id=target and period_start<=dto and period_end>=dfrom order by period_start,id limit 200 offset page_no*200) r;
   when 'credits' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select invoice_id,credit_number,credit_date,net_total,vat_total,(net_total+vat_total) as total from public.invoice_credits where user_id=target and credit_date between dfrom and dto order by credit_date,invoice_id limit 200 offset page_no*200) r;
   when 'catchup' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,period_start,period_end,income_amount,expense_amount,business_miles,regular_costs_included,reconciled from public.period_entries where user_id=target and period_start<=dto and period_end>=dfrom order by period_start,id limit 200 offset page_no*200) r;
   when 'regular_costs' then select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (select id,category,amount,frequency,start_date,end_date,is_active,tax_treatment,business_percent from public.recurring_expenses where user_id=target and start_date<=dto and (end_date is null or end_date>=dfrom) order by start_date,id limit 200 offset page_no*200) r;
   else raise exception 'Unsupported accountant dataset';
  end case;
  insert into public.accountant_access_events(user_id,actor_id,action,details) values(target,actor,'read',jsonb_build_object('dataset',dataset,'from',dfrom,'to',dto,'page',page_no));
  return jsonb_build_object('rows',rows,'has_more',jsonb_array_length(rows)=200);
 else raise exception 'Unsupported accountant action';end if;
end $$;
revoke all on function earnavik_private.accountant_action(text,jsonb) from public,anon;
grant execute on function earnavik_private.accountant_action(text,jsonb) to authenticated;
create function public.accountant_action(p_action text,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select earnavik_private.accountant_action(p_action,p_data); $$;
revoke all on function public.accountant_action(text,jsonb) from public,anon;
grant execute on function public.accountant_action(text,jsonb) to authenticated;
