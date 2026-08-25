-- Managers are employees too. Permit staff and managers to create signed links
-- only for files stored beneath their own staff-record folder. Admin access is
-- handled by the separate admin storage policy.

create or replace function public.employee_document_storage_object_visible(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when public.current_user_app_role() not in ('staff','manager') then false
    when split_part(object_name,'/',1) <> public.current_user_staff_record_id()::text then false
    when split_part(object_name,'/',2) <> 'employee-documents' then true
    else exists(
      select 1
      from public.employee_documents d
      join public.employee_document_types t on t.id=d.document_type_id
      where d.staff_record_id=public.current_user_staff_record_id()
        and d.lineage_id::text=split_part(object_name,'/',3)
        and d.deleted_at is null
        and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
    )
  end
$$;
grant execute on function public.employee_document_storage_object_visible(text) to authenticated;

drop policy if exists "staff_hr_files_storage_staff_select_own" on storage.objects;
create policy "staff_hr_files_storage_staff_select_own" on storage.objects for select using (
  bucket_id='staff-hr-files'
  and public.employee_document_storage_object_visible(name)
);
