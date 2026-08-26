-- Managers submit and view their own expenses, but do not see other employees'
-- claims or receipts. Admin has payroll visibility; Superadmin owns decisions.
create or replace function public.can_access_employee_expense(target_staff_record_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_profile_active() and (
    public.current_user_owns_staff_record(target_staff_record_id)
    or public.current_user_app_role() in ('admin','superadmin')
  )
$$;
grant execute on function public.can_access_employee_expense(uuid) to authenticated;
