
-- Label Printing: nutrition table + premium template support

alter table public.label_products add column if not exists nutrition_info jsonb default '{}'::jsonb;
alter table public.label_products add column if not exists serving_size_g numeric;
alter table public.label_products add column if not exists servings_per_package numeric;
alter table public.label_products add column if not exists default_label_template text default 'thermal';
alter table public.label_products add column if not exists company_name_override text;
alter table public.label_products add column if not exists address_override text;
alter table public.label_products add column if not exists email_override text;
alter table public.label_products add column if not exists customer_care_override text;
alter table public.label_products add column if not exists fssai_lic_override text;

alter table public.label_print_batches add column if not exists template_used text default 'thermal';

create table if not exists public.label_company_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  company_name text,
  address text,
  email text,
  customer_care_number text,
  fssai_lic_no text,
  facebook_url text,
  instagram_url text,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.label_company_settings to authenticated;
grant all on public.label_company_settings to service_role;

alter table public.label_company_settings enable row level security;

drop policy if exists "label_company_settings_select" on public.label_company_settings;
drop policy if exists "label_company_settings_insert" on public.label_company_settings;
drop policy if exists "label_company_settings_update" on public.label_company_settings;
drop policy if exists "label_company_settings_delete" on public.label_company_settings;

create policy "label_company_settings_select" on public.label_company_settings
  for select to authenticated
  using (public.has_permission(auth.uid(), property_id, 'label_printing', 'view'));

create policy "label_company_settings_insert" on public.label_company_settings
  for insert to authenticated
  with check (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));

create policy "label_company_settings_update" on public.label_company_settings
  for update to authenticated
  using (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'))
  with check (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));

create policy "label_company_settings_delete" on public.label_company_settings
  for delete to authenticated
  using (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));

create trigger set_label_company_settings_updated_at
  before update on public.label_company_settings
  for each row execute function public.set_updated_at();
