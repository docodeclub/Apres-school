grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.programmes to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.session_assignments to authenticated;
grant select, insert, update, delete on public.document_versions to authenticated;
grant select, insert, update, delete on public.document_assignments to authenticated;

drop policy if exists "locations_admin_all" on public.locations;
create policy "locations_admin_all" on public.locations for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "programmes_admin_all" on public.programmes;
create policy "programmes_admin_all" on public.programmes for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "sessions_admin_all" on public.sessions;
create policy "sessions_admin_all" on public.sessions for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "session_assignments_admin_all" on public.session_assignments;
create policy "session_assignments_admin_all" on public.session_assignments for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "document_versions_admin_all" on public.document_versions;
create policy "document_versions_admin_all" on public.document_versions for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

drop policy if exists "document_assignments_admin_all" on public.document_assignments;
create policy "document_assignments_admin_all" on public.document_assignments for all using (
  public.current_user_app_role() in ('admin', 'superadmin')
) with check (
  public.current_user_app_role() in ('admin', 'superadmin')
);

create unique index if not exists locations_name_unique_idx on public.locations (name);
create unique index if not exists programmes_location_name_category_unique_idx on public.programmes (location_id, name, category);
create unique index if not exists sessions_programme_start_end_unique_idx on public.sessions (programme_id, starts_at, ends_at);
create unique index if not exists document_versions_title_version_unique_idx on public.document_versions (title, version);

insert into public.locations (name, area, booking_platform, booking_url, public_notes, operational_notes, active)
values
  ('Willington Prep', 'Wimbledon', 'Magicbooking', 'https://apres-school.magicbooking.co.uk/Identity/Account/Login', 'After-school care, 15:30-18:00.', 'Setup 15 minutes. Cleanup 5 minutes.', true),
  ('King''s House School', 'Richmond', 'Magicbooking', 'https://apres-school.magicbooking.co.uk/Identity/Account/Login', 'After-school care, 15:15-18:00.', 'Setup 15 minutes. Cleanup 5 minutes.', true),
  ('Shrewsbury House School', 'Surbiton', 'Magicbooking', 'https://apres-school.magicbooking.co.uk/Identity/Account/Login', 'Breakfast club, 07:30-08:00. After-school care, 15:00-18:00.', 'Setup 15 minutes. Cleanup 5 minutes.', true),
  ('Ripley Court School', 'Ripley', 'Magicbooking', 'https://apres-school.magicbooking.co.uk/Identity/Account/Login', 'After-school care, 15:00-18:00.', 'Setup 15 minutes. Cleanup 5 minutes.', true),
  ('The Rowans School', 'Wimbledon', 'Book Pebble', 'https://activities.bookpebble.co.uk/', 'Holiday camp site for selected dates.', 'Confirm camp timings before publishing.', true)
on conflict (name) do update set
  area = excluded.area,
  booking_platform = excluded.booking_platform,
  booking_url = excluded.booking_url,
  public_notes = excluded.public_notes,
  operational_notes = excluded.operational_notes,
  active = excluded.active;

insert into public.programmes (location_id, name, category, age_range, booking_notes, active)
select location.id, programme.name, programme.category, programme.age_range, programme.booking_notes, true
from public.locations location
join (
  values
    ('Willington Prep', 'After-school Club', 'wraparound', 'School pupils', 'Book through Magicbooking.'),
    ('King''s House School', 'After-school Club', 'wraparound', 'School pupils', 'Book through Magicbooking.'),
    ('Shrewsbury House School', 'Breakfast Club', 'wraparound', 'School pupils', 'Book through Magicbooking.'),
    ('Shrewsbury House School', 'After-school Club', 'wraparound', 'School pupils', 'Book through Magicbooking.'),
    ('Ripley Court School', 'After-school Club', 'wraparound', 'School pupils', 'Book through Magicbooking.'),
    ('Willington Prep', 'Holiday Camp', 'holiday_camp', 'School-age children', 'Book through the current camp booking route.'),
    ('King''s House School', 'Holiday Camp', 'holiday_camp', 'School-age children', 'Book through the current camp booking route.'),
    ('The Rowans School', 'Holiday Camp', 'holiday_camp', 'School-age children', 'Book through Book Pebble.')
) as programme(location_name, name, category, age_range, booking_notes)
  on programme.location_name = location.name
