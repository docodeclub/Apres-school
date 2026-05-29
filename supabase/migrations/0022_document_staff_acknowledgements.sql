drop policy if exists "document_assignments_staff_update_own_acknowledgement" on public.document_assignments;
create policy "document_assignments_staff_update_own_acknowledgement" on public.document_assignments
for update using (
  exists (
    select 1
    from public.staff_records staff
    where staff.id = document_assignments.staff_record_id
      and staff.profile_id = auth.uid()
  )
) with check (
  exists (
    select 1
    from public.staff_records staff
    where staff.id = document_assignments.staff_record_id
      and staff.profile_id = auth.uid()
  )
);
