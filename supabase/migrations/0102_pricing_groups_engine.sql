-- Configurable, effective-dated pricing groups. All calculations are performed
-- server-side and then snapshotted against the booking item and invoice trail.

create table if not exists public.pricing_groups (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null unique,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  is_default boolean not null default false,
  assignment_criteria jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);
create unique index if not exists pricing_groups_one_default_idx on public.pricing_groups(is_default) where is_default and deleted_at is null;

create table if not exists public.pricing_group_rules (
  id uuid primary key default gen_random_uuid(),
  pricing_group_id uuid not null references public.pricing_groups(id),
  name text not null,
  school_id uuid references public.locations(id) on delete set null,
  service_key text not null default 'all',
  programme_id uuid references public.programmes(id) on delete set null,
  discount_type text not null default 'percentage' check (discount_type in ('percentage','fixed_amount','fixed_price','free_session','no_discount')),
  discount_value numeric(10,2) not null default 0 check (discount_value >= 0),
  starts_on date,
  ends_on date,
  priority integer not null default 100,
  enabled boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (discount_type <> 'percentage' or discount_value <= 100)
);
create index if not exists pricing_group_rules_match_idx on public.pricing_group_rules(pricing_group_id,enabled,school_id,service_key,programme_id,priority desc) where deleted_at is null;

create table if not exists public.parent_pricing_assignments (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references public.parent_accounts(id),
  pricing_group_id uuid not null references public.pricing_groups(id),
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists parent_pricing_assignments_effective_idx on public.parent_pricing_assignments(parent_account_id,effective_from desc) where deleted_at is null;

create table if not exists public.parent_pricing_overrides (
  id uuid primary key default gen_random_uuid(),
  parent_account_id uuid not null references public.parent_accounts(id),
  name text not null default 'Individual parent override',
  school_id uuid references public.locations(id) on delete set null,
  service_key text not null default 'all',
  programme_id uuid references public.programmes(id) on delete set null,
  discount_type text not null default 'percentage' check (discount_type in ('percentage','fixed_amount','fixed_price','free_session','no_discount')),
  discount_value numeric(10,2) not null default 0 check (discount_value >= 0),
  starts_on date,
  ends_on date,
  priority integer not null default 1000,
  enabled boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (discount_type <> 'percentage' or discount_value <= 100)
);
create index if not exists parent_pricing_overrides_match_idx on public.parent_pricing_overrides(parent_account_id,enabled,priority desc) where deleted_at is null;

alter table public.booking_items
  add column if not exists original_unit_amount numeric(10,2),
  add column if not exists unit_discount_amount numeric(10,2) not null default 0,
  add column if not exists pricing_group_id uuid references public.pricing_groups(id) on delete set null,
  add column if not exists pricing_rule_id uuid references public.pricing_group_rules(id) on delete set null,
  add column if not exists pricing_override_id uuid references public.parent_pricing_overrides(id) on delete set null,
  add column if not exists pricing_label text;

alter table public.bookings
  add column if not exists gross_total numeric(10,2) not null default 0,
  add column if not exists pricing_group_id uuid references public.pricing_groups(id) on delete set null,
  add column if not exists pricing_group_name text;

create table if not exists public.booking_pricing_adjustments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  booking_item_id uuid not null unique references public.booking_items(id),
  parent_account_id uuid references public.parent_accounts(id) on delete set null,
  pricing_group_id uuid references public.pricing_groups(id) on delete set null,
  pricing_rule_id uuid references public.pricing_group_rules(id) on delete set null,
  pricing_override_id uuid references public.parent_pricing_overrides(id) on delete set null,
  school_id uuid references public.locations(id) on delete set null,
  programme_id uuid references public.programmes(id) on delete set null,
  service_key text,
  pricing_group_name text not null,
  rule_name text,
  source text not null check (source in ('parent_override','pricing_group','discount_code','standard')),
  discount_type text not null,
  discount_value numeric(10,2) not null default 0,
  quantity integer not null default 1,
  original_unit_amount numeric(10,2) not null,
  final_unit_amount numeric(10,2) not null,
  original_line_total numeric(10,2) not null,
  discount_amount numeric(10,2) not null,
  final_line_total numeric(10,2) not null,
  calculation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists booking_pricing_adjustments_report_idx on public.booking_pricing_adjustments(pricing_group_id,school_id,created_at desc);

create table if not exists public.pricing_group_events (
  id uuid primary key default gen_random_uuid(),
  pricing_group_id uuid references public.pricing_groups(id),
  parent_account_id uuid references public.parent_accounts(id),
  rule_id uuid references public.pricing_group_rules(id),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  action text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pricing_group_events_group_idx on public.pricing_group_events(pricing_group_id,created_at desc);

alter table public.pricing_groups enable row level security;
alter table public.pricing_group_rules enable row level security;
alter table public.parent_pricing_assignments enable row level security;
alter table public.parent_pricing_overrides enable row level security;
alter table public.booking_pricing_adjustments enable row level security;
alter table public.pricing_group_events enable row level security;

grant select on public.pricing_groups,public.pricing_group_rules to authenticated;
grant select,insert,update on public.parent_pricing_assignments,public.parent_pricing_overrides to authenticated;
grant select on public.booking_pricing_adjustments to authenticated;
grant select,insert on public.pricing_group_events to authenticated;
grant all on public.pricing_groups,public.pricing_group_rules,public.parent_pricing_assignments,public.parent_pricing_overrides,public.booking_pricing_adjustments,public.pricing_group_events to service_role;

create policy "pricing groups restricted read" on public.pricing_groups for select using (public.current_user_app_role() in ('manager','admin','superadmin') and deleted_at is null);
create policy "pricing groups admin manage" on public.pricing_groups for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));
create policy "pricing rules restricted read" on public.pricing_group_rules for select using (public.current_user_app_role() in ('manager','admin','superadmin') and deleted_at is null);
create policy "pricing rules admin manage" on public.pricing_group_rules for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));
create policy "pricing assignments admin manage" on public.parent_pricing_assignments for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));
create policy "pricing assignments parent read" on public.parent_pricing_assignments for select using (deleted_at is null and public.parent_account_has_access(parent_account_id));
create policy "pricing overrides admin manage" on public.parent_pricing_overrides for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));
create policy "pricing overrides parent read" on public.parent_pricing_overrides for select using (deleted_at is null and public.parent_account_has_access(parent_account_id));
create policy "booking pricing own read" on public.booking_pricing_adjustments for select using (public.parent_account_has_access(parent_account_id) or public.current_user_app_role() in ('admin','superadmin'));
create policy "pricing events admin manager read" on public.pricing_group_events for select using (public.current_user_app_role() in ('manager','admin','superadmin'));
create policy "pricing events admin insert" on public.pricing_group_events for insert with check (public.current_user_app_role() in ('admin','superadmin') and (actor_id is null or actor_id=auth.uid()));

