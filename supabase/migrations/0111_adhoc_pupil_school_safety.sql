-- Make ad-hoc pupil selection unambiguous and prevent a child being placed
-- into a wraparound session at a different school.

create or replace function public.adhoc_school_key(p_school_name text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  with normalized as (
    select regexp_replace(
      lower(translate(coalesce(p_school_name, ''), 'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇàáâãäåèéêëìíîïòóôõöùúûüç', 'AAAAAAEEEEIIIIOOOOOUUUUCaaaaaaeeeeiiiiooooouuuuc')),
      '[^a-z0-9]+',
      '',
      'g'
    ) as value
  )
  select case
    when value like '%kingshouse%' then 'kings-house'
    when value like '%ripleycourt%' then 'ripley-court'
    when value like '%shrewsburyhouse%' then 'shrewsbury-house'
    when value like '%rowans%' then 'rowans'
    when value like '%willington%' then 'willington'
    else value
  end
  from normalized
$$;

grant execute on function public.adhoc_school_key(text) to authenticated, service_role;

create or replace function public.staff_adhoc_booking_options(
  p_register_date date,
  p_site_name text default null,
  p_programme_name text default null,
  p_child_query text default '',
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_children jsonb := '[]'::jsonb;
  v_sessions jsonb := '[]'::jsonb;
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

  select coalesce(jsonb_agg(to_jsonb(child_result) order by child_result.child_name), '[]'::jsonb)
  into v_children
  from (
    select
      child.id as child_id,
      coalesce(nullif(trim(child.full_name), ''), nullif(trim(child.preferred_name), ''), 'Child') as child_name,
      child.preferred_name,
      child.school_name,
      public.adhoc_school_key(child.school_name) as school_key,
      child.year_group,
      account.id as parent_account_id,
      account.full_name as parent_name,
      account.email as parent_email
    from public.child_profiles child
    join public.parent_accounts account on account.id = child.parent_account_id
    where child.active = true
      and child.archived_at is null
      and account.archived_at is null
      and account.portal_status <> 'archived'
      and (
        p_site_name is null
        or public.adhoc_school_key(child.school_name) = public.adhoc_school_key(p_site_name)
      )
      and (
        trim(coalesce(p_child_query, '')) = ''
        or concat_ws(' ', child.preferred_name, child.full_name, account.full_name, account.email)
          ilike '%' || trim(p_child_query) || '%'
      )
    order by coalesce(nullif(trim(child.full_name), ''), nullif(trim(child.preferred_name), ''), 'Child')
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) child_result;

  select coalesce(jsonb_agg(to_jsonb(session_result) order by session_result.starts_at, session_result.session_label), '[]'::jsonb)
  into v_sessions
  from (
    select
      block.id as session_block_id,
      session.id as session_id,
      location.name as site_name,
      public.adhoc_school_key(location.name) as school_key,
      programme.name as programme_name,
      block.label as session_label,
      block.starts_at,
      block.ends_at,
      coalesce(nullif(block.price, 0), session.price, 0)::numeric(10,2) as price,
      coalesce(block.capacity, session.capacity) as capacity,
      greatest(
        coalesce(block.capacity, session.capacity, 0) - (
          select coalesce(sum(item.quantity), 0)::integer
          from public.booking_items item
          left join public.booking_capacity_holds hold on hold.booking_item_id = item.id
          where item.session_block_id = block.id
            and (
              item.status in ('confirmed', 'attended')
              or (
                item.status = 'reserved'
                and hold.released_at is null
                and hold.status in ('held', 'confirmed')
                and (hold.expires_at is null or hold.expires_at > now())
              )
            )
        ),
        0
      ) as places_left
    from public.session_blocks block
    join public.sessions session on session.id = block.session_id
    join public.programmes programme on programme.id = session.programme_id
    join public.locations location on location.id = programme.location_id
    where (block.starts_at at time zone 'Europe/London')::date = p_register_date
      and block.parent_bookable = true
      and session.parent_bookable = true
      and session.status not in ('cancelled', 'closed')
      and programme.active = true
      and location.active = true
      and (p_site_name is null or public.adhoc_school_key(location.name) = public.adhoc_school_key(p_site_name))
      and (p_programme_name is null or programme.name = p_programme_name)
  ) session_result;

  return jsonb_build_object('children', v_children, 'sessions', v_sessions);
end;
$$;

alter function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean)
  rename to create_staff_adhoc_booking_unchecked;

revoke all on function public.create_staff_adhoc_booking_unchecked(uuid, date, uuid[], boolean)
  from public, anon, authenticated;

create or replace function public.create_staff_adhoc_booking(
  p_child_id uuid,
  p_register_date date,
  p_session_block_ids uuid[],
  p_apply_non_booking_fee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_child_school text;
  v_wrong_school text;
begin
  select
    coalesce(nullif(trim(child.full_name), ''), nullif(trim(child.preferred_name), ''), 'This pupil'),
    child.school_name
  into v_child_name, v_child_school
  from public.child_profiles child
  where child.id = p_child_id;

  if nullif(public.adhoc_school_key(v_child_school), '') is null then
    raise exception '% does not have a school recorded. Update the pupil record before adding ad-hoc care.', v_child_name;
  end if;

  select location.name
  into v_wrong_school
  from public.session_blocks block
  join public.sessions session on session.id = block.session_id
  join public.programmes programme on programme.id = session.programme_id
  join public.locations location on location.id = programme.location_id
  where block.id = any(p_session_block_ids)
    and public.adhoc_school_key(location.name) <> public.adhoc_school_key(v_child_school)
  limit 1;

  if v_wrong_school is not null then
    raise exception 'School mismatch: % is recorded at %. Choose a session at that school, not %.',
      v_child_name, v_child_school, v_wrong_school;
  end if;

  return public.create_staff_adhoc_booking_unchecked(
    p_child_id,
    p_register_date,
    p_session_block_ids,
    p_apply_non_booking_fee
  );
end;
$$;

revoke all on function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean) from public, anon;
grant execute on function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean) to authenticated, service_role;

comment on function public.create_staff_adhoc_booking(uuid, date, uuid[], boolean) is
  'Creates a staff ad-hoc booking only when every selected session belongs to the pupil school.';
