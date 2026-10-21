create table public.bank_pdf_request_windows(user_id uuid primary key references auth.users(id) on delete cascade,window_start timestamptz not null,calls integer not null check(calls>0));
alter table public.bank_pdf_request_windows enable row level security;
revoke all on public.bank_pdf_request_windows from public,anon,authenticated;
grant select,insert,update,delete on public.bank_pdf_request_windows to service_role;
create policy bank_pdf_server_only on public.bank_pdf_request_windows for all to anon,authenticated using(false) with check(false);
create function public.consume_bank_pdf_request(p_user_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare bucket timestamptz:=date_trunc('minute',clock_timestamp());used integer;
begin
 if p_user_id is null then return false;end if;
 insert into public.bank_pdf_request_windows(user_id,window_start,calls) values(p_user_id,bucket,1)
 on conflict(user_id) do update set window_start=excluded.window_start,calls=case when public.bank_pdf_request_windows.window_start=excluded.window_start then public.bank_pdf_request_windows.calls+1 else 1 end
 where public.bank_pdf_request_windows.window_start<excluded.window_start or public.bank_pdf_request_windows.calls<3 returning calls into used;
 return used is not null;
end $$;
revoke all on function public.consume_bank_pdf_request(uuid) from public,anon,authenticated;
grant execute on function public.consume_bank_pdf_request(uuid) to service_role;
