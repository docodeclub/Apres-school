create sequence if not exists public.finance_invoice_number_seq start 1;
create sequence if not exists public.finance_credit_note_number_seq start 1;

create table if not exists public.finance_permissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null check (permission in ('finance_admin', 'finance_viewer')),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  unique (profile_id, permission)
);

create or replace function public.current_user_has_finance_access(required_permission text default 'finance_viewer')
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active = true
      and (
        profile.role = 'superadmin'
        or (
          profile.role = 'admin'
          and exists (
            select 1
            from public.finance_permissions permission
            where permission.profile_id = profile.id
              and (
                permission.permission = 'finance_admin'
                or (required_permission = 'finance_viewer' and permission.permission = 'finance_viewer')
              )
          )
        )
      )
  )
$$;

create table if not exists public.finance_customers (
  id uuid primary key default gen_random_uuid(),
  linked_location_id uuid references public.locations(id),
  customer_name text not null,
  accounts_contact text,
  accounts_email text,
  telephone text,
  billing_address text,
  payment_terms_days integer not null default 14,
  default_purchase_order text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_settings (
  id boolean primary key default true,
  company_name text not null default 'APRÈS SCHOOL LIMITED',
  registered_address text,
  company_number text,
  vat_status text not null default 'not_registered' check (vat_status in ('not_registered', 'registered', 'exempt')),
  vat_number text,
  default_payment_terms_days integer not null default 14,
  invoice_prefix text not null default 'AS-INV-',
  credit_note_prefix text not null default 'AS-CN-',
  finance_email text not null default 'hello@apres-school.co.uk',
  finance_telephone text,
  default_invoice_footer text,
  default_email_subject text not null default 'Invoice {InvoiceNumber} from Après School',
  default_email_body text not null default 'Dear {Contact},

Please find attached invoice {InvoiceNumber}.

Payment is requested by {DueDate}.

Please pay by BACS using the invoice number as the payment reference.

Kind regards,

Après School',
  bank_account_name text not null default 'Après School Limited',
  bank_sort_code text not null default '04-00-03',
  bank_account_number text not null default '21773814',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint finance_settings_singleton check (id)
);

insert into public.finance_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.finance_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.finance_customers(id),
  linked_location_id uuid references public.locations(id),
  invoice_number text unique,
  draft_reference text not null default ('DRAFT-' || substr(gen_random_uuid()::text, 1, 8)),
  invoice_date date not null default current_date,
  due_date date not null default (current_date + interval '14 days')::date,
  payment_terms_days integer not null default 14,
  purchase_order text,
  reference text,
  notes text,
  internal_notes text,
  service_period_start date,
  service_period_end date,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'sent', 'viewed', 'part_paid', 'paid', 'overdue', 'void', 'credited')),
  subtotal numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  sent_by uuid references public.profiles(id),
  voided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  voided_at timestamptz
);

create table if not exists public.finance_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  line_order integer not null default 1,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit text not null default 'Fixed Fee' check (unit in ('Hours', 'Days', 'Sessions', 'Staff', 'Fixed Fee', 'Items')),
  unit_price numeric(12,2) not null default 0,
  vat_rate text not null default 'No VAT' check (vat_rate in ('No VAT', 'Exempt', 'Zero Rated', 'Standard Rated')),
  vat_percent numeric(5,2) not null default 0,
  net_total numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  gross_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_invoice_emails (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  recipient text not null,
  cc text,
  bcc text,
  subject text not null,
  body text not null,
  provider_message_id text,
  status text not null default 'sent',
  sent_by uuid references public.profiles(id),
  sent_at timestamptz default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  notes text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  reversal_reason text
);

create table if not exists public.finance_credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_invoices(id),
  credit_note_number text unique,
  credit_date date not null default current_date,
  reason text,
  subtotal numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'void')),
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  sent_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz
);

create table if not exists public.finance_credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.finance_credit_notes(id) on delete cascade,
  invoice_line_id uuid references public.finance_invoice_lines(id),
  line_order integer not null default 1,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit text not null default 'Fixed Fee',
  unit_price numeric(12,2) not null default 0,
  vat_rate text not null default 'No VAT',
  vat_percent numeric(5,2) not null default 0,
  net_total numeric(12,2) not null default 0,
  vat_total numeric(12,2) not null default 0,
  gross_total numeric(12,2) not null default 0
);

