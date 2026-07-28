-- Employees may only read their own published employment documents. Unsent drafts
-- remain private to HR even though they are stored under the employee's folder.

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
      public.current_user_app_role() <> 'staff'
      or target_status in ('awaiting_signature','signed','declined','superseded','expired')
    )
$$;
grant execute on function public.employee_document_row_visible(uuid,text,text) to authenticated;

drop policy if exists "employee documents scoped read" on public.employee_documents;
create policy "employee documents scoped read" on public.employee_documents for select using (
  deleted_at is null
  and public.employee_document_row_visible(
    staff_record_id,
    (select t.sensitivity from public.employee_document_types t where t.id=document_type_id),
    status
  )
);

drop policy if exists "employee signatures scoped read" on public.employee_document_signatures;
create policy "employee signatures scoped read" on public.employee_document_signatures for select using (
  exists(
    select 1
    from public.employee_documents d
    join public.employee_document_types t on t.id=d.document_type_id
    where d.id=document_id
      and d.deleted_at is null
      and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
  )
);

drop policy if exists "employee events scoped read" on public.employee_document_events;
create policy "employee events scoped read" on public.employee_document_events for select using (
  exists(
    select 1
    from public.employee_documents d
    join public.employee_document_types t on t.id=d.document_type_id
    where d.id=document_id
      and d.deleted_at is null
      and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
  )
);

drop policy if exists "employee events scoped insert" on public.employee_document_events;
create policy "employee events scoped insert" on public.employee_document_events for insert with check (
  actor_id=auth.uid()
  and exists(
    select 1
    from public.employee_documents d
    join public.employee_document_types t on t.id=d.document_type_id
    where d.id=document_id
      and d.deleted_at is null
      and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
  )
);

drop policy if exists "employment terms scoped read" on public.employment_terms_history;
create policy "employment terms scoped read" on public.employment_terms_history for select using (
  public.employee_document_staff_in_scope(staff_record_id)
  and (public.current_user_app_role() in ('admin','superadmin') or term_key not in ('salary','hourly_rate'))
  and (
    public.current_user_app_role() <> 'staff'
    or exists(
      select 1
      from public.employee_documents d
      join public.employee_document_types t on t.id=d.document_type_id
      where d.id=source_document_id
        and d.deleted_at is null
        and public.employee_document_row_visible(d.staff_record_id,t.sensitivity,d.status)
    )
  )
);

-- The edge function records view/download events after authorising the document.
-- Removing direct RPC execution avoids a second, less controlled event path.
revoke execute on function public.employee_document_record_event(uuid,text,text,jsonb) from authenticated;

create or replace function public.employee_document_storage_object_visible(object_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when public.current_user_app_role() <> 'staff' then false
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
