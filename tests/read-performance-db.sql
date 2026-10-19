begin;
do $$ declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid'),(v,v::text||'@example.invalid');
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('test.other',v::text,true);
end $$;
set local role authenticated;
do $$ declare u uuid:=auth.uid();v uuid:=current_setting('test.other')::uuid;r uuid;p uuid;begin
 insert into public.tax_profiles(user_id,paye_income) values(u,16000) on conflict(user_id) do update set paye_income=excluded.paye_income;
 insert into public.recurring_expenses(user_id,category,amount,frequency,start_date) values(u,'Fixture',10,'monthly',current_date) returning id into r;
 insert into public.period_entries(user_id,period_start,period_end) values(u,date '2026-04-06',date '2026-04-07') returning id into p;
 if not exists(select 1 from public.tax_profiles where user_id=u and paye_income=16000) or not exists(select 1 from public.period_entries where id=p) or not exists(select 1 from public.recurring_expenses where id=r) then raise exception 'Owner read failed';end if;
 perform set_config('request.jwt.claim.sub',v::text,true);
 if exists(select 1 from public.tax_profiles where user_id=u) or exists(select 1 from public.period_entries where id=p) or exists(select 1 from public.recurring_expenses where id=r) then raise exception 'Cross owner read allowed';end if;
 update public.tax_profiles set paye_income=0 where user_id=u;if found then raise exception 'Cross owner tax update';end if;
 update public.period_entries set income_amount=1 where id=p;if found then raise exception 'Cross owner summary update';end if;
 delete from public.recurring_expenses where id=r;if found then raise exception 'Cross owner cost delete';end if;
 begin insert into public.recurring_expenses(user_id,category,amount,frequency,start_date) values(u,'Forbidden',1,'monthly',current_date);raise exception 'Cross owner cost insert';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.tax_profiles set paye_income=17000 where user_id=u;if not found then raise exception 'Owner update failed';end if;
 delete from public.recurring_expenses where id=r;if not found then raise exception 'Owner delete failed';end if;
 delete from public.period_entries where id=p;if not found then raise exception 'Owner summary delete failed';end if;
end $$;
rollback;
