do $$ begin
  alter type app_role add value if not exists 'parent';
exception when duplicate_object then null;
end $$;

do $$ begin
  create type booking_status as enum (
    'draft',
    'reserved',
    'confirmed',
    'payment_pending',
    'payment_plan_active',
    'waitlist',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type booking_item_status as enum (
    'reserved',
    'confirmed',
    'waitlist',
    'cancelled',
    'attended',
    'no_show'
  );
exception when duplicate_object then null;
end $$;

create table if not exists parent_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references profiles(id) on delete set null,
  full_name text not null,
  email text not null unique,
  phone text,
  billing_address jsonb not null default '{}'::jsonb,
  emergency_contact jsonb not null default '{}'::jsonb,
  marketing_preferences jsonb not null default '{}'::jsonb,
  portal_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists child_profiles (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references parent_accounts(id) on delete cascade,
  full_name text not null,
  preferred_name text,
  date_of_birth date,
  school_name text,
  year_group text,
  medical_notes text,
  allergy_notes text,
  dietary_notes text,
  authorised_collectors jsonb not null default '[]'::jsonb,
  consents jsonb not null default '{}'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sessions
  add column if not exists booking_label text,
  add column if not exists parent_bookable boolean not null default false,
  add column if not exists price numeric(10,2) not null default 0,
  add column if not exists payment_route text not null default 'ponchopay_card_voucher',
  add column if not exists cancellation_hours integer not null default 24,
  add column if not exists amendment_hours integer not null default 24,
  add column if not exists booking_cutoff_hours integer not null default 0,
  add column if not exists eligibility jsonb not null default '{}'::jsonb,
  add column if not exists booking_metadata jsonb not null default '{}'::jsonb;

create table if not exists session_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price numeric(10,2) not null default 0,
  capacity integer,
  parent_bookable boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, label, starts_at, ends_at)
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid references parent_accounts(id) on delete set null,
  parent_id uuid references profiles(id) on delete set null,
  parent_email text,
  parent_name text,
  status booking_status not null default 'draft',
  source text not null default 'parent_portal',
  booking_reference text not null unique default ('APR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  invoice_id text references booking_invoices(id) on delete set null,
  payment_method text not null default 'card',
  payment_plan text not null default 'pay_now',
  payment_route text not null default 'ponchopay_card_voucher',
  total_amount numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  due_today numeric(10,2) not null default 0,
  outstanding_balance numeric(10,2) not null default 0,
  cancellation_deadline timestamptz,
  amendment_deadline timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  child_id uuid references child_profiles(id) on delete set null,
  session_id uuid not null references sessions(id),
  session_block_id uuid references session_blocks(id),
  child_name text,
  site_name text,
  programme_name text,
  session_label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  quantity integer not null default 1,
  unit_amount numeric(10,2) not null default 0,
  line_total numeric(10,2) generated always as (quantity * unit_amount) stored,
  status booking_item_status not null default 'reserved',
  capacity_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_capacity_holds (
  id uuid primary key default gen_random_uuid(),
  booking_item_id uuid not null unique references booking_items(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  session_block_id uuid references session_blocks(id) on delete cascade,
  child_id uuid references child_profiles(id) on delete set null,
  quantity integer not null default 1,
  status text not null default 'held',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists parent_accounts_email_idx on parent_accounts (lower(email));
create index if not exists child_profiles_parent_idx on child_profiles (parent_account_id);
create index if not exists session_blocks_session_idx on session_blocks (session_id, starts_at);
create index if not exists bookings_parent_account_idx on bookings (parent_account_id, created_at desc);
create index if not exists bookings_parent_email_idx on bookings (lower(parent_email), created_at desc);
create index if not exists bookings_status_idx on bookings (status, created_at desc);
create index if not exists booking_items_booking_idx on booking_items (booking_id);
create index if not exists booking_items_session_idx on booking_items (session_id, starts_at);
create index if not exists booking_capacity_holds_session_idx
  on booking_capacity_holds (session_id, session_block_id, status);

alter table parent_accounts enable row level security;
alter table child_profiles enable row level security;
alter table session_blocks enable row level security;
alter table bookings enable row level security;
alter table booking_items enable row level security;
alter table booking_capacity_holds enable row level security;

grant all privileges on parent_accounts to service_role;
grant all privileges on child_profiles to service_role;
grant all privileges on session_blocks to service_role;
grant all privileges on bookings to service_role;
grant all privileges on booking_items to service_role;
grant all privileges on booking_capacity_holds to service_role;

grant select, insert, update on parent_accounts to authenticated;
grant select, insert, update on child_profiles to authenticated;
grant select on session_blocks to authenticated;
grant select, insert, update on bookings to authenticated;
grant select, insert, update on booking_items to authenticated;
grant select on booking_capacity_holds to authenticated;

drop policy if exists "Parents can read own parent account" on parent_accounts;
create policy "Parents can read own parent account"
  on parent_accounts for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and lower(profiles.email) = lower(parent_accounts.email)
        and profiles.active = true
    )
  );

drop policy if exists "Parents can create own parent account" on parent_accounts;
create policy "Parents can create own parent account"
  on parent_accounts for insert
  with check (
    profile_id = auth.uid()
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and lower(profiles.email) = lower(parent_accounts.email)
        and profiles.active = true
    )
  );

drop policy if exists "Parents can update own parent account" on parent_accounts;
create policy "Parents can update own parent account"
  on parent_accounts for update
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and lower(profiles.email) = lower(parent_accounts.email)
        and profiles.active = true
    )
  )
  with check (
    profile_id = auth.uid()
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and lower(profiles.email) = lower(parent_accounts.email)
        and profiles.active = true
    )
  );

