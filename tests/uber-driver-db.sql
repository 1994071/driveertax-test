begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();n integer;
begin
 insert into auth.users(id) values(a),(b);
 insert into public.uber_driver_connections(user_id,attempt_id,status) values(a,gen_random_uuid(),'authorizing');
 insert into public.uber_driver_oauth_states(user_id,state_hash,attempt_id,expires_at) values(a,'fixture-hash-'||a,gen_random_uuid(),now()+interval '10 minutes');
 if has_table_privilege('authenticated','public.uber_driver_connections','select') or has_table_privilege('anon','public.uber_driver_oauth_states','select') or has_function_privilege('authenticated','public.consume_uber_request(uuid)','execute') then raise exception 'Browser access to OAuth internals';end if;
 if exists(select 1 from pg_class where oid in ('public.uber_driver_connections'::regclass,'public.uber_driver_oauth_states'::regclass,'public.uber_driver_request_windows'::regclass) and not relrowsecurity) then raise exception 'Missing RLS';end if;
 if not has_table_privilege('service_role','public.uber_driver_connections','update') then raise exception 'Service unavailable';end if;
 for n in 1..20 loop if not public.consume_uber_request(a) then raise exception 'Quota blocked too early';end if;end loop;
 if public.consume_uber_request(a) then raise exception 'Quota not enforced';end if;
 if not public.consume_uber_request(b) then raise exception 'Quota not isolated';end if;
 delete from auth.users where id=a;
 if exists(select 1 from public.uber_driver_connections where user_id=a) or exists(select 1 from public.uber_driver_oauth_states where user_id=a) or exists(select 1 from public.uber_driver_request_windows where user_id=a) then raise exception 'Deletion did not cascade';end if;
end $$;
rollback;
