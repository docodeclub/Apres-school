create table if not exists public.parent_password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0,
  requested_ip text,
  created_at timestamptz not null default now()
);

create index if not exists parent_password_reset_codes_email_idx
  on public.parent_password_reset_codes (lower(email), created_at desc);

create index if not exists parent_password_reset_codes_expires_idx
  on public.parent_password_reset_codes (expires_at);

alter table public.parent_password_reset_codes enable row level security;

grant select, insert, update, delete on public.parent_password_reset_codes to service_role;
