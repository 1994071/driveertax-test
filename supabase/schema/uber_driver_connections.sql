-- Server-only OAuth data. Never grant browser roles access to tokens or states.
create table public.uber_driver_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 attempt_id uuid not null,
 status text not null check(status in ('authorizing','connected','reconnect_required')),
 token_ciphertext text,
 expires_at timestamptz,
 connected_at timestamptz,
 lock_id uuid,
 lock_until timestamptz
);
create table public.uber_driver_oauth_states (
 user_id uuid primary key references auth.users(id) on delete cascade,
 state_hash text not null unique,
 attempt_id uuid not null,
 expires_at timestamptz not null
);
alter table public.uber_driver_connections enable row level security;
alter table public.uber_driver_oauth_states enable row level security;
revoke all on public.uber_driver_connections,public.uber_driver_oauth_states from public,anon,authenticated;
grant select,insert,update,delete on public.uber_driver_connections,public.uber_driver_oauth_states to service_role;
create table public.uber_driver_request_windows (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_start timestamptz not null,
 calls integer not null check(calls>0)
);
alter table public.uber_driver_request_windows enable row level security;
revoke all on public.uber_driver_request_windows from public,anon,authenticated;
grant select,insert,update,delete on public.uber_driver_request_windows to service_role;
create function public.consume_uber_request(p_user_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare bucket timestamptz:=date_trunc('minute',clock_timestamp());used integer;
begin
 if p_user_id is null then return false;end if;
 insert into public.uber_driver_request_windows(user_id,window_start,calls) values(p_user_id,bucket,1)
 on conflict(user_id) do update set window_start=excluded.window_start,
 calls=case when public.uber_driver_request_windows.window_start=excluded.window_start then public.uber_driver_request_windows.calls+1 else 1 end
 where public.uber_driver_request_windows.window_start<excluded.window_start or public.uber_driver_request_windows.calls<20 returning calls into used;
 return used is not null;
end $$;
revoke all on function public.consume_uber_request(uuid) from public,anon,authenticated;
grant execute on function public.consume_uber_request(uuid) to service_role;
-- Explicit deny policies document that browsers must use the authenticated Edge Function.
create policy uber_connections_server_only on public.uber_driver_connections for all to anon,authenticated using(false) with check(false);
create policy uber_states_server_only on public.uber_driver_oauth_states for all to anon,authenticated using(false) with check(false);
create policy uber_quota_server_only on public.uber_driver_request_windows for all to anon,authenticated using(false) with check(false);
