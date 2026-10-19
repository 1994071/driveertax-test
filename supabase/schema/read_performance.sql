-- Preserve the owner predicate; evaluate the current account once per statement.
alter policy "Users can view own period entries" on public.period_entries to authenticated using((select auth.uid())=user_id);
alter policy "Users can insert own period entries" on public.period_entries to authenticated with check((select auth.uid())=user_id);
alter policy "Users can update own period entries" on public.period_entries to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
alter policy "Users can delete own period entries" on public.period_entries to authenticated using((select auth.uid())=user_id);
alter policy "Users can view own recurring expenses" on public.recurring_expenses to authenticated using((select auth.uid())=user_id);
alter policy "Users can insert own recurring expenses" on public.recurring_expenses to authenticated with check((select auth.uid())=user_id);
alter policy "Users can update own recurring expenses" on public.recurring_expenses to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
alter policy "Users can delete own recurring expenses" on public.recurring_expenses to authenticated using((select auth.uid())=user_id);
alter policy tax_profiles_select_own on public.tax_profiles using((select auth.uid())=user_id);
alter policy tax_profiles_insert_own on public.tax_profiles with check((select auth.uid())=user_id);
alter policy tax_profiles_update_own on public.tax_profiles using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
alter policy tax_profiles_delete_own on public.tax_profiles using((select auth.uid())=user_id);
create index if not exists bank_import_rows_batch_owner on public.bank_import_rows(batch_id,user_id);