on conflict (location_id, name, category) do update set
  age_range = excluded.age_range,
  booking_notes = excluded.booking_notes,
  active = excluded.active;

insert into public.sessions (programme_id, starts_at, ends_at, capacity, status, notes)
select programme.id, session.starts_at::timestamptz, session.ends_at::timestamptz, session.capacity, session.status, session.notes
from public.programmes programme
join public.locations location on location.id = programme.location_id
join (
  values
    ('Willington Prep', 'After-school Club', '2026-06-01 15:30 Europe/London', '2026-06-01 18:00 Europe/London', 40, 'planning', 'Term-time after-school session.'),
    ('King''s House School', 'After-school Club', '2026-06-01 15:15 Europe/London', '2026-06-01 18:00 Europe/London', 40, 'planning', 'Term-time after-school session.'),
    ('Shrewsbury House School', 'Breakfast Club', '2026-06-01 07:30 Europe/London', '2026-06-01 08:00 Europe/London', 30, 'planning', 'Breakfast club session.'),
    ('Shrewsbury House School', 'After-school Club', '2026-06-01 15:00 Europe/London', '2026-06-01 18:00 Europe/London', 45, 'planning', 'Term-time after-school session.'),
    ('Ripley Court School', 'After-school Club', '2026-06-01 15:00 Europe/London', '2026-06-01 18:00 Europe/London', 45, 'planning', 'Term-time after-school session.'),
    ('Willington Prep', 'After-school Club', '2026-06-02 15:30 Europe/London', '2026-06-02 18:00 Europe/London', 40, 'planning', 'Term-time after-school session.'),
    ('King''s House School', 'After-school Club', '2026-06-02 15:15 Europe/London', '2026-06-02 18:00 Europe/London', 40, 'planning', 'Term-time after-school session.'),
    ('Shrewsbury House School', 'After-school Club', '2026-06-02 15:00 Europe/London', '2026-06-02 18:00 Europe/London', 45, 'planning', 'Term-time after-school session.'),
    ('Ripley Court School', 'After-school Club', '2026-06-02 15:00 Europe/London', '2026-06-02 18:00 Europe/London', 45, 'planning', 'Term-time after-school session.')
) as session(location_name, programme_name, starts_at, ends_at, capacity, status, notes)
  on session.location_name = location.name
  and session.programme_name = programme.name
on conflict (programme_id, starts_at, ends_at) do update set
  capacity = excluded.capacity,
  status = excluded.status,
  notes = excluded.notes;

insert into public.document_versions (title, category, version, source_url, published_at)
values
  ('Safeguarding Policy', 'Safeguarding', '2026.1', null, now()),
  ('Behaviour Policy', 'Operations', '2026.1', null, now()),
  ('Staff Handbook', 'HR', '2026.1', null, now()),
  ('Health and Safety Policy', 'Health and safety', '2026.1', null, now()),
  ('Complaints Policy', 'Governance', '2026.1', null, now()),
  ('Incident Reporting Procedure', 'Safeguarding', '2026.1', null, now()),
  ('First Aid Policy', 'Health and safety', '2026.1', null, now()),
  ('Code of Conduct', 'HR', '2026.1', null, now())
on conflict (title, version) do update set
  category = excluded.category,
  published_at = coalesce(public.document_versions.published_at, excluded.published_at);

insert into public.document_assignments (document_version_id, staff_record_id, due_at)
select document.id, staff.id, now() + interval '14 days'
from public.document_versions document
cross join public.staff_records staff
where document.version = '2026.1'
  and staff.archived_at is null
on conflict (document_version_id, staff_record_id) do nothing;
