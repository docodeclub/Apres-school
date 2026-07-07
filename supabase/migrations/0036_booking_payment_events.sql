create table if not exists booking_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'ponchopay',
  provider_event_id text not null,
  event_type text not null,
  booking_id text,
  invoice_id text,
  payment_id text,
  provider_reference text,
  amount numeric(10,2),
  currency text not null default 'GBP',
  signature_status text not null,
  processing_status text not null default 'received',
  raw_payload_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  source_path text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists booking_payment_events_provider_idx
  on booking_payment_events (provider, event_type, received_at desc);

create index if not exists booking_payment_events_booking_idx
  on booking_payment_events (booking_id, received_at desc);

create index if not exists booking_payment_events_invoice_idx
  on booking_payment_events (invoice_id, received_at desc);

alter table booking_payment_events enable row level security;

grant all privileges on booking_payment_events to service_role;
grant select on booking_payment_events to authenticated;

drop policy if exists "Admins can read booking payment events" on booking_payment_events;
create policy "Admins can read booking payment events"
  on booking_payment_events
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

