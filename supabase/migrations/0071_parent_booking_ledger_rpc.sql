create index if not exists booking_invoices_parent_updated_idx
  on public.booking_invoices (parent_id, updated_at desc);

create index if not exists booking_invoices_parent_email_updated_idx
  on public.booking_invoices (lower(parent_email), updated_at desc);

create index if not exists bookings_invoice_parent_account_idx
  on public.bookings (invoice_id, parent_account_id)
  where invoice_id is not null;

create or replace function public.parent_booking_ledger(p_limit integer default 80)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 80), 250));
  v_account_id uuid;
  v_account_email text;
  v_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invoices jsonb := '[]'::jsonb;
  v_bookings jsonb := '[]'::jsonb;
  v_credit_entries jsonb := '[]'::jsonb;
  v_credit_balance numeric(10,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your booking history.';
  end if;

  select account.id, lower(account.email)
    into v_account_id, v_account_email
  from public.parent_accounts account
  where account.archived_at is null
    and (
      account.profile_id = auth.uid()
      or (v_user_email <> '' and lower(account.email) = v_user_email)
      or exists (
        select 1
        from public.parent_account_holders holder
        where holder.parent_account_id = account.id
          and holder.status <> 'removed'
          and (
            holder.profile_id = auth.uid()
            or (v_user_email <> '' and lower(holder.email) = v_user_email)
          )
      )
    )
  order by
    case when account.profile_id = auth.uid() then 0 else 1 end,
    account.updated_at desc
  limit 1;

  if v_account_id is null then
    return jsonb_build_object(
      'parentAccountId', null,
      'invoices', '[]'::jsonb,
      'bookings', '[]'::jsonb,
      'creditBalance', 0,
      'creditEntries', '[]'::jsonb,
      'fetchedAt', now()
    );
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
    select invoice.*
    from public.booking_invoices invoice
    where invoice.parent_id = auth.uid()
      or lower(coalesce(invoice.parent_email, '')) = v_account_email
      or exists (
        select 1
        from public.bookings booking
        where booking.invoice_id = invoice.id
          and booking.parent_account_id = v_account_id
      )
    order by invoice.updated_at desc
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
    select booking.*
    from public.bookings booking
    where booking.parent_account_id = v_account_id
    order by booking.created_at desc
    limit v_limit
  ) booking_row;

  select coalesce(sum(entry.amount), 0)
    into v_credit_balance
  from public.parent_account_credit_entries entry
  where entry.parent_account_id = v_account_id
    and entry.status = 'posted';

  select coalesce(
    jsonb_agg(to_jsonb(entry_row) order by entry_row.created_at desc),
    '[]'::jsonb
  )
    into v_credit_entries
  from (
    select entry.*
    from public.parent_account_credit_entries entry
    where entry.parent_account_id = v_account_id
    order by entry.created_at desc
    limit v_limit
  ) entry_row;

  return jsonb_build_object(
    'parentAccountId', v_account_id,
    'invoices', v_invoices,
    'bookings', v_bookings,
    'creditBalance', round(v_credit_balance, 2),
    'creditEntries', v_credit_entries,
    'fetchedAt', now()
  );
end;
$$;

revoke all on function public.parent_booking_ledger(integer) from public;
grant execute on function public.parent_booking_ledger(integer) to authenticated;
grant execute on function public.parent_booking_ledger(integer) to service_role;

comment on function public.parent_booking_ledger(integer) is
  'Returns a bounded invoice, booking and credit ledger for only the signed-in family account.';
