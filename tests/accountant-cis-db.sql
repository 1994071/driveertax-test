-- Run after schema/accountant_cis.sql, in the SAME rolled-back transaction.
create temporary table accountant_actors(owner_id uuid,accountant_id uuid,stranger_id uuid,unverified_id uuid,grant_id uuid,income_id uuid);
insert into accountant_actors values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null);
insert into auth.users(id,email,email_confirmed_at)
 select owner_id,owner_id::text||'@example.invalid',now() from accountant_actors
 union all select accountant_id,accountant_id::text||'@example.invalid',now() from accountant_actors
 union all select stranger_id,stranger_id::text||'@example.invalid',now() from accountant_actors
 union all select unverified_id,unverified_id::text||'@example.invalid',null from accountant_actors;
grant select,update on accountant_actors to authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from accountant_actors),true);
set local role authenticated;
do $test$
declare actor uuid:=auth.uid();result jsonb;inc uuid;inv uuid;testdate date:=(now() at time zone 'Europe/London')::date;
begin
 result:=public.accountant_action('invite',jsonb_build_object('email',(select upper(accountant_id::text)||'@EXAMPLE.INVALID' from accountant_actors)));
 update accountant_actors set grant_id=(result->>'id')::uuid;
 if jsonb_array_length(public.accountant_action('list','{}'))<>1 then raise exception 'Owner invite missing';end if;
 begin update public.accountant_access set accountant_id=(select stranger_id from accountant_actors);raise exception 'Owner forged acceptance';exception when insufficient_privilege then null;end;
 insert into public.income(user_id,source,amount,earned_on) values(actor,'CIS fixture',1000,testdate) returning id into inc;
 update accountant_actors set income_id=inc;
 insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,rate,deducted_amount,evidence_confirmed)
 values(actor,inc,1000,testdate,'Builder','Statement 1',20,200,true);
 if (select amount from public.income where id=inc)<>1000 then raise exception 'CIS reduced gross turnover';end if;
 begin update public.income set amount=800 where id=inc;raise exception 'CIS gross income editable';exception when others then if sqlerrm not like 'Remove the linked CIS deduction%' then raise;end if;end;
 begin insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,rate,deducted_amount,evidence_confirmed) values(actor,inc,1000,testdate,'Builder','Duplicate',20,200,true);raise exception 'Duplicate CIS accepted';exception when unique_violation then null;end;
 delete from public.cis_deductions where income_id=inc;
 begin insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,rate,deducted_amount,evidence_confirmed) values(actor,inc,1000,testdate,'Builder','Bad amount',20,199,true);raise exception 'Wrong CIS amount accepted';exception when others then if sqlerrm not like 'Deduction does not match%' then raise;end if;end;
 insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,materials_cost,rate,deducted_amount,evidence_confirmed) values(actor,inc,1000,testdate,'Builder','Eligible costs',200,30,240,true);
 -- Ordinary VAT is separate from the CIS deduction base, and must be classified.
 insert into public.vat_profiles(user_id,registered,vat_number,registration_date,scheme) values(actor,true,'123456789',testdate-10,'standard');
 insert into public.income(user_id,source,amount,earned_on) values(actor,'VAT CIS fixture',1200,testdate) returning id into inv;
 begin insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,vat_amount,materials_cost,rate,deducted_amount,evidence_confirmed) values(actor,inv,1200,testdate,'Builder','Unclassified',200,100,20,180,true);raise exception 'Unclassified VAT CIS accepted';exception when others then if sqlerrm not like 'Classify the gross income%' then raise;end if;end;
 insert into public.vat_classifications(user_id,income_id,gross_snapshot,source_date,tax_point,treatment,scheme,registration_date)
 values(actor,inv,1200,testdate,testdate,'20','standard',testdate-10);
 insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,vat_amount,materials_cost,rate,deducted_amount,evidence_confirmed) values(actor,inv,1200,testdate,'Builder','VAT statement',200,100,20,180,true);
 begin delete from public.vat_classifications where income_id=inv;raise exception 'CIS VAT classification deleted';exception when others then if sqlerrm not like 'Remove the linked CIS deduction%' then raise;end if;end;
 begin update public.vat_classifications set treatment='5' where income_id=inv;raise exception 'CIS VAT classification changed';exception when others then if sqlerrm not like 'Remove the linked CIS deduction%' then raise;end if;end;
 begin insert into public.period_entries(user_id,period_start,period_end,income_amount,expense_amount,business_miles) values(actor,testdate,testdate,2200,0,0);raise exception 'CIS catch-up overlap accepted';exception when others then if sqlerrm not like 'A CIS payment is already recorded%' then raise;end if;end;
 insert into public.income(user_id,source,amount,earned_on) select actor,'Pagination fixture',1,testdate from generate_series(1,201);
 begin perform public.accountant_action('read',jsonb_build_object('owner',actor,'from',testdate,'to',testdate,'dataset','income'));raise exception 'Owner accidentally used accountant route without accepted access';exception when insufficient_privilege then null;end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub',(select stranger_id::text from accountant_actors),true);
