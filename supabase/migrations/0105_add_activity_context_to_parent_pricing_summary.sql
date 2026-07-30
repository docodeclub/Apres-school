create or replace function public.current_parent_pricing_summary()
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_parent_id uuid;
  v_group public.pricing_groups%rowtype;
  v_assignment public.parent_pricing_assignments%rowtype;
  v_year_start date;
begin
  select pa.id into v_parent_id from public.parent_accounts pa
  where public.parent_account_has_access(pa.id)
  order by (pa.profile_id=auth.uid()) desc,pa.created_at limit 1;
  if v_parent_id is null then return jsonb_build_object('pricingGroupName','Standard','benefits','[]'::jsonb,'academicYearSavings',0); end if;

  select * into v_assignment from public.parent_pricing_assignments
  where parent_account_id=v_parent_id and deleted_at is null and effective_from<=current_date
    and (effective_to is null or effective_to>=current_date)
  order by effective_from desc,assigned_at desc limit 1;
  select * into v_group from public.pricing_groups where id=v_assignment.pricing_group_id and status='active' and deleted_at is null;
  if v_group.id is null then select * into v_group from public.pricing_groups where is_default and status='active' and deleted_at is null limit 1; end if;
  v_year_start := make_date(case when extract(month from current_date)>=9 then extract(year from current_date)::int else extract(year from current_date)::int-1 end,9,1);

  return jsonb_build_object(
    'parentAccountId',v_parent_id,'pricingGroupId',v_group.id,'pricingGroupName',coalesce(v_group.name,'Standard'),
    'description',v_group.description,'effectiveFrom',v_assignment.effective_from,
    'benefits',(select coalesce(jsonb_agg(jsonb_build_object('name',r.name,'school',l.name,'activity',p.name,'serviceKey',r.service_key,'discountType',r.discount_type,'discountValue',r.discount_value) order by r.priority desc),'[]'::jsonb) from public.pricing_group_rules r left join public.locations l on l.id=r.school_id left join public.programmes p on p.id=r.programme_id where r.pricing_group_id=v_group.id and r.enabled and r.deleted_at is null and (r.starts_on is null or r.starts_on<=current_date) and (r.ends_on is null or r.ends_on>=current_date)),
    'overrides',(select coalesce(jsonb_agg(jsonb_build_object('name',o.name,'school',l.name,'activity',p.name,'serviceKey',o.service_key,'discountType',o.discount_type,'discountValue',o.discount_value) order by o.priority desc),'[]'::jsonb) from public.parent_pricing_overrides o left join public.locations l on l.id=o.school_id left join public.programmes p on p.id=o.programme_id where o.parent_account_id=v_parent_id and o.enabled and o.deleted_at is null and (o.starts_on is null or o.starts_on<=current_date) and (o.ends_on is null or o.ends_on>=current_date)),
    'academicYearSavings',(select coalesce(round(sum(a.discount_amount),2),0) from public.booking_pricing_adjustments a join public.booking_items bi on bi.id=a.booking_item_id where a.parent_account_id=v_parent_id and bi.status<>'cancelled' and bi.starts_at::date>=v_year_start),
    'academicYearStarts',v_year_start
  );
end $$;
