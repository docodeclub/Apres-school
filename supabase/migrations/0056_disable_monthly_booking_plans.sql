-- Monthly plans are disabled for new bookings. Existing historical plans remain
-- readable and can continue to receive payment/webhook status updates.

create or replace function public.enforce_pay_now_booking_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.payment_plan, 'pay_now')) in ('monthly', 'month') then
    raise exception 'Monthly payment plans are currently unavailable. Please pay in full.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_pay_now_booking_plan_trigger on public.bookings;

create trigger enforce_pay_now_booking_plan_trigger
before insert or update of payment_plan
on public.bookings
for each row
execute function public.enforce_pay_now_booking_plan();

revoke all on function public.enforce_pay_now_booking_plan() from public;
grant execute on function public.enforce_pay_now_booking_plan() to service_role;
