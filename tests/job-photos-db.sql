-- Fixture-only integration tests. Wrap schema and this file in BEGIN/ROLLBACK.
-- Permit deletion of metadata-only fixtures inside this rolled-back transaction.
set local storage.allow_delete_query = 'true';
create temporary table job_actors(owner_id uuid,stranger_id uuid,job_id uuid,photo_id uuid,foreign_invoice uuid);
insert into job_actors values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at) select owner_id,owner_id::text||'@example.invalid',now() from job_actors union all select stranger_id,stranger_id::text||'@example.invalid',now() from job_actors;
insert into public.invoices(id,user_id,request_id,invoice_number,seller_name,seller_address,seller_contact,customer_name,customer_address,invoice_date,supply_date,due_date,items,total,subtotal)
 select foreign_invoice,stranger_id,gen_random_uuid(),'JOB-FIXTURE','Test','Test address','test@example.invalid','Test','Test address',current_date,current_date,current_date,(public.calculate_invoice_items_v2('[{"description":"Test","quantity":1,"unit_price":1}]',false,'exclusive','none',0)->'items'),1,1 from job_actors;
grant select on job_actors to authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from job_actors),true);
set local role authenticated;
insert into public.customer_jobs(id,user_id,title,customer_name) select job_id,owner_id,'Test job','Test customer' from job_actors;
do $test$
begin
 begin update public.customer_jobs set invoice_id=(select foreign_invoice from job_actors) where id=(select job_id from job_actors);raise exception 'Cross-owner invoice accepted';exception when others then if sqlerrm not like 'Choose an invoice from your own account%' then raise;end if;end;
 begin update public.customer_jobs set user_id=(select stranger_id from job_actors);raise exception 'Owner reassignment accepted';exception when insufficient_privilege then null;end;
 begin delete from public.customer_jobs where id=(select job_id from job_actors);raise exception 'Folder deletion allowed';exception when insufficient_privilege then null;end;
end $test$;
insert into public.job_photos(id,user_id,job_id,storage_path,byte_size,width,height)
 select photo_id,owner_id,job_id,owner_id::text||'/'||job_id::text||'/'||photo_id::text||'.jpg',500,20,20 from job_actors;
-- Metadata-only storage object fixtures; no real file is created or sent.
insert into storage.objects(bucket_id,name) select 'job-photos',owner_id::text||'/'||job_id::text||'/'||photo_id::text||'.jpg' from job_actors;
do $test$
begin
 begin insert into storage.objects(bucket_id,name) values('job-photos',auth.uid()::text||'/unreserved.jpg');raise exception 'Unreserved upload accepted';exception when insufficient_privilege then null;end;
 begin delete from public.job_photos where id=(select photo_id from job_actors);raise exception 'File quota bypass accepted';exception when others then if sqlerrm not like 'Remove the stored photo%' then raise;end if;end;
 begin update public.job_photos set storage_path='forged.jpg';raise exception 'Path reassignment accepted';exception when insufficient_privilege then null;end;
end $test$;
update public.job_photos set ready=true,note='Completed work';
update public.customer_jobs set archived=true;
select set_config('request.jwt.claim.sub',(select stranger_id::text from job_actors),true);
do $test$
begin
 if exists(select 1 from public.customer_jobs) or exists(select 1 from public.job_photos) or exists(select 1 from storage.objects where bucket_id='job-photos') then raise exception 'Stranger can read private job data';end if;
 begin insert into public.job_photos(user_id,job_id,storage_path,byte_size,width,height) select stranger_id,job_id,stranger_id::text||'/'||job_id::text||'/'||gen_random_uuid()::text||'.jpg',100,10,10 from job_actors;raise exception 'Cross-owner job accepted';exception when foreign_key_violation or check_violation then null;end;
 update public.customer_jobs set title='Stolen';if found then raise exception 'Stranger edited job';end if;
 delete from public.job_photos;if found then raise exception 'Stranger deleted photo';end if;
 delete from storage.objects where bucket_id='job-photos';if found then raise exception 'Stranger deleted file';end if;
end $test$;
select set_config('request.jwt.claim.sub',(select owner_id::text from job_actors),true);
delete from storage.objects where bucket_id='job-photos';
delete from public.job_photos where user_id=auth.uid();
-- Limits are enforced on the database, not just in the browser.
insert into public.job_photos(id,user_id,job_id,storage_path,byte_size,width,height)
 select r.id,a.owner_id,a.job_id,a.owner_id::text||'/'||a.job_id::text||'/'||r.id::text||'.jpg',100,10,10
 from job_actors a cross join lateral(select gen_random_uuid() id from generate_series(1,100)) r;
do $test$
declare pid uuid:=gen_random_uuid();jid uuid:=(select job_id from job_actors);
begin
 begin insert into public.job_photos(id,user_id,job_id,storage_path,byte_size,width,height) values(pid,auth.uid(),jid,auth.uid()::text||'/'||jid::text||'/'||pid::text||'.jpg',100,10,10);raise exception 'Per-job quota bypassed';exception when others then if sqlerrm not like 'This job already has 100 photos%' then raise;end if;end;
end $test$;
reset role;
select 'Job photos owner isolation, invoice ownership, storage reservations, deletion and limits passed' as result;
