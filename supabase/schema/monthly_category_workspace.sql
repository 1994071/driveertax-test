-- Category-only batches: ownership, optimistic locking, idempotency and atomic undo.
create table public.merchant_category_rules (
 user_id uuid not null references auth.users(id) on delete cascade,
 merchant_key text not null check(length(merchant_key) between 2 and 160),
 merchant_label text not null check(length(merchant_label) between 2 and 200),
 category text not null check(length(btrim(category)) between 1 and 80),
 updated_at timestamptz not null default now(), primary key(user_id,merchant_key)
);
create table public.expense_category_batches (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 category text not null, request_rows jsonb not null, changes jsonb not null,
 rule_before jsonb, rule_after jsonb, created_at timestamptz not null default now(), undone_at timestamptz,
 check(jsonb_array_length(request_rows) between 1 and 500), check(octet_length(changes::text)<1000000)
);
alter table public.merchant_category_rules enable row level security;
alter table public.expense_category_batches enable row level security;
create policy owner_rules on public.merchant_category_rules for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy owner_category_batches on public.expense_category_batches for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.merchant_category_rules,public.expense_category_batches from public,anon;
grant select,insert,update,delete on public.merchant_category_rules,public.expense_category_batches to authenticated;
create index expense_category_batches_owner_date on public.expense_category_batches(user_id,created_at desc,id);

create function public.merchant_category_key(p_text text) returns text language sql immutable security invoker set search_path='' as $$
 select btrim(regexp_replace(lower(coalesce(p_text,'')), '[^a-z0-9]+', ' ', 'g'));
$$;
create function public.change_expense_categories(p_id uuid,p_rows jsonb,p_category text,p_remember boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); e public.expenses%rowtype; r jsonb; before_row jsonb; after_row jsonb;
 changes jsonb:='[]'; previous public.expense_category_batches%rowtype; v_key text; v_label text;
 prior_rule jsonb; next_rule jsonb; count_rows int;
begin
 if owner_id is null then raise exception 'Sign in first' using errcode='42501';end if;
 if p_id is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid batch';end if;
 count_rows:=jsonb_array_length(p_rows); p_category:=btrim(p_category);
 if count_rows<1 or count_rows>500 or p_category is null or length(p_category) not between 1 and 80 then raise exception 'Select 1–500 expenses and a category';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_rows))<>count_rows then raise exception 'Duplicate expense selection';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text||p_id::text,0));
 select * into previous from public.expense_category_batches where id=p_id and user_id=owner_id for update;
 if found then
  if previous.request_rows<>p_rows or previous.category<>p_category then raise exception 'Batch request changed';end if;
  return jsonb_build_object('id',p_id,'count',jsonb_array_length(previous.changes),'already_saved',true,'undone',previous.undone_at is not null);
 end if;
 -- Stable locking order avoids deadlocks between overlapping batches.
 for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  select * into e from public.expenses where id=(r->>'id')::uuid and user_id=owner_id for update;
  if not found then raise exception 'Expense unavailable. Refresh and select again.';end if;
  if r->>'updated_at' is null or e.updated_at is distinct from (r->>'updated_at')::timestamptz then raise exception 'An expense changed. Refresh and select again.';end if;
  if jsonb_array_length(e.item_allocations)>0 then raise exception 'Use Split items to categorise an allocated receipt';end if;
  if p_remember then
   if v_key is null then v_key:=public.merchant_category_key(e.merchant);v_label:=e.merchant;
   elsif v_key<>public.merchant_category_key(e.merchant) then raise exception 'Remember one exact merchant at a time';end if;
   if length(v_key)<2 then raise exception 'Add a merchant before remembering a choice';end if;
  end if;
  before_row:=to_jsonb(e);
  update public.expenses set category=p_category,updated_at=clock_timestamp() where id=e.id and user_id=owner_id returning to_jsonb(expenses.*) into after_row;
  changes:=changes||jsonb_build_array(jsonb_build_object('before',before_row,'after',after_row));
 end loop;
 if p_remember then
  select to_jsonb(x.*) into prior_rule from public.merchant_category_rules x where x.user_id=owner_id and x.merchant_key=v_key for update;
  insert into public.merchant_category_rules as rules(user_id,merchant_key,merchant_label,category)
   values(owner_id,v_key,v_label,p_category)
   on conflict(user_id,merchant_key) do update set category=excluded.category,merchant_label=excluded.merchant_label,updated_at=clock_timestamp()
   returning to_jsonb(rules.*) into next_rule;
 end if;
 insert into public.expense_category_batches(id,user_id,category,request_rows,changes,rule_before,rule_after)
 values(p_id,owner_id,p_category,p_rows,changes,prior_rule,next_rule);
 return jsonb_build_object('id',p_id,'count',count_rows,'remembered',p_remember);
end $$;

create function public.undo_expense_categories(p_id uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); batch public.expense_category_batches%rowtype; change jsonb; e public.expenses%rowtype; current_rule jsonb;
begin
 if owner_id is null then raise exception 'Sign in first' using errcode='42501';end if;
 select * into batch from public.expense_category_batches where id=p_id and user_id=owner_id for update;
 if not found then raise exception 'Batch unavailable';end if;
 if batch.undone_at is not null then return 0;end if;
 for change in select value from jsonb_array_elements(batch.changes) order by value->'after'->>'id' loop
  select * into e from public.expenses where id=(change->'after'->>'id')::uuid and user_id=owner_id for update;
  if not found or to_jsonb(e)<>change->'after' then raise exception 'An expense changed since this batch. Nothing was undone; review it individually.';end if;
  update public.expenses set category=change->'before'->>'category',updated_at=clock_timestamp() where id=e.id and user_id=owner_id;
 end loop;
 if batch.rule_after is not null then
  select to_jsonb(r.*) into current_rule from public.merchant_category_rules r where r.user_id=owner_id and r.merchant_key=batch.rule_after->>'merchant_key' for update;
  if current_rule is distinct from batch.rule_after then raise exception 'The remembered choice changed. Review it before undoing this batch.';end if;
  if batch.rule_before is null then delete from public.merchant_category_rules where user_id=owner_id and merchant_key=batch.rule_after->>'merchant_key';
  else update public.merchant_category_rules set category=batch.rule_before->>'category',merchant_label=batch.rule_before->>'merchant_label',updated_at=clock_timestamp() where user_id=owner_id and merchant_key=batch.rule_after->>'merchant_key';end if;
 end if;
 update public.expense_category_batches set undone_at=clock_timestamp() where id=p_id and user_id=owner_id;
 return jsonb_array_length(batch.changes);
end $$;
revoke all on function public.merchant_category_key(text),public.change_expense_categories(uuid,jsonb,text,boolean),public.undo_expense_categories(uuid) from public,anon;
grant execute on function public.merchant_category_key(text),public.change_expense_categories(uuid,jsonb,text,boolean),public.undo_expense_categories(uuid) to authenticated;
