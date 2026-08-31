-- Repair the daily reset audit snapshot ordering. booking_register_entries uses
-- booking_item_id as its identifier and does not have a separate id column.

create or replace function public.reset_staff_register_day(
  p_register_date date,
  p_site_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_name text;
  v_reset_count integer := 0;
  v_previous_entries jsonb := '[]'::jsonb;
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

  if p_register_date is null then
    raise exception 'Choose a register date.' using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_site_name, '')), '') is null then
    raise exception 'Choose one school before resetting attendance.' using errcode = '22023';
  end if;

  select item.site_name
    into v_site_name
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  where lower(trim(item.site_name)) = lower(trim(p_site_name))
    and (item.starts_at at time zone 'Europe/London')::date = p_register_date
    and item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed'
  limit 1;

  if v_site_name is null then
    raise exception 'No active register was found for that school and date.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(entry) order by entry.updated_at, entry.booking_item_id), '[]'::jsonb)
    into v_previous_entries
  from public.booking_register_entries entry
  join public.booking_items item on item.id = entry.booking_item_id
  join public.bookings booking on booking.id = item.booking_id
  where item.site_name = v_site_name
    and (item.starts_at at time zone 'Europe/London')::date = p_register_date
    and item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed';

  delete from public.booking_register_entries entry
  using public.booking_items item, public.bookings booking
  where entry.booking_item_id = item.id
    and booking.id = item.booking_id
    and item.site_name = v_site_name
    and (item.starts_at at time zone 'Europe/London')::date = p_register_date
    and item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed';

  get diagnostics v_reset_count = row_count;

  insert into public.audit_log (actor_id, action, table_name, metadata)
  values (
    auth.uid(),
    'Register day attendance reset',
    'booking_register_entries',
    jsonb_build_object(
      'registerDate', p_register_date,
      'siteName', v_site_name,
      'resetCount', v_reset_count,
      'previousEntries', v_previous_entries
    )
  );

  return jsonb_build_object(
    'ok', true,
    'registerDate', p_register_date,
    'siteName', v_site_name,
    'resetCount', v_reset_count
  );
end;
$$;

revoke all on function public.reset_staff_register_day(date, text) from public;
grant execute on function public.reset_staff_register_day(date, text) to authenticated;

comment on function public.reset_staff_register_day(date, text) is
  'Resets attendance for one school and date to expected while preserving an audit snapshot.';
