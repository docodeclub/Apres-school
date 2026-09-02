insert into public.platform_settings (key, value, is_public)
values ('booking_pricing', '{"siblingDiscountPercent":10}'::jsonb, false)
on conflict (key) do update
set value = case
  when public.platform_settings.value ? 'siblingDiscountPercent' then public.platform_settings.value
  else public.platform_settings.value || excluded.value
end,
updated_at = now();

create or replace function public.booking_sibling_discount_percent()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select least(100, greatest(0, coalesce(
    (select nullif(value->>'siblingDiscountPercent', '')::numeric
     from public.platform_settings
     where key = 'booking_pricing'),
    10
  )));
$$;

revoke all on function public.booking_sibling_discount_percent() from public, anon, authenticated;
grant execute on function public.booking_sibling_discount_percent() to service_role;

create or replace function public.quote_current_parent_pricing_with_sibling(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_quote jsonb;
  v_item jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_adjustments jsonb;
  v_child_count integer := 0;
  v_percent numeric := public.booking_sibling_discount_percent();
  v_quantity integer;
  v_standard numeric;
  v_before numeric;
  v_final numeric;
  v_total numeric := 0;
  v_sibling_discount numeric := 0;
begin
  v_quote := public.quote_current_parent_pricing(p_items);

  select count(distinct nullif(coalesce(value->>'childId', value->>'child_id'), ''))
  into v_child_count
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb));

  if v_child_count < 2 or v_percent <= 0 then
    return v_quote || jsonb_build_object(
      'siblingDiscountPercent', v_percent,
      'siblingDiscountTotal', 0,
      'siblingDiscountApplied', false
    );
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_quote->'items', '[]'::jsonb)) loop
    v_quantity := greatest(1, coalesce(nullif(v_item->>'quantity', '')::integer, 1));
    v_standard := coalesce(nullif(v_item->>'standardUnitAmount', '')::numeric, 0);
    v_before := coalesce(nullif(v_item->>'finalUnitAmount', '')::numeric, 0);
    v_final := round(v_before * (1 - v_percent / 100), 2);
    v_sibling_discount := v_sibling_discount + round((v_before - v_final) * v_quantity, 2);
    v_total := v_total + round(v_final * v_quantity, 2);
    v_lines := v_lines || jsonb_build_array(v_item || jsonb_build_object(
      'finalUnitAmount', v_final,
      'discountUnitAmount', round(greatest(0, v_standard - v_final), 2),
      'lineTotal', round(v_final * v_quantity, 2),
      'siblingDiscountApplied', true,
      'siblingDiscountPercent', v_percent,
      'siblingDiscountUnitAmount', round(v_before - v_final, 2),
      'ruleName', case when coalesce(v_item->>'discountType', 'no_discount') = 'no_discount' then 'Sibling Discount' else v_item->>'ruleName' end,
      'discountType', case when coalesce(v_item->>'discountType', 'no_discount') = 'no_discount' then 'percentage' else v_item->>'discountType' end,
      'discountValue', case when coalesce(v_item->>'discountType', 'no_discount') = 'no_discount' then v_percent else nullif(v_item->>'discountValue', '')::numeric end,
      'source', coalesce(v_item->>'source', 'standard')
    ));
  end loop;

  v_adjustments := coalesce(v_quote->'adjustments', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('label', 'Sibling Discount', 'amount', round(v_sibling_discount, 2)));

  return v_quote || jsonb_build_object(
    'totalAmount', round(v_total, 2),
    'discountTotal', round(coalesce((v_quote->>'grossTotal')::numeric, 0) - v_total, 2),
    'siblingDiscountPercent', v_percent,
    'siblingDiscountTotal', round(v_sibling_discount, 2),
    'siblingDiscountApplied', true,
    'items', v_lines,
    'adjustments', v_adjustments
  );
end;
$$;

revoke all on function public.quote_current_parent_pricing_with_sibling(jsonb) from public, anon;
grant execute on function public.quote_current_parent_pricing_with_sibling(jsonb) to authenticated, service_role;

