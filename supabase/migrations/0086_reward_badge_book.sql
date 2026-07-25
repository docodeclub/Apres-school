-- Expand register rewards into the shared parent Badge Book and management insight feed.

alter table public.child_rewards
  drop constraint if exists child_rewards_badge_type_check;

alter table public.child_rewards
  add constraint child_rewards_badge_type_check check (
    badge_type in (
      'excellent_behaviour',
      'fab_friend',
      'what_would_we_do_without_you',
      'creativity',
      'perseverance',
      'team_player',
      'positive_attitude',
      'kindness'
    )
  );

alter table public.child_rewards
  add column if not exists club_name text,
  add column if not exists site_name text,
  add column if not exists session_label text;

create index if not exists child_rewards_created_idx
  on public.child_rewards (created_at desc);

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

  if v_badge not in (
    'excellent_behaviour',
    'fab_friend',
    'what_would_we_do_without_you',
    'creativity',
    'perseverance',
    'team_player',
    'positive_attitude',
    'kindness'
  ) then
    raise exception 'Choose a valid reward badge.' using errcode = '22023';
  end if;

  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Add a short reason for the reward.' using errcode = '22023';
  end if;

  select
    item.child_id,
    item.session_id,
    programme.location_id,
    coalesce(programme.name, session.booking_label, 'Après School club') as club_name,
    coalesce(location.name, item.site_name, 'Après School') as site_name,
    coalesce(item.session_label, session.booking_label, 'Club session') as session_label
  into v_item
  from public.booking_items item
  join public.bookings booking on booking.id = item.booking_id
  left join public.sessions session on session.id = item.session_id
  left join public.programmes programme on programme.id = session.programme_id
  left join public.locations location on location.id = programme.location_id
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
    reason,
    club_name,
    site_name,
    session_label
  ) values (
    v_item.child_id,
    p_booking_item_id,
    v_item.location_id,
    v_item.session_id,
    auth.uid(),
    v_badge,
    v_reason,
    v_item.club_name,
    v_item.site_name,
    v_item.session_label
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
      'bookingItemId', p_booking_item_id,
      'club', v_item.club_name,
      'site', v_item.site_name,
      'session', v_item.session_label
    )
  );

  return jsonb_build_object(
    'ok', true,
    'rewardId', v_reward_id,
    'badgeType', v_badge,
    'childId', v_item.child_id,
    'clubName', v_item.club_name,
    'siteName', v_item.site_name,
    'sessionLabel', v_item.session_label
  );
end;
$$;

create or replace function public.staff_register_rewards_for_day(p_register_date date)
returns table (
  reward_id uuid,
  child_id uuid,
  booking_item_id uuid,
  badge_type text,
  reason text,
  awarded_by_name text,
  club_name text,
  site_name text,
  session_label text,
  awarded_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('staff', 'manager', 'admin', 'superadmin')
  ) then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  return query
  select
    reward.id,
    reward.child_id,
    reward.booking_item_id,
    reward.badge_type,
    reward.reason,
    coalesce(profile.full_name, 'Après School team'),
    coalesce(reward.club_name, programme.name, 'Après School club'),
    coalesce(reward.site_name, location.name, 'Après School'),
    coalesce(reward.session_label, item.session_label, session.booking_label, 'Club session'),
    reward.created_at
  from public.child_rewards reward
  left join public.profiles profile on profile.id = reward.awarded_by
  left join public.booking_items item on item.id = reward.booking_item_id
  left join public.sessions session on session.id = reward.session_id
  left join public.programmes programme on programme.id = session.programme_id
  left join public.locations location on location.id = reward.location_id
  where (
    item.starts_at is not null
    and (item.starts_at at time zone 'Europe/London')::date = p_register_date
  )
  or (
    item.starts_at is null
    and (reward.created_at at time zone 'Europe/London')::date = p_register_date
  )
  order by reward.created_at desc;
end;
$$;

