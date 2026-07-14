create table if not exists public.parent_account_holders (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references public.parent_accounts(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  full_name text,
  role text not null default 'secondary' check (role in ('primary', 'secondary')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  permissions jsonb not null default '{"book": true, "view_schedule": true, "view_invoices": true, "manage_holders": false}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.parent_account_holders
  add column if not exists profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists full_name text,
  add column if not exists role text not null default 'secondary',
  add column if not exists status text not null default 'invited',
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at timestamptz not null default now(),
  add column if not exists accepted_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists permissions jsonb not null default '{"book": true, "view_schedule": true, "view_invoices": true, "manage_holders": false}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists parent_account_holders_active_email_idx
  on public.parent_account_holders (parent_account_id, lower(email))
  where status <> 'removed';

create index if not exists parent_account_holders_profile_idx
  on public.parent_account_holders (profile_id);

create index if not exists parent_account_holders_email_idx
  on public.parent_account_holders (lower(email));

alter table public.parent_account_holders enable row level security;

grant all privileges on public.parent_account_holders to service_role;
grant select, insert, update on public.parent_account_holders to authenticated;

create or replace function public.current_profile_email()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select lower(coalesce(email, ''))
  from public.profiles
  where id = auth.uid()
    and active = true
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
      and active = true
  )
$$;

create or replace function public.parent_account_is_primary_holder(p_parent_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.parent_accounts
    where id = p_parent_account_id
      and (
        profile_id = auth.uid()
        or lower(email) = public.current_profile_email()
      )
  )
$$;

create or replace function public.parent_account_has_access(p_parent_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.parent_account_is_primary_holder(p_parent_account_id)
    or exists (
      select 1
      from public.parent_account_holders
      where parent_account_id = p_parent_account_id
        and status <> 'removed'
        and (
          profile_id = auth.uid()
          or lower(email) = public.current_profile_email()
        )
    )
$$;

drop policy if exists "Primary parent can manage linked account holders" on public.parent_account_holders;
create policy "Primary parent can manage linked account holders"
  on public.parent_account_holders
  for all
  using (public.parent_account_is_primary_holder(parent_account_id))
  with check (
    public.parent_account_is_primary_holder(parent_account_id)
    and role = 'secondary'
  );

drop policy if exists "Linked holders can read family account holders" on public.parent_account_holders;
create policy "Linked holders can read family account holders"
  on public.parent_account_holders
  for select
  using (public.parent_account_has_access(parent_account_id));

drop policy if exists "Admins can manage linked account holders" on public.parent_account_holders;
create policy "Admins can manage linked account holders"
  on public.parent_account_holders
  for all
  using (public.current_profile_is_admin())
  with check (public.current_profile_is_admin());

drop policy if exists "Linked holders can read parent account" on public.parent_accounts;
create policy "Linked holders can read parent account"
  on public.parent_accounts
  for select
  using (public.parent_account_has_access(id));

drop policy if exists "Linked holders can read children" on public.child_profiles;
create policy "Linked holders can read children"
  on public.child_profiles
  for select
  using (public.parent_account_has_access(parent_account_id));

drop policy if exists "Linked holders can read bookings" on public.bookings;
create policy "Linked holders can read bookings"
  on public.bookings
  for select
  using (public.parent_account_has_access(parent_account_id));

drop policy if exists "Linked holders can read booking items" on public.booking_items;
create policy "Linked holders can read booking items"
  on public.booking_items
  for select
  using (
    exists (
      select 1
      from public.bookings
      where bookings.id = booking_items.booking_id
        and public.parent_account_has_access(bookings.parent_account_id)
    )
  );

drop policy if exists "Linked holders can read booking invoices" on public.booking_invoices;
create policy "Linked holders can read booking invoices"
  on public.booking_invoices
  for select
  using (
    exists (
      select 1
      from public.bookings
      where bookings.invoice_id = booking_invoices.id
        and public.parent_account_has_access(bookings.parent_account_id)
    )
    or exists (
      select 1
      from public.parent_accounts
      where (
          parent_accounts.profile_id = booking_invoices.parent_id
          or lower(parent_accounts.email) = lower(coalesce(booking_invoices.parent_email, ''))
        )
        and public.parent_account_has_access(parent_accounts.id)
    )
  );

drop policy if exists "Linked holders can read booking receipts" on public.booking_receipts;
create policy "Linked holders can read booking receipts"
  on public.booking_receipts
  for select
  using (
    exists (
      select 1
      from public.booking_invoices
      where booking_invoices.id = booking_receipts.invoice_id
        and (
          exists (
            select 1
            from public.bookings
            where bookings.invoice_id = booking_invoices.id
              and public.parent_account_has_access(bookings.parent_account_id)
          )
          or exists (
            select 1
            from public.parent_accounts
            where (
                parent_accounts.profile_id = booking_invoices.parent_id
                or lower(parent_accounts.email) = lower(coalesce(booking_invoices.parent_email, ''))
              )
              and public.parent_account_has_access(parent_accounts.id)
          )
        )
    )
  );

drop policy if exists "Linked holders can read PonchoPay checkout sessions" on public.ponchopay_checkout_sessions;
create policy "Linked holders can read PonchoPay checkout sessions"
  on public.ponchopay_checkout_sessions
  for select
  using (
    exists (
      select 1
      from public.parent_accounts
      where (
          parent_accounts.profile_id = ponchopay_checkout_sessions.parent_id
          or lower(parent_accounts.email) = lower(coalesce(ponchopay_checkout_sessions.parent_email, ''))
        )
        and public.parent_account_has_access(parent_accounts.id)
    )
  );
