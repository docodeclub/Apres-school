grant select, update on public.staff_records to authenticated;
grant select, insert, update on public.staff_pay_details to authenticated;

drop policy if exists "staff_pay_details_admin_all" on public.staff_pay_details;
create policy "staff_pay_details_admin_all" on public.staff_pay_details for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "staff_pay_details_staff_read_own" on public.staff_pay_details;
create policy "staff_pay_details_staff_read_own" on public.staff_pay_details for select using (
  exists (
    select 1
    from public.staff_records sr
    where sr.id = staff_pay_details.staff_record_id
      and sr.profile_id = auth.uid()
  )
);
