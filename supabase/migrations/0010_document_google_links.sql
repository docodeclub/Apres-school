alter table public.document_versions
  add column if not exists source_url text;

grant select, update on public.document_versions to authenticated;

drop policy if exists "document_versions_admin_update" on public.document_versions;
create policy "document_versions_admin_update" on public.document_versions for update using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);
