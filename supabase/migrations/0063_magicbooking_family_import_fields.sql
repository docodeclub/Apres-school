alter table public.parent_accounts
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists registered_centres jsonb not null default '[]'::jsonb,
  add column if not exists migration_metadata jsonb not null default '{}'::jsonb;

alter table public.child_profiles
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists migration_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists parent_accounts_external_identity_idx
  on public.parent_accounts (external_source, external_id)
  where external_source is not null and external_id is not null;

create unique index if not exists child_profiles_external_identity_idx
  on public.child_profiles (external_source, external_id)
  where external_source is not null and external_id is not null;

do $$ begin
  alter table public.parent_accounts
    add constraint parent_accounts_registered_centres_array_check
    check (jsonb_typeof(registered_centres) = 'array');
exception when duplicate_object then null;
end $$;

comment on column public.parent_accounts.external_source is
  'Originating system for a migrated account, for example magicbooking.';
comment on column public.parent_accounts.external_id is
  'Stable source-system identifier used to make imports repeat-safe.';
comment on column public.parent_accounts.registered_centres is
  'Canonical booking centres associated with the family. This is separate from each child''s school.';
comment on column public.parent_accounts.migration_metadata is
  'Import batch, review status and source-quality information. Do not store passwords or provider secrets.';
comment on column public.child_profiles.external_source is
  'Originating system for a migrated child profile.';
comment on column public.child_profiles.external_id is
  'Stable source-system child identifier used to prevent duplicate imports.';
comment on column public.child_profiles.migration_metadata is
  'Parent-review requirements and source-quality information for the migrated child profile.';
