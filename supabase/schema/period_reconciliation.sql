alter table public.period_entries add column if not exists reconciled boolean not null default false;
alter table public.period_entries add column if not exists reviewed_records jsonb;

create or replace function public.get_period_record_totals(p_start date,p_end date)
returns jsonb language sql stable security invoker set search_path='' as $$
  with records as (
    select 'income' kind,id,amount value,earned_on recorded_on from public.income where user_id=auth.uid() and earned_on between p_start and p_end
    union all
    select 'expenses',id,amount,expense_date from public.expenses where user_id=auth.uid() and expense_date between p_start and p_end
    union all
    select 'mileage',id,business_miles,trip_date from public.mileage where user_id=auth.uid() and trip_date between p_start and p_end
  )
  select jsonb_build_object('income',coalesce(sum(value) filter(where kind='income'),0),
    'expenses',coalesce(sum(value) filter(where kind='expenses'),0),'mileage',coalesce(sum(value) filter(where kind='mileage'),0),
    'count',count(*),'signature',md5(coalesce(jsonb_agg(jsonb_build_array(kind,id,value,recorded_on) order by kind,id)::text,'[]')))
  from records;
$$;
revoke all on function public.get_period_record_totals(date,date) from public,anon;
grant execute on function public.get_period_record_totals(date,date) to authenticated;

alter table public.period_entries add column if not exists entry_mode text not null default 'expenses';
alter table public.period_entries add column if not exists regular_costs_included boolean not null default false;
alter table public.period_entries add column if not exists statement_source text;

create or replace function public.save_period_summary(p_summary jsonb, p_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  driver uuid := auth.uid();
  starts date := (p_summary->>'period_start')::date;
  ends date := (p_summary->>'period_end')::date;
  turnover numeric := round((p_summary->>'turnover')::numeric,2);
  costs numeric;
  miles numeric := coalesce((p_summary->>'business_miles')::numeric,0);
  mode text := p_summary->>'entry_mode';
  includes_costs boolean := (p_summary->>'regular_costs_included')::boolean;
  result uuid;
  tax_year_start date;
  reconcile boolean := coalesce((p_summary->>'reconcile')::boolean,false);
  recorded jsonb;
begin
  if driver is null then raise exception 'Sign in before saving' using errcode='42501'; end if;
  if starts is null or ends is null or starts > ends or ends > (now() at time zone 'Europe/London')::date then
    raise exception 'Choose a completed date range ending today or earlier';
  end if;
  tax_year_start := make_date(extract(year from starts)::integer,4,6);
  if starts < tax_year_start then tax_year_start := (tax_year_start - interval '1 year')::date; end if;
  if ends >= (tax_year_start + interval '1 year')::date then raise exception 'Choose dates within one tax year'; end if;
  if turnover is null or turnover < 0 or miles < 0 or includes_costs is null then raise exception 'Enter valid totals and choose how regular costs are treated'; end if;
  if mode='profit' then costs := turnover-round((p_summary->>'profit')::numeric,2);
  elsif mode='expenses' then costs := round((p_summary->>'expenses')::numeric,2);
  else raise exception 'Choose expenses or profit entry'; end if;
  if costs is null or costs < 0 then raise exception 'Profit cannot exceed turnover'; end if;
  if turnover=0 and costs=0 and miles=0 then raise exception 'Enter at least one total'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(driver::text || ':period-summary',0));
  if p_id is not null and not exists(select 1 from public.period_entries where id=p_id and user_id=driver) then
    raise exception 'Summary not found' using errcode='42501';
  end if;
  if exists(select 1 from public.period_entries where user_id=driver and (p_id is null or id<>p_id)
      and period_start<=ends and period_end>=starts) then
    raise exception 'period_summary_overlap';
  end if;
  recorded := public.get_period_record_totals(starts,ends);
  if reconcile then
    if p_summary->>'review_signature' is distinct from recorded->>'signature' then raise exception 'period_records_changed'; end if;
    if turnover < (recorded->>'income')::numeric or costs < (recorded->>'expenses')::numeric or miles < (recorded->>'mileage')::numeric then
      raise exception 'Totals cannot be lower than existing records';
    end if;
  elsif exists(select 1 from public.income where user_id=driver and earned_on between starts and ends)
    or exists(select 1 from public.expenses where user_id=driver and expense_date between starts and ends)
    or exists(select 1 from public.mileage where user_id=driver and trip_date between starts and ends) then
    raise exception 'period_summary_overlap';
  end if;
  if p_id is null then
    insert into public.period_entries(user_id,period_start,period_end,income_amount,expense_amount,business_miles,
      notes,entry_mode,regular_costs_included,statement_source,reconciled,reviewed_records)
    values(driver,starts,ends,turnover,costs,miles,p_summary->>'notes',mode,includes_costs,p_summary->>'statement_source',reconcile,case when reconcile then recorded else null end)
    returning id into result;
  else
    update public.period_entries set period_start=starts,period_end=ends,income_amount=turnover,expense_amount=costs,
      business_miles=miles,notes=p_summary->>'notes',entry_mode=mode,regular_costs_included=includes_costs,
      statement_source=p_summary->>'statement_source',reconciled=reconcile,reviewed_records=case when reconcile then recorded else null end,updated_at=now()
    where id=p_id and user_id=driver returning id into result;
  end if;
  return result;
end $$;
revoke all on function public.save_period_summary(jsonb,uuid) from public,anon;
grant execute on function public.save_period_summary(jsonb,uuid) to authenticated;
