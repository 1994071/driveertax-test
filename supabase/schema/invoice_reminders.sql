-- Opt-in transactional reminders. Existing invoices remain off.
create table public.invoice_reminder_settings (
 invoice_id uuid primary key references public.invoices(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 recipient text not null check(length(recipient)<=180),
 updated_at timestamptz not null default now()
);
alter table public.invoice_reminder_settings enable row level security;
create policy invoice_reminder_settings_owner on public.invoice_reminder_settings for all to authenticated
 using((select auth.uid())=user_id)
 with check((select auth.uid())=user_id and exists(select 1 from public.invoices i where i.id=invoice_id and i.user_id=(select auth.uid())));
grant select,insert,update on public.invoice_reminder_settings to authenticated;
revoke all on public.invoice_reminder_settings from anon;
create function public.guard_invoice_reminder_settings() returns trigger language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;
begin
 select * into inv from public.invoices where id=new.invoice_id and user_id=new.user_id for update;
 if not found then raise exception 'Invoice not available';end if;
 if tg_op='UPDATE' and (new.invoice_id<>old.invoice_id or new.user_id<>old.user_id) then raise exception 'Reminder owner cannot change';end if;
 if new.enabled and (inv.status<>'unpaid' or inv.archived) then raise exception 'Only active unpaid invoices can have reminders';end if;
 if new.enabled and new.recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid reminder email';end if;
 new.updated_at:=now();return new;
end $$;
create trigger invoice_reminder_settings_guard before insert or update on public.invoice_reminder_settings for each row execute function public.guard_invoice_reminder_settings();
revoke all on function public.guard_invoice_reminder_settings() from public,anon;

create table public.invoice_reminder_deliveries (
 invoice_id uuid not null references public.invoices(id) on delete cascade,
 stage text not null check(stage in ('due','overdue')),
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'sending' check(status in ('sending','accepted','failed')),
 attempted_at timestamptz not null default now(),
 provider_id text,
 error text,
 primary key(invoice_id,stage)
);
alter table public.invoice_reminder_deliveries enable row level security;
create policy invoice_reminder_deliveries_owner on public.invoice_reminder_deliveries for select to authenticated using((select auth.uid())=user_id);
grant select on public.invoice_reminder_deliveries to authenticated;
revoke all on public.invoice_reminder_deliveries from anon;
create index invoice_reminder_settings_owner_idx on public.invoice_reminder_settings(user_id);
create index invoice_reminder_deliveries_owner_idx on public.invoice_reminder_deliveries(user_id);

-- Only the scheduled worker can read its authentication hash or claim deliveries.
create table public.invoice_reminder_worker (id boolean primary key default true check(id),token_hash text not null);
alter table public.invoice_reminder_worker enable row level security;
create policy invoice_reminder_worker_deny_clients on public.invoice_reminder_worker for all to anon,authenticated using(false) with check(false);
revoke all on public.invoice_reminder_worker from anon,authenticated;
grant select on public.invoice_reminder_worker to service_role;
grant all on public.invoice_reminder_settings,public.invoice_reminder_deliveries to service_role;

create function public.list_due_invoice_reminders(p_now timestamptz default now()) returns table(invoice_id uuid,user_id uuid,stage text)
language sql security invoker set search_path='' as $$
 select i.id,i.user_id,case when i.due_date=(p_now at time zone 'Europe/London')::date then 'due' else 'overdue' end
 from public.invoices i join public.invoice_reminder_settings s on s.invoice_id=i.id and s.user_id=i.user_id
 where s.enabled and i.status='unpaid' and not i.archived
 and extract(hour from p_now at time zone 'Europe/London')>=9 and extract(hour from p_now at time zone 'Europe/London')<18
 and (i.due_date=(p_now at time zone 'Europe/London')::date or i.due_date+7=(p_now at time zone 'Europe/London')::date)
 and not exists(select 1 from public.invoice_reminder_deliveries d where d.invoice_id=i.id and d.stage=case when i.due_date=(p_now at time zone 'Europe/London')::date then 'due' else 'overdue' end)
 order by i.due_date,i.id limit 5;
$$;
create function public.claim_invoice_reminder(p_invoice_id uuid,p_stage text,p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;settings public.invoice_reminder_settings%rowtype;claimed uuid;today date:=(p_now at time zone 'Europe/London')::date;
begin
 -- Match the invoice-first lock order used by payment and settings updates.
 select * into inv from public.invoices where id=p_invoice_id for update;
 if not found or inv.status<>'unpaid' or inv.archived then return null;end if;
 select * into settings from public.invoice_reminder_settings where invoice_id=inv.id and user_id=inv.user_id;
 if not found or not settings.enabled then return null;end if;
 if extract(hour from p_now at time zone 'Europe/London')<9 or extract(hour from p_now at time zone 'Europe/London')>=18 then return null;end if;
 if not ((p_stage='due' and inv.due_date=today) or (p_stage='overdue' and inv.due_date+7=today)) then return null;end if;
 insert into public.invoice_reminder_deliveries(invoice_id,stage,user_id) values(inv.id,p_stage,inv.user_id)
 on conflict do nothing returning invoice_id into claimed;
 if claimed is null then return null;end if;
 return jsonb_build_object('invoice_id',inv.id,'user_id',inv.user_id,'recipient',settings.recipient,'invoice_number',inv.invoice_number,
 'seller_name',coalesce(nullif(inv.trading_name,''),inv.seller_name),'total',inv.total,'due_date',inv.due_date,'payment_details',inv.payment_details,'stage',p_stage);
end $$;
create function public.finish_invoice_reminder(p_invoice_id uuid,p_stage text,p_provider_id text,p_error text) returns void
language sql security invoker set search_path='' as $$
 update public.invoice_reminder_deliveries set status=case when p_provider_id is not null then 'accepted' else 'failed' end,
 provider_id=left(p_provider_id,180),error=left(p_error,300) where invoice_id=p_invoice_id and stage=p_stage and status='sending';
$$;
revoke all on function public.list_due_invoice_reminders(timestamptz),public.claim_invoice_reminder(uuid,text,timestamptz),public.finish_invoice_reminder(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.list_due_invoice_reminders(timestamptz),public.claim_invoice_reminder(uuid,text,timestamptz),public.finish_invoice_reminder(uuid,text,text,text) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- Generate a scope-limited cron token inside the database. Never return it or embed it in source.
do $$declare token text:=encode(extensions.gen_random_bytes(32),'hex');begin
 perform vault.create_secret(token,'invoice_reminder_cron_token','Scope-limited invoice reminder scheduler token');
 insert into public.invoice_reminder_worker(id,token_hash) values(true,encode(extensions.digest(token,'sha256'),'hex'));
end $$;
select cron.schedule('earnavik-invoice-reminders','*/10 * * * *',$job$
 select net.http_post(url:='https://hhrhcajywexgpxrjndto.supabase.co/functions/v1/invoice-reminders',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='invoice_reminder_cron_token')),
 body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