set local role authenticated;
do $test$
begin
 if jsonb_array_length(public.accountant_action('list','{}'))<>0 then raise exception 'Unrelated invitations visible';end if;
 begin perform public.accountant_action('accept',jsonb_build_object('id',(select grant_id from accountant_actors)));raise exception 'Stranger accepted invitation';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.cis_deductions) then raise exception 'Cross-owner CIS readable';end if;
 insert into public.income(user_id,source,amount,earned_on) values(auth.uid(),'Other account private record',999,current_date);
 begin insert into public.cis_deductions(user_id,income_id,gross_snapshot,paid_on,contractor,statement_reference,rate,deducted_amount,evidence_confirmed) values(auth.uid(),(select income_id from accountant_actors),1000,current_date,'Other','Cross-owner',20,200,true);raise exception 'Cross-owner CIS inserted';exception when others then if sqlerrm not like 'Income changed.%' then raise;end if;end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub',(select unverified_id::text from accountant_actors),true);
set local role authenticated;
do $test$ begin
 begin perform public.accountant_action('list','{}');raise exception 'Unverified account used accountant route';exception when insufficient_privilege then null;end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub',(select accountant_id::text from accountant_actors),true);
set local role authenticated;
do $test$
declare d text;result jsonb;target uuid:=(select owner_id from accountant_actors);today date:=current_date;
begin
 if jsonb_array_length(public.accountant_action('list','{}'))<>1 then raise exception 'Recipient invitation missing';end if;
 begin perform public.accountant_action('read',jsonb_build_object('owner',target,'from',today,'to',today,'dataset','income'));raise exception 'Pending invitation read records';exception when insufficient_privilege then null;end;
 perform public.accountant_action('accept',jsonb_build_object('id',(select grant_id from accountant_actors)));
 perform public.accountant_action('accept',jsonb_build_object('id',(select grant_id from accountant_actors)));
 foreach d in array array['income','expenses','invoices','cis','vat_classifications','vat_purchases','vat_reviews','credits','catchup','regular_costs'] loop
  result:=public.accountant_action('read',jsonb_build_object('owner',target,'from',today,'to',today,'dataset',d));
  if jsonb_typeof(result->'rows')<>'array' then raise exception 'Dataset % incomplete',d;end if;
 end loop;
 if jsonb_array_length(public.accountant_action('read',jsonb_build_object('owner',target,'from',today,'to',today,'dataset','cis'))->'rows')<>2 then raise exception 'CIS records missing';end if;
 result:=public.accountant_action('read',jsonb_build_object('owner',target,'from',today,'to',today,'dataset','income','page',0));
 if jsonb_array_length(result->'rows')<>200 or not (result->>'has_more')::boolean then raise exception 'First accountant page truncated';end if;
 result:=public.accountant_action('read',jsonb_build_object('owner',target,'from',today,'to',today,'dataset','income','page',1));
 if jsonb_array_length(result->'rows')<>3 or (result->>'has_more')::boolean or result::text like '%Other account private record%' then raise exception 'Second accountant page or owner isolation failed';end if;
 if exists(select 1 from public.income where user_id=target) then raise exception 'Accountant obtained direct ledger read';end if;
 if exists(select 1 from public.accountant_access) then raise exception 'Accountant read owner-only grant table';end if;
 update public.income set amount=1 where user_id=target;
 begin insert into public.income(user_id,source,amount,earned_on) values(target,'Forbidden',1,today);raise exception 'Accountant wrote client income';exception when insufficient_privilege then null;end;
 begin perform public.accountant_action('read',jsonb_build_object('owner',target,'from',today,'to',today,'dataset','auth.users'));raise exception 'Unlisted table read';exception when others then if sqlerrm<>'Unsupported accountant dataset' then raise;end if;end;
 begin perform public.accountant_action('read',jsonb_build_object('owner',target,'from',today-500,'to',today,'dataset','income'));raise exception 'Unbounded report allowed';exception when others then if sqlerrm not like 'Choose a date range%' then raise;end if;end;
end $test$;
reset role;
update public.accountant_access set revoked_at=null,access_expires_at=now()-interval '1 minute' where id=(select grant_id from accountant_actors);
set local role authenticated;
do $test$ begin
 begin perform public.accountant_action('read',jsonb_build_object('owner',(select owner_id from accountant_actors),'from',current_date,'to',current_date,'dataset','income'));raise exception 'Expired access still usable';exception when insufficient_privilege then null;end;
end $test$;
reset role;
update public.accountant_access set access_expires_at=now()+interval '1 day' where id=(select grant_id from accountant_actors);
select set_config('request.jwt.claim.sub',(select owner_id::text from accountant_actors),true);
set local role authenticated;
do $test$ begin
 if not exists(select 1 from public.accountant_access_events where action='read') then raise exception 'Read events not audited';end if;
 if (select amount from public.income where id=(select income_id from accountant_actors))<>1000 then raise exception 'Accountant changed source';end if;
 delete from public.income where user_id=auth.uid() and source='VAT CIS fixture';
 if (select count(*) from public.cis_deductions)<>1 then raise exception 'Income delete did not cascade CIS correctly';end if;
 perform public.accountant_action('revoke',jsonb_build_object('id',(select grant_id from accountant_actors)));
end $test$;
reset role;
select set_config('request.jwt.claim.sub',(select accountant_id::text from accountant_actors),true);
set local role authenticated;
do $test$ begin
 begin perform public.accountant_action('read',jsonb_build_object('owner',(select owner_id from accountant_actors),'from',current_date,'to',current_date,'dataset','income'));raise exception 'Revoked access still usable';exception when insufficient_privilege then null;end;
end $test$;
reset role;
