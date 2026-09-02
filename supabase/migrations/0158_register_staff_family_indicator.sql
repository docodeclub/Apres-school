-- Surface a minimal operational marker when a child's family belongs to an
-- active employee pricing group or the parent email matches an active employee.
-- No pricing or employment detail is exposed to the register.

drop function if exists public.staff_register_for_day(date, text, text);

create function public.staff_register_for_day(
  p_register_date date,
  p_site_name text default null,
  p_programme_name text default null
)
returns table (
  booking_item_id uuid,
  booking_id uuid,
  booking_reference text,
  booking_source text,
  booking_metadata jsonb,
  session_id uuid,
  session_block_id uuid,
  child_id uuid,
  child_name text,
  child_date_of_birth date,
  child_school_name text,
  child_year_group text,
  parent_name text,
  parent_phone text,
  parent_is_staff boolean,
  emergency_contact jsonb,
  site_name text,
  programme_name text,
  session_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  attendance_status text,
  attendance_note text,
  attendance_time timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  medical_notes text,
  allergy_notes text,
  dietary_notes text,
  care_flags jsonb,
  authorised_collectors jsonb,
  consents jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  return query
  select
    item.id,
    item.booking_id,
    booking.booking_reference,
    coalesce(booking.source, ''),
    coalesce(booking.metadata, '{}'::jsonb),
    item.session_id,
    item.session_block_id,
    item.child_id,
    coalesce(nullif(trim(child.full_name), ''), nullif(trim(item.child_name), ''), nullif(trim(child.preferred_name), ''), 'Child'),
    child.date_of_birth,
    coalesce(child.school_name, ''),
    coalesce(child.year_group, ''),
    coalesce(parent.full_name, booking.parent_name, ''),
    coalesce(parent.phone, ''),
    (
      exists (
        select 1
        from public.parent_pricing_assignments assignment
        join public.pricing_groups pricing_group on pricing_group.id = assignment.pricing_group_id
        where assignment.parent_account_id = parent.id
          and assignment.deleted_at is null
          and assignment.effective_from <= p_register_date
          and (assignment.effective_to is null or assignment.effective_to >= p_register_date)
          and pricing_group.status = 'active'
          and pricing_group.deleted_at is null
          and (lower(pricing_group.key) like '%staff%' or lower(pricing_group.name) like '%staff%')
      )
      or exists (
        select 1
        from public.staff_records staff_record
        join public.profiles staff_profile on staff_profile.id = staff_record.profile_id
        where staff_record.archived_at is null
          and staff_profile.active = true
          and lower(staff_profile.email) = lower(parent.email)
      )
    ),
    coalesce(parent.emergency_contact, '{}'::jsonb),
    item.site_name,
    item.programme_name,
    item.session_label,
    item.starts_at,
    item.ends_at,
    coalesce(entry.attendance_status, 'booked'),
    coalesce(entry.note, ''),
    coalesce(entry.checked_out_at, entry.checked_in_at, entry.updated_at),
    entry.checked_in_at,
    entry.checked_out_at,
    coalesce(child.medical_notes, ''),
    coalesce(child.allergy_notes, ''),
    coalesce(child.dietary_notes, ''),
    coalesce(child.flags, '[]'::jsonb),
    coalesce(child.authorised_collectors, '[]'::jsonb),
    coalesce(child.consents, '{}'::jsonb)
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  left join public.child_profiles child on child.id = item.child_id
  left join public.parent_accounts parent on parent.id = child.parent_account_id
  left join public.booking_register_entries entry on entry.booking_item_id = item.id
  where item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed'
    and (item.starts_at at time zone 'Europe/London')::date = p_register_date
    and (p_site_name is null or item.site_name = p_site_name)
    and (p_programme_name is null or item.programme_name = p_programme_name)
  order by
    item.starts_at,
    item.session_label,
    coalesce(nullif(trim(child.full_name), ''), nullif(trim(item.child_name), ''), nullif(trim(child.preferred_name), ''), 'Child');
end;
$$;

revoke all on function public.staff_register_for_day(date, text, text) from public;
grant execute on function public.staff_register_for_day(date, text, text) to authenticated;

comment on function public.staff_register_for_day(date, text, text) is
  'Authoritative operational register with full child names, care details, staff-family marker and staff ad-hoc booking provenance.';
