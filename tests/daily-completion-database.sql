-- Run as an administrator. Every fixture is isolated and rolled back; no push worker is invoked.
begin;
do $$
declare who uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();d date:=(now() at time zone 'Europe/London')::date;v jsonb;
begin
 perform set_config('app.daily_test_owner',who::text,true);perform set_config('app.daily_test_other',other_user::text,true);
 insert into auth.users(id,email) values(who,'daily-test-'||who||'@example.invalid'),(other_user,'daily-test-'||other_user||'@example.invalid');
 perform set_config('request.jwt.claim.sub',who::text,true);
 v:=public.get_bookkeeping_day_status(who,d);if (v->>'complete')::boolean then raise exception 'Empty day completed';end if;
 insert into public.income(user_id,source,amount,earned_on) values(who,'TEST ONLY',1,d);
 insert into public.expenses(user_id,category,amount,expense_date) values(other_user,'Other',1,d);
 v:=public.get_bookkeeping_day_status(who,d);if not (v->>'income_done')::boolean or (v->>'expenses_done')::boolean then raise exception 'Partial/other owner failed';end if;
 insert into public.expenses(user_id,category,amount,expense_date) values(who,'Other',1,d);
 if not (public.get_bookkeeping_day_status(who,d)->>'complete')::boolean then raise exception 'Both rows not complete';end if;
 insert into public.owner_push_devices(endpoint_hash,user_id,subscription,binding,enabled,sound,bookkeeping_enabled,bookkeeping_time,updated_at)
 values('test-'||who,who,'{}',gen_random_uuid(),true,false,true,'20:00','1900-01-01');
 if public.claim_owner_bookkeeping_push('test-'||who,who,(d::text||' 21:00 Europe/London')::timestamptz) is not null then raise exception 'Completed day claimed';end if;
 if exists(select 1 from public.list_owner_bookkeeping_push((d::text||' 21:00 Europe/London')::timestamptz) where user_id=who) then raise exception 'Completed day listed';end if;
 delete from public.expenses where user_id=who;
 if (public.get_bookkeeping_day_status(who,d)->>'complete')::boolean then raise exception 'Deleted expense still complete';end if;
 perform public.confirm_my_bookkeeping_none(d,'expenses');
 if not (public.get_bookkeeping_day_status(who,d)->>'complete')::boolean then raise exception 'No expenses not counted';end if;
 delete from public.income where user_id=who;
 perform public.confirm_my_bookkeeping_none(d,'income');
 if not exists(select 1 from public.daily_bookkeeping_checks where user_id=who and day=d and no_income and no_expenses) then raise exception 'Confirmation clobbered other field';end if;
 if public.claim_owner_bookkeeping_push('test-'||who,who,'2026-07-01 18:59:00+00') is not null then raise exception 'Summer reminder early';end if;
 if public.claim_owner_bookkeeping_push('test-'||who,who,'2026-07-01 19:00:00+00') is null then raise exception 'Summer reminder missing';end if;
 if public.claim_owner_bookkeeping_push('test-'||who,who,'2026-07-01 19:10:00+00') is not null then raise exception 'Duplicate reminder claim';end if;
 if public.claim_owner_bookkeeping_push('test-'||who,who,'2026-01-01 19:59:00+00') is not null then raise exception 'Winter reminder early';end if;
 if public.claim_owner_bookkeeping_push('test-'||who,who,'2026-01-01 20:00:00+00') is null then raise exception 'Winter reminder missing';end if;
 if ('2026-07-01 23:30:00+00'::timestamptz at time zone 'Europe/London')::date<>'2026-07-02'::date then raise exception 'UK midnight incorrect';end if;
end $$;
set local role authenticated;
do $$
declare who uuid:=current_setting('app.daily_test_owner')::uuid;other_user uuid:=current_setting('app.daily_test_other')::uuid;blocked boolean:=false;d date:=(now() at time zone 'Europe/London')::date;
begin
 if (select count(*) from public.daily_bookkeeping_checks where user_id=who)<>1 then raise exception 'Own row not readable';end if;
 begin perform public.get_bookkeeping_day_status(other_user,d);exception when others then blocked:=true;end;
 if not blocked then raise exception 'Other owner status accessible';end if;
 blocked:=false;
 begin insert into public.daily_bookkeeping_checks(user_id,day,no_income) values(other_user,d,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Other owner write allowed';end if;
 perform public.confirm_my_bookkeeping_none(d,'income');
end $$;
reset role;
rollback;
select 'PASS: records, partial days, quiet-day confirmations, deletion, owner RLS, fresh claim suppression, duplicate claims, UK midnight and summer/winter times. Fixtures rolled back.' as result;
