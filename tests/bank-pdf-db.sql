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