create or replace function public.pricing_service_key(p_name text,p_category text)
returns text language sql immutable as $$
  select case
    when lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) like '%breakfast%' then 'breakfast_club'
    when lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) like '%after%school%' then 'after_school_club'
    when lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) like '%holiday%'
      or lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) like '%camp%' then 'holiday_club'
    when lower(coalesce(p_category,'') || ' ' || coalesce(p_name,'')) like '%activity%' then 'activity_club'
    else regexp_replace(lower(trim(coalesce(nullif(p_category,''),nullif(p_name,''),'other'))),'[^a-z0-9]+','_','g')
  end
$$;

create or replace function public.calculate_parent_price(
  p_parent_account_id uuid,
  p_school_id uuid,
  p_service_key text,
  p_programme_id uuid,
  p_service_date date,
  p_standard_price numeric
)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare
  v_group public.pricing_groups%rowtype;
  v_assignment public.parent_pricing_assignments%rowtype;
  v_override public.parent_pricing_overrides%rowtype;
  v_rule public.pricing_group_rules%rowtype;
  v_source text := 'standard';
  v_type text := 'no_discount';
  v_value numeric := 0;
  v_final numeric := greatest(0,coalesce(p_standard_price,0));
  v_rule_name text := 'Standard price';
begin
  select * into v_assignment from public.parent_pricing_assignments
  where parent_account_id=p_parent_account_id and deleted_at is null
    and effective_from<=coalesce(p_service_date,current_date)
    and (effective_to is null or effective_to>=coalesce(p_service_date,current_date))
  order by effective_from desc,assigned_at desc limit 1;

  select * into v_group from public.pricing_groups
  where id=v_assignment.pricing_group_id and status='active' and deleted_at is null;
  if v_group.id is null then
    select * into v_group from public.pricing_groups where is_default and status='active' and deleted_at is null limit 1;
  end if;

  select * into v_override from public.parent_pricing_overrides
  where parent_account_id=p_parent_account_id and enabled and deleted_at is null
    and (starts_on is null or starts_on<=coalesce(p_service_date,current_date))
    and (ends_on is null or ends_on>=coalesce(p_service_date,current_date))
    and (school_id is null or school_id=p_school_id)
    and (service_key='all' or service_key=p_service_key)
    and (programme_id is null or programme_id=p_programme_id)
  order by priority desc,((programme_id is not null)::int+(school_id is not null)::int+(service_key<>'all')::int) desc,created_at desc limit 1;

  if v_override.id is not null then
    v_source := 'parent_override'; v_type := v_override.discount_type; v_value := v_override.discount_value; v_rule_name := v_override.name;
  elsif v_group.id is not null then
    select * into v_rule from public.pricing_group_rules
    where pricing_group_id=v_group.id and enabled and deleted_at is null
      and (starts_on is null or starts_on<=coalesce(p_service_date,current_date))
      and (ends_on is null or ends_on>=coalesce(p_service_date,current_date))
      and (school_id is null or school_id=p_school_id)
      and (service_key='all' or service_key=p_service_key)
      and (programme_id is null or programme_id=p_programme_id)
    order by priority desc,((programme_id is not null)::int+(school_id is not null)::int+(service_key<>'all')::int) desc,created_at desc limit 1;
    if v_rule.id is not null then
      v_source := 'pricing_group'; v_type := v_rule.discount_type; v_value := v_rule.discount_value; v_rule_name := v_rule.name;
    end if;
  end if;

  v_final := case v_type
    when 'percentage' then round(greatest(0,p_standard_price*(1-v_value/100)),2)
    when 'fixed_amount' then round(greatest(0,p_standard_price-v_value),2)
    when 'fixed_price' then round(greatest(0,v_value),2)
    when 'free_session' then 0
    else round(greatest(0,p_standard_price),2)
  end;

  return jsonb_build_object(
    'parentAccountId',p_parent_account_id,'pricingGroupId',v_group.id,'pricingGroupName',coalesce(v_group.name,'Standard'),
    'assignmentId',v_assignment.id,'ruleId',v_rule.id,'overrideId',v_override.id,'source',v_source,'ruleName',v_rule_name,
    'discountType',v_type,'discountValue',v_value,'standardUnitAmount',round(coalesce(p_standard_price,0),2),
    'discountUnitAmount',round(greatest(0,coalesce(p_standard_price,0)-v_final),2),'finalUnitAmount',v_final
  );
