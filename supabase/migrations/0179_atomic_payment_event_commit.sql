-- Draft release: deploy with the processor, never independently enable old writers.
-- Database changes and notification intent commit together; external delivery is separate.
create table if not exists public.payment_notification_outbox (
  event_id uuid primary key references public.ponchopay_webhook_events(id),
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_notification_outbox enable row level security;
revoke all on public.payment_notification_outbox from anon, authenticated;
grant all on public.payment_notification_outbox to service_role;

create or replace function public.commit_ponchopay_event(
  p_event_id uuid, p_invoice_id text, p_expected jsonb, p_next jsonb,
  p_booking_status text, p_receipt jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  i public.booking_invoices%rowtype;
  e public.ponchopay_webhook_events%rowtype;
  n public.booking_invoices%rowtype;
  receipt_id uuid;
  checkout_status text;
  result_status text := 'processed';
begin
  -- Consistent lock order: invoice first, then event. All mutations below are
  -- one transaction, so a crash either commits everything or nothing.
  select * into i from public.booking_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  select * into e from public.ponchopay_webhook_events where id=p_event_id for update;
  if not found or e.signature_status <> 'verified' or e.invoice_id is distinct from p_invoice_id then
    raise exception 'Verified event does not belong to invoice';
  end if;
  if e.processing_status in ('processed','skipped') then
    return jsonb_build_object('status','existing','invoiceId',i.id);
  end if;
  if to_jsonb(i) is distinct from p_expected then
    return jsonb_build_object('status','conflict','invoiceId',i.id);
  end if;
  if p_next->>'id' is distinct from i.id or p_next->>'last_webhook_event_id' is distinct from e.id::text then
    raise exception 'Invalid invoice proposal';
  end if;
  if coalesce((p_next->>'retainSettledPayment')::boolean,false) then
    result_status := 'skipped';
  else
    n := jsonb_populate_record(i,p_next);
    update public.booking_invoices set
      provider_payment_id=n.provider_payment_id, provider_reference=n.provider_reference,
      total_amount=n.total_amount, paid_amount=n.paid_amount, refunded_amount=n.refunded_amount,
      balance=n.balance, currency=n.currency, payment_status=n.payment_status,
      parent_portal_status=n.parent_portal_status, receipt_status=n.receipt_status,
      finance_status=n.finance_status, metadata=n.metadata,
      last_webhook_event_id=e.id,last_provider_event_id=e.provider_event_id,updated_at=clock_timestamp()
    where id=i.id returning * into i;

    checkout_status := case e.event_type when 'payment_captured' then 'captured'
      when 'payment_completed' then 'paid' when 'payment_reconciled' then 'reconciled'
      when 'payment_in_bank' then 'bank_confirmed' when 'payment_failed' then 'failed'
      when 'payment_cancelled' then 'cancelled' when 'payment_refunded' then 'refunded' end;
    if checkout_status is not null then
      update public.ponchopay_checkout_sessions set status=checkout_status,
        provider_payment_id=e.payment_id,provider_reference=e.provider_reference,updated_at=clock_timestamp()
      where invoice_id=i.id;
    end if;
    if p_receipt is not null then
      insert into public.booking_receipts(invoice_id,provider_event_id,payment_id,provider_reference,
        receipt_number,amount,currency,delivery_status,metadata)
      values(i.id,e.provider_event_id,e.payment_id,e.provider_reference,p_receipt->>'receipt_number',
        (p_receipt->>'amount')::numeric,e.currency,'pending_email',jsonb_build_object('eventType',e.event_type))
      on conflict(provider_event_id) do nothing;
      select id into receipt_id from public.booking_receipts where provider_event_id=e.provider_event_id;
    end if;
    if i.booking_id is not null then
      if p_booking_status not in ('confirmed','payment_pending') then raise exception 'Invalid booking status'; end if;
      update public.bookings set status=p_booking_status,outstanding_balance=greatest(0,i.balance),
        invoice_id=i.id,updated_at=clock_timestamp() where id::text=i.booking_id::text;
      if p_booking_status='confirmed' then
        update public.booking_items set status='confirmed',updated_at=clock_timestamp()
        where booking_id::text=i.booking_id::text and status='reserved';
      end if;
    end if;
    -- Durable intent. No provider/network call is allowed inside this transaction.
    insert into public.payment_notification_outbox(event_id,payload)
    values(e.id,jsonb_build_object('event',to_jsonb(e),'invoice',to_jsonb(i),
      'receiptId',receipt_id,'bookingStatus',case when i.booking_id is not null then p_booking_status end))
    on conflict(event_id) do nothing;
  end if;
  update public.ponchopay_webhook_events set processing_status=result_status,
    processing_outcome=p_next->>'processingOutcome',processed_at=clock_timestamp() where id=e.id;
  insert into public.audit_log(action,table_name,record_id,metadata)
  values('ponchopay_atomic_event_'||result_status,'booking_invoices',null,
    jsonb_build_object('invoiceId',i.id,'providerEventId',e.provider_event_id,'eventType',e.event_type,
      'settledPaymentId',i.provider_payment_id,'incomingPaymentId',e.payment_id));
  return jsonb_build_object('status',result_status,'invoiceId',i.id,'receiptId',receipt_id,
    'paymentStatus',i.payment_status,'notificationQueued',result_status='processed');
end $$;
revoke all on function public.commit_ponchopay_event(uuid,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_ponchopay_event(uuid,text,jsonb,jsonb,text,jsonb) to service_role;
