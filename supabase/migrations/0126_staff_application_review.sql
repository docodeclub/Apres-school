alter table public.staff_applications
  add column if not exists admin_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

create or replace function public.review_staff_application(
  p_application_id uuid,
  p_status text,
  p_admin_note text default null
)
returns public.staff_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_application public.staff_applications;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role not in ('admin', 'superadmin') then
    raise exception 'Only an active Admin or Superadmin can review staff applications.';
  end if;

  if p_status not in ('new', 'reviewing', 'shortlisted', 'rejected', 'hired', 'withdrawn') then
    raise exception 'Invalid application status.';
  end if;

  update public.staff_applications
  set status = p_status,
      admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  where id = p_application_id
  returning * into v_application;

  if v_application.id is null then
    raise exception 'Staff application not found.';
  end if;

  insert into public.audit_log(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'staff_application_reviewed',
    'staff_applications',
    v_application.id,
    jsonb_build_object('status', p_status)
  );

  return v_application;
end;
$$;

revoke all on function public.review_staff_application(uuid, text, text) from public, anon;
grant execute on function public.review_staff_application(uuid, text, text) to authenticated;