end $$;
revoke all on function public.calculate_parent_price(uuid,uuid,text,uuid,date,numeric) from public,anon,authenticated;
grant execute on function public.calculate_parent_price(uuid,uuid,text,uuid,date,numeric) to service_role;

create or replace function public.apply_booking_pricing(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_booking public.bookings%rowtype;
  v_item record;
  v_quote jsonb;
  v_standard numeric;
  v_final numeric;
  v_quantity integer;
  v_gross numeric := 0;
  v_net numeric := 0;
  v_discount numeric := 0;
  v_deposit numeric := 0;
  v_due numeric := 0;
  v_group_id uuid;
  v_group_name text;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found'; end if;

  for v_item in
    select bi.*,sb.price block_price,s.price session_price,p.id programme_id,p.name programme_name,p.category programme_category,l.id school_id,
      a.id adjustment_id,a.original_unit_amount adjustment_original_unit_amount,a.final_unit_amount adjustment_final_unit_amount,
      a.discount_amount adjustment_discount_amount,a.pricing_group_id adjustment_group_id,a.pricing_group_name adjustment_group_name
    from public.booking_items bi join public.session_blocks sb on sb.id=bi.session_block_id
    join public.sessions s on s.id=bi.session_id join public.programmes p on p.id=s.programme_id
    left join public.locations l on l.id=p.location_id
    left join public.booking_pricing_adjustments a on a.booking_item_id=bi.id
    where bi.booking_id=p_booking_id and bi.status<>'cancelled'
  loop
    v_quantity := greatest(1,v_item.quantity);
    v_standard := coalesce(nullif(v_item.block_price,0),nullif(v_item.session_price,0),0);
    if v_item.adjustment_id is not null then
      -- A booked line is an immutable commercial promise. Re-running this
      -- function (for example after an amendment) must not reprice it.
      v_standard := v_item.adjustment_original_unit_amount;
      v_final := v_item.adjustment_final_unit_amount;
      v_gross := v_gross+round(v_standard*v_quantity,2);
      v_net := v_net+round(v_final*v_quantity,2);
      v_discount := v_discount+round(greatest(0,v_standard-v_final)*v_quantity,2);
      v_group_id := coalesce(v_group_id,v_item.adjustment_group_id);
      v_group_name := coalesce(v_group_name,v_item.adjustment_group_name,'Standard');
      continue;
    elsif v_item.status='waitlist' then
      v_quote := jsonb_build_object('pricingGroupName','Standard','source','standard','ruleName','Waitlist','discountType','no_discount','discountValue',0,'standardUnitAmount',v_standard,'discountUnitAmount',0,'finalUnitAmount',0);
    else
      v_quote := public.calculate_parent_price(v_booking.parent_account_id,v_item.school_id,public.pricing_service_key(v_item.programme_name,v_item.programme_category),v_item.programme_id,v_item.starts_at::date,v_standard);
    end if;
    v_final := (v_quote->>'finalUnitAmount')::numeric;
    v_gross := v_gross+round(v_standard*v_quantity,2);
    v_net := v_net+round(v_final*v_quantity,2);
    v_discount := v_discount+round((v_standard-v_final)*v_quantity,2);
    v_group_id := coalesce(v_group_id,nullif(v_quote->>'pricingGroupId','')::uuid);
    v_group_name := coalesce(v_group_name,v_quote->>'pricingGroupName','Standard');

    update public.booking_items set original_unit_amount=v_standard,unit_amount=v_final,unit_discount_amount=greatest(0,v_standard-v_final),
      pricing_group_id=nullif(v_quote->>'pricingGroupId','')::uuid,pricing_rule_id=nullif(v_quote->>'ruleId','')::uuid,
      pricing_override_id=nullif(v_quote->>'overrideId','')::uuid,pricing_label=v_quote->>'ruleName',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pricing',v_quote),updated_at=now() where id=v_item.id;

    insert into public.booking_pricing_adjustments(booking_id,booking_item_id,parent_account_id,pricing_group_id,pricing_rule_id,pricing_override_id,school_id,programme_id,service_key,pricing_group_name,rule_name,source,discount_type,discount_value,quantity,original_unit_amount,final_unit_amount,original_line_total,discount_amount,final_line_total,calculation)
    values(p_booking_id,v_item.id,v_booking.parent_account_id,nullif(v_quote->>'pricingGroupId','')::uuid,nullif(v_quote->>'ruleId','')::uuid,nullif(v_quote->>'overrideId','')::uuid,v_item.school_id,v_item.programme_id,public.pricing_service_key(v_item.programme_name,v_item.programme_category),coalesce(v_quote->>'pricingGroupName','Standard'),v_quote->>'ruleName',v_quote->>'source',v_quote->>'discountType',(v_quote->>'discountValue')::numeric,v_quantity,v_standard,v_final,round(v_standard*v_quantity,2),round((v_standard-v_final)*v_quantity,2),round(v_final*v_quantity,2),v_quote)
    on conflict(booking_item_id) do nothing;
  end loop;

  v_deposit := greatest(0,coalesce(nullif(v_booking.metadata->'bookingRequest'->>'depositAmount','')::numeric,0));
  v_due := case when lower(v_booking.payment_plan)='monthly' then least(v_net,v_deposit) else v_net end;
  update public.bookings set gross_total=round(v_gross,2),discount_amount=round(v_discount,2),total_amount=round(v_net,2),due_today=round(v_due,2),outstanding_balance=round(greatest(0,v_net-v_due),2),pricing_group_id=v_group_id,pricing_group_name=coalesce(v_group_name,'Standard'),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pricingGroup',coalesce(v_group_name,'Standard'),'grossTotal',round(v_gross,2),'discountTotal',round(v_discount,2)),updated_at=now() where id=p_booking_id returning * into v_booking;
  if v_net=0 and v_booking.status<>'waitlist' then
    update public.bookings set status='confirmed',updated_at=now() where id=p_booking_id returning * into v_booking;
    update public.booking_items set status='confirmed',updated_at=now() where booking_id=p_booking_id and status='reserved';
    update public.booking_capacity_holds set status='confirmed',expires_at=null where booking_item_id in (select id from public.booking_items where booking_id=p_booking_id) and released_at is null;
  end if;
  return jsonb_build_object('booking',to_jsonb(v_booking),'grossTotal',round(v_gross,2),'discountTotal',round(v_discount,2),'totalAmount',round(v_net,2),'pricingGroupId',v_group_id,'pricingGroupName',coalesce(v_group_name,'Standard'),'items',(select coalesce(jsonb_agg(to_jsonb(bi) order by bi.starts_at),'[]'::jsonb) from public.booking_items bi where bi.booking_id=p_booking_id));
end $$;
revoke all on function public.apply_booking_pricing(uuid) from public,anon,authenticated;
grant execute on function public.apply_booking_pricing(uuid) to service_role;

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
    'benefits',(select coalesce(jsonb_agg(jsonb_build_object('name',r.name,'school',l.name,'serviceKey',r.service_key,'discountType',r.discount_type,'discountValue',r.discount_value) order by r.priority desc),'[]'::jsonb) from public.pricing_group_rules r left join public.locations l on l.id=r.school_id where r.pricing_group_id=v_group.id and r.enabled and r.deleted_at is null and (r.starts_on is null or r.starts_on<=current_date) and (r.ends_on is null or r.ends_on>=current_date)),
    'overrides',(select coalesce(jsonb_agg(jsonb_build_object('name',o.name,'serviceKey',o.service_key,'discountType',o.discount_type,'discountValue',o.discount_value)),'[]'::jsonb) from public.parent_pricing_overrides o where o.parent_account_id=v_parent_id and o.enabled and o.deleted_at is null and (o.starts_on is null or o.starts_on<=current_date) and (o.ends_on is null or o.ends_on>=current_date)),
    'academicYearSavings',(select coalesce(round(sum(a.discount_amount),2),0) from public.booking_pricing_adjustments a join public.booking_items bi on bi.id=a.booking_item_id where a.parent_account_id=v_parent_id and bi.status<>'cancelled' and bi.starts_at::date>=v_year_start),
    'academicYearStarts',v_year_start
  );
