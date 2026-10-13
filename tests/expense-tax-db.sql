begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles limit 1),true);
set local role authenticated;
do $$
declare expense_id uuid; scanned_id uuid; request_id uuid:=gen_random_uuid(); caught boolean:=false;
begin
 if auth.uid() is null then raise exception 'Test requires an existing profile'; end if;
 insert into public.expenses(user_id,category,amount,expense_date,tax_treatment,business_percent) values(auth.uid(),'Tax test',100,current_date,'allowable',60) returning id into expense_id;
 if not exists(select 1 from public.expenses where id=expense_id and business_percent=60 and tax_treatment='allowable') then raise exception 'Round-trip failed'; end if;
 begin update public.expenses set business_percent=101 where id=expense_id; exception when check_violation then caught:=true; end;
 if not caught then raise exception 'Invalid percentage accepted'; end if;
 caught:=false;
 begin update public.expenses set tax_treatment='invalid' where id=expense_id; exception when check_violation then caught:=true; end;
 if not caught then raise exception 'Invalid treatment accepted'; end if;
 caught:=false;
 begin update public.expenses set user_id=gen_random_uuid() where id=expense_id; exception when insufficient_privilege then caught:=true; end;
 if not caught then raise exception 'Owner reassignment accepted'; end if;
 scanned_id:=public.save_scanned_receipt(jsonb_build_object('content_sha256',repeat('a',64),'save_request_id',request_id,'file_path',auth.uid()::text||'/tax-test.jpg','amount',120,'date',current_date,'merchant','Tax test','category','Phone','tax_treatment','allowable','business_percent',50,'ai_completed',false));
 if not exists(select 1 from public.expenses where id=scanned_id and amount=120 and business_percent=50 and tax_treatment='allowable') then raise exception 'Scanned treatment not persisted'; end if;
 if scanned_id<>public.save_scanned_receipt(jsonb_build_object('content_sha256',repeat('a',64),'save_request_id',request_id,'file_path',auth.uid()::text||'/tax-test.jpg','amount',120,'date',current_date)) then raise exception 'Receipt retry duplicated'; end if;
 insert into public.recurring_expenses(user_id,category,amount,frequency,start_date,tax_treatment,business_percent) values(auth.uid(),'Tax test',100,'monthly',current_date,'allowable',50);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.expenses where id in (expense_id,scanned_id)) then raise exception 'Cross-account read allowed'; end if;
 update public.expenses set amount=0 where id=expense_id;
 if found then raise exception 'Cross-account update allowed'; end if;
end $$;
rollback;
