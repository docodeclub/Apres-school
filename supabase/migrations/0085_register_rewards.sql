-- Positive recognition awarded from the live register.

create table if not exists public.child_rewards (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.child_profiles(id) on delete cascade,
  booking_item_id uuid references public.booking_items(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  awarded_by uuid not null references public.profiles(id) on delete restrict,
  badge_type text not null check (
    badge_type in ('excellent_behaviour', 'fab_friend', 'what_would_we_do_without_you')
  ),
  reason text not null,
  parent_email_sent_at timestamptz,
  parent_email_recipient text,
  created_at timestamptz not null default now()
);

create index if not exists child_rewards_child_created_idx
  on public.child_rewards (child_id, created_at desc);

alter table public.child_rewards enable row level security;

grant all privileges on public.child_rewards to service_role;

create or replace function public.create_register_child_reward(
  p_booking_item_id uuid,
  p_badge_type text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_reward_id uuid;
  v_badge text := lower(trim(coalesce(p_badge_type, '')));
  v_reason text := trim(coalesce(p_reason, ''));
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

  if v_badge not in ('excellent_behaviour', 'fab_friend', 'what_would_we_do_without_you') then
    raise exception 'Choose a valid reward badge.' using errcode = '22023';
  end if;

  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Add a short reason for the reward.' using errcode = '22023';
  end if;

  select
    item.child_id,
    item.session_id,
    programme.location_id
  into v_item
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  left join public.sessions session on session.id = item.session_id
  left join public.programmes programme on programme.id = session.programme_id
  where item.id = p_booking_item_id
    and item.child_id is not null
    and item.status in ('confirmed', 'attended')
    and booking.status = 'confirmed';

  if not found then
    raise exception 'This pupil is not on an active register booking.' using errcode = '22023';
  end if;

  insert into public.child_rewards (
    child_id,
    booking_item_id,
    location_id,
    session_id,
    awarded_by,
    badge_type,
    reason
  ) values (
    v_item.child_id,
    p_booking_item_id,
    v_item.location_id,
    v_item.session_id,
    auth.uid(),
    v_badge,
    v_reason
  )
  returning id into v_reward_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'Register child reward created',
    'child_rewards',
    v_reward_id,
    jsonb_build_object(
      'badgeType', v_badge,
      'childId', v_item.child_id,
      'bookingItemId', p_booking_item_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'rewardId', v_reward_id,
    'badgeType', v_badge
  );
end;
$$;

revoke all on function public.create_register_child_reward(uuid, text, text) from public;
grant execute on function public.create_register_child_reward(uuid, text, text) to authenticated;

comment on table public.child_rewards is
  'Auditable positive-recognition badges awarded to children from the staff register.';
