create or replace function public.admin_upsert_holiday_camp(p_camp jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_site text := nullif(trim(p_camp->>'site'), '');
  v_area text := coalesce(nullif(trim(p_camp->>'area'), ''), 'London and Surrey');
  v_camp_name text := coalesce(nullif(trim(p_camp->>'campName'), ''), 'Holiday Camp');
  v_age_range text := coalesce(nullif(trim(p_camp->>'ageRange'), ''), 'Primary-age children');
  v_eligibility text := coalesce(nullif(trim(p_camp->>'eligibility'), ''), 'Open to children from all schools');
  v_school_only boolean := coalesce((p_camp->>'schoolOnly')::boolean, false);
  v_date_from date := nullif(trim(p_camp->>'dateFrom'), '')::date;
  v_date_to date := nullif(trim(p_camp->>'dateTo'), '')::date;
  v_start_time time := coalesce(nullif(trim(p_camp->>'startTime'), '')::time, '09:00'::time);
  v_end_time time := coalesce(nullif(trim(p_camp->>'endTime'), '')::time, '17:00'::time);
  v_price numeric(10,2) := coalesce(nullif(trim(p_camp->>'price'), '')::numeric, 50);
  v_capacity integer := coalesce(nullif(trim(p_camp->>'capacity'), '')::integer, 0);
  v_early_enabled boolean := coalesce((p_camp->>'earlyDropOffEnabled')::boolean, false);
  v_early_start time := coalesce(nullif(trim(p_camp->>'earlyDropOffStart'), '')::time, '08:00'::time);
  v_early_end time := coalesce(nullif(trim(p_camp->>'earlyDropOffEnd'), '')::time, v_start_time);
  v_early_price numeric(10,2) := coalesce(nullif(trim(p_camp->>'earlyDropOffPrice'), '')::numeric, 5);
  v_week_4_price numeric(10,2) := coalesce(nullif(trim(p_camp->>'fullWeek4Price'), '')::numeric, v_price * 4);
  v_week_5_price numeric(10,2) := coalesce(nullif(trim(p_camp->>'fullWeek5Price'), '')::numeric, v_price * 5);
  v_cancellation_hours integer := coalesce(nullif(trim(p_camp->>'cancellationHours'), '')::integer, 24);
  v_published boolean := coalesce((p_camp->>'published')::boolean, false);
  v_notes text := nullif(trim(p_camp->>'notes'), '');
  v_weekdays jsonb := coalesce(p_camp->'weekdays', '[1,2,3,4,5]'::jsonb);
  v_location_id uuid;
  v_programme_id uuid;
  v_session_id uuid;
  v_day date;
  v_count integer := 0;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true limit 1;
  if v_role not in ('admin','superadmin') then raise exception 'Only admins can manage holiday camps.'; end if;
  if v_site is null then raise exception 'Venue is required.'; end if;
  if v_date_from is null or v_date_to is null or v_date_to<v_date_from then raise exception 'Choose a valid camp date range.'; end if;
  if v_date_to-v_date_from>93 then raise exception 'A camp date range cannot exceed 93 days.'; end if;
  if v_end_time<=v_start_time then raise exception 'Camp end time must be after the start time.'; end if;
  if v_early_enabled and (v_early_end<=v_early_start or v_early_end>v_start_time) then raise exception 'Early Drop-Off must end no later than the camp day starts.'; end if;
  if v_price<0 or v_early_price<0 or v_week_4_price<0 or v_week_5_price<0 then raise exception 'Prices cannot be negative.'; end if;
  if v_capacity<1 then raise exception 'Capacity must be at least 1.'; end if;
  if jsonb_typeof(v_weekdays)<>'array' or jsonb_array_length(v_weekdays)=0 then raise exception 'Choose at least one day of the week.'; end if;

  insert into public.locations(id,name,area,booking_platform,booking_url,public_notes,operational_notes,active)
  values(public.apres_stable_uuid('location:'||v_site),v_site,v_area,'Après booking system','/launch-booking','Holiday camp venue managed by Après School.','Managed from the Holiday Camps planner.',true)
  on conflict(name) do update set area=excluded.area,booking_platform=excluded.booking_platform,booking_url=excluded.booking_url,active=true
  returning id into v_location_id;

  insert into public.programmes(id,location_id,name,category,age_range,booking_notes,active)
  values(public.apres_stable_uuid('programme:holiday-camp:'||v_site||':'||v_camp_name),v_location_id,v_camp_name,'holiday_camp',v_age_range,'Managed from the Holiday Camps planner.',true)
  on conflict(location_id,name,category) do update set age_range=excluded.age_range,booking_notes=excluded.booking_notes,active=true
  returning id into v_programme_id;

  for v_day in
    select generated_day::date from generate_series(v_date_from,v_date_to,interval '1 day') generated_day
    where exists(select 1 from jsonb_array_elements_text(v_weekdays) weekday where weekday::integer=extract(isodow from generated_day)::integer)
  loop
    insert into public.sessions(id,programme_id,starts_at,ends_at,capacity,status,notes,booking_label,parent_bookable,price,payment_route,cancellation_hours,amendment_hours,booking_cutoff_hours,eligibility,booking_metadata)
    values(
      public.apres_stable_uuid('session:holiday-camp:'||v_site||':'||v_camp_name||':'||v_day::text),v_programme_id,
      (v_day+(case when v_early_enabled then v_early_start else v_start_time end)) at time zone 'Europe/London',(v_day+v_end_time) at time zone 'Europe/London',
      v_capacity,case when v_published then 'open' else 'planning' end,coalesce(v_notes,'Holiday camp session managed from the staff planner.'),
      v_camp_name,v_published,v_price,'ponchopay_card_voucher',v_cancellation_hours,v_cancellation_hours,0,
      jsonb_build_object('schoolOnly',v_school_only,'label',v_eligibility),
      jsonb_build_object('source','holiday_camp_planner','campName',v_camp_name,'published',v_published,'sessionDate',v_day,'area',v_area,'notes',coalesce(v_notes,''),
        'fullWeek4Price',v_week_4_price,'fullWeek5Price',v_week_5_price,'earlyDropOffEnabled',v_early_enabled)
    )
    on conflict(id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,capacity=excluded.capacity,status=excluded.status,notes=excluded.notes,
      booking_label=excluded.booking_label,parent_bookable=excluded.parent_bookable,price=excluded.price,payment_route=excluded.payment_route,
      cancellation_hours=excluded.cancellation_hours,amendment_hours=excluded.amendment_hours,eligibility=excluded.eligibility,booking_metadata=excluded.booking_metadata
    returning id into v_session_id;

    delete from public.session_blocks where session_id=v_session_id and coalesce(metadata->>'source','')='holiday_camp_planner';
    insert into public.session_blocks(id,session_id,label,starts_at,ends_at,price,capacity,parent_bookable,sort_order,metadata)
    values(public.apres_stable_uuid('block:holiday-camp:'||v_site||':'||v_camp_name||':'||v_day::text),v_session_id,'Holiday Camp',
      (v_day+v_start_time) at time zone 'Europe/London',(v_day+v_end_time) at time zone 'Europe/London',v_price,v_capacity,v_published,2,
      jsonb_build_object('source','holiday_camp_planner','sessionDate',v_day,'kind','holiday_camp_day'));
    if v_early_enabled then
      insert into public.session_blocks(id,session_id,label,starts_at,ends_at,price,capacity,parent_bookable,sort_order,metadata)
      values(public.apres_stable_uuid('block:holiday-camp-early:'||v_site||':'||v_camp_name||':'||v_day::text),v_session_id,'Early Drop-Off',
        (v_day+v_early_start) at time zone 'Europe/London',(v_day+v_early_end) at time zone 'Europe/London',v_early_price,v_capacity,v_published,1,
        jsonb_build_object('source','holiday_camp_planner','sessionDate',v_day,'kind','early_drop_off'));
    end if;
    v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'No dates match the selected days.'; end if;
  insert into public.audit_log(actor_id,action,table_name,metadata) values(auth.uid(),'holiday_camp_saved','sessions',jsonb_build_object(
    'site',v_site,'campName',v_camp_name,'dateFrom',v_date_from,'dateTo',v_date_to,'sessionsUpserted',v_count,'published',v_published,
    'dayPrice',v_price,'earlyDropOffPrice',case when v_early_enabled then v_early_price else null end,'fullWeek4Price',v_week_4_price,'fullWeek5Price',v_week_5_price));
  return jsonb_build_object('ok',true,'site',v_site,'campName',v_camp_name,'sessionsUpserted',v_count,'published',v_published);
end;
$$;

drop function if exists public.public_holiday_camp_schedule();
create function public.public_holiday_camp_schedule()
returns table(session_id uuid,session_block_id uuid,programme_id uuid,site_name text,area text,camp_name text,age_range text,session_date date,
  block_label text,starts_at timestamptz,ends_at timestamptz,price numeric,capacity integer,eligibility jsonb,pricing jsonb)
language sql stable security definer set search_path=public as $$
  select s.id,b.id,p.id,l.name,l.area,coalesce(s.booking_label,p.name),p.age_range,(s.starts_at at time zone 'Europe/London')::date,
    b.label,b.starts_at,b.ends_at,b.price,coalesce(b.capacity,s.capacity),s.eligibility,
    jsonb_build_object('dayPrice',s.price,'fullWeek4Price',s.booking_metadata->'fullWeek4Price','fullWeek5Price',s.booking_metadata->'fullWeek5Price',
      'earlyDropOffEnabled',coalesce((s.booking_metadata->>'earlyDropOffEnabled')::boolean,false))
  from public.sessions s join public.programmes p on p.id=s.programme_id join public.locations l on l.id=p.location_id join public.session_blocks b on b.session_id=s.id
  where p.category='holiday_camp' and p.active and l.active and s.status='open' and s.parent_bookable and b.parent_bookable and s.starts_at>=now()
  order by s.starts_at,b.sort_order,l.name;
$$;

create or replace function public.holiday_camp_week_context(p_programme_id uuid,p_date date)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'operatingDays',count(distinct (s.starts_at at time zone 'Europe/London')::date),
    'fullWeek4Price',max(nullif(s.booking_metadata->>'fullWeek4Price','')::numeric),
    'fullWeek5Price',max(nullif(s.booking_metadata->>'fullWeek5Price','')::numeric)
  )
  from public.sessions s join public.session_blocks b on b.session_id=s.id
  where s.programme_id=p_programme_id and s.status='open' and s.parent_bookable and b.parent_bookable and b.label='Holiday Camp'
    and extract(isoyear from s.starts_at at time zone 'Europe/London')=extract(isoyear from p_date)
    and extract(week from s.starts_at at time zone 'Europe/London')=extract(week from p_date);
$$;

revoke all on function public.admin_upsert_holiday_camp(jsonb) from public;
grant execute on function public.admin_upsert_holiday_camp(jsonb) to authenticated;
grant execute on function public.public_holiday_camp_schedule() to anon,authenticated;
revoke all on function public.holiday_camp_week_context(uuid,date) from public,anon,authenticated;
grant execute on function public.holiday_camp_week_context(uuid,date) to service_role;

create or replace function public.quote_current_parent_pricing(p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_parent_id uuid;
  v_request jsonb;
  v_context record;
  v_quote jsonb;
  v_week_context jsonb;
  v_quantity integer;
  v_operating_days integer;
  v_selected_days integer;
  v_week_rate numeric;
  v_before_week numeric;
  v_final numeric;
  v_gross numeric:=0;
  v_total numeric:=0;
  v_full_week_discount numeric:=0;
  v_lines jsonb:='[]'::jsonb;
  v_group_name text:='Standard';
  v_child_key text;
begin
  select pa.id into v_parent_id from public.parent_accounts pa where public.parent_account_has_access(pa.id)
  order by (pa.profile_id=auth.uid()) desc,pa.created_at limit 1;
  if v_parent_id is null then raise exception 'Parent account not found'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Pricing items must be an array'; end if;
  for v_request in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    select sb.id,sb.label block_label,sb.price block_price,s.price session_price,s.starts_at,s.booking_metadata,
      p.id programme_id,p.name programme_name,p.category programme_category,p.location_id school_id
    into v_context from public.session_blocks sb join public.sessions s on s.id=sb.session_id join public.programmes p on p.id=s.programme_id
    where sb.id=nullif(coalesce(v_request->>'sessionBlockId',v_request->>'session_block_id'),'')::uuid and sb.parent_bookable;
    if v_context.id is null then raise exception 'A selected session is no longer available'; end if;
    v_quantity:=greatest(1,coalesce(nullif(v_request->>'quantity','')::integer,1));
    v_quote:=public.calculate_parent_price(v_parent_id,v_context.school_id,public.pricing_service_key(v_context.programme_name,v_context.programme_category),v_context.programme_id,v_context.starts_at::date,coalesce(nullif(v_context.block_price,0),nullif(v_context.session_price,0),0));
    v_before_week:=(v_quote->>'finalUnitAmount')::numeric;
    v_final:=v_before_week;
    v_child_key:=coalesce(nullif(v_request->>'childId',''),nullif(v_request->>'child_id',''),'__one_child__');

    if v_context.programme_category='holiday_camp' and v_context.block_label='Holiday Camp' then
      v_week_context:=public.holiday_camp_week_context(v_context.programme_id,(v_context.starts_at at time zone 'Europe/London')::date);
      v_operating_days:=coalesce((v_week_context->>'operatingDays')::integer,0);
      select count(distinct (selected_session.starts_at at time zone 'Europe/London')::date)
      into v_selected_days
      from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) selected_request
      join public.session_blocks selected_block on selected_block.id=nullif(coalesce(selected_request->>'sessionBlockId',selected_request->>'session_block_id'),'')::uuid
      join public.sessions selected_session on selected_session.id=selected_block.session_id
      where selected_session.programme_id=v_context.programme_id and selected_block.label='Holiday Camp'
        and coalesce(nullif(selected_request->>'childId',''),nullif(selected_request->>'child_id',''),'__one_child__')=v_child_key
        and extract(isoyear from selected_session.starts_at at time zone 'Europe/London')=extract(isoyear from v_context.starts_at at time zone 'Europe/London')
        and extract(week from selected_session.starts_at at time zone 'Europe/London')=extract(week from v_context.starts_at at time zone 'Europe/London');
      v_week_rate:=case when v_operating_days=4 then nullif(v_week_context->>'fullWeek4Price','')::numeric/4
                        when v_operating_days=5 then nullif(v_week_context->>'fullWeek5Price','')::numeric/5 end;
      if v_operating_days in (4,5) and v_selected_days=v_operating_days and v_week_rate is not null then
        v_final:=least(v_final,round(v_week_rate,2));
        if v_final<v_before_week then
          v_full_week_discount:=v_full_week_discount+round((v_before_week-v_final)*v_quantity,2);
          v_quote:=v_quote||jsonb_build_object('ruleName','Full Week Discount','discountType','fixed_price','discountValue',v_final,
            'discountUnitAmount',round((v_quote->>'standardUnitAmount')::numeric-v_final,2),'finalUnitAmount',v_final,
            'campWeekDiscount',true,'campWeekOperatingDays',v_operating_days,'campWeekSelectedDays',v_selected_days);
        end if;
      end if;
    end if;
    v_gross:=v_gross+(v_quote->>'standardUnitAmount')::numeric*v_quantity;
    v_total:=v_total+v_final*v_quantity;
    v_group_name:=coalesce(v_quote->>'pricingGroupName',v_group_name);
    v_lines:=v_lines||jsonb_build_array(v_quote||jsonb_build_object('sessionBlockId',v_context.id,'childId',nullif(v_child_key,'__one_child__'),'quantity',v_quantity,'lineTotal',round(v_final*v_quantity,2)));
  end loop;
  return jsonb_build_object('pricingGroupName',v_group_name,'grossTotal',round(v_gross,2),'discountTotal',round(v_gross-v_total,2),
    'fullWeekDiscountTotal',round(v_full_week_discount,2),'totalAmount',round(v_total,2),'items',v_lines,
    'adjustments',case when v_full_week_discount>0 then jsonb_build_array(jsonb_build_object('label','Full Week Discount','amount',round(v_full_week_discount,2))) else '[]'::jsonb end);
end $$;
revoke all on function public.quote_current_parent_pricing(jsonb) from public,anon;
grant execute on function public.quote_current_parent_pricing(jsonb) to authenticated,service_role;

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
  if v_net=0 and v_booking.status<>'waitlist' then
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
