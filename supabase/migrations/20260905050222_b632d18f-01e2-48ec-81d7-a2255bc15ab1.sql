create table public.pincode_directory (
  id uuid primary key default gen_random_uuid(),
  pincode text not null,
  office_name text,
  district text,
  city text,
  state text,
  created_at timestamptz not null default now()
);

create index idx_pincode_directory_city on public.pincode_directory (lower(city));
create index idx_pincode_directory_pincode on public.pincode_directory (pincode);

grant select on public.pincode_directory to authenticated;
grant select on public.pincode_directory to anon;
grant all on public.pincode_directory to service_role;

alter table public.pincode_directory enable row level security;

create policy "pincode_directory_read_all"
  on public.pincode_directory for select
  using (true);