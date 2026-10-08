begin;
do $$ begin
  perform set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
end $$;
set local role authenticated;
do $$
declare
  driver uuid:=auth.uid();starts date;ends date;review jsonb;payload jsonb;summary uuid;income_id uuid;
begin
  select d::date into starts from generate_series(date '2026-04-06',least(date '2026-09-20',(now() at time zone 'Europe/London')::date-7),interval '7 days') d
  where not exists(select 1 from public.period_entries where user_id=driver and period_start<=d::date+6 and period_end>=d::date)
    and not exists(select 1 from public.income where user_id=driver and earned_on between d::date and d::date+6)
    and not exists(select 1 from public.expenses where user_id=driver and expense_date between d::date and d::date+6)
    and not exists(select 1 from public.mileage where user_id=driver and trip_date between d::date and d::date+6)
  order by d limit 1;
  if starts is null or driver is null then raise exception 'No isolated test range';end if;ends:=starts+6;
  insert into public.income(user_id,source,amount,earned_on) values(driver,'Uber',500,starts) returning id into income_id;
  insert into public.expenses(user_id,category,amount,expense_date) values(driver,'Fuel',100,starts);
  insert into public.mileage(user_id,trip_date,business_miles,source) values(driver,starts,20,'manual');
  review:=public.get_period_record_totals(starts,ends);
  if (review->>'income')::numeric<>500 or (review->>'expenses')::numeric<>100 or (review->>'mileage')::numeric<>20 or (review->>'count')::int<>3 then raise exception 'Review mismatch';end if;
  payload:=jsonb_build_object('period_start',starts,'period_end',ends,'turnover',2000,'expenses',500,'entry_mode','expenses','regular_costs_included',true,'business_miles',50,'reconcile',true,'review_signature',review->>'signature');
  summary:=public.save_period_summary(payload);
  if not exists(select 1 from public.period_entries where id=summary and reconciled and income_amount=2000 and expense_amount=500 and business_miles=50) then raise exception 'Summary not saved correctly';end if;
  if not exists(select 1 from public.income where id=income_id and amount=500) then raise exception 'Original record changed';end if;
  begin
    perform public.save_period_summary(payload);raise exception 'Overlap accepted';
  exception when others then if sqlerrm<>'period_summary_overlap' then raise;end if;end;
  begin
    perform public.save_period_summary(payload||jsonb_build_object('turnover',400),summary);raise exception 'Lower total accepted';
  exception when others then if sqlerrm<>'Totals cannot be lower than existing records' then raise;end if;end;
  update public.income set amount=600 where id=income_id;
  begin
    perform public.save_period_summary(payload,summary);raise exception 'Stale review accepted';
  exception when others then if sqlerrm<>'period_records_changed' then raise;end if;end;
  review:=public.get_period_record_totals(starts,ends);
  perform public.save_period_summary(payload||jsonb_build_object('review_signature',review->>'signature','entry_mode','profit','profit',1400),summary);
  if not exists(select 1 from public.period_entries where id=summary and expense_amount=600) then raise exception 'Profit edit wrong';end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if (public.get_period_record_totals(starts,ends)->>'count')::int<>0 then raise exception 'Other driver records exposed';end if;
  begin
    perform public.save_period_summary(payload,summary);raise exception 'Other driver edit accepted';
  exception when insufficient_privilege then null;end;
end $$;
rollback;
