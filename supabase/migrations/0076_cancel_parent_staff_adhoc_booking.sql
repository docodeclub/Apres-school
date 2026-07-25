-- Parents can cancel a future staff-created ad-hoc booking from their portal.
-- The original account charge is reversed atomically, restoring any credit
-- consumed when the ad-hoc care was added and clearing the unpaid balance.

create or replace function public.cancel_parent_staff_adhoc_booking(
  p_parent_id uuid,
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_invoice public.booking_invoices%rowtype;
  v_now timestamptz := now();
  v_cancelled_items integer := 0;
  v_released_holds integer := 0;
  v_credit_applied numeric(10,2) := 0;
  v_balance_before numeric(10,2) := 0;
  v_balance_after numeric(10,2) := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_parent_id is null or p_booking_id is null then
    raise exception 'Parent and booking are required.' using errcode = '22023';
  end if;

  select booking.*
  into v_booking
  from public.bookings booking
  where booking.id = p_booking_id
    and (
      booking.parent_id = p_parent_id
      or exists (
        select 1
        from public.parent_accounts account
        where account.id = booking.parent_account_id
          and (
            account.profile_id = p_parent_id
            or exists (
              select 1
              from public.parent_account_holders holder
              where holder.parent_account_id = account.id
                and holder.profile_id = p_parent_id
                and holder.status <> 'removed'
            )
          )
      )
    )
  for update;

  if not found then
    raise exception 'Ad-hoc booking was not found for this parent.' using errcode = '42501';
  end if;

  if v_booking.source <> 'staff_adhoc'
     or not coalesce((v_booking.metadata->>'staffAdHoc')::boolean, false) then
    raise exception 'Only ad-hoc bookings can use this cancellation route.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', item.id,
      'childName', item.child_name,
      'sessionLabel', item.session_label,
      'startsAt', item.starts_at,
      'endsAt', item.ends_at,
      'status', item.status
    )
    order by item.starts_at
  ), '[]'::jsonb)
  into v_items
  from public.booking_items item
  where item.booking_id = v_booking.id;

  if v_booking.status = 'cancelled' then
    return jsonb_build_object(
      'cancelled', false,
      'alreadyCancelled', true,
      'staffAdHoc', true,
      'creditRestored', coalesce((v_booking.metadata->>'creditRestoredOnCancellation')::numeric, 0),
      'booking', jsonb_build_object(
        'id', v_booking.id,
        'bookingReference', v_booking.booking_reference,
        'status', v_booking.status,
        'invoiceId', v_booking.invoice_id,
        'outstandingBalance', v_booking.outstanding_balance
      ),
      'items', v_items
    );
  end if;

  if not exists (
    select 1
    from public.booking_items item
    where item.booking_id = v_booking.id
      and item.status in ('reserved', 'confirmed', 'waitlist')
      and item.starts_at > v_now
  ) then
    raise exception 'Only future ad-hoc care can be cancelled from the parent portal.' using errcode = '42501';
  end if;

  if v_booking.parent_account_id is not null then
    select coalesce(sum(entry.amount), 0)::numeric(10,2)
    into v_balance_before
    from public.parent_account_credit_entries entry
    where entry.parent_account_id = v_booking.parent_account_id
      and entry.status = 'posted';
  end if;

  if nullif(v_booking.invoice_id, '') is not null then
    select invoice.*
    into v_invoice
    from public.booking_invoices invoice
    where invoice.id = v_booking.invoice_id
    for update;

    if found then
      v_credit_applied := greatest(
        0,
        coalesce((v_invoice.metadata->>'creditAppliedAtCreation')::numeric, 0)
      );
    end if;
  end if;

  update public.booking_items
  set status = 'cancelled',
      updated_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelledAt', v_now,
        'cancelledBy', p_parent_id,
        'cancelReason', coalesce(nullif(trim(p_reason), ''), 'Parent cancelled ad-hoc care')
      )
  where booking_id = v_booking.id
    and status in ('reserved', 'confirmed', 'waitlist');

  get diagnostics v_cancelled_items = row_count;

  update public.booking_capacity_holds
  set status = 'released',
      released_at = v_now,
      expires_at = least(coalesce(expires_at, v_now), v_now)
  where booking_item_id in (
    select item.id
    from public.booking_items item
    where item.booking_id = v_booking.id
  )
    and released_at is null;

  get diagnostics v_released_holds = row_count;

  update public.bookings
  set status = 'cancelled',
      due_today = 0,
      outstanding_balance = 0,
      updated_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelledAt', v_now,
        'cancelledBy', p_parent_id,
        'cancelReason', coalesce(nullif(trim(p_reason), ''), 'Parent cancelled ad-hoc care'),
        'creditRestoredOnCancellation', v_credit_applied,
        'adHocChargeReversed', total_amount
      )
  where id = v_booking.id
  returning * into v_booking;

  if v_invoice.id is not null then
    -- Setting refunded_amount equal to the amount already covered makes the
    -- credit-ledger trigger's target zero. It therefore reverses the entire
    -- ad-hoc account charge exactly once, including any negative balance.
    update public.booking_invoices
    set refunded_amount = paid_amount,
        balance = 0,
        payment_status = 'cancelled',
        parent_portal_status = 'Cancelled',
        finance_status = 'cancelled_charge_reversed',
        updated_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'cancelledAt', v_now,
          'cancelledBy', p_parent_id,
          'cancelReason', coalesce(nullif(trim(p_reason), ''), 'Parent cancelled ad-hoc care'),
          'creditRestoredOnCancellation', v_credit_applied,
          'adHocChargeReversed', total_amount
        )
    where id = v_invoice.id;
  end if;

  if v_booking.parent_account_id is not null then
    select coalesce(sum(entry.amount), 0)::numeric(10,2)
    into v_balance_after
    from public.parent_account_credit_entries entry
    where entry.parent_account_id = v_booking.parent_account_id
      and entry.status = 'posted';
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    p_parent_id,
    'parent_staff_adhoc_booking_cancelled',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'cancelledItems', v_cancelled_items,
      'releasedHolds', v_released_holds,
      'chargeReversed', v_booking.total_amount,
      'creditRestored', v_credit_applied,
      'creditBalanceBefore', v_balance_before,
      'creditBalanceAfter', v_balance_after,
      'reason', coalesce(nullif(trim(p_reason), ''), 'Parent cancelled ad-hoc care')
    )
  );

  return jsonb_build_object(
    'cancelled', true,
    'alreadyCancelled', false,
    'staffAdHoc', true,
    'cancelledItems', v_cancelled_items,
    'releasedHolds', v_released_holds,
    'chargeReversed', v_booking.total_amount,
    'creditRestored', v_credit_applied,
    'creditBalance', v_balance_after,
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'bookingReference', v_booking.booking_reference,
      'status', v_booking.status,
      'invoiceId', v_booking.invoice_id,
      'outstandingBalance', v_booking.outstanding_balance
    ),
    'items', v_items
  );
end;
$$;

revoke all on function public.cancel_parent_staff_adhoc_booking(uuid, uuid, text) from public;
grant execute on function public.cancel_parent_staff_adhoc_booking(uuid, uuid, text) to service_role;
