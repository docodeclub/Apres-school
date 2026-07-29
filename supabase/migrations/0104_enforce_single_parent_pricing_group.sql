-- Give every existing and future parent an explicit Standard assignment, and
-- make group changes atomic so date ranges cannot overlap.

insert into public.parent_pricing_assignments(parent_account_id,pricing_group_id,effective_from,notes)
select pa.id,g.id,pa.created_at::date,'Default Standard pricing group.'
from public.parent_accounts pa cross join lateral(
  select id from public.pricing_groups where is_default and status='active' and deleted_at is null limit 1
) g
where pa.archived_at is null
  and not exists(select 1 from public.parent_pricing_assignments a where a.parent_account_id=pa.id and a.deleted_at is null);

create or replace function public.assign_default_parent_pricing_group()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_group_id uuid;
begin
  select id into v_group_id from public.pricing_groups where is_default and status='active' and deleted_at is null limit 1;
  if v_group_id is not null then
    insert into public.parent_pricing_assignments(parent_account_id,pricing_group_id,effective_from,notes)
    values(new.id,v_group_id,new.created_at::date,'Default Standard pricing group.');
  end if;
  return new;
end $$;
drop trigger if exists parent_accounts_default_pricing_group on public.parent_accounts;
create trigger parent_accounts_default_pricing_group after insert on public.parent_accounts
for each row execute function public.assign_default_parent_pricing_group();

create or replace function public.assign_parent_pricing_group(
  p_parent_account_id uuid,
  p_pricing_group_id uuid,
  p_effective_from date default current_date,
  p_effective_to date default null,
  p_notes text default null
)
returns public.parent_pricing_assignments language plpgsql security definer set search_path=public as $$
declare v_result public.parent_pricing_assignments%rowtype;
begin
  if public.current_user_app_role() not in ('admin','superadmin') then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.pricing_groups where id=p_pricing_group_id and status='active' and deleted_at is null) then raise exception 'Choose an active pricing group'; end if;
  if p_effective_to is not null and p_effective_to<p_effective_from then raise exception 'The end date must follow the start date'; end if;

  update public.parent_pricing_assignments
  set effective_to=p_effective_from-1
  where parent_account_id=p_parent_account_id and deleted_at is null and effective_from<p_effective_from
    and (effective_to is null or effective_to>=p_effective_from);
  update public.parent_pricing_assignments
  set deleted_at=now()
  where parent_account_id=p_parent_account_id and deleted_at is null and effective_from>=p_effective_from
    and (p_effective_to is null or effective_from<=p_effective_to);

  insert into public.parent_pricing_assignments(parent_account_id,pricing_group_id,effective_from,effective_to,notes,assigned_by)
  values(p_parent_account_id,p_pricing_group_id,p_effective_from,p_effective_to,nullif(trim(p_notes),''),auth.uid())
  returning * into v_result;
  return v_result;
end $$;
revoke all on function public.assign_parent_pricing_group(uuid,uuid,date,date,text) from public,anon;
grant execute on function public.assign_parent_pricing_group(uuid,uuid,date,date,text) to authenticated,service_role;
