begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
do $$
declare driver uuid:=auth.uid(); pid uuid:=gen_random_uuid(); testcount int;
begin
 insert into public.tax_payment_records(id,user_id,tax_year,amount,kind,paid_on,note) values(pid,driver,2025,100,'balancing',current_date,'Test - rolled back');
 insert into public.tax_payment_records(id,user_id,tax_year,amount,kind,paid_on) values(pid,driver,2025,100,'balancing',current_date) on conflict(id) do nothing;
 select count(*) into testcount from public.tax_payment_records where id=pid;
 if testcount<>1 then raise exception 'Duplicate retry accepted';end if;
 insert into public.tax_year_accounts(user_id,tax_year,bill_amount,estimate_snapshot) values(driver,2025,200,'test') on conflict(user_id,tax_year) do update set bill_amount=excluded.bill_amount;
 begin
 insert into public.tax_payment_records(user_id,tax_year,amount,kind,paid_on) values(driver,2025,-1,'balancing',current_date);
 raise exception 'Negative payment accepted';exception when check_violation then null;end;
 begin
 insert into public.tax_payment_records(user_id,tax_year,amount,kind,paid_on) values(driver,2025,1,'balancing',current_date+1);
 raise exception 'Future payment accepted';exception when check_violation then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.tax_payment_records where id=pid) then raise exception 'Other owner payment exposed';end if;
 delete from public.tax_payment_records where id=pid;
 begin
 insert into public.tax_payment_records(user_id,tax_year,amount,kind,paid_on) values(driver,2025,1,'balancing',current_date);
 raise exception 'Other owner insertion accepted';exception when insufficient_privilege then null;end;
 begin
 insert into public.tax_year_accounts(user_id,tax_year,bill_amount) values(driver,2026,1);
 raise exception 'Other owner bill accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',driver::text,true);
 if not exists(select 1 from public.tax_payment_records where id=pid) then raise exception 'Other owner deleted payment';end if;
 delete from public.tax_payment_records where id=pid;
 if exists(select 1 from public.tax_payment_records where id=pid) then raise exception 'Own delete failed';end if;
end $$;
rollback;
