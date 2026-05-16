grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter table locations enable row level security;
alter table programmes enable row level security;
alter table sessions enable row level security;
alter table session_assignments enable row level security;
alter table document_versions enable row level security;
alter table document_assignments enable row level security;
alter table audit_log enable row level security;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "locations_read_authenticated" on locations for select using (auth.uid() is not null);
create policy "programmes_read_authenticated" on programmes for select using (auth.uid() is not null);
create policy "sessions_read_authenticated" on sessions for select using (auth.uid() is not null);
create policy "session_assignments_read_authenticated" on session_assignments for select using (auth.uid() is not null);
create policy "document_versions_read_authenticated" on document_versions for select using (auth.uid() is not null);
create policy "document_assignments_read_authenticated" on document_assignments for select using (auth.uid() is not null);

create policy "audit_log_admin_read" on audit_log for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

create policy "audit_log_admin_insert" on audit_log for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'superadmin'))
);

