create table if not exists public.document_chase_events (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  recipient_staff_record_ids uuid[] not null default '{}'::uuid[],
  recipient_count integer not null default 0,
  channel text not null default 'manual',
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_chase_events_document_idx
  on public.document_chase_events (document_version_id, created_at desc);

create index if not exists document_chase_events_actor_idx
  on public.document_chase_events (actor_id, created_at desc);

alter table public.document_chase_events enable row level security;

grant select, insert on public.document_chase_events to authenticated;

drop policy if exists "document_chase_events_admin_read" on public.document_chase_events;
create policy "document_chase_events_admin_read"
  on public.document_chase_events
  for select
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('admin', 'superadmin')
    )
  );

drop policy if exists "document_chase_events_admin_insert" on public.document_chase_events;
create policy "document_chase_events_admin_insert"
  on public.document_chase_events
  for insert
  with check (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('admin', 'superadmin')
    )
  );
