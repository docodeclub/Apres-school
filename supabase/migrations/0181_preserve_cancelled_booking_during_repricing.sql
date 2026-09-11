-- Preserve cancelled status when repricing a booking with no remaining sessions.
create or replace function public.apply_booking_pricing(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_booking public.bookings%rowtype;
  v_item record;
  v_quote jsonb;
  v_week_context jsonb;
  v_standard numeric;
  v_before_week numeric;
  v_final numeric;
  v_week_rate numeric;
  v_quantity integer;
  v_operating_days integer;
  v_selected_days integer;
  v_gross numeric:=0;
  v_net numeric:=0;
  v_discount numeric:=0;
  v_full_week_discount numeric:=0;
  v_deposit numeric:=0;
  v_due numeric:=0;
  v_group_id uuid;
  v_group_name text;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found'; end if;
  for v_item in
    select bi.*,sb.label block_label,sb.price block_price,s.price session_price,s.booking_metadata,p.id programme_id,p.name programme_name,p.category programme_category,l.id school_id,
      a.id adjustment_id,a.original_unit_amount adjustment_original_unit_amount,a.final_unit_amount adjustment_final_unit_amount,
      a.discount_amount adjustment_discount_amount,a.pricing_group_id adjustment_group_id,a.pricing_group_name adjustment_group_name
    from public.booking_items bi join public.session_blocks sb on sb.id=bi.session_block_id join public.sessions s on s.id=bi.session_id
    join public.programmes p on p.id=s.programme_id left join public.locations l on l.id=p.location_id
    left join public.booking_pricing_adjustments a on a.booking_item_id=bi.id
    where bi.booking_id=p_booking_id and bi.status<>'cancelled'
  loop
    v_quantity:=greatest(1,v_item.quantity);
    v_standard:=coalesce(nullif(v_item.block_price,0),nullif(v_item.session_price,0),0);
    if v_item.adjustment_id is not null then
      v_standard:=v_item.adjustment_original_unit_amount; v_final:=v_item.adjustment_final_unit_amount;
      v_gross:=v_gross+round(v_standard*v_quantity,2); v_net:=v_net+round(v_final*v_quantity,2);
      v_discount:=v_discount+round(greatest(0,v_standard-v_final)*v_quantity,2);
      v_group_id:=coalesce(v_group_id,v_item.adjustment_group_id); v_group_name:=coalesce(v_group_name,v_item.adjustment_group_name,'Standard');
      continue;
    elsif v_item.status='waitlist' then
      v_quote:=jsonb_build_object('pricingGroupName','Standard','source','standard','ruleName','Waitlist','discountType','no_discount','discountValue',0,'standardUnitAmount',v_standard,'discountUnitAmount',0,'finalUnitAmount',0);
    else
      v_quote:=public.calculate_parent_price(v_booking.parent_account_id,v_item.school_id,public.pricing_service_key(v_item.programme_name,v_item.programme_category),v_item.programme_id,v_item.starts_at::date,v_standard);
    end if;
    v_before_week:=(v_quote->>'finalUnitAmount')::numeric; v_final:=v_before_week;
    if v_item.status<>'waitlist' and v_item.programme_category='holiday_camp' and v_item.block_label='Holiday Camp' then
      v_week_context:=public.holiday_camp_week_context(v_item.programme_id,(v_item.starts_at at time zone 'Europe/London')::date);
      v_operating_days:=coalesce((v_week_context->>'operatingDays')::integer,0);
      select count(distinct (selected_item.starts_at at time zone 'Europe/London')::date) into v_selected_days
      from public.booking_items selected_item join public.session_blocks selected_block on selected_block.id=selected_item.session_block_id
      join public.sessions selected_session on selected_session.id=selected_item.session_id
      where selected_item.booking_id=p_booking_id and selected_item.status<>'cancelled' and selected_item.child_id is not distinct from v_item.child_id
        and selected_session.programme_id=v_item.programme_id and selected_block.label='Holiday Camp'
        and extract(isoyear from selected_item.starts_at at time zone 'Europe/London')=extract(isoyear from v_item.starts_at at time zone 'Europe/London')
        and extract(week from selected_item.starts_at at time zone 'Europe/London')=extract(week from v_item.starts_at at time zone 'Europe/London');
      v_week_rate:=case when v_operating_days=4 then nullif(v_week_context->>'fullWeek4Price','')::numeric/4
                        when v_operating_days=5 then nullif(v_week_context->>'fullWeek5Price','')::numeric/5 end;
      if v_operating_days in (4,5) and v_selected_days=v_operating_days and v_week_rate is not null then
        v_final:=least(v_final,round(v_week_rate,2));
        if v_final<v_before_week then
          v_full_week_discount:=v_full_week_discount+round((v_before_week-v_final)*v_quantity,2);
          v_quote:=v_quote||jsonb_build_object('ruleName','Full Week Discount','discountType','fixed_price','discountValue',v_final,
            'discountUnitAmount',round(v_standard-v_final,2),'finalUnitAmount',v_final,'campWeekDiscount',true,
            'campWeekOperatingDays',v_operating_days,'campWeekSelectedDays',v_selected_days);
        end if;
      end if;
    end if;
    v_gross:=v_gross+round(v_standard*v_quantity,2); v_net:=v_net+round(v_final*v_quantity,2); v_discount:=v_discount+round((v_standard-v_final)*v_quantity,2);
    v_group_id:=coalesce(v_group_id,nullif(v_quote->>'pricingGroupId','')::uuid); v_group_name:=coalesce(v_group_name,v_quote->>'pricingGroupName','Standard');
    update public.booking_items set original_unit_amount=v_standard,unit_amount=v_final,unit_discount_amount=greatest(0,v_standard-v_final),
      pricing_group_id=nullif(v_quote->>'pricingGroupId','')::uuid,pricing_rule_id=nullif(v_quote->>'ruleId','')::uuid,
      pricing_override_id=nullif(v_quote->>'overrideId','')::uuid,pricing_label=v_quote->>'ruleName',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pricing',v_quote),updated_at=now() where id=v_item.id;
    insert into public.booking_pricing_adjustments(booking_id,booking_item_id,parent_account_id,pricing_group_id,pricing_rule_id,pricing_override_id,school_id,programme_id,service_key,pricing_group_name,rule_name,source,discount_type,discount_value,quantity,original_unit_amount,final_unit_amount,original_line_total,discount_amount,final_line_total,calculation)
    values(p_booking_id,v_item.id,v_booking.parent_account_id,nullif(v_quote->>'pricingGroupId','')::uuid,nullif(v_quote->>'ruleId','')::uuid,nullif(v_quote->>'overrideId','')::uuid,v_item.school_id,v_item.programme_id,
      public.pricing_service_key(v_item.programme_name,v_item.programme_category),coalesce(v_quote->>'pricingGroupName','Standard'),v_quote->>'ruleName',v_quote->>'source',v_quote->>'discountType',(v_quote->>'discountValue')::numeric,
      v_quantity,v_standard,v_final,round(v_standard*v_quantity,2),round((v_standard-v_final)*v_quantity,2),round(v_final*v_quantity,2),v_quote)
    on conflict(booking_item_id) do nothing;
  end loop;
  v_deposit:=greatest(0,coalesce(nullif(v_booking.metadata->'bookingRequest'->>'depositAmount','')::numeric,0));
  v_due:=case when lower(v_booking.payment_plan)='monthly' then least(v_net,v_deposit) else v_net end;
  update public.bookings set gross_total=round(v_gross,2),discount_amount=round(v_discount,2),total_amount=round(v_net,2),due_today=round(v_due,2),
    outstanding_balance=round(greatest(0,v_net-v_due),2),pricing_group_id=v_group_id,pricing_group_name=coalesce(v_group_name,'Standard'),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pricingGroup',coalesce(v_group_name,'Standard'),'grossTotal',round(v_gross,2),
      'discountTotal',round(v_discount,2),'fullWeekDiscountTotal',round(v_full_week_discount,2)),updated_at=now()
    where id=p_booking_id returning * into v_booking;
  if v_net=0 and v_booking.status not in ('waitlist','cancelled') then
    update public.bookings set status='confirmed',updated_at=now() where id=p_booking_id returning * into v_booking;
    update public.booking_items set status='confirmed',updated_at=now() where booking_id=p_booking_id and status='reserved';
    update public.booking_capacity_holds set status='confirmed',expires_at=null where booking_item_id in(select id from public.booking_items where booking_id=p_booking_id) and released_at is null;
  end if;
  return jsonb_build_object('booking',to_jsonb(v_booking),'grossTotal',round(v_gross,2),'discountTotal',round(v_discount,2),
    'fullWeekDiscountTotal',round(v_full_week_discount,2),'totalAmount',round(v_net,2),'pricingGroupId',v_group_id,
    'pricingGroupName',coalesce(v_group_name,'Standard'),'items',(select coalesce(jsonb_agg(to_jsonb(bi) order by bi.starts_at),'[]'::jsonb) from public.booking_items bi where bi.booking_id=p_booking_id));
end $$;
revoke all on function public.apply_booking_pricing(uuid) from public,anon,authenticated;
grant execute on function public.apply_booking_pricing(uuid) to service_role;
