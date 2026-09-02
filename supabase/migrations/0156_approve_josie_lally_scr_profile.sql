-- Admin confirmations supplied on 2 September 2026 complete Josie Lally's
-- core SCR checklist. First aid is accurately recorded as not held and is not
-- a universal requirement for this bank/camp role.

do $$
declare
  v_staff_record_id uuid := '142028ff-167d-4ddd-96e4-03e01902967f';
  v_approved_at timestamptz := now();
  v_checklist jsonb;
begin
  select coalesce(admin_review -> 'checklist', '{}'::jsonb)
  into v_checklist
  from public.scr_checks
  where staff_record_id = v_staff_record_id;

  if v_checklist is null
    or not coalesce((v_checklist ->> 'rightToWork')::boolean, false)
    or not coalesce((v_checklist ->> 'identity')::boolean, false)
    or not coalesce((v_checklist ->> 'dbs')::boolean, false)
    or not coalesce((v_checklist ->> 'barredList')::boolean, false)
    or not coalesce((v_checklist ->> 'safeguarding')::boolean, false)
    or not coalesce((v_checklist ->> 'allergy')::boolean, false)
    or not coalesce((v_checklist ->> 'references')::boolean, false)
    or not coalesce((v_checklist ->> 'declarations')::boolean, false)
  then
    raise exception 'Josie Lally core SCR checks are not complete';
  end if;

  v_checklist := v_checklist || jsonb_build_object(
    'approvedAt', v_approved_at,
    'approvedBy', 'Luke Currie',
    'updatedAt', v_approved_at
  );

  update public.scr_checks
  set
    admin_review = coalesce(admin_review, '{}'::jsonb) || jsonb_build_object(
      'status', 'Compliant',
      'checklist', v_checklist,
      'approvedAt', v_approved_at,
      'approvedBy', 'Luke Currie',
      'updatedAt', v_approved_at
    ),
    updated_at = v_approved_at
  where staff_record_id = v_staff_record_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    null,
    'scr_profile_approved',
    'scr_checks',
    v_staff_record_id,
    jsonb_build_object(
      'approvedAt', v_approved_at,
      'approvedBy', 'Luke Currie',
      'firstAidStatus', 'Not held — role/location requirement managed separately'
    )
  );
end;
$$;
