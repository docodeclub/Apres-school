create or replace function public.apply_parent_account_credit_to_booking(
  p_parent_id uuid,
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_balance numeric(10,2) := 0;
  v_applied numeric(10,2) := 0;
  v_existing numeric(10,2) := 0;
  v_remaining numeric(10,2) := 0;
  v_invoice_id text;
  v_credit_entry_id uuid;
begin
  select * into v_booking
    from public.bookings
    where id = p_booking_id
      and parent_id = p_parent_id
    for update;

  if not found then
    raise exception 'Booking was not found for this parent' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'waitlist') then
    return jsonb_build_object(
      'applied', 0,
      'remainingCredit', 0,
      'dueToday', v_booking.due_today,
      'fullyCovered', false
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_booking.parent_account_id::text || ':account-credit', 0));

  select coalesce(-sum(entry.amount), 0) into v_existing
    from public.parent_account_credit_entries entry
    where entry.booking_id = v_booking.id
      and entry.entry_type = 'credit_applied'
      and entry.status = 'posted';

  if v_existing > 0 then
    select greatest(0, coalesce(sum(entry.amount), 0)) into v_balance
      from public.parent_account_credit_entries entry
      where entry.parent_account_id = v_booking.parent_account_id
        and entry.status = 'posted';
    return jsonb_build_object(
      'applied', v_existing,
      'remainingCredit', v_balance,
      'dueToday', v_booking.due_today,
      'fullyCovered', v_booking.due_today = 0,
      'invoiceId', v_booking.invoice_id
    );
  end if;

  select greatest(0, coalesce(sum(entry.amount), 0)) into v_balance
    from public.parent_account_credit_entries entry
    where entry.parent_account_id = v_booking.parent_account_id
      and entry.status = 'posted';

  v_applied := least(v_balance, greatest(0, v_booking.due_today));
  v_remaining := greatest(0, v_booking.due_today - v_applied);

  if v_applied <= 0 then
    return jsonb_build_object(
      'applied', 0,
      'remainingCredit', v_balance,
      'dueToday', v_booking.due_today,
      'fullyCovered', false
    );
  end if;

  insert into public.parent_account_credit_entries (
    parent_account_id,
    parent_id,
    booking_id,
    entry_type,
    amount,
    currency,
    description,
    metadata
  ) values (
    v_booking.parent_account_id,
    v_booking.parent_id,
    v_booking.id,
    'credit_applied',
    -v_applied,
    'GBP',
    'Account credit applied to booking ' || v_booking.booking_reference,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'grossDueToday', v_booking.due_today,
      'creditApplied', v_applied,
      'remainingDueToday', v_remaining
    )
  ) returning id into v_credit_entry_id;

  update public.bookings
    set due_today = v_remaining,
        status = case when v_remaining = 0 then 'confirmed'::booking_status else status end,
        metadata = jsonb_strip_nulls(
          coalesce(metadata, '{}'::jsonb) ||
          jsonb_build_object(
            'accountCreditApplied', v_applied,
            'accountCreditEntryId', v_credit_entry_id,
            'grossDueTodayBeforeCredit', v_booking.due_today
          )
        ),
        updated_at = now()
    where id = v_booking.id
    returning * into v_booking;

  if v_remaining = 0 then
    v_invoice_id := coalesce(v_booking.invoice_id, 'inv_' || v_booking.id::text);

    insert into public.booking_invoices (
      id,
      booking_id,
      parent_id,
      parent_email,
      total_amount,
      paid_amount,
      refunded_amount,
      balance,
      currency,
      payment_status,
      parent_portal_status,
      receipt_status,
      finance_status,
      metadata,
      updated_at
    ) values (
      v_invoice_id,
      v_booking.id::text,
      v_booking.parent_id,
      v_booking.parent_email,
      v_applied,
      v_applied,
      0,
      0,
      'GBP',
      'paid_by_credit',
      'Paid with account credit; booking confirmed',
      'issued',
      'cleared_by_account_credit',
      jsonb_build_object(
        'grossBookingTotal', v_booking.total_amount,
        'accountCreditApplied', v_applied,
        'accountCreditEntryId', v_credit_entry_id,
        'bookingReference', v_booking.booking_reference
      ),
      now()
    )
    on conflict (id) do update set
      paid_amount = excluded.paid_amount,
      balance = 0,
      payment_status = excluded.payment_status,
      parent_portal_status = excluded.parent_portal_status,
      receipt_status = excluded.receipt_status,
      finance_status = excluded.finance_status,
      metadata = public.booking_invoices.metadata || excluded.metadata,
      updated_at = now();

    update public.bookings
      set invoice_id = v_invoice_id,
          outstanding_balance = 0,
          updated_at = now()
      where id = v_booking.id;

    update public.booking_items
      set status = 'confirmed',
          updated_at = now()
      where booking_id = v_booking.id
        and status = 'reserved';

    update public.booking_capacity_holds
      set status = 'confirmed',
          expires_at = null
      where booking_item_id in (
        select item.id from public.booking_items item where item.booking_id = v_booking.id
      )
        and released_at is null;

    insert into public.booking_receipts (
      invoice_id,
      provider_event_id,
      payment_id,
      provider_reference,
      receipt_number,
      amount,
      currency,
      delivery_status,
      metadata
    ) values (
      v_invoice_id,
      'account-credit-' || v_booking.id::text,
      'account-credit',
      v_booking.booking_reference,
      'APR-CR-' || upper(substr(replace(v_booking.id::text, '-', ''), 1, 12)),
      v_applied,
      'GBP',
      'ready',
      jsonb_build_object('accountCreditEntryId', v_credit_entry_id, 'paymentMethod', 'account_credit')
    )
    on conflict (provider_event_id) do nothing;
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    p_parent_id,
    'parent_account_credit_applied',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'creditApplied', v_applied,
      'remainingDueToday', v_remaining,
      'fullyCovered', v_remaining = 0,
      'creditEntryId', v_credit_entry_id
    )
  );

  return jsonb_build_object(
    'applied', v_applied,
    'remainingCredit', greatest(0, v_balance - v_applied),
    'dueToday', v_remaining,
    'fullyCovered', v_remaining = 0,
    'invoiceId', case when v_remaining = 0 then v_invoice_id else null end,
    'entryId', v_credit_entry_id
  );
