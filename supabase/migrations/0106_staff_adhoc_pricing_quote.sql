-- Give staff the same authoritative pricing preview used by the parent basket
-- before an ad-hoc booking is committed. The non-booking fee is deliberately
-- outside the pricing-group rules and is added after session discounts.

create or replace function public.quote_staff_adhoc_pricing(
  p_child_id uuid,
  p_session_block_ids uuid[],
  p_apply_non_booking_fee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_parent_account_id uuid;
  v_block record;
  v_quote jsonb;
  v_requested_count integer;
  v_gross numeric(10,2) := 0;
  v_discount numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_fee numeric(10,2) := case when p_apply_non_booking_fee then 2.50 else 0 end;
  v_group_name text := 'Standard';
  v_lines jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  if p_child_id is null then
    raise exception 'Choose a pupil.';
  end if;
  if p_session_block_ids is null or cardinality(p_session_block_ids) = 0 then
    raise exception 'Choose at least one session.';
  end if;

  select child.parent_account_id
  into v_parent_account_id
  from public.child_profiles child
  join public.parent_accounts account on account.id = child.parent_account_id
  where child.id = p_child_id
    and child.active = true
    and child.archived_at is null
    and account.archived_at is null
    and account.portal_status <> 'archived';

  if v_parent_account_id is null then
    raise exception 'This pupil is not available for an ad-hoc booking.';
  end if;

  select count(distinct block_id)
  into v_requested_count
  from unnest(p_session_block_ids) as block_id;

  for v_block in
    select
      block.id,
      block.label,
      block.starts_at,
      coalesce(nullif(block.price, 0), nullif(session.price, 0), 0)::numeric(10,2) as standard_price,
      programme.id as programme_id,
      programme.name as programme_name,
      programme.category as programme_category,
      location.id as school_id
    from public.session_blocks block
    join public.sessions session on session.id = block.session_id
    join public.programmes programme on programme.id = session.programme_id
    join public.locations location on location.id = programme.location_id
    where block.id = any(p_session_block_ids)
      and block.parent_bookable = true
      and session.parent_bookable = true
      and session.status not in ('cancelled', 'closed')
      and programme.active = true
      and location.active = true
    order by block.starts_at
  loop
    v_quote := public.calculate_parent_price(
      v_parent_account_id,
      v_block.school_id,
      public.pricing_service_key(v_block.programme_name, v_block.programme_category),
      v_block.programme_id,
      (v_block.starts_at at time zone 'Europe/London')::date,
      v_block.standard_price
    );

    v_gross := v_gross + (v_quote->>'standardUnitAmount')::numeric;
    v_discount := v_discount + (v_quote->>'discountUnitAmount')::numeric;
    v_total := v_total + (v_quote->>'finalUnitAmount')::numeric;
    v_group_name := coalesce(v_quote->>'pricingGroupName', v_group_name);
    v_lines := v_lines || jsonb_build_array(
      v_quote || jsonb_build_object(
        'sessionBlockId', v_block.id,
        'sessionLabel', v_block.label,
        'lineTotal', (v_quote->>'finalUnitAmount')::numeric
      )
    );
  end loop;

  if jsonb_array_length(v_lines) <> v_requested_count then
    raise exception 'One or more selected sessions are no longer available.';
  end if;

  return jsonb_build_object(
    'pricingGroupName', v_group_name,
    'sessionGrossTotal', round(v_gross, 2),
    'grossTotal', round(v_gross + v_fee, 2),
    'discountTotal', round(v_discount, 2),
    'nonBookingFee', v_fee,
    'totalAmount', round(v_total + v_fee, 2),
    'items', v_lines
  );
end;
$$;

revoke all on function public.quote_staff_adhoc_pricing(uuid, uuid[], boolean) from public, anon;
grant execute on function public.quote_staff_adhoc_pricing(uuid, uuid[], boolean) to authenticated, service_role;

comment on function public.quote_staff_adhoc_pricing(uuid, uuid[], boolean) is
  'Authoritative pricing-group quote for a staff-created ad-hoc booking.';
