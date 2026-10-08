alter table public.recurring_expenses add column if not exists end_date date;
-- Retain past allocations for previously stopped costs, using their last update date.
update public.recurring_expenses
set end_date = (updated_at at time zone 'Europe/London')::date
where not is_active and end_date is null;
