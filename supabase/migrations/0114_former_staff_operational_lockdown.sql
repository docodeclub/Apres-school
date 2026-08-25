-- Former employees keep a document-only account. This restrictive policy is
-- deliberately applied across every RLS-protected operational table so older
-- permissive role policies cannot accidentally preserve manager/admin access.

do $$
declare
  target record;
begin
  for target in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname not in (
        'profiles',
        'hr_file_categories',
        'staff_hr_files',
        'employee_document_types',
        'employee_documents',
        'employee_document_signatures',
        'employee_document_events'
      )
  loop
    execute format('drop policy if exists %I on public.%I',
      'Former staff document-only restriction', target.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not public.current_user_is_former_staff()) with check (not public.current_user_is_former_staff())',
      'Former staff document-only restriction', target.relname
    );
  end loop;
end
$$;

-- A former employee must still be able to read their own access status during
-- sign-in, but may not use a preserved admin role to inspect other profiles.
drop policy if exists "Former staff own profile only" on public.profiles;
create policy "Former staff own profile only"
  on public.profiles
  as restrictive
  for all
  to authenticated
  using (not public.current_user_is_former_staff() or id = auth.uid())
  with check (not public.current_user_is_former_staff() or id = auth.uid());

-- Published employment documents remain readable by former employees. Treat
-- them like staff for publication-state filtering even though their app role is
-- intentionally null while inactive.
create or replace function public.employee_document_row_visible(
  target_staff_record_id uuid,
  target_sensitivity text,
  target_status text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.employee_document_can_read(target_staff_record_id,target_sensitivity)
    and (
      public.current_user_is_former_staff()
      or public.current_user_app_role() = 'staff'
    )
    and target_status in ('awaiting_signature','signed','declined','superseded','expired')
    or (
      public.employee_document_can_read(target_staff_record_id,target_sensitivity)
      and public.current_user_app_role() in ('manager','admin','superadmin')
    )
$$;
grant execute on function public.employee_document_row_visible(uuid,text,text) to authenticated;

-- Former employees may read existing signatures and audit history attached to
-- their documents, but cannot sign or append events after employment ends.
drop policy if exists "employee signatures own insert" on public.employee_document_signatures;
create policy "employee signatures own insert"
  on public.employee_document_signatures
  for insert
  with check (
    public.current_user_profile_active()
    and signer_profile_id = auth.uid()
    and exists (
      select 1 from public.staff_records sr
      where sr.id = signer_staff_record_id and sr.profile_id = auth.uid()
    )
  );

drop policy if exists "employee events scoped insert" on public.employee_document_events;
create policy "employee events scoped insert"
  on public.employee_document_events
  for insert
  with check (
    public.current_user_profile_active()
    and actor_id = auth.uid()
    and exists (
      select 1
      from public.employee_documents d
      join public.employee_document_types t on t.id = d.document_type_id
      where d.id = document_id
        and d.deleted_at is null
        and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
    )
  );

