-- Private job documentation. Job photos never create or change financial entries.
create table public.customer_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 160),
 customer_name text not null check(length(btrim(customer_name)) between 1 and 160),
 address text not null default '' check(length(address)<=1000),
 job_date date not null default current_date,
 notes text not null default '' check(length(notes)<=4000),
 invoice_id uuid references public.invoices(id) on delete set null,
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 unique(id,user_id)
);
create index customer_jobs_owner_date on public.customer_jobs(user_id,job_date desc);
create index customer_jobs_invoice on public.customer_jobs(invoice_id) where invoice_id is not null;
create table public.job_photos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 job_id uuid not null,
 stage text not null default 'before' check(stage in ('before','after','progress')),
 note text not null default '' check(length(note)<=1000),
 storage_path text not null unique,
 byte_size integer not null check(byte_size between 1 and 1048576),
 width integer not null check(width between 1 and 1600),
 height integer not null check(height between 1 and 1600),
 ready boolean not null default false,
 created_at timestamptz not null default now(),
 foreign key(job_id,user_id) references public.customer_jobs(id,user_id) on delete cascade,
 check(storage_path=user_id::text||'/'||job_id::text||'/'||id::text||'.jpg')
);
create index job_photos_owner_job on public.job_photos(user_id,job_id,created_at);
alter table public.customer_jobs enable row level security;
alter table public.job_photos enable row level security;
revoke all on public.customer_jobs,public.job_photos from anon,authenticated;
grant select,insert on public.customer_jobs to authenticated;
grant update(title,customer_name,address,job_date,notes,invoice_id,archived) on public.customer_jobs to authenticated;
grant select,insert,delete on public.job_photos to authenticated;
grant update(stage,note,ready) on public.job_photos to authenticated;
create policy jobs_read on public.customer_jobs for select to authenticated using(user_id=(select auth.uid()));
create policy jobs_insert on public.customer_jobs for insert to authenticated with check(user_id=(select auth.uid()));
create policy jobs_update on public.customer_jobs for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy photos_read on public.job_photos for select to authenticated using(user_id=(select auth.uid()));
create policy photos_insert on public.job_photos for insert to authenticated with check(user_id=(select auth.uid()));
create policy photos_update on public.job_photos for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy photos_delete on public.job_photos for delete to authenticated using(user_id=(select auth.uid()));

create function public.guard_job_documentation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if current_user='authenticated' and exists(select 1 from storage.objects where bucket_id='job-photos' and name=old.storage_path) then raise exception 'Remove the stored photo before deleting its record';end if;
  return old;
 end if;
 if new.user_id is distinct from (select auth.uid()) then raise exception 'Sign in to your own account'; end if;
 -- Serialize reservations to enforce limits even across tabs.
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,741));
 if tg_table_name='customer_jobs' then
  if new.invoice_id is not null and not exists(select 1 from public.invoices where id=new.invoice_id and user_id=new.user_id) then
   raise exception 'Choose an invoice from your own account';
  end if;
  if tg_op='INSERT' and (select count(*) from public.customer_jobs where user_id=new.user_id)>=200 then raise exception 'Job folder limit reached (200)';end if;
 else
  if tg_op='INSERT' then
   if (select count(*) from public.job_photos where user_id=new.user_id)>=1000 then raise exception 'Photo limit reached (1,000). Remove unused photos first';end if;
   if (select count(*) from public.job_photos where job_id=new.job_id and user_id=new.user_id)>=100 then raise exception 'This job already has 100 photos';end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_job_documentation() from public,anon,authenticated;
create trigger guard_customer_jobs before insert or update on public.customer_jobs for each row execute function public.guard_job_documentation();
create trigger guard_job_photos before insert or update or delete on public.job_photos for each row execute function public.guard_job_documentation();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('job-photos','job-photos',false,1048576,array['image/jpeg']);
-- Read/delete use the owner's folder even if metadata cleanup needs to be retried.
create policy job_files_read on storage.objects for select to authenticated
 using(bucket_id='job-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy job_files_delete on storage.objects for delete to authenticated
 using(bucket_id='job-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- A file must have a quota-counted reservation in the same user's job before upload.
create policy job_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='job-photos' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.job_photos p where p.storage_path=name and p.user_id=(select auth.uid())));
