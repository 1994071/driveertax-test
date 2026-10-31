-- Explicit quiet-day confirmations; ledger rows remain the source of recorded activity.
create table public.daily_bookkeeping_checks (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 no_income boolean not null default false,
 no_expenses boolean not null default false,
 primary key(user_id,day)
);
alter table public.daily_bookkeeping_checks enable row level security;
revoke all on public.daily_bookkeeping_checks from public,anon,authenticated;
grant select,insert,update,delete on public.daily_bookkeeping_checks to authenticated;
grant all on public.daily_bookkeeping_checks to service_role;
create policy daily_bookkeeping_owner on public.daily_bookkeeping_checks for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create function public.get_bookkeeping_day_status(p_user_id uuid,p_day date) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inc boolean;exp boolean;
begin
 if p_user_id is null or p_day is null then raise exception 'Missing owner or date';end if;
 if current_user not in ('service_role','postgres','supabase_admin') and (select auth.uid()) is distinct from p_user_id then raise exception 'Not authorized';end if;
 select exists(select 1 from public.income where user_id=p_user_id and earned_on=p_day)
  or exists(select 1 from public.daily_bookkeeping_checks where user_id=p_user_id and day=p_day and no_income) into inc;
 select exists(select 1 from public.expenses where user_id=p_user_id and expense_date=p_day)
  or exists(select 1 from public.daily_bookkeeping_checks where user_id=p_user_id and day=p_day and no_expenses) into exp;
 return jsonb_build_object('day',p_day,'income_done',inc,'expenses_done',exp,'complete',inc and exp);
end $$;
revoke all on function public.get_bookkeeping_day_status(uuid,date) from public,anon;
grant execute on function public.get_bookkeeping_day_status(uuid,date) to authenticated,service_role;

-- One field at a time, atomically preserving the other confirmation across devices.
create function public.confirm_my_bookkeeping_none(p_day date,p_kind text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare who uuid:=(select auth.uid());
begin
 if who is null then raise exception 'Sign in first';end if;
 if p_day is null or p_day>(now() at time zone 'Europe/London')::date or p_kind is null or p_kind not in ('income','expenses') then raise exception 'Invalid confirmation';end if;
 insert into public.daily_bookkeeping_checks(user_id,day,no_income,no_expenses)
 values(who,p_day,p_kind='income',p_kind='expenses')
 on conflict(user_id,day) do update set
 no_income=daily_bookkeeping_checks.no_income or excluded.no_income,
 no_expenses=daily_bookkeeping_checks.no_expenses or excluded.no_expenses;
 return public.get_bookkeeping_day_status(who,p_day);
end $$;
revoke all on function public.confirm_my_bookkeeping_none(date,text) from public,anon;
grant execute on function public.confirm_my_bookkeeping_none(date,text) to authenticated;

create or replace function public.list_owner_bookkeeping_push(p_now timestamptz default now()) returns table(endpoint_hash text,user_id uuid)
language sql security invoker set search_path='' as $$
 select d.endpoint_hash,d.user_id from public.owner_push_devices d
 where d.enabled and d.bookkeeping_enabled
 and (p_now at time zone 'Europe/London')::time>=d.bookkeeping_time
 and not (public.get_bookkeeping_day_status(d.user_id,(p_now at time zone 'Europe/London')::date)->>'complete')::boolean
 and not exists(select 1 from public.owner_bookkeeping_push_deliveries l where l.endpoint_hash=d.endpoint_hash and l.user_id=d.user_id and l.day=(p_now at time zone 'Europe/London')::date)
 order by d.updated_at limit 10;
$$;
create or replace function public.claim_owner_bookkeeping_push(p_hash text,p_user_id uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare device public.owner_push_devices%rowtype;today date:=(p_now at time zone 'Europe/London')::date;claimed text;
begin
 select * into device from public.owner_push_devices where endpoint_hash=p_hash and user_id=p_user_id for update;
 if not found or not device.enabled or not device.bookkeeping_enabled then return null;end if;
 if (p_now at time zone 'Europe/London')::time<device.bookkeeping_time then return null;end if;
 if (public.get_bookkeeping_day_status(p_user_id,today)->>'complete')::boolean then return null;end if;
 insert into public.owner_bookkeeping_push_deliveries(endpoint_hash,user_id,day) values(p_hash,p_user_id,today) on conflict do nothing returning endpoint_hash into claimed;
 if claimed is null then return null;end if;
 return jsonb_build_object('subscription',device.subscription,'binding',device.binding,'user_id',device.user_id,'sound',device.sound,'day',today);
end $$;
revoke all on function public.list_owner_bookkeeping_push(timestamptz),public.claim_owner_bookkeeping_push(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.list_owner_bookkeeping_push(timestamptz),public.claim_owner_bookkeeping_push(text,uuid,timestamptz) to service_role;