create or replace function public.parent_badge_book()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_account_id uuid;
  v_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_rewards jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your Badge Book.';
  end if;

  select account.id
  into v_account_id
  from public.parent_accounts account
  where account.archived_at is null
    and (
      account.profile_id = auth.uid()
      or (v_user_email <> '' and lower(account.email) = v_user_email)
      or exists (
        select 1
        from public.parent_account_holders holder
        where holder.parent_account_id = account.id
          and holder.status <> 'removed'
          and (
            holder.profile_id = auth.uid()
            or (v_user_email <> '' and lower(holder.email) = v_user_email)
          )
      )
    )
  order by case when account.profile_id = auth.uid() then 0 else 1 end
  limit 1;

  if v_account_id is null then
    return jsonb_build_object('rewards', '[]'::jsonb, 'total', 0, 'fetchedAt', now());
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reward.id,
    'childId', child.id,
    'childName', coalesce(nullif(child.preferred_name, ''), child.full_name),
    'badgeType', reward.badge_type,
    'reason', reward.reason,
    'staffName', coalesce(profile.full_name, 'Après School team'),
    'clubName', coalesce(reward.club_name, programme.name, 'Après School club'),
    'siteName', coalesce(reward.site_name, location.name, 'Après School'),
    'sessionLabel', coalesce(reward.session_label, item.session_label, session.booking_label, 'Club session'),
    'awardedAt', reward.created_at
  ) order by reward.created_at desc), '[]'::jsonb)
  into v_rewards
  from public.child_rewards reward
  join public.child_profiles child on child.id = reward.child_id
  left join public.profiles profile on profile.id = reward.awarded_by
  left join public.booking_items item on item.id = reward.booking_item_id
  left join public.sessions session on session.id = reward.session_id
  left join public.programmes programme on programme.id = session.programme_id
  left join public.locations location on location.id = reward.location_id
  where child.parent_account_id = v_account_id;

  return jsonb_build_object(
    'rewards', v_rewards,
    'total', jsonb_array_length(v_rewards),
    'fetchedAt', now()
  );
end;
$$;

create or replace function public.admin_rewards_dashboard(p_limit integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 50));
  v_today integer := 0;
  v_week integer := 0;
  v_month integer := 0;
  v_top_badges jsonb := '[]'::jsonb;
  v_top_staff jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active = true
      and role in ('manager', 'admin', 'superadmin')
  ) then
    raise exception 'Management access is required.' using errcode = '42501';
  end if;

  select
    count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London'),
    count(*) filter (where created_at >= date_trunc('week', now() at time zone 'Europe/London') at time zone 'Europe/London'),
    count(*) filter (where created_at >= date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London')
  into v_today, v_week, v_month
  from public.child_rewards;

  select coalesce(jsonb_agg(jsonb_build_object('badgeType', badge_type, 'count', badge_count) order by badge_count desc), '[]'::jsonb)
  into v_top_badges
  from (
    select badge_type, count(*)::integer as badge_count
    from public.child_rewards
    group by badge_type
    order by badge_count desc, badge_type
    limit 8
  ) badges;

  select coalesce(jsonb_agg(jsonb_build_object('staffName', staff_name, 'count', reward_count) order by reward_count desc), '[]'::jsonb)
  into v_top_staff
  from (
    select coalesce(profile.full_name, 'Après School team') as staff_name, count(*)::integer as reward_count
    from public.child_rewards reward
    left join public.profiles profile on profile.id = reward.awarded_by
    group by coalesce(profile.full_name, 'Après School team')
    order by reward_count desc, staff_name
    limit 8
  ) staff;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recent.id,
    'childId', recent.child_id,
    'childName', recent.child_name,
    'badgeType', recent.badge_type,
    'reason', recent.reason,
    'staffName', recent.staff_name,
    'clubName', recent.club_name,
    'siteName', recent.site_name,
    'awardedAt', recent.created_at
  ) order by recent.created_at desc), '[]'::jsonb)
  into v_recent
  from (
    select reward.*, coalesce(nullif(child.preferred_name, ''), child.full_name) as child_name,
      coalesce(profile.full_name, 'Après School team') as staff_name
    from public.child_rewards reward
    join public.child_profiles child on child.id = reward.child_id
    left join public.profiles profile on profile.id = reward.awarded_by
    order by reward.created_at desc
    limit v_limit
  ) recent;

  return jsonb_build_object(
    'today', v_today,
    'week', v_week,
    'month', v_month,
    'topBadges', v_top_badges,
    'topStaff', v_top_staff,
    'recent', v_recent,
    'fetchedAt', now()
  );
end;
$$;

revoke all on function public.staff_register_rewards_for_day(date) from public;
revoke all on function public.parent_badge_book() from public;
revoke all on function public.admin_rewards_dashboard(integer) from public;
grant execute on function public.staff_register_rewards_for_day(date) to authenticated;
grant execute on function public.parent_badge_book() to authenticated;
grant execute on function public.admin_rewards_dashboard(integer) to authenticated;
