-- File identity is independent of the account nickname. Existing imports remain valid.
alter table public.bank_import_batches add column file_sha256 text check(file_sha256 ~ '^[0-9a-f]{64}$');
create index bank_import_batches_file on public.bank_import_batches(user_id,file_sha256) where undone_at is null;
create function public.check_bank_statement(p_sha256 text,p_filename text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in again' using errcode='42501';end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file identity';end if;
 return jsonb_build_object('file_seen',exists(select 1 from public.bank_import_batches where user_id=auth.uid() and file_sha256=p_sha256 and undone_at is null),'name_seen',exists(select 1 from public.bank_import_batches where user_id=auth.uid() and filename=p_filename and undone_at is null));
end $$;
revoke all on function public.check_bank_statement(text,text) from public,anon;
grant execute on function public.check_bank_statement(text,text) to authenticated;

create function public.commit_bank_statement(p_id uuid,p_account text,p_filename text,p_rows jsonb,p_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();canonical_account text;result jsonb;
begin
 if uid is null then raise exception 'Sign in again' using errcode='42501';end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Choose the statement again to verify its identity';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':bank-import',0));
 if exists(select 1 from public.bank_import_batches where id=p_id and user_id=uid and file_sha256 is distinct from p_sha256) then raise exception 'Import changed. Choose the statement again';end if;
 -- Reuse the original account identity for this exact file, preserving row occurrences.
 -- Partial selections can be imported later without duplicating rows already saved.
 select account_label into canonical_account from public.bank_import_batches where user_id=uid and file_sha256=p_sha256 and undone_at is null order by created_at limit 1;
 if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'kind'<>'skip' and coalesce((r->>'approved')::boolean,false) is not true) then raise exception 'Approve the selected transactions';end if;
 result:=public.commit_bank_import(p_id,coalesce(canonical_account,p_account),p_filename,p_rows);
 update public.bank_import_batches set file_sha256=p_sha256 where id=p_id and user_id=uid;
 return result;
end $$;
revoke all on function public.commit_bank_statement(uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.commit_bank_statement(uuid,text,text,jsonb,text) to authenticated;
