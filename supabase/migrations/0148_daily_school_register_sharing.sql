-- Passwordless, school-scoped daily register sharing for partner schools.
-- Links expose only child name, year group and class/form and expire after 24 hours.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

alter table public.child_profiles
  add column if not exists class_name text;

create table if not exists public.school_register_share_settings (
  location_id uuid primary key references public.locations(id) on delete cascade,
  enabled boolean not null default false,
  send_time time not null default '08:00',
  timezone text not null default 'Europe/London',
  include_breakfast boolean not null default true,
  include_after_school boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (include_breakfast or include_after_school)
);

create table if not exists public.school_register_share_recipients (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  email text not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists school_register_share_recipient_email_idx
  on public.school_register_share_recipients(location_id, lower(email));

create table if not exists public.school_register_share_links (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  recipient_id uuid references public.school_register_share_recipients(id) on delete set null,
  register_date date not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  include_breakfast boolean not null default true,
  include_after_school boolean not null default true,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists school_register_share_links_lookup_idx
  on public.school_register_share_links(token_hash, expires_at)
  where revoked_at is null;

create table if not exists public.school_register_share_deliveries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  recipient_id uuid not null references public.school_register_share_recipients(id) on delete cascade,
  register_date date not null,
  link_id uuid references public.school_register_share_links(id) on delete set null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed')),
  provider_message_id text,
  email_log_id uuid references public.email_logs(id) on delete set null,
  error_message text,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id, recipient_id, register_date)
);

alter table public.school_register_share_settings enable row level security;
alter table public.school_register_share_recipients enable row level security;
alter table public.school_register_share_links enable row level security;
alter table public.school_register_share_deliveries enable row level security;

revoke all on public.school_register_share_settings from public, anon, authenticated;
revoke all on public.school_register_share_recipients from public, anon, authenticated;
revoke all on public.school_register_share_links from public, anon, authenticated;
revoke all on public.school_register_share_deliveries from public, anon, authenticated;
grant all on public.school_register_share_settings to service_role;
grant all on public.school_register_share_recipients to service_role;
grant all on public.school_register_share_links to service_role;
grant all on public.school_register_share_deliveries to service_role;

drop policy if exists school_register_share_settings_admin_read on public.school_register_share_settings;
create policy school_register_share_settings_admin_read
  on public.school_register_share_settings for select to authenticated
  using (public.current_user_app_role() in ('admin', 'superadmin'));

drop policy if exists school_register_share_recipients_admin_read on public.school_register_share_recipients;
create policy school_register_share_recipients_admin_read
  on public.school_register_share_recipients for select to authenticated
  using (public.current_user_app_role() in ('admin', 'superadmin'));

drop policy if exists school_register_share_deliveries_admin_read on public.school_register_share_deliveries;
create policy school_register_share_deliveries_admin_read
  on public.school_register_share_deliveries for select to authenticated
  using (public.current_user_app_role() in ('admin', 'superadmin'));

grant select on public.school_register_share_settings to authenticated;
grant select on public.school_register_share_recipients to authenticated;
grant select on public.school_register_share_deliveries to authenticated;

create or replace function public.save_school_register_share_settings(
  p_location_id uuid,
  p_enabled boolean,
  p_send_time time,
  p_include_breakfast boolean,
  p_include_after_school boolean,
  p_recipients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient jsonb;
  v_email text;
  v_name text;
  v_count integer := 0;
begin
  if public.current_user_app_role() not in ('admin', 'superadmin') then
    raise exception 'Admin access is required to manage school register sharing.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.locations location
    join public.programmes programme on programme.location_id = location.id
    where location.id = p_location_id
      and location.active = true
      and programme.active = true
      and programme.category = 'wraparound'
  ) then
    raise exception 'Choose an active wraparound school.' using errcode = '22023';
  end if;

  if not coalesce(p_include_breakfast, false) and not coalesce(p_include_after_school, false) then
    raise exception 'Include Breakfast Club, After-school Club or both.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) <> 'array' then
    raise exception 'Recipients must be supplied as a list.' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_recipients, '[]'::jsonb)) > 100 then
    raise exception 'A maximum of 100 recipients can be added to one school.' using errcode = '22023';
  end if;

  insert into public.school_register_share_settings (
    location_id, enabled, send_time, include_breakfast, include_after_school, updated_by, updated_at
  ) values (
    p_location_id,
    coalesce(p_enabled, false),
    coalesce(p_send_time, '08:00'::time),
    coalesce(p_include_breakfast, false),
    coalesce(p_include_after_school, false),
    auth.uid(),
    now()
  )
  on conflict (location_id) do update
  set enabled = excluded.enabled,
      send_time = excluded.send_time,
      include_breakfast = excluded.include_breakfast,
      include_after_school = excluded.include_after_school,
      updated_by = excluded.updated_by,
      updated_at = now();

  update public.school_register_share_recipients
  set active = false, updated_at = now()
  where location_id = p_location_id;

  for v_recipient in select value from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb))
  loop
    v_email := lower(trim(coalesce(v_recipient ->> 'email', '')));
    v_name := nullif(trim(coalesce(v_recipient ->> 'name', '')), '');
    if v_email = '' then continue; end if;
    if v_email !~* '^[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
      raise exception 'Invalid register recipient email: %', v_email using errcode = '22023';
    end if;
    insert into public.school_register_share_recipients(location_id, email, name, active, updated_at)
    values (p_location_id, v_email, v_name, true, now())
    on conflict (location_id, (lower(email))) do update
    set name = excluded.name,
        active = true,
        updated_at = now();
  end loop;

  select count(*) into v_count
  from public.school_register_share_recipients
  where location_id = p_location_id and active = true;

  if coalesce(p_enabled, false) and v_count = 0 then
    raise exception 'Add at least one recipient before enabling daily register emails.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'locationId', p_location_id,
    'enabled', coalesce(p_enabled, false),
    'sendTime', to_char(coalesce(p_send_time, '08:00'::time), 'HH24:MI'),
    'includeBreakfast', coalesce(p_include_breakfast, false),
    'includeAfterSchool', coalesce(p_include_after_school, false),
    'recipientCount', v_count
  );
