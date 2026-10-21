begin;
do $$
declare uid uuid:=gen_random_uuid();first_id uuid:=gen_random_uuid();second_id uuid:=gen_random_uuid();result jsonb;rowdata jsonb:='[{"date":"2026-01-01","description":"PDF fixture payment","amount":50,"direction":"in","occurrence":1,"kind":"income","category":"Bank income","approved":true}]'::jsonb;
begin
 insert into auth.users(id) values(uid);perform set_config('request.jwt.claim.sub',uid::text,true);
 if has_table_privilege('authenticated','public.bank_pdf_request_windows','select') or has_function_privilege('authenticated','public.consume_bank_pdf_request(uuid)','execute') then raise exception 'Quota exposed';end if;
 if not public.consume_bank_pdf_request(uid) or not public.consume_bank_pdf_request(uid) or not public.consume_bank_pdf_request(uid) or public.consume_bank_pdf_request(uid) then raise exception 'PDF quota incorrect';end if;
 result:=public.commit_bank_import(first_id,'PDF test bank','bank.pdf',rowdata);if (result->>'inserted')::int<>1 then raise exception 'PDF record not saved';end if;
 result:=public.commit_bank_import(second_id,'PDF test bank','bank.csv',rowdata);if (result->>'duplicates')::int<>1 or (result->>'inserted')::int<>0 then raise exception 'PDF/CSV duplicates not protected';end if;
 if (select count(*) from public.income where user_id=uid)<>1 then raise exception 'Unexpected income count';end if;
end $$;
rollback;

-- New exact-file checks survive account nickname changes, allow partial imports,
-- and are private to the authenticated account. Everything rolls back.
begin;
insert into auth.users(id) values('e837e985-432e-462f-a561-3abe44fc1ac1'),('e837e985-432e-462f-a561-3abe44fc1ac2');
select set_config('request.jwt.claim.sub','e837e985-432e-462f-a561-3abe44fc1ac1',true);
set local role authenticated;
do $$
declare result jsonb;rows jsonb:='[{"date":"2026-01-02","description":"Synthetic Shell","amount":25,"direction":"out","occurrence":1,"kind":"expense","category":"Fuel","approved":true}]';sha text:=repeat('a',64);
begin
 result:=public.commit_bank_statement(gen_random_uuid(),'Original name','test.pdf',rows,sha);if (result->>'inserted')::int<>1 then raise exception 'First file import failed';end if;
 if not(public.check_bank_statement(sha,'renamed.pdf')->>'file_seen')::boolean then raise exception 'Renamed file not recognised';end if;
 result:=public.commit_bank_statement(gen_random_uuid(),'Changed nickname','renamed.pdf',rows,sha);if (result->>'duplicates')::int<>1 or (result->>'inserted')::int<>0 then raise exception 'Nickname bypassed duplicate prevention';end if;
 rows:=rows||'[{"date":"2026-01-03","description":"Synthetic Vodafone","amount":20,"direction":"out","occurrence":1,"kind":"expense","category":"Phone & Internet","approved":true}]';
 result:=public.commit_bank_statement(gen_random_uuid(),'Another nickname','test.pdf',rows,sha);if (result->>'duplicates')::int<>1 or (result->>'inserted')::int<>1 then raise exception 'Remaining rows not imported selectively';end if;
 if (select count(*) from public.expenses)<>2 then raise exception 'Expenses not owner scoped or wrong count';end if;
 if (select count(*) from public.expenses where expense_date in ('2026-01-02','2026-01-03') and tax_treatment='review')<>2 then raise exception 'Date/tax treatment changed';end if;
 perform set_config('request.jwt.claim.sub','e837e985-432e-462f-a561-3abe44fc1ac2',true);
 if (public.check_bank_statement(sha,'test.pdf')->>'file_seen')::boolean or exists(select 1 from public.bank_import_batches) then raise exception 'Other account import visible';end if;
end $$;
reset role;
rollback;
