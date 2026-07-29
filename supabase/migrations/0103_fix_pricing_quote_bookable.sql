create or replace function public.quote_current_parent_pricing(p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_parent_id uuid;
  v_request jsonb;
  v_context record;
  v_quote jsonb;
  v_quantity integer;
  v_gross numeric:=0;
  v_total numeric:=0;
  v_lines jsonb:='[]'::jsonb;
  v_group_name text:='Standard';
begin
  select pa.id into v_parent_id from public.parent_accounts pa where public.parent_account_has_access(pa.id)
  order by (pa.profile_id=auth.uid()) desc,pa.created_at limit 1;
  if v_parent_id is null then raise exception 'Parent account not found'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Pricing items must be an array'; end if;
  for v_request in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    select sb.id,sb.price block_price,s.price session_price,s.starts_at,p.id programme_id,p.name programme_name,p.category programme_category,p.location_id school_id
      into v_context from public.session_blocks sb join public.sessions s on s.id=sb.session_id join public.programmes p on p.id=s.programme_id
      where sb.id=nullif(coalesce(v_request->>'sessionBlockId',v_request->>'session_block_id'),'')::uuid and sb.parent_bookable;
    if v_context.id is null then raise exception 'A selected session is no longer available'; end if;
    v_quantity:=greatest(1,coalesce(nullif(v_request->>'quantity','')::integer,1));
    v_quote:=public.calculate_parent_price(v_parent_id,v_context.school_id,public.pricing_service_key(v_context.programme_name,v_context.programme_category),v_context.programme_id,v_context.starts_at::date,coalesce(nullif(v_context.block_price,0),nullif(v_context.session_price,0),0));
    v_gross:=v_gross+(v_quote->>'standardUnitAmount')::numeric*v_quantity;
    v_total:=v_total+(v_quote->>'finalUnitAmount')::numeric*v_quantity;
    v_group_name:=coalesce(v_quote->>'pricingGroupName',v_group_name);
    v_lines:=v_lines||jsonb_build_array(v_quote||jsonb_build_object('sessionBlockId',v_context.id,'quantity',v_quantity,'lineTotal',round((v_quote->>'finalUnitAmount')::numeric*v_quantity,2)));
  end loop;
  return jsonb_build_object('pricingGroupName',v_group_name,'grossTotal',round(v_gross,2),'discountTotal',round(v_gross-v_total,2),'totalAmount',round(v_total,2),'items',v_lines);
end $$;