end
$$;

revoke all on function public.save_school_register_share_settings(uuid, boolean, time, boolean, boolean, jsonb) from public, anon;
grant execute on function public.save_school_register_share_settings(uuid, boolean, time, boolean, boolean, jsonb) to authenticated;

create or replace function public.school_register_share_admin_snapshot()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select case
    when public.current_user_app_role() not in ('admin', 'superadmin') then
      jsonb_build_object('error', 'Admin access is required.')
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'locationId', location.id,
        'schoolName', location.name,
        'area', coalesce(location.area, ''),
        'enabled', coalesce(settings.enabled, false),
        'sendTime', coalesce(to_char(settings.send_time, 'HH24:MI'), '08:00'),
        'includeBreakfast', coalesce(settings.include_breakfast, exists(
          select 1 from public.programmes p where p.location_id = location.id and p.active = true and p.category = 'wraparound' and lower(p.name) like 'breakfast%'
        )),
        'includeAfterSchool', coalesce(settings.include_after_school, exists(
          select 1 from public.programmes p where p.location_id = location.id and p.active = true and p.category = 'wraparound' and lower(p.name) like 'after-school%'
        )),
        'hasBreakfast', exists(
          select 1 from public.programmes p where p.location_id = location.id and p.active = true and p.category = 'wraparound' and lower(p.name) like 'breakfast%'
        ),
        'hasAfterSchool', exists(
          select 1 from public.programmes p where p.location_id = location.id and p.active = true and p.category = 'wraparound' and lower(p.name) like 'after-school%'
        ),
        'recipients', coalesce((
          select jsonb_agg(jsonb_build_object('id', recipient.id, 'email', recipient.email, 'name', coalesce(recipient.name, '')) order by recipient.email)
          from public.school_register_share_recipients recipient
          where recipient.location_id = location.id and recipient.active = true
        ), '[]'::jsonb),
        'lastDelivery', (
          select jsonb_build_object(
            'date', delivery.register_date,
            'status', delivery.status,
            'sentAt', delivery.sent_at,
            'error', coalesce(delivery.error_message, '')
          )
          from public.school_register_share_deliveries delivery
          where delivery.location_id = location.id
          order by delivery.attempted_at desc
          limit 1
        )
      ) order by location.name)
      from public.locations location
      left join public.school_register_share_settings settings on settings.location_id = location.id
      where location.active = true
        and exists (
          select 1 from public.programmes p where p.location_id = location.id and p.active = true and p.category = 'wraparound'
        )
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.school_register_share_admin_snapshot() from public, anon;
grant execute on function public.school_register_share_admin_snapshot() to authenticated;

