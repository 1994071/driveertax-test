-- Additive batch: allocations, reviewed bank imports, evidence attachment.
alter table public.expenses add column item_allocations jsonb not null default '[]'::jsonb;
create function public.validate_expense_allocations() returns trigger language plpgsql security invoker set search_path='' as $$
declare item jsonb; total numeric:=0;
begin
 if jsonb_typeof(new.item_allocations)<>'array' or jsonb_array_length(new.item_allocations)>100 then raise exception 'Invalid item allocations'; end if;
 for item in select value from jsonb_array_elements(new.item_allocations) loop
  if coalesce(length(trim(item->>'description')),0)=0 or length(item->>'description')>200 or coalesce(length(trim(item->>'category')),0)=0 or length(item->>'category')>100 or (item->>'tax_treatment') is null or (item->>'tax_treatment') not in ('allowable','excluded','review') or (item->>'amount') is null or (item->>'amount')::numeric not between 0.01 and 1000000000 or (item->>'amount')::numeric<>round((item->>'amount')::numeric,2) or (item->>'business_percent') is null or (item->>'business_percent')::numeric not between 0 and 100 then raise exception 'Check each item description, category, amount and business use'; end if;
  total:=total+(item->>'amount')::numeric;
 end loop;
 if jsonb_array_length(new.item_allocations)>0 then
  if total<>new.amount then raise exception 'Item amounts must equal the expense total'; end if;
  if exists(select 1 from public.vat_purchases where expense_id=new.id) or exists(select 1 from public.vat_classifications where expense_id=new.id) then raise exception 'Remove the existing VAT classification before allocating items; review VAT separately afterwards'; end if;
  new.tax_treatment:='review';new.business_percent:=100;
 end if;
 return new;
end $$;
create trigger expense_allocations_check before insert or update on public.expenses for each row execute function public.validate_expense_allocations();
revoke all on function public.validate_expense_allocations() from public,anon;

