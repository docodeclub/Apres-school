-- A child can only hold one active place in a session block. This protects every
-- booking entry point, including parent checkout, amendments and service writes.

create index if not exists booking_items_child_session_block_status_idx
  on public.booking_items (child_id, session_block_id, status)
  where child_id is not null and session_block_id is not null;

create or replace function public.prevent_duplicate_child_session_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.child_id is null
     or new.session_block_id is null
     or new.status not in ('reserved', 'confirmed', 'attended') then
    return new;
  end if;

  -- Serialise attempts for the same child and block so two checkouts cannot pass
  -- the duplicate check at the same time.
  perform pg_advisory_xact_lock(
    hashtextextended(new.child_id::text || ':' || new.session_block_id::text, 0)
  );

  if exists (
    select 1
      from public.booking_items existing
      left join public.booking_capacity_holds hold
        on hold.booking_item_id = existing.id
     where existing.id is distinct from new.id
       and existing.child_id = new.child_id
       and existing.session_block_id = new.session_block_id
       and (
         existing.status in ('confirmed', 'attended')
         or (
           existing.status = 'reserved'
           and hold.released_at is null
           and hold.status in ('held', 'confirmed')
           and (hold.expires_at is null or hold.expires_at > now())
         )
       )
  ) then
    raise exception 'This child is already booked or has an active payment hold for the selected session.'
      using errcode = '23505',
            detail = 'Duplicate child_id and session_block_id booking prevented.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_child_session_booking_trigger
  on public.booking_items;

create trigger prevent_duplicate_child_session_booking_trigger
before insert or update of child_id, session_block_id, status
on public.booking_items
for each row
execute function public.prevent_duplicate_child_session_booking();

revoke all on function public.prevent_duplicate_child_session_booking() from public;
grant execute on function public.prevent_duplicate_child_session_booking() to service_role;
