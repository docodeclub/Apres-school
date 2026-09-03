-- A child can be returned to checked-in after an accidental checkout. Treat
-- that as a fresh attendance action so the live register can place the child
-- at the bottom using the current action time.

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
      and item.status in ('reserved', 'confirmed', 'attended')
      and (
        booking.status = 'confirmed'
        or exists (
          select 1
          from public.booking_invoices invoice
          where (
              invoice.id = booking.invoice_id
              or invoice.booking_id = booking.id::text
            )
            and lower(coalesce(invoice.payment_status, '')) in (
              'paid',
              'bank_confirmed',
              'reconciled',
              'paid_by_fallback_card',
              'payment_guaranteed',
              'payment_plan_active',
              'captured'
            )
        )
      )
  ) then
    raise exception 'Only secured booking items can be updated on the register.' using errcode = '22023';
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
      when excluded.attendance_status = 'checked_in' then now()
      else booking_register_entries.checked_in_at
    end,
    checked_out_at = case
      when excluded.attendance_status = 'checked_in' then null
      when excluded.attendance_status = 'checked_out' then now()
      else booking_register_entries.checked_out_at
    end,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.update_staff_register_entry(uuid, text, text) to authenticated;

comment on function public.update_staff_register_entry(uuid, text, text) is
  'Updates one secured register row and refreshes timestamps when a child is checked in again.';