create or replace function public.apply_booking_sibling_discount(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_item record;
  v_child_count integer := 0;
  v_percent numeric := public.booking_sibling_discount_percent();
  v_before numeric;
  v_final numeric;
  v_line_discount numeric;
  v_sibling_discount numeric := 0;
  v_gross numeric := 0;
  v_net numeric := 0;
  v_discount numeric := 0;
  v_deposit numeric := 0;
  v_due numeric := 0;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found'; end if;

  select count(distinct child_id)
  into v_child_count
  from public.booking_items
  where booking_id = p_booking_id and status <> 'cancelled' and child_id is not null;

  if v_child_count >= 2
     and v_percent > 0
     and coalesce((v_booking.metadata->>'siblingDiscountApplied')::boolean, false) = false then
    for v_item in
      select * from public.booking_items
      where booking_id = p_booking_id and status not in ('cancelled', 'waitlist')
      for update
    loop
      v_before := coalesce(v_item.unit_amount, 0);
      v_final := round(v_before * (1 - v_percent / 100), 2);
      v_line_discount := round((v_before - v_final) * greatest(1, v_item.quantity), 2);
      v_sibling_discount := v_sibling_discount + v_line_discount;

      update public.booking_items
      set unit_amount = v_final,
          unit_discount_amount = greatest(0, coalesce(original_unit_amount, v_before) - v_final),
          pricing_label = case when coalesce(pricing_label, '') in ('', 'Standard') then 'Sibling Discount' else pricing_label end,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'siblingDiscountApplied', true,
            'siblingDiscountPercent', v_percent,
            'siblingDiscountUnitAmount', round(v_before - v_final, 2)
          ),
          updated_at = now()
      where id = v_item.id;

      update public.booking_pricing_adjustments
      set final_unit_amount = v_final,
          discount_amount = round(greatest(0, original_unit_amount - v_final) * greatest(1, quantity), 2),
          final_line_total = round(v_final * greatest(1, quantity), 2),
          rule_name = case when coalesce(discount_type, 'no_discount') = 'no_discount' then 'Sibling Discount' else rule_name end,
          source = source,
          discount_type = case when coalesce(discount_type, 'no_discount') = 'no_discount' then 'percentage' else discount_type end,
          discount_value = case when coalesce(discount_type, 'no_discount') = 'no_discount' then v_percent else discount_value end,
          calculation = coalesce(calculation, '{}'::jsonb) || jsonb_build_object(
            'finalUnitAmount', v_final,
            'discountUnitAmount', round(greatest(0, original_unit_amount - v_final), 2),
            'siblingDiscountApplied', true,
            'siblingDiscountPercent', v_percent,
            'siblingDiscountUnitAmount', round(v_before - v_final, 2)
          )
      where booking_item_id = v_item.id;
    end loop;

    v_booking.metadata := coalesce(v_booking.metadata, '{}'::jsonb) || jsonb_build_object(
      'siblingDiscountApplied', true,
      'siblingDiscountPercent', v_percent,
      'siblingDiscountTotal', round(v_sibling_discount, 2)
    );
  else
    v_sibling_discount := coalesce(nullif(v_booking.metadata->>'siblingDiscountTotal', '')::numeric, 0);
  end if;

  select coalesce(sum(round(coalesce(original_unit_amount, unit_amount, 0) * greatest(1, quantity), 2)), 0),
         coalesce(sum(round(coalesce(unit_amount, 0) * greatest(1, quantity), 2)), 0)
  into v_gross, v_net
  from public.booking_items
  where booking_id = p_booking_id and status <> 'cancelled';

  v_discount := greatest(0, v_gross - v_net);
  v_deposit := greatest(0, coalesce(nullif(v_booking.metadata->'bookingRequest'->>'depositAmount', '')::numeric, 0));
  v_due := case when lower(v_booking.payment_plan) = 'monthly' then least(v_net, v_deposit) else v_net end;

  update public.bookings
  set gross_total = round(v_gross, 2),
      discount_amount = round(v_discount, 2),
      total_amount = round(v_net, 2),
      due_today = round(v_due, 2),
      outstanding_balance = round(greatest(0, v_net - v_due), 2),
      metadata = coalesce(v_booking.metadata, '{}'::jsonb) || jsonb_build_object(
        'grossTotal', round(v_gross, 2),
        'discountTotal', round(v_discount, 2),
        'siblingDiscountApplied', v_child_count >= 2 and v_percent > 0,
        'siblingDiscountPercent', v_percent,
        'siblingDiscountTotal', round(v_sibling_discount, 2)
      ),
      updated_at = now()
  where id = p_booking_id
  returning * into v_booking;

  return jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'grossTotal', round(v_gross, 2),
    'discountTotal', round(v_discount, 2),
    'siblingDiscountPercent', v_percent,
    'siblingDiscountTotal', round(v_sibling_discount, 2),
    'siblingDiscountApplied', v_child_count >= 2 and v_percent > 0,
    'totalAmount', round(v_net, 2),
    'pricingGroupId', v_booking.pricing_group_id,
    'pricingGroupName', coalesce(v_booking.pricing_group_name, 'Standard'),
    'items', (select coalesce(jsonb_agg(to_jsonb(bi) order by bi.starts_at), '[]'::jsonb) from public.booking_items bi where bi.booking_id = p_booking_id)
  );
end;
$$;

revoke all on function public.apply_booking_sibling_discount(uuid) from public, anon, authenticated;
grant execute on function public.apply_booking_sibling_discount(uuid) to service_role;
