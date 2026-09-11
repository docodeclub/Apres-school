-- Deploy before switching update-parent-booking to this RPC. Existing removal
-- permissions, notice checks and pricing snapshots remain authoritative.
create or replace function public.remove_parent_booking_items_atomic(
  p_parent_id uuid, p_booking_id uuid, p_booking_item_ids uuid[],
  p_reason text default null, p_actor_role text default 'parent'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  b public.bookings%rowtype;
  removed jsonb;
  pricing jsonb;
begin
  select * into b from public.bookings where id=p_booking_id and parent_id=p_parent_id for update;
  if not found then raise exception 'Booking was not found for this parent' using errcode='42501'; end if;
  -- A retry after cancelling the last item is a no-op, not a second credit.
  if b.status='cancelled' and cardinality(p_booking_item_ids)>0 and not exists (
    select 1 from unnest(p_booking_item_ids) selected(id)
    left join public.booking_items item on item.id=selected.id and item.booking_id=b.id
    where item.id is null or item.status is distinct from 'cancelled'
  ) then
    return jsonb_build_object('amended',false,'reason','no_active_items_selected',
      'removedItems',0,'removedTotal',0,'booking',to_jsonb(b));
  end if;
  removed:=public.amend_parent_booking_remove_items(p_parent_id,p_booking_id,p_booking_item_ids,p_reason,p_actor_role);
  pricing:=public.apply_booking_pricing(p_booking_id);
  -- Any pricing failure propagates and rolls back removal, invoice, credit,
  -- capacity and audit changes in this same database transaction.
  return removed || jsonb_build_object('pricing',pricing,'booking',pricing->'booking');
end $$;
revoke all on function public.remove_parent_booking_items_atomic(uuid,uuid,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.remove_parent_booking_items_atomic(uuid,uuid,uuid[],text,text) to service_role;
