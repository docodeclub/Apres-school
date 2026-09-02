-- A provider may emit payment_reported_complete after payment_captured. The
-- weaker callback must not hide already-secured sessions from operations.

do $$
declare
  v_invoice_ids text[];
begin
  select coalesce(array_agg(invoice.id order by invoice.created_at), array[]::text[])
    into v_invoice_ids
  from public.booking_invoices invoice
  where lower(coalesce(invoice.payment_status, '')) = 'reported_complete'
    and coalesce(invoice.paid_amount, 0) >= coalesce(invoice.total_amount, 0)
    and exists (
      select 1
      from public.ponchopay_webhook_events event
      where event.invoice_id = invoice.id
        and lower(coalesce(event.event_type, '')) = 'payment_captured'
        and lower(coalesce(event.signature_status, '')) = 'verified'
        and lower(coalesce(event.processing_status, '')) = 'processed'
    );

  update public.booking_invoices invoice
  set payment_status = 'captured',
      parent_portal_status = 'Booking confirmed; payment captured',
      finance_status = 'captured_pending_completion',
      balance = greatest(0, coalesce(invoice.total_amount, 0) - coalesce(invoice.paid_amount, 0) + coalesce(invoice.refunded_amount, 0)),
      updated_at = now()
  where invoice.id = any(v_invoice_ids);

  if cardinality(v_invoice_ids) > 0 then
    insert into public.audit_log (action, table_name, record_id, metadata)
    values (
      'secured_payment_downgrade_repaired',
      'booking_invoices',
      null,
      jsonb_build_object(
        'invoiceIds', to_jsonb(v_invoice_ids),
        'count', cardinality(v_invoice_ids),
        'reason', 'Verified payment_captured event was followed by weaker payment_reported_complete state'
      )
    );
  end if;
end;
$$;
