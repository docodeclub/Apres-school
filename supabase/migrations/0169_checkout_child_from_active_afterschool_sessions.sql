-- Leaving an after-school club normally means leaving the site. Allow staff to
-- close every currently active ASC attendance row for the same child, school
-- and day in one atomic action. Breakfast Club and expected future sessions
-- are deliberately excluded.

create or replace function public.checkout_child_from_active_afterschool_sessions(
  p_booking_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor public.booking_items%rowtype;
  v_updated_count integer := 0;
  v_session_labels jsonb := '[]'::jsonb;
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

  select item.*
    into v_anchor
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  where item.id = p_booking_item_id
    and item.child_id is not null
    and item.status in ('reserved', 'confirmed', 'attended')
    and (
      booking.status = 'confirmed'
      or exists (
        select 1
        from public.booking_invoices invoice
        where (invoice.id = booking.invoice_id or invoice.booking_id = booking.id::text)
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
  limit 1;

  if v_anchor.id is null then
    raise exception 'Choose a secured child booking from the register.' using errcode = '22023';
  end if;

  if lower(coalesce(v_anchor.programme_name, '')) not like '%after-school%'
    and lower(coalesce(v_anchor.programme_name, '')) not like '%after school%'
  then
    raise exception 'Going home is only available for after-school care.' using errcode = '22023';
  end if;

  with updated as (
    update public.booking_register_entries entry
      set attendance_status = 'checked_out',
          checked_out_at = now(),
          updated_by = auth.uid(),
          updated_at = now()
    from public.booking_items item
    join public.bookings booking on booking.id = item.booking_id
    where entry.booking_item_id = item.id
      and item.child_id = v_anchor.child_id
      and item.site_name = v_anchor.site_name
      and (item.starts_at at time zone 'Europe/London')::date =
          (v_anchor.starts_at at time zone 'Europe/London')::date
      and (
        lower(coalesce(item.programme_name, '')) like '%after-school%'
        or lower(coalesce(item.programme_name, '')) like '%after school%'
      )
      and item.status in ('reserved', 'confirmed', 'attended')
      and entry.attendance_status in ('checked_in', 'late_collection', 'incident')
      and (
        booking.status = 'confirmed'
        or exists (
          select 1
          from public.booking_invoices invoice
          where (invoice.id = booking.invoice_id or invoice.booking_id = booking.id::text)
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
    returning item.session_label
  )
  select count(*)::integer,
         coalesce(jsonb_agg(session_label order by session_label), '[]'::jsonb)
    into v_updated_count, v_session_labels
  from updated;

  if v_updated_count = 0 then
    raise exception 'This child is not currently checked into an after-school session.' using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, action, table_name, metadata)
  values (
    auth.uid(),
    'Child checked out from all active after-school sessions',
    'booking_register_entries',
    jsonb_build_object(
      'childId', v_anchor.child_id,
      'siteName', v_anchor.site_name,
      'registerDate', (v_anchor.starts_at at time zone 'Europe/London')::date,
      'updatedCount', v_updated_count,
      'sessionLabels', v_session_labels
    )
  );

  return jsonb_build_object(
    'ok', true,
    'updatedCount', v_updated_count,
    'sessionLabels', v_session_labels
  );
end;
$$;

revoke all on function public.checkout_child_from_active_afterschool_sessions(uuid) from public;
grant execute on function public.checkout_child_from_active_afterschool_sessions(uuid) to authenticated;

comment on function public.checkout_child_from_active_afterschool_sessions(uuid) is
  'Atomically checks a child out of active ASC sessions at the same school on the same day without changing Breakfast Club or expected sessions.';