end;
$$;

revoke all on function public.apply_parent_account_credit_to_booking(uuid, uuid) from public, authenticated;
grant execute on function public.apply_parent_account_credit_to_booking(uuid, uuid) to service_role;

create or replace function public.release_parent_account_credit_from_booking(
  p_parent_id uuid,
  p_booking_id uuid,
  p_reason text default 'Checkout could not be created'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_entry public.parent_account_credit_entries%rowtype;
  v_restored_due numeric(10,2) := 0;
begin
  select * into v_booking
    from public.bookings
    where id = p_booking_id
      and parent_id = p_parent_id
    for update;

  if not found then
    raise exception 'Booking was not found for this parent' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_booking.parent_account_id::text || ':account-credit', 0));

  select * into v_entry
    from public.parent_account_credit_entries entry
    where entry.booking_id = v_booking.id
      and entry.entry_type = 'credit_applied'
      and entry.status = 'posted'
    order by entry.created_at desc
    limit 1
    for update;

  if not found then
    return jsonb_build_object('released', 0, 'dueToday', v_booking.due_today);
  end if;

  if v_booking.status = 'confirmed' then
    raise exception 'Confirmed booking credit cannot be released automatically';
  end if;

  v_restored_due := greatest(
    0,
    coalesce((v_booking.metadata->>'grossDueTodayBeforeCredit')::numeric, v_booking.due_today - v_entry.amount)
  );

  update public.parent_account_credit_entries
    set status = 'void',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'releasedAt', now(),
          'releaseReason', coalesce(nullif(trim(p_reason), ''), 'Checkout could not be created')
        ),
        updated_at = now()
    where id = v_entry.id;

  update public.bookings
    set due_today = v_restored_due,
        metadata = coalesce(metadata, '{}'::jsonb) - 'accountCreditApplied' - 'accountCreditEntryId' - 'grossDueTodayBeforeCredit',
        updated_at = now()
    where id = v_booking.id;

  update public.booking_invoices
    set total_amount = v_restored_due,
        balance = greatest(0, v_restored_due - paid_amount),
        payment_status = 'checkout_failed',
        parent_portal_status = 'Payment link unavailable; try again',
        finance_status = 'checkout_failed',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('accountCreditReleased', abs(v_entry.amount)),
        updated_at = now()
    where booking_id = v_booking.id::text
      and paid_amount = 0;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    p_parent_id,
    'parent_account_credit_released',
    'bookings',
    v_booking.id,
    jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'creditReleased', abs(v_entry.amount),
      'reason', coalesce(nullif(trim(p_reason), ''), 'Checkout could not be created'),
      'creditEntryId', v_entry.id
    )
  );

  return jsonb_build_object(
    'released', abs(v_entry.amount),
    'dueToday', v_restored_due,
    'entryId', v_entry.id
  );
end;
$$;

revoke all on function public.release_parent_account_credit_from_booking(uuid, uuid, text) from public, authenticated;
grant execute on function public.release_parent_account_credit_from_booking(uuid, uuid, text) to service_role;