end $$;
revoke all on function public.current_parent_pricing_summary() from public,anon;
grant execute on function public.current_parent_pricing_summary() to authenticated,service_role;

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
revoke all on function public.quote_current_parent_pricing(jsonb) from public,anon;
grant execute on function public.quote_current_parent_pricing(jsonb) to authenticated,service_role;

insert into public.pricing_groups(key,name,description,is_default) values
('standard','Standard','Standard public pricing with no concession.',true),
('vip','VIP','10% off all Après School services.',false),
('shrewsbury-house-staff','Shrewsbury House Staff','Free Breakfast Club and 50% off After School Club at Shrewsbury House.',false),
('willington-staff','Willington Staff','Free After School Club and 50% off Holiday Clubs at Willington.',false),
('kings-house-staff','King''s House Staff','50% off all services at King''s House.',false),
('ripley-staff','Ripley Staff','50% off all services at Ripley.',false)
on conflict(key) do update set name=excluded.name,description=excluded.description,is_default=excluded.is_default,updated_at=now(),deleted_at=null;

insert into public.pricing_group_rules(pricing_group_id,name,service_key,discount_type,discount_value,priority)
select id,'VIP · 10% off all services','all','percentage',10,100 from public.pricing_groups where key='vip'
and not exists(select 1 from public.pricing_group_rules r where r.pricing_group_id=pricing_groups.id and r.name='VIP · 10% off all services');

