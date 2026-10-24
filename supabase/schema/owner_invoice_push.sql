-- Device-scoped owner notifications, independent of customer email consent.
create table public.owner_push_config(id boolean primary key default true check(id),public_key text not null,private_key text not null);
create table public.owner_push_devices(
 endpoint_hash text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null,binding uuid not null,enabled boolean not null default true,sound boolean not null default true,
 updated_at timestamptz not null default now()
);
create index owner_push_devices_user on public.owner_push_devices(user_id);
create table public.owner_push_deliveries(
 endpoint_hash text not null references public.owner_push_devices(endpoint_hash) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,day date not null,
 status text not null default 'sending' check(status in ('sending','accepted','failed')),
 attempted_at timestamptz not null default now(),primary key(endpoint_hash,user_id,day)
);
create index owner_push_deliveries_user on public.owner_push_deliveries(user_id);
alter table public.owner_push_config enable row level security;
alter table public.owner_push_devices enable row level security;
alter table public.owner_push_deliveries enable row level security;
create policy owner_push_config_no_clients on public.owner_push_config for all to anon,authenticated using(false) with check(false);
create policy owner_push_devices_no_clients on public.owner_push_devices for all to anon,authenticated using(false) with check(false);
create policy owner_push_deliveries_no_clients on public.owner_push_deliveries for all to anon,authenticated using(false) with check(false);
revoke all on public.owner_push_config,public.owner_push_devices,public.owner_push_deliveries from public,anon,authenticated;
grant all on public.owner_push_config,public.owner_push_devices,public.owner_push_deliveries to service_role;
-- Push delivery is free; this shared limiter bounds network calls and abuse.
insert into public.paid_api_limits(service,user_minute,user_day,global_minute,global_day,enabled) values('owner_push',3,20,60,1000,true);
create function public.list_owner_invoice_push(p_now timestamptz default now()) returns table(endpoint_hash text,user_id uuid)
language sql security invoker set search_path='' as $$
 select d.endpoint_hash,d.user_id from public.owner_push_devices d
 where d.enabled and extract(hour from p_now at time zone 'Europe/London')>=9 and extract(hour from p_now at time zone 'Europe/London')<18
 and exists(select 1 from public.invoices i where i.user_id=d.user_id and i.status='unpaid' and not i.archived and i.due_date<=(p_now at time zone 'Europe/London')::date)
 and not exists(select 1 from public.owner_push_deliveries l where l.endpoint_hash=d.endpoint_hash and l.user_id=d.user_id and l.day=(p_now at time zone 'Europe/London')::date)
 order by d.updated_at limit 10;
$$;
create function public.claim_owner_invoice_push(p_hash text,p_user_id uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare device public.owner_push_devices%rowtype;today date:=(p_now at time zone 'Europe/London')::date;due bigint;overdue bigint;claimed text;
begin
 select * into device from public.owner_push_devices where endpoint_hash=p_hash and user_id=p_user_id for update;
 if not found or not device.enabled then return null;end if;
 if extract(hour from p_now at time zone 'Europe/London')<9 or extract(hour from p_now at time zone 'Europe/London')>=18 then return null;end if;
 select count(*) filter(where due_date=today),count(*) filter(where due_date<today) into due,overdue
 from public.invoices where user_id=device.user_id and status='unpaid' and not archived and due_date<=today;
 if due+overdue=0 then return null;end if;
 insert into public.owner_push_deliveries(endpoint_hash,user_id,day) values(p_hash,p_user_id,today) on conflict do nothing returning endpoint_hash into claimed;
 if claimed is null then return null;end if;
 return jsonb_build_object('subscription',device.subscription,'binding',device.binding,'user_id',device.user_id,'sound',device.sound,'due',due,'overdue',overdue,'day',today);
end $$;
revoke all on function public.list_owner_invoice_push(timestamptz),public.claim_owner_invoice_push(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.list_owner_invoice_push(timestamptz),public.claim_owner_invoice_push(text,uuid,timestamptz) to service_role;
select cron.schedule('earnavik-owner-invoice-push','*/10 * * * *',$job$
 select net.http_post(url:='https://hhrhcajywexgpxrjndto.supabase.co/functions/v1/owner-invoice-push',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='invoice_reminder_cron_token')),
 body:='{"action":"run_daily"}'::jsonb,timeout_milliseconds:=120000);
$job$);
