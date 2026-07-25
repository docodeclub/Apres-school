create or replace function public.parent_credit_ledger(p_limit integer default 80)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 80), 250));
  v_account_id uuid;
  v_entries jsonb := '[]'::jsonb;
  v_balance numeric(10,2) := 0;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to view account credit.';
  end if;

  select account.id
    into v_account_id
  from public.parent_accounts account
  where account.archived_at is null
    and (
      account.profile_id = auth.uid()
      or (v_email <> '' and lower(account.email) = v_email)
      or exists (
        select 1
        from public.parent_account_holders holder
        where holder.parent_account_id = account.id
          and holder.status <> 'removed'
          and (
            holder.profile_id = auth.uid()
            or (v_email <> '' and lower(holder.email) = v_email)
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
      'creditBalance', 0,
      'creditEntries', '[]'::jsonb,
      'fetchedAt', now()
    );
  end if;

  select coalesce(sum(entry.amount), 0)
    into v_balance
  from public.parent_account_credit_entries entry
  where entry.parent_account_id = v_account_id
    and entry.status = 'posted';

  select coalesce(
    jsonb_agg(to_jsonb(entry_row) order by entry_row.created_at desc),
    '[]'::jsonb
  )
    into v_entries
  from (
    select *
    from public.parent_account_credit_entries
    where parent_account_id = v_account_id
    order by created_at desc
    limit v_limit
  ) entry_row;

  return jsonb_build_object(
    'parentAccountId', v_account_id,
    'creditBalance', round(v_balance, 2),
    'creditEntries', v_entries,
    'fetchedAt', now()
  );
end;
$$;

revoke all on function public.parent_credit_ledger(integer) from public;
grant execute on function public.parent_credit_ledger(integer) to authenticated;
grant execute on function public.parent_credit_ledger(integer) to service_role;

comment on function public.parent_credit_ledger(integer) is
  'Returns only the signed-in family account credit balance and entries through a bounded security-definer query.';
