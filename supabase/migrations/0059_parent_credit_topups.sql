alter table public.parent_account_credit_entries
  drop constraint if exists parent_account_credit_entries_entry_type_check;

alter table public.parent_account_credit_entries
  add constraint parent_account_credit_entries_entry_type_check
  check (entry_type in (
    'cancellation_credit',
    'amendment_credit',
    'credit_applied',
    'refund_reversal',
    'adjustment',
    'top_up'
  ));

create unique index if not exists parent_account_credit_topup_invoice_unique
  on public.parent_account_credit_entries (
    parent_account_id,
    ((metadata->>'topUpInvoiceId'))
  )
  where entry_type = 'top_up'
    and status = 'posted'
    and metadata ? 'topUpInvoiceId';

create or replace function public.sync_parent_account_credit_topup_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_account_id uuid;
  v_target_credit numeric(10,2) := 0;
  v_recorded_credit numeric(10,2) := 0;
  v_delta numeric(10,2) := 0;
begin
  if not coalesce((new.metadata->>'creditTopUp')::boolean, false) then
    return new;
  end if;

  select account.id into v_parent_account_id
    from public.parent_accounts account
    where account.id::text = nullif(new.metadata->>'parentAccountId', '')
       or account.profile_id = new.parent_id
       or (new.parent_email is not null and lower(account.email) = lower(new.parent_email))
    order by
      case when account.id::text = nullif(new.metadata->>'parentAccountId', '') then 0
           when account.profile_id = new.parent_id then 1
           else 2 end
    limit 1;

  if v_parent_account_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_parent_account_id::text || ':account-credit', 0));

  v_target_credit := greatest(0, coalesce(new.paid_amount, 0) - coalesce(new.refunded_amount, 0));

  select coalesce(sum(entry.amount), 0) into v_recorded_credit
    from public.parent_account_credit_entries entry
    where entry.parent_account_id = v_parent_account_id
      and entry.status = 'posted'
      and entry.metadata->>'topUpInvoiceId' = new.id;

  v_delta := round(v_target_credit - v_recorded_credit, 2);
  if v_delta = 0 then
    return new;
  end if;

  insert into public.parent_account_credit_entries (
    parent_account_id,
    parent_id,
    invoice_id,
    entry_type,
    amount,
    currency,
    description,
    metadata
  ) values (
    v_parent_account_id,
    new.parent_id,
    null,
    case when v_delta > 0 then 'top_up' else 'refund_reversal' end,
    v_delta,
    coalesce(new.currency, 'GBP'),
    case when v_delta > 0 then 'Credit added securely through PonchoPay' else 'Credit removed after top-up refund' end,
    jsonb_build_object(
      'topUpInvoiceId', new.id,
      'providerReference', new.provider_reference,
      'paidAmount', new.paid_amount,
      'refundedAmount', new.refunded_amount,
      'paymentStatus', new.payment_status
    )
  );

  return new;
end;
$$;

drop trigger if exists sync_parent_account_credit_topup_after_invoice_change on public.booking_invoices;
create trigger sync_parent_account_credit_topup_after_invoice_change
  after insert or update of paid_amount, refunded_amount, payment_status, metadata
  on public.booking_invoices
  for each row
  execute function public.sync_parent_account_credit_topup_from_invoice();
