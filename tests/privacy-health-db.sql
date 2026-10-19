begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where not exists(select 1 from public.account_deletion_requests r where r.user_id=auth.users.id and cancelled_at is null and completed_at is null) order by created_at limit 1),true);
set local role authenticated;
do $test$
declare actor uuid:=auth.uid();request uuid;other uuid:=gen_random_uuid();
begin
 if actor is null then raise exception 'No eligible test actor';end if;
 insert into public.account_deletion_requests(user_id) values(actor) returning id into request;
 begin insert into public.account_deletion_requests(user_id) values(actor);raise exception 'Duplicate request allowed';exception when unique_violation then null;end;
 begin insert into public.account_deletion_requests(user_id) values(other);raise exception 'Other owner allowed';exception when insufficient_privilege then null;end;
 begin update public.account_deletion_requests set user_id=other where id=request;raise exception 'Owner reassignment allowed';exception when insufficient_privilege then null;end;
 begin update public.account_deletion_requests set processing_at=now() where id=request;raise exception 'Client processed request';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',other::text,true);
 if exists(select 1 from public.account_deletion_requests where id=request) then raise exception 'Other owner read request';end if;
 update public.account_deletion_requests set cancelled_at=now() where id=request;
 if found then raise exception 'Other owner cancelled request';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 update public.account_deletion_requests set cancelled_at=now() where id=request;
 if not found then raise exception 'Owner cancellation failed';end if;
 insert into public.account_deletion_requests(user_id) values(actor);
 begin perform public.record_app_health(actor,'runtime_error');raise exception 'Client wrote operational counter';exception when insufficient_privilege then null;end;
 begin perform public.claim_app_health_alert('runtime_error');raise exception 'Client claimed operator alert';exception when insufficient_privilege then null;end;
end $test$;
reset role;
set local role service_role;
do $test$
declare actor uuid:=auth.uid();before_count integer;after_count integer;
begin
 before_count:=public.record_app_health(actor,'runtime_error');after_count:=public.record_app_health(actor,'runtime_error');
 if after_count<>before_count+1 then raise exception 'Counter did not increment';end if;
 if not public.consume_api_request(actor,'app_health') then raise exception 'First quota request failed';end if;
 perform public.claim_app_health_alert('runtime_error');
 if public.claim_app_health_alert('runtime_error') then raise exception 'Duplicate operator email permitted';end if;
 begin perform public.record_app_health(actor,'private message');raise exception 'Arbitrary content allowed';exception when check_violation then null;end;
end $test$;
rollback;
