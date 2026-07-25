create table if not exists public.booking_register_entries (
  booking_item_id uuid primary key references public.booking_items(id) on delete cascade,
  attendance_status text not null default 'booked'
    check (attendance_status in ('booked', 'checked_in', 'checked_out', 'absent', 'late_collection', 'incident')),
  note text not null default '',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.booking_register_entries enable row level security;

grant all privileges on public.booking_register_entries to service_role;
grant select, insert, update on public.booking_register_entries to authenticated;

drop policy if exists "Staff can read register entries" on public.booking_register_entries;
create policy "Staff can read register entries"
  on public.booking_register_entries for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.active = true
        and profiles.role in ('staff', 'manager', 'admin', 'superadmin')
    )
  );

drop policy if exists "Staff can update register entries" on public.booking_register_entries;
create policy "Staff can update register entries"
  on public.booking_register_entries for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.active = true
        and profiles.role in ('staff', 'manager', 'admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.active = true
        and profiles.role in ('staff', 'manager', 'admin', 'superadmin')
    )
  );

create or replace function public.staff_register_for_day(
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
  site_name text,
  programme_name text,
  session_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  attendance_status text,
  attendance_note text,
  attendance_time timestamptz,
  medical_notes text,
  allergy_notes text,
  dietary_notes text,
  care_flags jsonb,
  authorised_collectors jsonb
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
    item.site_name,
    item.programme_name,
    item.session_label,
    item.starts_at,
    item.ends_at,
    coalesce(entry.attendance_status, 'booked'),
    coalesce(entry.note, ''),
    coalesce(entry.checked_out_at, entry.checked_in_at, entry.updated_at),
    coalesce(child.medical_notes, ''),
    coalesce(child.allergy_notes, ''),
    coalesce(child.dietary_notes, ''),
    coalesce(child.flags, '[]'::jsonb),
    coalesce(child.authorised_collectors, '[]'::jsonb)
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  left join public.child_profiles child on child.id = item.child_id
  left join public.booking_register_entries entry on entry.booking_item_id = item.id
  where item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed'
    and (item.starts_at at time zone 'Europe/London')::date = p_register_date
    and (p_site_name is null or item.site_name = p_site_name)
    and (p_programme_name is null or item.programme_name = p_programme_name)
  order by item.starts_at, child_name, item.session_label;
end;
$$;

create or replace function public.update_staff_register_entry(
  p_booking_item_id uuid,
  p_attendance_status text,
  p_note text default ''
)
returns public.booking_register_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.booking_register_entries;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  if p_attendance_status not in ('booked', 'checked_in', 'checked_out', 'absent', 'late_collection', 'incident') then
    raise exception 'Invalid attendance status.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.booking_items item
    join public.bookings booking on booking.id = item.booking_id
    where item.id = p_booking_item_id
      and item.status in ('confirmed', 'attended')
      and booking.status = 'confirmed'
  ) then
    raise exception 'Only confirmed booking items can be updated on the register.' using errcode = '22023';
  end if;

  insert into public.booking_register_entries (
    booking_item_id,
    attendance_status,
    note,
    checked_in_at,
    checked_out_at,
    updated_by,
    updated_at
  ) values (
    p_booking_item_id,
    p_attendance_status,
    coalesce(p_note, ''),
    case when p_attendance_status = 'checked_in' then now() else null end,
    case when p_attendance_status = 'checked_out' then now() else null end,
    auth.uid(),
    now()
  )
  on conflict (booking_item_id) do update set
    attendance_status = excluded.attendance_status,
    note = excluded.note,
    checked_in_at = case
      when excluded.attendance_status = 'checked_in' then coalesce(booking_register_entries.checked_in_at, now())
      else booking_register_entries.checked_in_at
    end,
    checked_out_at = case
      when excluded.attendance_status = 'checked_out' then now()
      else booking_register_entries.checked_out_at
    end,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.staff_register_for_day(date, text, text) to authenticated;
grant execute on function public.update_staff_register_entry(uuid, text, text) to authenticated;

comment on function public.staff_register_for_day(date, text, text) is
  'Authoritative daily staff register: one row per confirmed booking item and child.';
