-- Per-driver file fingerprints warn on duplicates; an explicit override permits another save.
alter table public.receipts add column if not exists content_sha256 text;
alter table public.receipts add column if not exists save_request_id uuid;
create unique index if not exists receipts_user_save_request_unique
  on public.receipts (user_id, save_request_id) where save_request_id is not null;
drop index if exists public.receipts_user_content_sha256_unique;
create index if not exists receipts_user_content_sha256_idx
  on public.receipts (user_id, content_sha256) where content_sha256 is not null;

-- Both inserts are one transaction. Serialize saves of the same file per driver.
create or replace function public.save_scanned_receipt(p_receipt jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  driver_id uuid := auth.uid();
  expense_id uuid;
  file_hash text := p_receipt->>'content_sha256';
  receipt_path text := p_receipt->>'file_path';
  request_id uuid := (p_receipt->>'save_request_id')::uuid;
  receipt_amount numeric := (p_receipt->>'amount')::numeric;
begin
  if driver_id is null then
    raise exception 'Sign in before saving a receipt' using errcode = '42501';
  end if;
  if file_hash is null or file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt fingerprint' using errcode = '22023';
  end if;
  if receipt_path is null or receipt_path not like driver_id::text || '/%' then
    raise exception 'Invalid receipt file owner' using errcode = '42501';
  end if;
  if request_id is null then
    raise exception 'Missing receipt save request' using errcode = '22023';
  end if;
  if receipt_amount is null or receipt_amount <= 0 then
    raise exception 'Enter a positive receipt amount' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(driver_id::text || file_hash, 0));
  select r.expense_id into expense_id from public.receipts r where r.user_id = driver_id and r.save_request_id = request_id;
  if expense_id is not null then return expense_id; end if;
  if not coalesce((p_receipt->>'duplicate_override')::boolean, false)
     and exists (select 1 from public.receipts where user_id = driver_id and content_sha256 = file_hash) then
    raise exception 'receipt_duplicate';
  end if;
  insert into public.expenses (user_id, category, amount, merchant, expense_date, notes, receipt_attached)
  values (driver_id, coalesce(nullif(p_receipt->>'category',''),'Other'), receipt_amount,
    coalesce(nullif(p_receipt->>'merchant',''),'Receipt'), (p_receipt->>'date')::date, 'Receipt scan', true)
  returning id into expense_id;

  insert into public.receipts (user_id, expense_id, file_path, content_sha256, save_request_id, original_filename,
    mime_type, size_bytes, ai_status, extracted_merchant, extracted_date, extracted_amount,
    extracted_vat, suggested_category, driver_confirmed)
  values (driver_id, expense_id, receipt_path, file_hash, request_id, p_receipt->>'original_filename',
    p_receipt->>'mime_type', (p_receipt->>'size_bytes')::bigint,
    case when (p_receipt->>'ai_completed')::boolean then 'completed' else 'failed' end,
    coalesce(nullif(p_receipt->>'merchant',''),'Receipt'), (p_receipt->>'date')::date,
    receipt_amount, (p_receipt->>'vat')::numeric, coalesce(nullif(p_receipt->>'category',''),'Other'), true);
  return expense_id;
end;
$$;
revoke all on function public.save_scanned_receipt(jsonb) from public, anon;
grant execute on function public.save_scanned_receipt(jsonb) to authenticated;
