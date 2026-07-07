create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  recipient_name text,
  email_type text not null,
  subject text not null,
  status text not null default 'queued',
  provider text not null default 'resend',
  provider_message_id text,
  error_message text,
  sent_by uuid references public.profiles(id),
  staff_record_id uuid references public.staff_records(id) on delete set null,
  enquiry_id uuid references public.enquiries(id) on delete set null,
  cover_move_id uuid references public.cover_moves(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_recipient_idx
  on public.email_logs (recipient_email, created_at desc);

create index if not exists email_logs_type_status_idx
  on public.email_logs (email_type, status, created_at desc);

create index if not exists email_logs_staff_idx
  on public.email_logs (staff_record_id, created_at desc)
  where staff_record_id is not null;

create index if not exists email_logs_enquiry_idx
  on public.email_logs (enquiry_id, created_at desc)
  where enquiry_id is not null;

create index if not exists email_logs_cover_move_idx
  on public.email_logs (cover_move_id, created_at desc)
  where cover_move_id is not null;

alter table public.email_logs enable row level security;

grant select, insert on public.email_logs to authenticated;

drop policy if exists "email_logs_admin_read" on public.email_logs;
create policy "email_logs_admin_read"
  on public.email_logs
  for select
  using (
    public.current_user_app_role() in ('admin', 'superadmin')
  );

drop policy if exists "email_logs_staff_read_own_recipient" on public.email_logs;
create policy "email_logs_staff_read_own_recipient"
  on public.email_logs
  for select
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) = lower(email_logs.recipient_email)
  );

drop policy if exists "email_logs_admin_insert" on public.email_logs;
create policy "email_logs_admin_insert"
  on public.email_logs
  for insert
  with check (
    public.current_user_app_role() in ('admin', 'superadmin')
  );
