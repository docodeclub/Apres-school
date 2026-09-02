-- A confirmed booking must never retain reserved child-session rows. The
-- register, staffing and shared school lists correctly rely on confirmed item
-- state, so enforce the invariant in the database as well as in payment code.

create or replace function public.sync_confirmed_booking_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' then
    update public.booking_items
    set status = 'confirmed', updated_at = now()
    where booking_id = new.id
      and status = 'reserved';

    update public.booking_capacity_holds hold
    set status = 'confirmed', expires_at = null
    where hold.booking_item_id in (
      select item.id
      from public.booking_items item
      where item.booking_id = new.id
        and item.status = 'confirmed'
    )
      and hold.released_at is null
      and hold.status <> 'confirmed';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_confirmed_booking_items_trigger on public.bookings;
create trigger sync_confirmed_booking_items_trigger
  after insert or update of status on public.bookings
  for each row
  when (new.status = 'confirmed')
  execute function public.sync_confirmed_booking_items();

-- Repair bookings already confirmed before the invariant was enforced.
update public.booking_items item
set status = 'confirmed', updated_at = now()
from public.bookings booking
where booking.id = item.booking_id
  and booking.status = 'confirmed'
  and item.status = 'reserved';

update public.booking_capacity_holds hold
set status = 'confirmed', expires_at = null
where hold.booking_item_id in (
  select item.id
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  where booking.status = 'confirmed'
    and item.status = 'confirmed'
)
  and hold.released_at is null
  and hold.status <> 'confirmed';

revoke all on function public.sync_confirmed_booking_items() from public;
grant execute on function public.sync_confirmed_booking_items() to service_role;

comment on function public.sync_confirmed_booking_items() is
  'Keeps confirmed booking headers, child-session rows and capacity holds in one consistent state.';