create table public.bank_import_batches(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,account_label text not null,filename text not null,created_at timestamptz not null default now(),undone_at timestamptz,unique(id,user_id));
create table public.bank_import_rows(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.bank_import_batches(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,fingerprint text not null,record_type text not null check(record_type in ('income','expense')),record_id uuid not null,record_snapshot jsonb not null,unique(user_id,fingerprint),foreign key(batch_id,user_id) references public.bank_import_batches(id,user_id) on delete cascade);
alter table public.bank_import_batches enable row level security;
alter table public.bank_import_rows enable row level security;
grant select,insert,update,delete on public.bank_import_batches to authenticated;
grant select,insert,delete on public.bank_import_rows to authenticated;
create policy import_batch_owner on public.bank_import_batches for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy import_row_owner on public.bank_import_rows for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create index bank_import_rows_batch on public.bank_import_rows(batch_id);
create index bank_import_batches_user on public.bank_import_batches(user_id);

create function public.commit_bank_import(p_id uuid,p_account text,p_filename text,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();r jsonb; fp text; rid uuid; snap jsonb; inserted integer:=0; skipped integer:=0; amt numeric; d date; kind text;
begin
 if uid is null then raise exception 'Sign in again' using errcode='42501'; end if;
 if p_id is null or length(trim(p_account)) not between 1 and 100 or length(p_filename)>255 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Invalid import'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':bank-import',0));
 if exists(select 1 from public.bank_import_batches where id=p_id and user_id=uid) then return jsonb_build_object('already_saved',true);end if;
 insert into public.bank_import_batches(id,user_id,account_label,filename) values(p_id,uid,trim(p_account),p_filename);
 for r in select value from jsonb_array_elements(p_rows) loop
  kind:=r->>'kind';if kind='skip' then continue;end if;
  if kind is null or kind not in ('income','expense') then raise exception 'Choose income, expense or skip';end if;
  d:=(r->>'date')::date;amt:=(r->>'amount')::numeric;
  if d is null or d>current_date or amt is null or amt not between 0.01 and 1000000000 or amt<>round(amt,2) or length(coalesce(r->>'description','')) not between 1 and 500 or coalesce((r->>'occurrence')::int,0)<1 then raise exception 'Invalid transaction';end if;
  fp:=md5(lower(trim(p_account))||'|'||d::text||'|'||round(amt,2)::text||'|'||lower(trim(r->>'description'))||'|'||coalesce(r->>'direction','')||'|'||(r->>'occurrence'));
  if exists(select 1 from public.bank_import_rows where user_id=uid and fingerprint=fp) then skipped:=skipped+1;continue;end if;
  if kind='income' then
   insert into public.income(user_id,source,amount,earned_on,notes) values(uid,coalesce(nullif(r->>'category',''),'Bank import'),amt,d,r->>'description') returning id,to_jsonb(income.*) into rid,snap;
  else
   insert into public.expenses(user_id,category,amount,expense_date,merchant,notes,tax_treatment,business_percent) values(uid,coalesce(nullif(r->>'category',''),'Other'),amt,d,r->>'description','Reviewed bank statement import','review',100) returning id,to_jsonb(expenses.*) into rid,snap;
  end if;
  insert into public.bank_import_rows(batch_id,user_id,fingerprint,record_type,record_id,record_snapshot) values(p_id,uid,fp,kind,rid,snap);inserted:=inserted+1;
 end loop;
 if inserted>0 then delete from public.vat_return_reviews where user_id=uid;end if;
 return jsonb_build_object('inserted',inserted,'duplicates',skipped);
end $$;
revoke all on function public.commit_bank_import(uuid,text,text,jsonb) from public,anon;
grant execute on function public.commit_bank_import(uuid,text,text,jsonb) to authenticated;

create function public.undo_bank_import(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();r record; snap jsonb;
begin
 if uid is null then raise exception 'Sign in again' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||':bank-import',0));
 perform 1 from public.bank_import_batches where id=p_id and user_id=uid and undone_at is null for update;
 if not found then raise exception 'Import unavailable or already undone';end if;
 for r in select * from public.bank_import_rows where batch_id=p_id and user_id=uid loop
  if r.record_type='income' then
   select to_jsonb(i.*) into snap from public.income i where id=r.record_id and user_id=uid for update;
   if exists(select 1 from public.invoices where income_id=r.record_id and user_id=uid) or exists(select 1 from public.vat_classifications where income_id=r.record_id and user_id=uid) then raise exception 'An imported record is linked to an invoice or VAT review. Review it individually';end if;
  else
   select to_jsonb(e.*) into snap from public.expenses e where id=r.record_id and user_id=uid for update;
   if exists(select 1 from public.receipts where expense_id=r.record_id and user_id=uid) or exists(select 1 from public.vat_purchases where expense_id=r.record_id and user_id=uid) or exists(select 1 from public.vat_classifications where expense_id=r.record_id and user_id=uid) then raise exception 'An imported expense has evidence or VAT records. Review it individually';end if;
  end if;
  if snap is not null and snap<>r.record_snapshot then raise exception 'An imported record was edited. Review it individually; nothing was removed';end if;
  if r.record_type='income' then delete from public.income where id=r.record_id and user_id=uid;else delete from public.expenses where id=r.record_id and user_id=uid;end if;
 end loop;
 delete from public.bank_import_rows where batch_id=p_id and user_id=uid;
 update public.bank_import_batches set undone_at=now() where id=p_id and user_id=uid;
 delete from public.vat_return_reviews where user_id=uid;
end $$;
revoke all on function public.undo_bank_import(uuid) from public,anon;
grant execute on function public.undo_bank_import(uuid) to authenticated;

create function public.attach_expense_evidence(p_expense uuid,p_file jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();e public.expenses;rid uuid;
begin
 if uid is null or (p_file->>'file_path') is null or p_file->>'file_path' not like uid::text||'/%' then raise exception 'Invalid evidence owner' using errcode='42501';end if;
 select * into e from public.expenses where id=p_expense and user_id=uid for update;
 if not found then raise exception 'Expense unavailable';end if;
 if exists(select 1 from public.receipts where expense_id=e.id and user_id=uid) then raise exception 'This expense already has evidence';end if;
 insert into public.receipts(user_id,expense_id,file_path,original_filename,mime_type,size_bytes,ai_status,extracted_date,extracted_amount,driver_confirmed,content_sha256) values(uid,e.id,p_file->>'file_path',p_file->>'name',p_file->>'type',(p_file->>'size')::bigint,'failed',e.expense_date,e.amount,true,p_file->>'hash') returning id into rid;
 update public.expenses set receipt_attached=true where id=e.id and user_id=uid;
 return rid;
end $$;
revoke all on function public.attach_expense_evidence(uuid,jsonb) from public,anon;
grant execute on function public.attach_expense_evidence(uuid,jsonb) to authenticated;

-- Item allocations currently support Income Tax only. Prevent aggregate VAT being
-- spread over mixed personal/business goods or mixed VAT rates.
create function public.guard_split_vat() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.expense_id is not null and exists(select 1 from public.expenses where id=new.expense_id and jsonb_array_length(item_allocations)>0) then raise exception 'Item-split expenses need item-level VAT review outside this preview; no VAT claim was saved';end if;
 return new;
end $$;
create trigger split_vat_purchase before insert or update on public.vat_purchases for each row execute function public.guard_split_vat();
create trigger split_vat_classification before insert or update on public.vat_classifications for each row execute function public.guard_split_vat();
revoke all on function public.guard_split_vat() from public,anon;

-- Include import history in the existing reviewed clear-records flow.
create or replace function public.record_clear_snapshot(p_lock boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); tab text; rows jsonb; result jsonb:='{}'::jsonb;
begin
 if uid is null then raise exception 'Sign in to manage records' using errcode='42501'; end if;
 foreach tab in array array['income','expenses','receipts','mileage','invoices','invoice_credits','invoice_drafts','period_entries','recurring_expenses','tax_reserve','vat_purchases','vat_classifications','vat_return_reviews','bank_import_rows','bank_import_batches'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), ''[]''::jsonb) from (select * from public.%I where user_id=$1 %s) r',tab,case when p_lock then 'for update' else '' end) into rows using uid;
  result:=result||jsonb_build_object(tab,rows);
 end loop;
 return result;
end $$;
revoke all on function public.record_clear_snapshot(boolean) from public,anon;
grant execute on function public.record_clear_snapshot(boolean) to authenticated;

create or replace function public.preview_record_clear() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare snap jsonb:=public.record_clear_snapshot(false); counts jsonb:='{}'::jsonb; tab text;
begin
 for tab in select jsonb_object_keys(snap) loop counts:=counts||jsonb_build_object(tab,jsonb_array_length(snap->tab)); end loop;
 return jsonb_build_object('counts',counts,'signature',md5(snap::text),'linked_income',exists(select 1 from public.invoices where user_id=auth.uid() and income_id is not null));
end $$;
revoke all on function public.preview_record_clear() from public,anon;
grant execute on function public.preview_record_clear() to authenticated;

create or replace function public.clear_selected_records(p_choices text[],p_signature text,p_confirmation text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); snap jsonb; choice text; tab text; pk text; removed bigint; totals jsonb:='{}'::jsonb; tabs text[]:='{}';
begin
 if uid is null then raise exception 'Sign in to manage records' using errcode='42501'; end if;
 if p_confirmation is distinct from 'DELETE' then raise exception 'Type DELETE to confirm'; end if;
 if p_choices is null or cardinality(p_choices)=0 then raise exception 'Choose records to delete'; end if;
 foreach choice in array p_choices loop
  if choice is null or choice not in ('income','expenses','receipts','mileage','invoices','drafts','catchup','regular','reserve','imports') then raise exception 'Unknown record type'; end if;
 end loop;
 snap:=public.record_clear_snapshot(true);
 if p_signature is distinct from md5(snap::text) then raise exception 'Records changed. Review the latest counts before deleting.'; end if;
 if 'income'=any(p_choices) and not('invoices'=any(p_choices)) and exists(select 1 from public.invoices where user_id=uid and income_id is not null) then raise exception 'Select invoices too because some income is linked to paid invoices.'; end if;
 if p_choices && array['income','expenses','mileage'] and not('catchup'=any(p_choices)) and jsonb_array_length(snap->'period_entries')>0 then raise exception 'Select catch-up totals too, or keep the individual income, expenses and mileage records.'; end if;
 -- Remove saved import snapshots when their underlying financial records are cleared.
 if 'income'=any(p_choices) then delete from public.bank_import_rows where user_id=uid and record_type='income' and record_id in(select (r->>'id')::uuid from jsonb_array_elements(snap->'income') r);end if;
 if 'expenses'=any(p_choices) then delete from public.bank_import_rows where user_id=uid and record_type='expense' and record_id in(select (r->>'id')::uuid from jsonb_array_elements(snap->'expenses') r);end if;
 if 'imports'=any(p_choices) then tabs:=tabs||array['bank_import_rows','bank_import_batches'];end if;
 -- Order respects foreign keys. Dependent removals are explained in the UI.
 if p_choices && array['income','expenses','invoices','catchup','regular'] then tabs:=array_append(tabs,'vat_return_reviews'); end if;
 if 'invoices'=any(p_choices) then tabs:=tabs||array['invoice_credits','invoices']; end if;
 if 'expenses'=any(p_choices) then tabs:=array_append(tabs,'vat_purchases'); end if;
 if p_choices && array['expenses','receipts'] then
  insert into public.receipt_cleanup_queue(user_id,file_path)
   select uid,r->>'file_path' from jsonb_array_elements(snap->'receipts') r where nullif(r->>'file_path','') is not null on conflict do nothing;
  tabs:=array_append(tabs,'receipts');
 end if;
 if 'expenses'=any(p_choices) then tabs:=array_append(tabs,'expenses'); end if;
 if 'income'=any(p_choices) then tabs:=array_append(tabs,'income'); end if;
 if 'mileage'=any(p_choices) then tabs:=array_append(tabs,'mileage'); end if;
 if 'drafts'=any(p_choices) then tabs:=array_append(tabs,'invoice_drafts'); end if;
 if 'catchup'=any(p_choices) then tabs:=array_append(tabs,'period_entries'); end if;
 if 'regular'=any(p_choices) then tabs:=array_append(tabs,'recurring_expenses'); end if;
 if 'reserve'=any(p_choices) then tabs:=array_append(tabs,'tax_reserve'); end if;
 foreach tab in array tabs loop
  pk:=case when tab='invoice_credits' then 'invoice_id' when tab='vat_purchases' then 'expense_id' else 'id' end;
  execute format('delete from public.%I where user_id=$1 and %I in (select (r->>%L)::uuid from jsonb_array_elements($2->%L) r)',tab,pk,pk,tab) using uid,snap;
  get diagnostics removed=row_count;totals:=totals||jsonb_build_object(tab,removed);
 end loop;
 -- Keep retained expense attachment flags consistent with the actual remaining rows.
 if 'receipts'=any(p_choices) and not('expenses'=any(p_choices)) then
  update public.expenses e set receipt_attached=false where e.user_id=uid and e.id in(select (r->>'expense_id')::uuid from jsonb_array_elements(snap->'receipts') r) and not exists(select 1 from public.receipts r where r.expense_id=e.id);
 end if;
 -- Invoice numbering and profiles deliberately remain intact.
 return jsonb_build_object('deleted',totals,'file_cleanup_pending',(select count(*) from public.receipt_cleanup_queue where user_id=uid));
end $$;
revoke all on function public.clear_selected_records(text[],text,text) from public,anon;
grant execute on function public.clear_selected_records(text[],text,text) to authenticated;
