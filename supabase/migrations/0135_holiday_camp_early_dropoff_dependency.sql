-- Early Drop-Off is an add-on, never a standalone holiday-camp booking.
-- This deferred check allows the main day and add-on to be inserted in either
-- order during one checkout, and also allows an add-on to be bought later.

create or replace function public.enforce_holiday_camp_early_dropoff_dependency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block_label text;
  v_parent_account_id uuid;
begin
  if new.status not in ('reserved', 'confirmed', 'attended')
     or new.session_block_id is null then
    return new;
  end if;

  select block.label
    into v_block_label
    from public.session_blocks block
   where block.id = new.session_block_id;

  if v_block_label is distinct from 'Early Drop-Off' then
    return new;
  end if;

  select booking.parent_account_id
    into v_parent_account_id
    from public.bookings booking
   where booking.id = new.booking_id;

  if not exists (
    select 1
      from public.booking_items camp_day
      join public.session_blocks camp_block
        on camp_block.id = camp_day.session_block_id
      join public.bookings camp_booking
        on camp_booking.id = camp_day.booking_id
     where camp_day.id is distinct from new.id
       and camp_day.session_id = new.session_id
       and (
         (new.child_id is not null and camp_day.child_id = new.child_id)
         or (
           new.child_id is null
           and camp_day.child_id is null
           and lower(trim(coalesce(camp_day.child_name, ''))) = lower(trim(coalesce(new.child_name, '')))
         )
       )
       and camp_block.label = 'Holiday Camp'
       and camp_day.status in ('reserved', 'confirmed', 'attended')
       and camp_booking.status not in ('cancelled', 'draft', 'waitlist')
       and (
         camp_day.booking_id = new.booking_id
         or (
           v_parent_account_id is not null
           and camp_booking.parent_account_id = v_parent_account_id
         )
       )
  ) then
    raise exception 'Early Drop-Off can only be added when this child has a Holiday Camp booking for the same date.'
      using errcode = '23514',
            detail = 'A matching active Holiday Camp day is required for this child and session.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_holiday_camp_early_dropoff_dependency_trigger
  on public.booking_items;

create constraint trigger enforce_holiday_camp_early_dropoff_dependency_trigger
after insert or update
on public.booking_items
deferrable initially deferred
for each row
execute function public.enforce_holiday_camp_early_dropoff_dependency();

revoke all on function public.enforce_holiday_camp_early_dropoff_dependency() from public;
grant execute on function public.enforce_holiday_camp_early_dropoff_dependency() to service_role;
