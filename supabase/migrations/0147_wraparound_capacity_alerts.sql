-- Set the approved 2026/27 wraparound capacities and notify operations once
-- when a specific school/date/session first becomes full.
create extension if not exists pg_net with schema extensions;

with approved_capacity as (
  select
    s.id as session_id,
    case
      when l.name = 'Willington Prep' then 50
      when l.name = 'Ripley Court' then 20
      when l.name = 'King''s House School' and p.name = 'After-school Club' then 20
      when l.name = 'Shrewsbury House School' and p.name in ('Breakfast Club', 'After-school Club') then 20
      else null
    end as capacity
  from public.sessions s
  join public.programmes p on p.id = s.programme_id
  join public.locations l on l.id = p.location_id
  where p.category = 'wraparound'
)
update public.sessions s
set capacity = approved.capacity
from approved_capacity approved
where approved.session_id = s.id
  and approved.capacity is not null
  and s.capacity is distinct from approved.capacity;

with approved_capacity as (
  select
    s.id as session_id,
    case
      when l.name = 'Willington Prep' then 50
      when l.name = 'Ripley Court' then 20
      when l.name = 'King''s House School' and p.name = 'After-school Club' then 20
      when l.name = 'Shrewsbury House School' and p.name in ('Breakfast Club', 'After-school Club') then 20
      else null
    end as capacity
  from public.sessions s
  join public.programmes p on p.id = s.programme_id
  join public.locations l on l.id = p.location_id
  where p.category = 'wraparound'
)
update public.session_blocks b
set capacity = approved.capacity,
    updated_at = now()
from approved_capacity approved
where approved.session_id = b.session_id
  and approved.capacity is not null
  and b.capacity is distinct from approved.capacity;

create table if not exists public.capacity_alerts (
  id uuid primary key default gen_random_uuid(),
  session_block_id uuid not null unique references public.session_blocks(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  school_name text not null,
  programme_name text not null,
  session_label text not null,
  session_date date not null,
  capacity integer not null check (capacity > 0),
  occupied integer not null check (occupied >= 0),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  notification_attempts integer not null default 0,
  provider_message_id text,
  email_log_id uuid references public.email_logs(id) on delete set null,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.capacity_alerts enable row level security;
revoke all on public.capacity_alerts from public, anon, authenticated;
grant all on public.capacity_alerts to service_role;

create or replace function public.queue_session_capacity_alert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_alert_id uuid;
  v_capacity integer;
  v_occupied integer;
  v_session_id uuid;
  v_school_name text;
  v_programme_name text;
  v_session_label text;
  v_session_date date;
  v_authorization text;
  v_headers text;
  v_request_id bigint;
begin
  if new.session_block_id is null then
    return new;
  end if;

  select
    coalesce(block.capacity, session.capacity),
    session.id,
    location.name,
    programme.name,
    block.label,
    (block.starts_at at time zone 'Europe/London')::date
  into
    v_capacity,
    v_session_id,
    v_school_name,
    v_programme_name,
    v_session_label,
    v_session_date
  from public.session_blocks block
  join public.sessions session on session.id = block.session_id
  join public.programmes programme on programme.id = session.programme_id
  join public.locations location on location.id = programme.location_id
  where block.id = new.session_block_id;

  if coalesce(v_capacity, 0) <= 0 then
    return new;
  end if;

  select coalesce(sum(hold.quantity), 0)::integer
  into v_occupied
  from public.booking_capacity_holds hold
  where hold.session_block_id = new.session_block_id
    and hold.released_at is null
    and hold.status in ('held', 'confirmed')
    and (hold.expires_at is null or hold.expires_at > now());

  if v_occupied < v_capacity then
    return new;
  end if;

  insert into public.capacity_alerts (
    session_block_id,
    session_id,
    school_name,
    programme_name,
    session_label,
    session_date,
    capacity,
    occupied
  ) values (
    new.session_block_id,
    v_session_id,
    v_school_name,
    v_programme_name,
    v_session_label,
    v_session_date,
    v_capacity,
    v_occupied
  )
  on conflict (session_block_id) do update
  set occupied = excluded.occupied,
      capacity = excluded.capacity,
      status = 'pending',
      updated_at = now()
  where public.capacity_alerts.status = 'failed'
  returning id into v_alert_id;

  if v_alert_id is null then
    return new;
  end if;

  v_headers := nullif(current_setting('request.headers', true), '');
  if v_headers is not null then
    begin
      v_authorization := v_headers::jsonb ->> 'authorization';
    exception when others then
      v_authorization := null;
    end;
  end if;

  if coalesce(v_authorization, '') <> '' then
    select net.http_post(
      url := 'https://djkfuftbtfthjpezvjuu.supabase.co/functions/v1/notify-capacity-alert',
      headers := jsonb_build_object(
        'Authorization', v_authorization,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('alertId', v_alert_id)
    ) into v_request_id;
  end if;

  return new;
end
$$;

drop trigger if exists queue_session_capacity_alert_after_hold on public.booking_capacity_holds;
create trigger queue_session_capacity_alert_after_hold
after insert or update of status, released_at, quantity, expires_at
on public.booking_capacity_holds
for each row
execute function public.queue_session_capacity_alert();

comment on table public.capacity_alerts is
  'One deduplicated operational email alert per school/date/session when active capacity is first reached.';

