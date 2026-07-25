-- Give staff the operational details needed to run a safe daily register.
-- The register remains authoritative: one row per confirmed booking item.

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
  session_id uuid,
  session_block_id uuid,
  child_id uuid,
  child_name text,
  child_date_of_birth date,
  child_school_name text,
  child_year_group text,
  parent_name text,
  parent_phone text,
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
    select 1 from public.profiles
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
    item.session_id,
    item.session_block_id,
    item.child_id,
    coalesce(child.preferred_name, child.full_name, item.child_name, 'Child'),
    child.date_of_birth,
    coalesce(child.school_name, ''),
    coalesce(child.year_group, ''),
    coalesce(parent.full_name, booking.parent_name, ''),
    coalesce(parent.phone, ''),
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
    coalesce(child.preferred_name, child.full_name, item.child_name, 'Child');
end;
$$;

grant execute on function public.staff_register_for_day(date, text, text) to authenticated;

comment on function public.staff_register_for_day(date, text, text) is
  'Authoritative operational register: one row per confirmed booking item, with child care and emergency details.';
