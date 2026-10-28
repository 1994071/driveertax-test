-- Opt-in daily bookkeeping reminders, independent of invoice delivery history.
alter table public.owner_push_devices
 add column bookkeeping_enabled boolean not null default false,
 add column bookkeeping_time time not null default '20:00',
 add constraint owner_push_bookkeeping_time_step check(extract(second from bookkeeping_time)=0 and mod(extract(minute from bookkeeping_time)::int,10)=0);
create table public.owner_bookkeeping_push_deliveries(
 endpoint_hash text not null references public.owner_push_devices(endpoint_hash) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,day date not null,
 status text not null default 'sending' check(status in ('sending','accepted','failed')),
 attempted_at timestamptz not null default now(),primary key(endpoint_hash,user_id,day)
);
create index owner_bookkeeping_push_deliveries_user on public.owner_bookkeeping_push_deliveries(user_id);
alter table public.owner_bookkeeping_push_deliveries enable row level security;
revoke all on public.owner_bookkeeping_push_deliveries from public,anon,authenticated;
grant all on public.owner_bookkeeping_push_deliveries to service_role;
create policy owner_bookkeeping_push_no_clients on public.owner_bookkeeping_push_deliveries for all to anon,authenticated using(false) with check(false);
create function public.list_owner_bookkeeping_push(p_now timestamptz default now()) returns table(endpoint_hash text,user_id uuid)
language sql security invoker set search_path='' as $$
 select d.endpoint_hash,d.user_id from public.owner_push_devices d
 where d.enabled and d.bookkeeping_enabled
 and (p_now at time zone 'Europe/London')::time>=d.bookkeeping_time
 and not exists(select 1 from public.owner_bookkeeping_push_deliveries l where l.endpoint_hash=d.endpoint_hash and l.user_id=d.user_id and l.day=(p_now at time zone 'Europe/London')::date)
 order by d.updated_at limit 10;
$$;
create function public.claim_owner_bookkeeping_push(p_hash text,p_user_id uuid,p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare device public.owner_push_devices%rowtype;today date:=(p_now at time zone 'Europe/London')::date;claimed text;
begin
 select * into device from public.owner_push_devices where endpoint_hash=p_hash and user_id=p_user_id for update;
 if not found or not device.enabled or not device.bookkeeping_enabled then return null;end if;
 if (p_now at time zone 'Europe/London')::time<device.bookkeeping_time then return null;end if;
 insert into public.owner_bookkeeping_push_deliveries(endpoint_hash,user_id,day) values(p_hash,p_user_id,today) on conflict do nothing returning endpoint_hash into claimed;
 if claimed is null then return null;end if;
 return jsonb_build_object('subscription',device.subscription,'binding',device.binding,'user_id',device.user_id,'sound',device.sound,'day',today);
end $$;
revoke all on function public.list_owner_bookkeeping_push(timestamptz),public.claim_owner_bookkeeping_push(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.list_owner_bookkeeping_push(timestamptz),public.claim_owner_bookkeeping_push(text,uuid,timestamptz) to service_role;
select cron.schedule('earnavik-owner-bookkeeping-push','*/10 * * * *',$job$
 select net.http_post(url:='https://hhrhcajywexgpxrjndto.supabase.co/functions/v1/owner-invoice-push',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='invoice_reminder_cron_token')),
 body:='{"action":"run_bookkeeping"}'::jsonb,timeout_milliseconds:=120000);
$job$);
