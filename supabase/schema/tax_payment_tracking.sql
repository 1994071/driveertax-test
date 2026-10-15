create table public.tax_year_accounts (
 user_id uuid not null references auth.users(id) on delete cascade,
 tax_year integer not null check(tax_year between 2025 and 2026),
 bill_amount numeric(12,2) check(bill_amount>=0 and bill_amount<=999999999),
 estimate_snapshot text not null default '' check(length(estimate_snapshot)<=2000),
 primary key(user_id,tax_year)
);
create table public.tax_payment_records (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 tax_year integer not null check(tax_year between 2025 and 2026),
 amount numeric(12,2) not null check(amount>0 and amount<=999999999),
 kind text not null check(kind in ('balancing','on_account')),
 paid_on date not null check(paid_on>='2020-01-01' and paid_on<=(now() at time zone 'Europe/London')::date),
 note text not null default '' check(length(note)<=200),
 created_at timestamptz not null default now()
);
create index tax_payment_records_owner_year on public.tax_payment_records(user_id,tax_year);
alter table public.tax_year_accounts enable row level security;
alter table public.tax_payment_records enable row level security;
revoke all on public.tax_year_accounts,public.tax_payment_records from anon,authenticated;
grant select,insert,update,delete on public.tax_year_accounts to authenticated;
grant select,insert,delete on public.tax_payment_records to authenticated;
create policy tax_accounts_select on public.tax_year_accounts for select to authenticated using ((select auth.uid())=user_id);
create policy tax_accounts_insert on public.tax_year_accounts for insert to authenticated with check ((select auth.uid())=user_id);
create policy tax_accounts_update on public.tax_year_accounts for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy tax_accounts_delete on public.tax_year_accounts for delete to authenticated using ((select auth.uid())=user_id);
create policy tax_payments_select on public.tax_payment_records for select to authenticated using ((select auth.uid())=user_id);
create policy tax_payments_insert on public.tax_payment_records for insert to authenticated with check ((select auth.uid())=user_id);
create policy tax_payments_delete on public.tax_payment_records for delete to authenticated using ((select auth.uid())=user_id);
