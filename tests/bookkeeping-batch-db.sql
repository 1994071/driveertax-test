do $$ declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();begin
insert into auth.users(id,email) values(u,u::text||'@example.invalid'),(v,v::text||'@example.invalid');perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('test.other',v::text,true);
insert into public.expenses(user_id,category,amount,expense_date) values(v,'Other owner',30,current_date);
end $$;
set local role authenticated;
do $$ declare eid uuid;batch uuid:=gen_random_uuid();outcome jsonb;rows jsonb;failed boolean;uid uuid:=auth.uid();begin
insert into public.expenses(user_id,category,amount,expense_date,tax_treatment) values(uid,'Mixed',100,current_date,'review') returning id into eid;
update public.expenses set item_allocations='[{"description":"Tools","category":"Tools","amount":60,"business_percent":100,"tax_treatment":"allowable"},{"description":"Personal","category":"Personal","amount":40,"business_percent":0,"tax_treatment":"excluded"}]' where id=eid;
failed:=false;begin update public.expenses set amount=99 where id=eid;exception when raise_exception then failed:=true;end;if not failed then raise exception 'Allocation total mismatch accepted';end if;
if (select count(*) from public.expenses)<>1 then raise exception 'Expense isolation failed';end if;
rows:=jsonb_build_array(jsonb_build_object('date',current_date,'description','Client receipt','amount',120,'direction','in','occurrence',1,'kind','income','category','Client'),jsonb_build_object('date',current_date,'description','Fuel','amount',30,'direction','out','occurrence',1,'kind','expense','category','Fuel'));
outcome:=public.commit_bank_import(batch,'Business','test.csv',rows);if (outcome->>'inserted')::int<>2 then raise exception 'Import count failed';end if;
outcome:=public.commit_bank_import(batch,'Business','test.csv',rows);if not (outcome->>'already_saved')::boolean then raise exception 'Retry failed';end if;
outcome:=public.commit_bank_import(gen_random_uuid(),'Business','overlap.csv',rows);if (outcome->>'duplicates')::int<>2 or (outcome->>'inserted')::int<>0 then raise exception 'Overlap detection failed';end if;
perform public.undo_bank_import(batch);if exists(select 1 from public.income) or (select count(*) from public.expenses)<>1 then raise exception 'Undo removed wrong records';end if;
batch:=gen_random_uuid();perform public.commit_bank_import(batch,'Business','test.csv',rows);
update public.income set notes='Edited afterwards' where user_id=uid;
failed:=false;begin perform public.undo_bank_import(batch);exception when raise_exception then failed:=true;end;if not failed then raise exception 'Undo accepted edited record';end if;
if (select count(*) from public.income)<>1 or (select count(*) from public.expenses)<>2 then raise exception 'Failed undo was not atomic';end if;
failed:=false;begin perform public.attach_expense_evidence(eid,jsonb_build_object('file_path',current_setting('test.other')||'/bad.jpg'));exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Cross-owner evidence accepted';end if;
perform public.attach_expense_evidence(eid,jsonb_build_object('file_path',uid::text||'/good.jpg','type','image/jpeg','size',100,'name','receipt.jpg','hash',repeat('a',64)));
if (select count(*) from public.expenses)<>2 or (select count(*) from public.receipts)<>1 then raise exception 'Evidence changed ledger';end if;
perform public.clear_selected_records(array['imports'],public.preview_record_clear()->>'signature','DELETE');
if exists(select 1 from public.bank_import_batches) or exists(select 1 from public.bank_import_rows) or (select count(*) from public.expenses)<>2 or (select count(*) from public.income)<>1 then raise exception 'Clearing history changed ledger or retained metadata';end if;
perform set_config('request.jwt.claim.sub',current_setting('test.other'),true);
if exists(select 1 from public.bank_import_rows) or exists(select 1 from public.bank_import_batches) or exists(select 1 from public.receipts) then raise exception 'Cross-user data visible';end if;
end $$;
reset role;
