create table if not exists public.migration_health_review_items (
  id uuid primary key default gen_random_uuid(),
  external_source text not null,
  external_parent_id text not null,
  external_child_id text not null,
  parent_name text,
  parent_email text,
  child_name text not null,
  item_type text not null,
  item_name text not null,
  expiry_date date,
  status text not null default 'awaiting_import',
  detail text,
  recommended_action text,
  source_batch text,
  imported_child_profile_id uuid references public.child_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint migration_health_review_status_check check (
    status in ('awaiting_import', 'parent_update_required', 'parent_contacted', 'resolved')
  ),
  constraint migration_health_review_source_identity_unique unique (
    external_source,
    external_child_id,
    item_type,
    item_name
  )
);

alter table public.migration_health_review_items enable row level security;

drop policy if exists "migration_health_review_admin_read" on public.migration_health_review_items;
create policy "migration_health_review_admin_read"
  on public.migration_health_review_items
  for select
  to authenticated
  using (public.current_user_app_role() in ('admin', 'superadmin'));

grant select on public.migration_health_review_items to authenticated;
grant all privileges on public.migration_health_review_items to service_role;

create index if not exists migration_health_review_status_expiry_idx
  on public.migration_health_review_items (status, expiry_date);

comment on table public.migration_health_review_items is
  'Protected admin review queue for safety-critical issues found during external family migrations.';
