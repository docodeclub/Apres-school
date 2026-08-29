update public.enquiries enquiry
set parent_account_id = holder.parent_account_id
from public.parent_account_holders holder
join public.parent_accounts account on account.id = holder.parent_account_id
where enquiry.parent_account_id is null
  and holder.status <> 'removed'
  and account.archived_at is null
  and lower(holder.email) = lower(enquiry.email);

create or replace function public.link_enquiry_to_parent_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parent_account_id is null and nullif(btrim(new.email), '') is not null then
    select candidate.account_id into new.parent_account_id
    from (
      select account.id as account_id, account.updated_at, 0 as priority
      from public.parent_accounts account
      where account.archived_at is null and lower(account.email) = lower(new.email)
      union all
      select account.id, account.updated_at, 1
      from public.parent_account_holders holder
      join public.parent_accounts account on account.id = holder.parent_account_id
      where holder.status <> 'removed'
        and account.archived_at is null
        and lower(holder.email) = lower(new.email)
    ) candidate
    order by candidate.priority, candidate.updated_at desc
    limit 1;
  end if;
  return new;
end;
$$;

comment on function public.link_enquiry_to_parent_account() is
  'Links support enquiries to either the primary or an active linked holder family account by normalised email.';
