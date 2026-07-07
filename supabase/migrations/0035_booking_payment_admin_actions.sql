create table if not exists booking_payment_admin_actions (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null references booking_invoices(id) on delete cascade,
  booking_id text,
  action text not null,
  status text not null default 'queued',
  actor_id uuid references profiles(id) on delete set null,
  actor_email text,
  actor_role text,
  parent_email text,
  provider_reference text,
  message_log_id uuid references email_logs(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_payment_admin_actions_action_check
    check (action in ('resend_payment_link', 'resend_receipt', 'mark_finance_review')),
  constraint booking_payment_admin_actions_status_check
    check (status in ('queued', 'sent', 'review_required', 'completed', 'failed'))
);

create index if not exists booking_payment_admin_actions_invoice_idx
  on booking_payment_admin_actions (invoice_id, created_at desc);

create index if not exists booking_payment_admin_actions_booking_idx
  on booking_payment_admin_actions (booking_id, created_at desc)
  where booking_id is not null;

create index if not exists booking_payment_admin_actions_action_idx
  on booking_payment_admin_actions (action, status, created_at desc);

alter table booking_payment_admin_actions enable row level security;

grant all privileges on booking_payment_admin_actions to service_role;
grant select on booking_payment_admin_actions to authenticated;

drop policy if exists "Admins can read booking payment admin actions" on booking_payment_admin_actions;
create policy "Admins can read booking payment admin actions"
  on booking_payment_admin_actions
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

drop policy if exists "Parents can read own booking payment admin actions" on booking_payment_admin_actions;
create policy "Parents can read own booking payment admin actions"
  on booking_payment_admin_actions
  for select
  using (
    exists (
      select 1
      from booking_invoices
      where booking_invoices.id = booking_payment_admin_actions.invoice_id
        and (
          booking_invoices.parent_id = auth.uid()
          or exists (
            select 1
            from profiles
            where profiles.id = auth.uid()
              and profiles.email = booking_invoices.parent_email
              and profiles.active = true
          )
        )
    )
  );