create table if not exists public.finance_audit_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.finance_invoices(id) on delete cascade,
  customer_id uuid references public.finance_customers(id),
  credit_note_id uuid references public.finance_credit_notes(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_customers_name_idx on public.finance_customers (customer_name);
create index if not exists finance_invoices_customer_idx on public.finance_invoices (customer_id, invoice_date desc);
create index if not exists finance_invoices_status_idx on public.finance_invoices (status, due_date);
create index if not exists finance_invoice_lines_invoice_idx on public.finance_invoice_lines (invoice_id, line_order);
create index if not exists finance_payments_invoice_idx on public.finance_payments (invoice_id, payment_date desc);
create index if not exists finance_audit_invoice_idx on public.finance_audit_events (invoice_id, created_at desc);

create or replace function public.finance_next_invoice_number()
returns text
language sql
security definer
set search_path = public
as $$
  select (select invoice_prefix from public.finance_settings where id = true)
    || lpad(nextval('public.finance_invoice_number_seq')::text, 5, '0')
$$;

create or replace function public.finance_next_credit_note_number()
returns text
language sql
security definer
set search_path = public
as $$
  select (select credit_note_prefix from public.finance_settings where id = true)
    || lpad(nextval('public.finance_credit_note_number_seq')::text, 5, '0')
$$;

create or replace function public.finance_recalculate_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(12,2);
  v_vat numeric(12,2);
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  select
    coalesce(sum(net_total), 0),
    coalesce(sum(vat_total), 0),
    coalesce(sum(gross_total), 0)
  into v_subtotal, v_vat, v_total
  from public.finance_invoice_lines
  where invoice_id = p_invoice_id;

  select coalesce(sum(amount), 0)
  into v_paid
  from public.finance_payments
  where invoice_id = p_invoice_id
    and reversed_at is null;

  update public.finance_invoices
  set subtotal = v_subtotal,
      vat_total = v_vat,
      total = v_total,
      amount_paid = v_paid,
      balance_due = greatest(v_total - v_paid, 0),
      status = case
        when status in ('draft', 'submitted', 'approved', 'sent', 'viewed', 'part_paid', 'paid', 'overdue')
          and v_total > 0 and v_paid >= v_total then 'paid'
        when status in ('sent', 'viewed', 'part_paid', 'paid', 'overdue')
          and v_paid > 0 and v_paid < v_total then 'part_paid'
        when status in ('sent', 'viewed', 'part_paid', 'paid', 'overdue')
          and due_date < current_date and v_paid < v_total then 'overdue'
        else status
      end,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

alter table public.finance_permissions enable row level security;
alter table public.finance_customers enable row level security;
alter table public.finance_settings enable row level security;
alter table public.finance_invoices enable row level security;
alter table public.finance_invoice_lines enable row level security;
alter table public.finance_invoice_emails enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_credit_notes enable row level security;
alter table public.finance_credit_note_lines enable row level security;
alter table public.finance_audit_events enable row level security;

grant select, insert, update on public.finance_permissions to authenticated;
grant select, insert, update on public.finance_customers to authenticated;
grant select, insert, update on public.finance_settings to authenticated;
grant select, insert, update on public.finance_invoices to authenticated;
grant select, insert, update, delete on public.finance_invoice_lines to authenticated;
grant select, insert on public.finance_invoice_emails to authenticated;
grant select, insert, update on public.finance_payments to authenticated;
grant select, insert, update on public.finance_credit_notes to authenticated;
grant select, insert, update, delete on public.finance_credit_note_lines to authenticated;
grant select, insert on public.finance_audit_events to authenticated;
grant all privileges on all tables in schema public to service_role;
grant usage, select on public.finance_invoice_number_seq to authenticated, service_role;
grant usage, select on public.finance_credit_note_number_seq to authenticated, service_role;
grant execute on function public.current_user_has_finance_access(text) to authenticated, service_role;
grant execute on function public.finance_next_invoice_number() to authenticated, service_role;
grant execute on function public.finance_next_credit_note_number() to authenticated, service_role;
grant execute on function public.finance_recalculate_invoice(uuid) to authenticated, service_role;

drop policy if exists "finance_permissions_superadmin" on public.finance_permissions;
create policy "finance_permissions_superadmin" on public.finance_permissions for all using (
  public.current_user_app_role() = 'superadmin'
) with check (
  public.current_user_app_role() = 'superadmin'
);

drop policy if exists "finance_read_access_customers" on public.finance_customers;
create policy "finance_read_access_customers" on public.finance_customers for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_customers" on public.finance_customers;
create policy "finance_admin_write_customers" on public.finance_customers for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_settings" on public.finance_settings;
create policy "finance_read_access_settings" on public.finance_settings for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_settings" on public.finance_settings;
create policy "finance_admin_write_settings" on public.finance_settings for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_invoices" on public.finance_invoices;
create policy "finance_read_access_invoices" on public.finance_invoices for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_invoices" on public.finance_invoices;
create policy "finance_admin_write_invoices" on public.finance_invoices for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_invoice_lines" on public.finance_invoice_lines;
create policy "finance_read_access_invoice_lines" on public.finance_invoice_lines for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_invoice_lines" on public.finance_invoice_lines;
create policy "finance_admin_write_invoice_lines" on public.finance_invoice_lines for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_emails" on public.finance_invoice_emails;
create policy "finance_read_access_emails" on public.finance_invoice_emails for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_insert_emails" on public.finance_invoice_emails;
create policy "finance_admin_insert_emails" on public.finance_invoice_emails for insert with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_payments" on public.finance_payments;
create policy "finance_read_access_payments" on public.finance_payments for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_payments" on public.finance_payments;
create policy "finance_admin_write_payments" on public.finance_payments for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_credit_notes" on public.finance_credit_notes;
create policy "finance_read_access_credit_notes" on public.finance_credit_notes for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_credit_notes" on public.finance_credit_notes;
create policy "finance_admin_write_credit_notes" on public.finance_credit_notes for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_credit_note_lines" on public.finance_credit_note_lines;
create policy "finance_read_access_credit_note_lines" on public.finance_credit_note_lines for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_write_credit_note_lines" on public.finance_credit_note_lines;
create policy "finance_admin_write_credit_note_lines" on public.finance_credit_note_lines for all using (
  public.current_user_has_finance_access('finance_admin')
) with check (
  public.current_user_has_finance_access('finance_admin')
);

drop policy if exists "finance_read_access_audit" on public.finance_audit_events;
create policy "finance_read_access_audit" on public.finance_audit_events for select using (
  public.current_user_has_finance_access('finance_viewer')
);
drop policy if exists "finance_admin_insert_audit" on public.finance_audit_events;
create policy "finance_admin_insert_audit" on public.finance_audit_events for insert with check (
  public.current_user_has_finance_access('finance_admin')
);
