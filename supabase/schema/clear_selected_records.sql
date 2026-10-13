-- User-initiated clearing only. Invoker security and RLS remain in force.
create table public.receipt_cleanup_queue (
 user_id uuid not null references auth.users(id) on delete cascade,
 file_path text not null,
 created_at timestamptz not null default now(),
 primary key (user_id,file_path),
 check (file_path like user_id::text || '/%')
);
alter table public.receipt_cleanup_queue enable row level security;
grant select,insert,delete on public.receipt_cleanup_queue to authenticated;
create policy receipt_cleanup_select on public.receipt_cleanup_queue for select to authenticated using ((select auth.uid())=user_id);
create policy receipt_cleanup_insert on public.receipt_cleanup_queue for insert to authenticated with check ((select auth.uid())=user_id);
create policy receipt_cleanup_delete on public.receipt_cleanup_queue for delete to authenticated using ((select auth.uid())=user_id);

create function public.record_clear_snapshot(p_lock boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); tab text; rows jsonb; result jsonb:='{}'::jsonb;
begin
 if uid is null then raise exception 'Sign in to manage records' using errcode='42501'; end if;
 foreach tab in array array['income','expenses','receipts','mileage','invoices','invoice_credits','invoice_drafts','period_entries','recurring_expenses','tax_reserve','vat_purchases','vat_classifications','vat_return_reviews'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), ''[]''::jsonb) from (select * from public.%I where user_id=$1 %s) r',tab,case when p_lock then 'for update' else '' end) into rows using uid;
  result:=result||jsonb_build_object(tab,rows);
 end loop;
 return result;
end $$;
revoke all on function public.record_clear_snapshot(boolean) from public,anon;
grant execute on function public.record_clear_snapshot(boolean) to authenticated;

create function public.preview_record_clear() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare snap jsonb:=public.record_clear_snapshot(false); counts jsonb:='{}'::jsonb; tab text;
begin
 for tab in select jsonb_object_keys(snap) loop counts:=counts||jsonb_build_object(tab,jsonb_array_length(snap->tab)); end loop;
 return jsonb_build_object('counts',counts,'signature',md5(snap::text),'linked_income',exists(select 1 from public.invoices where user_id=auth.uid() and income_id is not null));
end $$;
revoke all on function public.preview_record_clear() from public,anon;
grant execute on function public.preview_record_clear() to authenticated;

create function public.clear_selected_records(p_choices text[],p_signature text,p_confirmation text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); snap jsonb; choice text; tab text; pk text; removed bigint; totals jsonb:='{}'::jsonb; tabs text[]:='{}';
begin
 if uid is null then raise exception 'Sign in to manage records' using errcode='42501'; end if;
 if p_confirmation is distinct from 'DELETE' then raise exception 'Type DELETE to confirm'; end if;
 if p_choices is null or cardinality(p_choices)=0 then raise exception 'Choose records to delete'; end if;
 foreach choice in array p_choices loop
  if choice is null or choice not in ('income','expenses','receipts','mileage','invoices','drafts','catchup','regular','reserve') then raise exception 'Unknown record type'; end if;
 end loop;
 snap:=public.record_clear_snapshot(true);
 if p_signature is distinct from md5(snap::text) then raise exception 'Records changed. Review the latest counts before deleting.'; end if;
 if 'income'=any(p_choices) and not('invoices'=any(p_choices)) and exists(select 1 from public.invoices where user_id=uid and income_id is not null) then raise exception 'Select invoices too because some income is linked to paid invoices.'; end if;
 if p_choices && array['income','expenses','mileage'] and not('catchup'=any(p_choices)) and jsonb_array_length(snap->'period_entries')>0 then raise exception 'Select catch-up totals too, or keep the individual income, expenses and mileage records.'; end if;
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