drop policy if exists "Admins can manage parent accounts" on parent_accounts;
create policy "Admins can manage parent accounts"
  on parent_accounts for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Parents can read own children" on child_profiles;
create policy "Parents can read own children"
  on child_profiles for select
  using (
    exists (
      select 1 from parent_accounts
      where parent_accounts.id = child_profiles.parent_account_id
        and (
          parent_accounts.profile_id = auth.uid()
          or exists (
            select 1 from profiles
            where profiles.id = auth.uid()
              and lower(profiles.email) = lower(parent_accounts.email)
              and profiles.active = true
          )
        )
    )
  );

drop policy if exists "Parents can manage own children" on child_profiles;
create policy "Parents can manage own children"
  on child_profiles for all
  using (
    exists (
      select 1 from parent_accounts
      where parent_accounts.id = child_profiles.parent_account_id
        and parent_accounts.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from parent_accounts
      where parent_accounts.id = child_profiles.parent_account_id
        and parent_accounts.profile_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage children" on child_profiles;
create policy "Admins can manage children"
  on child_profiles for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Session blocks readable by authenticated users" on session_blocks;
create policy "Session blocks readable by authenticated users"
  on session_blocks for select
  using (auth.uid() is not null and parent_bookable = true);

drop policy if exists "Admins can manage session blocks" on session_blocks;
create policy "Admins can manage session blocks"
  on session_blocks for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Parents can read own bookings" on bookings;
create policy "Parents can read own bookings"
  on bookings for select
  using (
    parent_id = auth.uid()
    or exists (
      select 1 from parent_accounts
      where parent_accounts.id = bookings.parent_account_id
        and (
          parent_accounts.profile_id = auth.uid()
          or lower(parent_accounts.email) = lower(coalesce(bookings.parent_email, ''))
        )
    )
  );

drop policy if exists "Parents can create own bookings" on bookings;
create policy "Parents can create own bookings"
  on bookings for insert
  with check (
    parent_id = auth.uid()
    or exists (
      select 1 from parent_accounts
      where parent_accounts.id = bookings.parent_account_id
        and parent_accounts.profile_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage bookings" on bookings;
create policy "Admins can manage bookings"
  on bookings for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Parents can read own booking items" on booking_items;
create policy "Parents can read own booking items"
  on booking_items for select
  using (
    exists (
      select 1 from bookings
      where bookings.id = booking_items.booking_id
        and (
          bookings.parent_id = auth.uid()
          or exists (
            select 1 from parent_accounts
            where parent_accounts.id = bookings.parent_account_id
              and parent_accounts.profile_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "Parents can create own booking items" on booking_items;
create policy "Parents can create own booking items"
  on booking_items for insert
  with check (
    exists (
      select 1 from bookings
      where bookings.id = booking_items.booking_id
        and bookings.parent_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage booking items" on booking_items;
create policy "Admins can manage booking items"
  on booking_items for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  )
  with check (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Capacity holds readable by admins" on booking_capacity_holds;
create policy "Capacity holds readable by admins"
  on booking_capacity_holds for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );
