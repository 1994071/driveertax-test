begin;
do $$ begin perform set_config('request.jwt.claim.sub',(select id::text from public.profiles order by created_at limit 1),true); end $$;
set local role authenticated;
do $$
declare owner_id uuid:=auth.uid(); roles jsonb:='[{"id":"property-0","label":"Window cleaner","category":"property","custom":false},{"id":"custom-solar","label":"Solar panel cleaner","category":"property","custom":true}]'; n integer;
begin
 if owner_id is null then raise exception 'No profile available for rollback test'; end if;
 update public.profiles set profession_roles=roles where id=owner_id;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Owner update failed';end if;
 if (select profession_roles from public.profiles where id=owner_id)<>roles then raise exception 'Role round trip failed'; end if;
 begin
   update public.profiles set profession_roles='{}'::jsonb where id=owner_id;
   raise exception 'Object accepted instead of array';
 exception when check_violation then null;end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.profiles where id=owner_id) then raise exception 'Other account can read profile';end if;
 update public.profiles set profession_roles='[]' where id=owner_id;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Other account can write profile';end if;
end $$;
rollback;
