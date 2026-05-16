# Après School Supabase Blueprint

This first version uses mock data in the React app, but the screens map directly to a Supabase backend.

## Core Tables

- `profiles`: auth user id, role, name, email, phone, active status.
- `staff_records`: one-to-one staff profile with personal info, employment info, emergency contact and NI number.
- `hr_reporting_lines`: staff id, reports-to staff id, scope/site responsibility, effective dates, changed by and archived status.
- `scr_checks`: right to work, identity, DBS, barred list, safeguarding, first aid, annual declarations and recruitment checks.
- `document_versions`: policy/training files, version, category, archive status, storage path.
- `document_assignments`: staff id, document version id, read status, acknowledged at.
- `locations`: school/site records, site contacts, provision notes and first-aid requirements.
- `programmes`: after-school, wraparound, holiday, enrichment and bespoke provision records.
- `sessions`: date, time, location, programme, capacity, status and operational notes.
- `session_assignments`: staff id, session id, assignment type, cover status and approved hours.
- `cover_moves`: covering staff id, covered staff id, destination site/session, move date, notes, email status and created by.
- `pay_rates`: staff id, hourly/session rate, effective dates.
- `expenses`: staff id, amount, category, receipt path, status, approver.
- `payslips`: staff id, period, file path, gross, expenses, deductions, net.
- `rewards`: badge catalogue with title, icon, description and auto-award rules.
- `staff_rewards`: staff id, reward id, awarded date, awarded by, note.
- `incidents`: type, sensitivity, location, session id, reporter, status and restricted details.
- `enquiries`: public enquiry form submissions, type, organisation, status, owner and notes.
- `audit_log`: actor, action, table, record id, timestamp and metadata.
- `rota_requirements`: site/programme, session times, setup minutes, cleanup minutes, first-aider required and Level 3/EYFS lead required.
- `hours_entries`: staff id, rota/session id, setup minutes, session minutes, cleanup minutes, unpaid break minutes, approval status and payroll period.

## Role Access

- Staff can read their own profile, sessions, pay summaries, expenses, assigned documents, acknowledgements and rewards.
- Managers can read assigned locations and staff attached to those locations.
- Admins can manage organisation-wide operations, payroll, documents, sessions and standard incidents.
- Superadmins can manage roles, storage policies, sensitive audit actions and safeguarding access.
- Safeguarding incidents should be visible only to DSL/safeguarding leads, admins explicitly granted access and superadmins.

## RLS Policy Shape

```sql
create type app_role as enum ('staff', 'manager', 'admin', 'superadmin');

create table profiles (
  id uuid primary key references auth.users(id),
  role app_role not null default 'staff',
  full_name text not null,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table staff_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  preferred_name text,
  date_of_birth date,
  address text,
  phone text,
  emergency_contact jsonb,
  job_role text,
  employment_type text,
  start_date date,
  national_insurance_number text,
  archived_at timestamptz
);

alter table profiles enable row level security;
alter table staff_records enable row level security;

create policy "staff can read own profile"
on profiles for select
using (id = auth.uid());

create policy "admins can read all profiles"
on profiles for select
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid()
    and p.role in ('admin', 'superadmin')
  )
);

create policy "staff can read own staff record"
on staff_records for select
using (profile_id = auth.uid());

create policy "admins can manage staff records"
on staff_records for all
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid()
    and p.role in ('admin', 'superadmin')
  )
);
```

## Edge Functions

- `notify-public-enquiry`: writes public enquiries to the `enquiries` table and optionally sends email to the operations inbox.
- CRM updates: admins update `enquiries.status` directly and store follow-up metadata as structured JSON in `enquiries.internal_notes` until owner assignment is upgraded to profile-backed `owner_id`.
- `request-evidence`: emails staff with a signed upload link and creates an SCR action.
- `annual-declaration-reminder`: scheduled function that prompts staff when declarations are due.
- `policy-ack-chaser`: scheduled function for outstanding document acknowledgements.
- `payroll-export`: admin-only function that returns payroll CSV for the selected period.
- `invite-user`: superadmin-only function that creates Auth users, writes `profiles`, and records audit log entries.

## Storage Buckets

- `public-assets`: website imagery and non-sensitive policy PDFs.
- `staff-evidence`: private DBS, right-to-work, qualifications and declarations.
- `policy-library`: current and archived controlled documents.
- `payslips`: private staff payslips.
- `incident-attachments`: restricted incident evidence.

All private buckets should require signed URLs and RLS-backed access checks through server-side functions.
