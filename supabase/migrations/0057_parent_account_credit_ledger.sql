create table if not exists public.parent_account_credit_entries (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references public.parent_accounts(id) on delete cascade,
  parent_id uuid references public.profiles(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  invoice_id text references public.booking_invoices(id) on delete set null,
  entry_type text not null check (entry_type in ('cancellation_credit', 'amendment_credit', 'credit_applied', 'refund_reversal', 'adjustment')),
  amount numeric(10,2) not null check (amount <> 0),
  currency text not null default 'GBP',
  status text not null default 'posted' check (status in ('posted', 'void')),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parent_account_credit_entries_account_idx
  on public.parent_account_credit_entries (parent_account_id, created_at desc);
create index if not exists parent_account_credit_entries_invoice_idx
  on public.parent_account_credit_entries (invoice_id, created_at desc);

alter table public.parent_account_credit_entries enable row level security;

grant select on public.parent_account_credit_entries to authenticated;
grant all privileges on public.parent_account_credit_entries to service_role;

drop policy if exists "Parents can read family credit" on public.parent_account_credit_entries;
create policy "Parents can read family credit"
  on public.parent_account_credit_entries for select
  using (
    exists (
      select 1
      from public.parent_accounts account
      where account.id = parent_account_credit_entries.parent_account_id
        and (
          account.profile_id = auth.uid()
          or exists (
            select 1
            from public.profiles profile
            where profile.id = auth.uid()
              and profile.active = true
              and lower(profile.email) = lower(account.email)
          )
          or exists (
            select 1
            from public.parent_account_holders holder
            where holder.parent_account_id = account.id
              and holder.profile_id = auth.uid()
              and holder.status <> 'removed'
          )
        )
    )
  );

create or replace function public.sync_parent_account_credit_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_parent_account_id uuid;
  v_target_credit numeric(10,2) := 0;
  v_recorded_credit numeric(10,2) := 0;
  v_delta numeric(10,2) := 0;
  v_entry_type text := 'adjustment';
begin
  if new.booking_id is not null then
    select * into v_booking
      from public.bookings
      where id::text = new.booking_id::text
      limit 1;
  end if;

  v_parent_account_id := v_booking.parent_account_id;
  if v_parent_account_id is null then
    select account.id into v_parent_account_id
      from public.parent_accounts account
      where account.profile_id = new.parent_id
         or (new.parent_email is not null and lower(account.email) = lower(new.parent_email))
      order by case when account.profile_id = new.parent_id then 0 else 1 end
      limit 1;
  end if;

  if v_parent_account_id is null then
    return new;
  end if;

  if lower(coalesce(v_booking.status::text, '')) = 'cancelled'
     or lower(coalesce(new.payment_status, '')) like 'cancelled%' then
    v_target_credit := greatest(0, new.paid_amount - new.refunded_amount);
    v_entry_type := 'cancellation_credit';
  elsif lower(coalesce(new.finance_status, '')) like '%credit%'
     or lower(coalesce(new.payment_status, '')) like '%credit%'
     or lower(coalesce(new.parent_portal_status, '')) like '%credit%' then
    v_target_credit := greatest(0, new.paid_amount - new.refunded_amount - new.total_amount);
    v_entry_type := 'amendment_credit';
  end if;

  select coalesce(sum(entry.amount), 0) into v_recorded_credit
    from public.parent_account_credit_entries entry
    where entry.invoice_id = new.id
      and entry.status = 'posted';

  v_delta := round(v_target_credit - v_recorded_credit, 2);
  if v_delta = 0 then
    return new;
  end if;

  insert into public.parent_account_credit_entries (
    parent_account_id,
    parent_id,
    booking_id,
    invoice_id,
    entry_type,
    amount,
    currency,
    description,
    metadata
  ) values (
    v_parent_account_id,
    coalesce(v_booking.parent_id, new.parent_id),
    v_booking.id,
    new.id,
    case when v_delta < 0 then 'refund_reversal' else v_entry_type end,
    v_delta,
    coalesce(new.currency, 'GBP'),
    case
      when v_delta < 0 then 'Credit reduced after refund or invoice adjustment'
      when v_entry_type = 'cancellation_credit' then 'Credit from cancelled booking'
      else 'Credit from cheaper booking amendment'
    end,
    jsonb_build_object(
      'paymentStatus', new.payment_status,
      'financeStatus', new.finance_status,
      'paidAmount', new.paid_amount,
      'refundedAmount', new.refunded_amount,
      'invoiceTotal', new.total_amount,
      'targetInvoiceCredit', v_target_credit
    )
  );

  return new;
end;
$$;

drop trigger if exists sync_parent_account_credit_after_invoice_change on public.booking_invoices;
create trigger sync_parent_account_credit_after_invoice_change
  after insert or update of total_amount, paid_amount, refunded_amount, payment_status, parent_portal_status, finance_status
  on public.booking_invoices
  for each row
  execute function public.sync_parent_account_credit_from_invoice();

-- Run the same idempotent trigger once for existing invoices so previously
-- cancelled or reduced paid bookings immediately appear in the parent balance.
update public.booking_invoices
  set finance_status = finance_status;
