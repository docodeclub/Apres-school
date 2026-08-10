alter type public.enquiry_status add value if not exists 'responded' before 'closed';

create table if not exists public.enquiry_replies (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  recipient_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft',
  provider_message_id text,
  email_log_id uuid references public.email_logs(id) on delete set null,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_replies_enquiry_created_idx
  on public.enquiry_replies (enquiry_id, created_at desc);

alter table public.enquiry_replies enable row level security;

grant select on public.enquiry_replies to authenticated;

drop policy if exists "enquiry_replies_admin_read" on public.enquiry_replies;
create policy "enquiry_replies_admin_read"
  on public.enquiry_replies
  for select
  using (public.current_user_app_role() in ('admin', 'superadmin'));

