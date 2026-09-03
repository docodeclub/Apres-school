-- Show partner schools exactly which children are booked into each session.
-- The token scope, exposed child fields and 24-hour expiry remain unchanged.
create or replace function public.read_school_register_share(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_link public.school_register_share_links;
  v_school_name text;
  v_rows jsonb;
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  select * into v_link
  from public.school_register_share_links link
  where link.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and link.revoked_at is null
    and link.expires_at > now()
  limit 1;

  if v_link.id is null then
    return jsonb_build_object('valid', false, 'reason', 'expired_or_invalid');
  end if;

  select name into v_school_name from public.locations where id = v_link.location_id;

  select coalesce(
    jsonb_agg(
      row_data
      order by
        row_data ->> 'startsAt',
        row_data ->> 'programmeName',
        row_data ->> 'sessionLabel',
        row_data ->> 'yearGroup',
        row_data ->> 'className',
        row_data ->> 'childName'
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select distinct jsonb_build_object(
      'childName', coalesce(nullif(child.full_name, ''), nullif(item.child_name, ''), 'Child'),
      'yearGroup', coalesce(nullif(child.year_group, ''), 'Not supplied'),
      'className', coalesce(nullif(child.class_name, ''), 'Not supplied'),
      'programmeName', item.programme_name,
      'sessionLabel', item.session_label,
      'startsAt', item.starts_at,
      'endsAt', item.ends_at,
      'sessionKey', concat_ws('|', item.programme_name, item.session_label, item.starts_at, item.ends_at)
    ) as row_data
    from public.booking_items item
    join public.bookings booking on booking.id = item.booking_id
    left join public.child_profiles child on child.id = item.child_id
    where item.site_name = v_school_name
      and item.status in ('confirmed', 'attended')
      and booking.status = 'confirmed'
      and (item.starts_at at time zone 'Europe/London')::date = v_link.register_date
      and (
        (v_link.include_breakfast and lower(item.programme_name) like 'breakfast%')
        or (v_link.include_after_school and lower(item.programme_name) like 'after-school%')
      )
  ) rows;

  update public.school_register_share_links
  set last_accessed_at = now(), access_count = access_count + 1
  where id = v_link.id;

  return jsonb_build_object(
    'valid', true,
    'schoolName', v_school_name,
    'registerDate', v_link.register_date,
    'expiresAt', v_link.expires_at,
    'includeBreakfast', v_link.include_breakfast,
    'includeAfterSchool', v_link.include_after_school,
    'rows', v_rows
  );
end
$$;

revoke all on function public.read_school_register_share(text) from public;
grant execute on function public.read_school_register_share(text) to anon, authenticated;

comment on function public.read_school_register_share(text) is
  'Reads one school-scoped, expiring register link and returns child rows with their exact booked session.';
