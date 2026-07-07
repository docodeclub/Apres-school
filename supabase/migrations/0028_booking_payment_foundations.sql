create table if not exists booking_invoices (
  id text primary key,
  booking_id text,
  parent_id uuid references profiles(id) on delete set null,
  parent_email text,
  provider_payment_id text,
  provider_reference text,
  total_amount numeric(10,2) not null default 0,
  paid_amount numeric(10,2) not null default 0,
  refunded_amount numeric(10,2) not null default 0,
  balance numeric(10,2) not null default 0,
  currency text not null default 'GBP',
  payment_status text not null default 'pending',
  parent_portal_status text not null default 'Outstanding',
  receipt_status text not null default 'not_issued',
  finance_status text not null default 'awaiting_payment',
  last_webhook_event_id uuid,
  last_provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ponchopay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  payment_id text,
  booking_id text,
  invoice_id text,
  provider_reference text,
  amount numeric(10,2),
  expected_amount numeric(10,2),
  currency text not null default 'GBP',
  signature_status text not null default 'unverified',
  processing_status text not null default 'received',
  processing_outcome text,
  raw_payload_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  source_path text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists booking_receipts (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null references booking_invoices(id) on delete cascade,
  provider_event_id text not null unique,
  payment_id text,
  provider_reference text,
  receipt_number text not null unique,
  amount numeric(10,2) not null default 0,
  currency text not null default 'GBP',
  delivery_status text not null default 'pending_email',
  metadata jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ponchopay_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null unique references booking_invoices(id) on delete cascade,
  booking_id text,
  parent_id uuid references profiles(id) on delete set null,
  parent_email text,
  provider_payment_id text,
  provider_checkout_url text,
  provider_reference text,
  amount numeric(10,2) not null default 0,
  currency text not null default 'GBP',
  payment_method text not null default 'card',
  payment_plan text not null default 'pay_now',
  status text not null default 'created',
  request_payload jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  error_message text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table booking_invoices
    add constraint booking_invoices_last_webhook_event_fkey
    foreign key (last_webhook_event_id) references ponchopay_webhook_events(id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists booking_invoices_parent_idx
  on booking_invoices (parent_id, created_at desc);
create index if not exists booking_invoices_parent_email_idx
  on booking_invoices (lower(parent_email), created_at desc);
create index if not exists booking_invoices_booking_idx
  on booking_invoices (booking_id);
create index if not exists booking_invoices_status_idx
  on booking_invoices (payment_status, finance_status, created_at desc);

create index if not exists ponchopay_webhook_events_status_idx
  on ponchopay_webhook_events (signature_status, processing_status, received_at);
create index if not exists ponchopay_webhook_events_invoice_idx
  on ponchopay_webhook_events (invoice_id, received_at desc);
create index if not exists ponchopay_webhook_events_payment_idx
  on ponchopay_webhook_events (payment_id, received_at desc);

create index if not exists booking_receipts_invoice_idx
  on booking_receipts (invoice_id, issued_at desc);

create index if not exists ponchopay_checkout_sessions_parent_idx
  on ponchopay_checkout_sessions (parent_id, created_at desc);
create index if not exists ponchopay_checkout_sessions_reference_idx
  on ponchopay_checkout_sessions (provider_reference);
create index if not exists ponchopay_checkout_sessions_payment_idx
  on ponchopay_checkout_sessions (provider_payment_id);

alter table booking_invoices enable row level security;
alter table ponchopay_webhook_events enable row level security;
alter table booking_receipts enable row level security;
alter table ponchopay_checkout_sessions enable row level security;

grant all privileges on booking_invoices to service_role;
grant all privileges on ponchopay_webhook_events to service_role;
grant all privileges on booking_receipts to service_role;
grant all privileges on ponchopay_checkout_sessions to service_role;

grant select on booking_invoices to authenticated;
grant select on booking_receipts to authenticated;
grant select on ponchopay_checkout_sessions to authenticated;
grant select on ponchopay_webhook_events to authenticated;

drop policy if exists "Parents can read own booking invoices" on booking_invoices;
create policy "Parents can read own booking invoices"
  on booking_invoices
  for select
  using (
    parent_id = auth.uid()
    or exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and lower(profiles.email) = lower(coalesce(booking_invoices.parent_email, ''))
        and profiles.active = true
    )
  );

drop policy if exists "Admins can manage booking invoices" on booking_invoices;
create policy "Admins can manage booking invoices"
  on booking_invoices
  for all
  using (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  )
  with check (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Parents can read own booking receipts" on booking_receipts;
create policy "Parents can read own booking receipts"
  on booking_receipts
  for select
  using (
    exists (
      select 1
      from booking_invoices
      where booking_invoices.id = booking_receipts.invoice_id
        and (
          booking_invoices.parent_id = auth.uid()
          or exists (
            select 1
            from profiles
            where profiles.id = auth.uid()
              and lower(profiles.email) = lower(coalesce(booking_invoices.parent_email, ''))
              and profiles.active = true
          )
        )
    )
  );

drop policy if exists "Admins can read booking receipts" on booking_receipts;
create policy "Admins can read booking receipts"
  on booking_receipts
  for select
  using (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Parents can read own PonchoPay checkout sessions" on ponchopay_checkout_sessions;
create policy "Parents can read own PonchoPay checkout sessions"
  on ponchopay_checkout_sessions
  for select
  using (
    parent_id = auth.uid()
    or exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and lower(profiles.email) = lower(coalesce(ponchopay_checkout_sessions.parent_email, ''))
        and profiles.active = true
    )
  );

drop policy if exists "Admins can read PonchoPay checkout sessions" on ponchopay_checkout_sessions;
create policy "Admins can read PonchoPay checkout sessions"
  on ponchopay_checkout_sessions
  for select
  using (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );

drop policy if exists "Admins can read PonchoPay webhook events" on ponchopay_webhook_events;
create policy "Admins can read PonchoPay webhook events"
  on ponchopay_webhook_events
  for select
  using (
    exists (
      select 1
      from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'superadmin')
        and profiles.active = true
    )
  );
