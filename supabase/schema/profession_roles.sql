-- Additive schema change: existing users keep their work types and expense preferences.
alter table public.profiles add column if not exists profession_roles jsonb not null default '[]'::jsonb
  constraint profiles_profession_roles_array check (jsonb_typeof(profession_roles) = 'array' and jsonb_array_length(profession_roles) <= 10);
comment on column public.profiles.profession_roles is 'Bookkeeping preferences only: selected profession id, label, category and custom flag. Never used for authorization or automatic tax eligibility.';
-- Existing profiles ownership policies apply to this column; no new grants or policies.
