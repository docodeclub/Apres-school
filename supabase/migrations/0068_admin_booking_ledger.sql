create or replace function public.admin_booking_ledger(p_limit integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 500));
  v_invoices jsonb := '[]'::jsonb;
  v_bookings jsonb := '[]'::jsonb;
  v_credit_entries jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.current_profile_is_admin() then
    raise exception 'Only active admins can load the booking ledger.';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(invoice_row)
      || jsonb_build_object(
        'booking_receipts', coalesce((
          select jsonb_agg(to_jsonb(receipt_row) order by receipt_row.issued_at desc)
          from public.booking_receipts receipt_row
          where receipt_row.invoice_id = invoice_row.id
        ), '[]'::jsonb),
        'booking_payment_admin_actions', coalesce((
          select jsonb_agg(to_jsonb(action_row) order by action_row.created_at desc)
          from public.booking_payment_admin_actions action_row
          where action_row.invoice_id = invoice_row.id
        ), '[]'::jsonb),
        'ponchopay_checkout_sessions', coalesce((
          select jsonb_agg(
            (to_jsonb(checkout_row) - 'request_payload' - 'provider_response')
            order by checkout_row.created_at desc
          )
          from public.ponchopay_checkout_sessions checkout_row
          where checkout_row.invoice_id = invoice_row.id
        ), '[]'::jsonb)
      )
      order by invoice_row.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_invoices
  from (
    select *
    from public.booking_invoices
    order by updated_at desc
    limit v_limit
  ) invoice_row;

  select coalesce(
    jsonb_agg(
      to_jsonb(booking_row)
      || jsonb_build_object(
        'booking_items', coalesce((
          select jsonb_agg(to_jsonb(item_row) order by item_row.starts_at, item_row.session_label)
          from public.booking_items item_row
          where item_row.booking_id = booking_row.id
        ), '[]'::jsonb)
      )
      order by booking_row.created_at desc
    ),
    '[]'::jsonb
  )
  into v_bookings
  from (
    select *
    from public.bookings
    order by created_at desc
    limit v_limit
  ) booking_row;

  select coalesce(
    jsonb_agg(to_jsonb(credit_row) order by credit_row.created_at desc),
    '[]'::jsonb
  )
  into v_credit_entries
  from (
    select *
    from public.parent_account_credit_entries
    order by created_at desc
    limit v_limit
  ) credit_row;

  return jsonb_build_object(
    'invoices', v_invoices,
    'bookings', v_bookings,
    'creditEntries', v_credit_entries,
    'fetchedAt', now()
  );
end;
$$;

revoke all on function public.admin_booking_ledger(integer) from public;
grant execute on function public.admin_booking_ledger(integer) to authenticated;
grant execute on function public.admin_booking_ledger(integer) to service_role;

comment on function public.admin_booking_ledger(integer) is
  'Returns a bounded booking and finance ledger after one active-admin authorization check.';
