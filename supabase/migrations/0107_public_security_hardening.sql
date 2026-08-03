create table if not exists public.public_api_rate_limits (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (scope, subject_hash, window_started_at)
);

alter table public.public_api_rate_limits enable row level security;
revoke all on public.public_api_rate_limits from anon, authenticated;
grant all on public.public_api_rate_limits to service_role;

create or replace function public.consume_public_api_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if coalesce(p_scope, '') = '' or coalesce(p_subject_hash, '') = '' or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.public_api_rate_limits(scope, subject_hash, window_started_at, request_count, updated_at)
  values (p_scope, p_subject_hash, v_window, 1, now())
  on conflict (scope, subject_hash, window_started_at)
  do update set request_count = public.public_api_rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_count;

  delete from public.public_api_rate_limits where window_started_at < now() - interval '2 days';
  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_public_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_api_rate_limit(text, text, integer, integer) to service_role;

create table if not exists public.staff_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  date_of_birth date not null,
  address text not null,
  application_data jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'reviewing', 'shortlisted', 'rejected', 'hired', 'withdrawn')),
  source_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_applications enable row level security;
revoke all on public.staff_applications from anon, authenticated;
grant all on public.staff_applications to service_role;

create policy "Managers can read staff applications"
  on public.staff_applications for select to authenticated
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true and role in ('manager', 'admin', 'superadmin')
  ));

grant select on public.staff_applications to authenticated;

alter table public.parent_account_holders
  add column if not exists invitation_token_hash text,
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists invitation_used_at timestamptz;

create unique index if not exists parent_account_holders_invitation_token_idx
  on public.parent_account_holders (invitation_token_hash)
  where invitation_token_hash is not null and invitation_used_at is null;
