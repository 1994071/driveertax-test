-- Isolated fixture data; run within BEGIN ... ROLLBACK.
create temporary table category_actors(a uuid,b uuid);
insert into category_actors values(gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select a,a::text||'@example.test' from category_actors union all select b,b::text||'@example.test' from category_actors;
grant select on category_actors to authenticated;
select set_config('request.jwt.claim.sub',(select a::text from category_actors),true);
set local role authenticated;
do $test$
declare d uuid:=auth.uid();a uuid;b uuid;split uuid;req uuid:=gen_random_uuid();rows jsonb;res jsonb;t timestamptz;rule_time timestamptz;
begin
 insert into public.expenses(user_id,category,amount,expense_date,merchant,tax_treatment,business_percent) values(d,'Other',45,current_date,'Shell Cannock','review',75) returning id into a;
 insert into public.expenses(user_id,category,amount,expense_date,merchant,tax_treatment) values(d,'Travel',60,current_date,'SHELL Cannock','allowable') returning id into b;
 select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id) into rows from public.expenses where id in(a,b);
 res:=public.change_expense_categories(req,rows,'Fuel',true);
 if (res->>'count')::int<>2 or (select count(*) from public.expenses where id in(a,b) and category='Fuel')<>2 then raise exception 'Batch failed';end if;
 if not (public.change_expense_categories(req,rows,'Fuel',true)->>'already_saved')::boolean then raise exception 'Retry not idempotent';end if;
 if (select amount<>45 or tax_treatment<>'review' or business_percent<>75 from public.expenses where id=a) then raise exception 'Financial data changed';end if;
 if (select category from public.merchant_category_rules where user_id=d and merchant_key='shell cannock')<>'Fuel' then raise exception 'Rule not saved';end if;
 if public.undo_expense_categories(req)<>2 or public.undo_expense_categories(req)<>0 then raise exception 'Undo retry failed';end if;
 if exists(select 1 from public.merchant_category_rules where user_id=d) then raise exception 'Undo left remembered rule';end if;
 if (select category from public.expenses where id=b)<>'Travel' then raise exception 'Prior category not restored';end if;
 -- A stale row aborts the entire batch, including earlier updates.
 begin perform public.change_expense_categories(gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',a,'updated_at','2000-01-01T00:00:00Z')),'Insurance',false);raise exception 'Stale row accepted';exception when others then if sqlerrm not like 'An expense changed.%' then raise;end if;end;
 select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id) into rows from public.expenses where id in(a,b);req:=gen_random_uuid();
 perform public.change_expense_categories(req,rows,'Fuel',true);
 update public.expenses set notes='Later edit',updated_at=clock_timestamp() where id=b;
 begin perform public.undo_expense_categories(req);raise exception 'Later edit overwritten';exception when others then if sqlerrm not like 'An expense changed since this batch.%' then raise;end if;end;
 if (select count(*) from public.expenses where id in(a,b) and category='Fuel')<>2 then raise exception 'Undo partially applied';end if;
 -- Selection cannot refer to another owner.
 begin perform public.change_expense_categories(gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'updated_at',now())),'Fuel',false);raise exception 'Unknown row accepted';exception when others then if sqlerrm not like 'Expense unavailable.%' then raise;end if;end;
 insert into public.expenses(user_id,category,amount,expense_date,merchant,item_allocations) values(d,'Other',5,current_date,'Shop','[{"description":"Item","category":"Other","amount":5,"tax_treatment":"review","business_percent":100}]') returning id into split;
 select jsonb_build_array(jsonb_build_object('id',id,'updated_at',updated_at)) into rows from public.expenses where id=split;
 begin perform public.change_expense_categories(gen_random_uuid(),rows,'Fuel',false);raise exception 'Split receipt accepted';exception when others then if sqlerrm<>'Use Split items to categorise an allocated receipt' then raise;end if;end;
 select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id) into rows from public.expenses where id=a;
 begin perform public.change_expense_categories(gen_random_uuid(),rows,' ',false);raise exception 'Empty category accepted';exception when others then if sqlerrm<>'Select 1–500 expenses and a category' then raise;end if;end;
 if public.merchant_category_key('  SHELL-Cannock  ')<>'shell cannock' then raise exception 'Merchant normalisation mismatch';end if;
end $test$;
select set_config('request.jwt.claim.sub',(select b::text from category_actors),true);
do $test$
begin
 if exists(select 1 from public.merchant_category_rules) or exists(select 1 from public.expense_category_batches) then raise exception 'Cross-account read';end if;
 begin insert into public.merchant_category_rules(user_id,merchant_key,merchant_label,category) select a,'shell','Shell','Fuel' from category_actors;raise exception 'Cross-account write';exception when insufficient_privilege then null;end;
end $test$;
reset role;
