create or replace function public.block_waitlist_capacity_for_launch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_source text;
begin
  if new.status is distinct from 'waitlist'::booking_item_status then
    return new;
  end if;

  select coalesce(source, '')
    into v_booking_source
    from bookings
    where id = new.booking_id;

  if coalesce(v_booking_source, '') in ('parent_portal', 'booking_amendment', '') then
    raise exception 'Selected session is full. Choose another session or date.' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists block_waitlist_capacity_for_launch_insert on public.booking_items;
create trigger block_waitlist_capacity_for_launch_insert
before insert on public.booking_items
for each row
execute function public.block_waitlist_capacity_for_launch();

drop trigger if exists block_waitlist_capacity_for_launch_update on public.booking_items;
create trigger block_waitlist_capacity_for_launch_update
before update of status on public.booking_items
for each row
execute function public.block_waitlist_capacity_for_launch();