create or replace function public.school_register_share_due_locations(p_local_date date, p_local_time time)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'locationId', location.id,
    'schoolName', location.name,
    'sendTime', to_char(settings.send_time, 'HH24:MI'),
    'includeBreakfast', settings.include_breakfast,
    'includeAfterSchool', settings.include_after_school,
    'recipients', (
      select coalesce(jsonb_agg(jsonb_build_object('id', recipient.id, 'email', recipient.email, 'name', coalesce(recipient.name, '')) order by recipient.email), '[]'::jsonb)
      from public.school_register_share_recipients recipient
      where recipient.location_id = location.id and recipient.active = true
    ),
    'breakfastCount', (
      select count(distinct item.child_id)
      from public.booking_items item
      join public.bookings booking on booking.id = item.booking_id and booking.status = 'confirmed'
      where item.site_name = location.name
        and lower(item.programme_name) like 'breakfast%'
        and item.status in ('confirmed', 'attended')
        and (item.starts_at at time zone 'Europe/London')::date = p_local_date
    ),
    'afterSchoolCount', (
      select count(distinct item.child_id)
      from public.booking_items item
      join public.bookings booking on booking.id = item.booking_id and booking.status = 'confirmed'
      where item.site_name = location.name
        and lower(item.programme_name) like 'after-school%'
        and item.status in ('confirmed', 'attended')
        and (item.starts_at at time zone 'Europe/London')::date = p_local_date
    )
  ) order by location.name), '[]'::jsonb)
  from public.school_register_share_settings settings
  join public.locations location on location.id = settings.location_id
  where settings.enabled = true
    and settings.send_time <= p_local_time
    and exists (
      select 1
      from public.sessions session
      join public.programmes programme on programme.id = session.programme_id
      where programme.location_id = settings.location_id
        and programme.category = 'wraparound'
        and programme.active = true
        and session.status = 'open'
        and (session.starts_at at time zone 'Europe/London')::date = p_local_date
        and (
          (settings.include_breakfast and lower(programme.name) like 'breakfast%')
          or (settings.include_after_school and lower(programme.name) like 'after-school%')
        )
    )
    and exists (
      select 1 from public.school_register_share_recipients recipient
      where recipient.location_id = settings.location_id and recipient.active = true
    );
$$;

revoke all on function public.school_register_share_due_locations(date, time) from public, anon, authenticated;
grant execute on function public.school_register_share_due_locations(date, time) to service_role;

create or replace function public.read_school_register_share(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_link public.school_register_share_links;
  v_school_name text;
  v_rows jsonb;
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  select * into v_link
  from public.school_register_share_links link
  where link.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and link.revoked_at is null
    and link.expires_at > now()
  limit 1;

  if v_link.id is null then
    return jsonb_build_object('valid', false, 'reason', 'expired_or_invalid');
  end if;

  select name into v_school_name from public.locations where id = v_link.location_id;

  select coalesce(jsonb_agg(row_data order by row_data ->> 'programmeName', row_data ->> 'yearGroup', row_data ->> 'className', row_data ->> 'childName'), '[]'::jsonb)
  into v_rows
  from (
    select distinct jsonb_build_object(
      'childName', coalesce(nullif(child.full_name, ''), nullif(item.child_name, ''), 'Child'),
      'yearGroup', coalesce(nullif(child.year_group, ''), 'Not supplied'),
      'className', coalesce(nullif(child.class_name, ''), 'Not supplied'),
      'programmeName', item.programme_name
    ) as row_data
    from public.booking_items item
    join public.bookings booking on booking.id = item.booking_id
    left join public.child_profiles child on child.id = item.child_id
    where item.site_name = v_school_name
      and item.status in ('confirmed', 'attended')
      and booking.status = 'confirmed'
      and (item.starts_at at time zone 'Europe/London')::date = v_link.register_date
      and (
        (v_link.include_breakfast and lower(item.programme_name) like 'breakfast%')
        or (v_link.include_after_school and lower(item.programme_name) like 'after-school%')
      )
  ) rows;

  update public.school_register_share_links
  set last_accessed_at = now(), access_count = access_count + 1
  where id = v_link.id;

  return jsonb_build_object(
    'valid', true,
    'schoolName', v_school_name,
    'registerDate', v_link.register_date,
    'expiresAt', v_link.expires_at,
    'includeBreakfast', v_link.include_breakfast,
    'includeAfterSchool', v_link.include_after_school,
    'rows', v_rows
  );
end
$$;

revoke all on function public.read_school_register_share(text) from public;
grant execute on function public.read_school_register_share(text) to anon, authenticated;

create or replace function public.invoke_daily_school_register_share_job()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'apres_register_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(v_secret, '') = '' then return; end if;

  perform net.http_post(
    url := 'https://djkfuftbtfthjpezvjuu.supabase.co/functions/v1/send-school-register-shares',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-apres-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end
$$;

revoke all on function public.invoke_daily_school_register_share_job() from public, anon, authenticated;
grant execute on function public.invoke_daily_school_register_share_job() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'send-daily-school-register-shares';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'send-daily-school-register-shares',
    '*/5 * * * *',
    'select public.invoke_daily_school_register_share_job();'
  );
end
$$;

comment on function public.read_school_register_share(text) is
  'Reads only name, year group and class/form for one school and date through a hashed 24-hour token.';