insert into public.pricing_group_rules(pricing_group_id,name,school_id,service_key,discount_type,discount_value,priority)
select g.id,seed.rule_name,l.id,seed.service_key,seed.discount_type,seed.discount_value,200
from (values
  ('shrewsbury-house-staff','Shrewsbury House Staff · Free Breakfast Club','%shrewsbury house%','breakfast_club','free_session',100::numeric),
  ('shrewsbury-house-staff','Shrewsbury House Staff · 50% off After School Club','%shrewsbury house%','after_school_club','percentage',50::numeric),
  ('willington-staff','Willington Staff · Free After School Club','%willington%','after_school_club','free_session',100::numeric),
  ('willington-staff','Willington Staff · 50% off Holiday Clubs','%willington%','holiday_club','percentage',50::numeric),
  ('kings-house-staff','King''s House Staff · 50% off all services','%king''s house%','all','percentage',50::numeric),
  ('ripley-staff','Ripley Staff · 50% off all services','%ripley%','all','percentage',50::numeric)
) as seed(group_key,rule_name,school_pattern,service_key,discount_type,discount_value)
join public.pricing_groups g on g.key=seed.group_key
join lateral(select id from public.locations where lower(name) like seed.school_pattern limit 1) l on true
where not exists(select 1 from public.pricing_group_rules r where r.pricing_group_id=g.id and r.name=seed.rule_name);

insert into public.pricing_group_events(pricing_group_id,action,notes,metadata)
select id,'created','Default pricing group seeded by migration.',jsonb_build_object('source','0102_pricing_groups_engine') from public.pricing_groups g
where not exists(select 1 from public.pricing_group_events e where e.pricing_group_id=g.id and e.action='created');
