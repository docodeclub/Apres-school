drop policy if exists "Managers can read staff applications" on public.staff_applications;
drop policy if exists "Admins can read staff applications" on public.staff_applications;

create policy "Admins can read staff applications"
  on public.staff_applications for select to authenticated
  using (exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('admin', 'superadmin')
  ));
