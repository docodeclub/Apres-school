-- Integrated employee document lifecycle. Existing staff_hr_files remain the
-- source for legacy uploads and are surfaced alongside these versioned records.

create table if not exists public.employee_document_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null check (category in ('Employment','Compliance','HR','General')),
  sensitivity text not null default 'confidential' check (sensitivity in ('standard','confidential','confidential_payroll','restricted_hr','restricted_safeguarding')),
  requires_signature boolean not null default false,
  supports_expiry boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_document_templates (
  id uuid primary key default gen_random_uuid(),
  document_type_id uuid not null references public.employee_document_types(id),
  name text not null,
  description text,
  subject text not null,
  body_template text not null,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_type_id,name,version)
);

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id),
  document_type_id uuid not null references public.employee_document_types(id),
  template_id uuid references public.employee_document_templates(id) on delete set null,
  lineage_id uuid not null default gen_random_uuid(),
  version integer not null default 1 check (version > 0),
  title text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_signature','signed','declined','superseded','expired','archived')),
  source_kind text not null default 'generated' check (source_kind in ('generated','uploaded','legacy_link')),
  effective_date date,
  issue_date date,
  expiry_date date,
  reminder_days integer[] not null default '{90,30,7}',
  rendered_body text,
  merge_data jsonb not null default '{}'::jsonb,
  storage_path text,
  signed_storage_path text,
  original_filename text,
  mime_type text,
  file_size bigint,
  requires_signature boolean not null default false,
  is_active_version boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_record_id,lineage_id,version)
);

create index if not exists employee_documents_staff_timeline_idx on public.employee_documents(staff_record_id,effective_date desc,issue_date desc,created_at desc);
create index if not exists employee_documents_status_idx on public.employee_documents(status,expiry_date) where deleted_at is null;
create unique index if not exists employee_documents_active_lineage_idx on public.employee_documents(staff_record_id,lineage_id) where is_active_version and deleted_at is null;

create table if not exists public.employee_document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.employee_documents(id),
  signer_staff_record_id uuid not null references public.staff_records(id),
  signer_profile_id uuid references public.profiles(id) on delete set null,
  signature_method text not null check (signature_method in ('typed','drawn')),
  legal_name text not null,
  signature_data text,
  confirmation_text text not null,
  signer_email text,
  ip_address text,
  user_agent text,
  device_summary text,
  evidence_hash text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.employee_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.employee_documents(id),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  action text not null check (action in ('created','viewed','downloaded','edited','generated','sent','reminder_sent','signed','declined','superseded','archived','soft_deleted','uploaded')),
  notes text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists employee_document_events_document_idx on public.employee_document_events(document_id,created_at desc);

create table if not exists public.employment_terms_history (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id),
  source_document_id uuid references public.employee_documents(id),
  term_key text not null check (term_key in ('salary','hourly_rate','contract_hours','job_title','department','line_manager','workplace','holiday_entitlement','notice_period','other')),
  current_value jsonb,
  new_value jsonb not null,
  effective_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','applied','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  applied_by uuid references public.profiles(id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists employment_terms_history_staff_idx on public.employment_terms_history(staff_record_id,effective_date desc);

alter table public.employee_document_types enable row level security;
alter table public.employee_document_templates enable row level security;
alter table public.employee_documents enable row level security;
alter table public.employee_document_signatures enable row level security;
alter table public.employee_document_events enable row level security;
alter table public.employment_terms_history enable row level security;

grant select,insert,update on public.employee_document_types,public.employee_document_templates,public.employee_documents,public.employee_document_signatures,public.employee_document_events,public.employment_terms_history to authenticated;
grant all on public.employee_document_types,public.employee_document_templates,public.employee_documents,public.employee_document_signatures,public.employee_document_events,public.employment_terms_history to service_role;

create or replace function public.employee_document_staff_in_scope(target_staff_record_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select coalesce((
    select case
      when p.role in ('admin','superadmin') then true
      when p.role='manager' then target_staff_record_id=sr.id or public.current_user_manages_staff_record(target_staff_record_id)
      when p.role='staff' then target_staff_record_id=sr.id
      else false end
    from public.profiles p
    left join public.staff_records sr on sr.profile_id=p.id and sr.archived_at is null
    where p.id=auth.uid() and p.active=true limit 1
  ),false)
$$;
grant execute on function public.employee_document_staff_in_scope(uuid) to authenticated;

create or replace function public.employee_document_can_read(target_staff_record_id uuid,target_sensitivity text)
returns boolean language sql security definer set search_path=public stable as $$
  select coalesce((
    select case
      when p.role in ('admin','superadmin') then true
      when p.role='manager' then public.current_user_manages_staff_record(target_staff_record_id)
        and coalesce(target_sensitivity,'confidential') not in ('restricted_hr','confidential_payroll')
      when p.role='staff' then sr.id=target_staff_record_id
      else false end
    from public.profiles p
    left join public.staff_records sr on sr.profile_id=p.id and sr.archived_at is null
    where p.id=auth.uid() and p.active=true limit 1
  ),false)
$$;
grant execute on function public.employee_document_can_read(uuid,text) to authenticated;

create policy "employee document types read" on public.employee_document_types for select using (auth.uid() is not null);
create policy "employee document types admin manage" on public.employee_document_types for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));
create policy "employee templates read" on public.employee_document_templates for select using (auth.uid() is not null);
create policy "employee templates admin manage" on public.employee_document_templates for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));

create policy "employee documents scoped read" on public.employee_documents for select using (
  deleted_at is null and public.employee_document_can_read(staff_record_id,(select t.sensitivity from public.employee_document_types t where t.id=document_type_id))
);
create policy "employee documents admin manage" on public.employee_documents for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));

create policy "employee signatures scoped read" on public.employee_document_signatures for select using (
  exists(select 1 from public.employee_documents d join public.employee_document_types t on t.id=d.document_type_id where d.id=document_id and public.employee_document_can_read(d.staff_record_id,t.sensitivity))
);
create policy "employee signatures own insert" on public.employee_document_signatures for insert with check (
  signer_profile_id=auth.uid() and exists(select 1 from public.staff_records sr where sr.id=signer_staff_record_id and sr.profile_id=auth.uid())
);

create policy "employee events scoped read" on public.employee_document_events for select using (
  exists(select 1 from public.employee_documents d join public.employee_document_types t on t.id=d.document_type_id where d.id=document_id and public.employee_document_can_read(d.staff_record_id,t.sensitivity))
);
create policy "employee events scoped insert" on public.employee_document_events for insert with check (
  actor_id=auth.uid() and exists(select 1 from public.employee_documents d join public.employee_document_types t on t.id=d.document_type_id where d.id=document_id and public.employee_document_can_read(d.staff_record_id,t.sensitivity))
);

create policy "employment terms scoped read" on public.employment_terms_history for select using (
  public.employee_document_staff_in_scope(staff_record_id)
  and (public.current_user_app_role() in ('admin','superadmin') or term_key not in ('salary','hourly_rate'))
);
create policy "employment terms admin manage" on public.employment_terms_history for all using (public.current_user_app_role() in ('admin','superadmin')) with check (public.current_user_app_role() in ('admin','superadmin'));

create or replace function public.employee_document_record_event(p_document_id uuid,p_action text,p_notes text default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_document public.employee_documents%rowtype; v_type public.employee_document_types%rowtype; v_event public.employee_document_events%rowtype; v_email text;
begin
  select * into v_document from public.employee_documents where id=p_document_id and deleted_at is null;
  select * into v_type from public.employee_document_types where id=v_document.document_type_id;
  if v_document.id is null or not public.employee_document_can_read(v_document.staff_record_id,v_type.sensitivity) then raise exception 'Document not found or access denied.' using errcode='42501'; end if;
  if p_action not in ('viewed','downloaded') then raise exception 'This event cannot be recorded from the client.'; end if;
  select email into v_email from public.profiles where id=auth.uid();
  insert into public.employee_document_events(document_id,actor_id,actor_email,action,notes,metadata)
  values(p_document_id,auth.uid(),v_email,p_action,nullif(trim(coalesce(p_notes,'')),''),coalesce(p_metadata,'{}'::jsonb)) returning * into v_event;
  if p_action='viewed' and v_document.viewed_at is null then update public.employee_documents set viewed_at=now(),updated_at=now() where id=p_document_id; end if;
  return to_jsonb(v_event);
end; $$;
grant execute on function public.employee_document_record_event(uuid,text,text,jsonb) to authenticated;

insert into public.employee_document_types(key,name,category,sensitivity,requires_signature,supports_expiry,sort_order) values
('offer_letter','Offer Letter','Employment','confidential',true,false,10),
('employment_contract','Employment Contract','Employment','confidential_payroll',true,false,20),
('contract_variation','Contract Variation','Employment','confidential_payroll',true,false,30),
('promotion_letter','Promotion Letter','Employment','confidential_payroll',true,false,40),
('salary_review','Salary Review Letter','Employment','confidential_payroll',true,false,50),
('probation_confirmation','Probation Confirmation','Employment','confidential',true,false,60),
('probation_extension','Probation Extension','Employment','confidential',true,false,70),
('flexible_working','Flexible Working Agreement','Employment','confidential',true,false,80),
('change_hours','Change of Hours','Employment','confidential_payroll',true,false,90),
('change_role','Change of Role','Employment','confidential',true,false,100),
('change_workplace','Change of Workplace','Employment','confidential',true,false,110),
('right_to_work','Right to Work','Compliance','confidential',false,true,200),
('dbs','DBS','Compliance','restricted_safeguarding',false,true,210),
('qualification','Qualification Certificate','Compliance','confidential',false,true,220),
('first_aid','First Aid Certificate','Compliance','confidential',false,true,230),
('safeguarding_training','Safeguarding Training','Compliance','restricted_safeguarding',false,true,240),
('food_hygiene','Food Hygiene','Compliance','confidential',false,true,250),
('performance_review','Performance Review','HR','restricted_hr',true,false,300),
('return_to_work','Return to Work Form','HR','restricted_hr',true,false,310),
('disciplinary','Disciplinary Letter','HR','restricted_hr',true,false,320),
('grievance','Grievance Outcome','HR','restricted_hr',true,false,330),
('capability','Capability Letter','HR','restricted_hr',true,false,340),
('warning','Warning Letter','HR','restricted_hr',true,false,350),
('uploaded','Uploaded Document','General','confidential',false,true,400),
('other','Other','General','confidential',false,true,410)
on conflict(key) do update set name=excluded.name,category=excluded.category,sensitivity=excluded.sensitivity,requires_signature=excluded.requires_signature,supports_expiry=excluded.supports_expiry,active=true,sort_order=excluded.sort_order;

insert into public.employee_document_templates(document_type_id,name,description,subject,body_template,version)
select type.id,'Standard Contract Variation','Records an agreed change without replacing the original contract.',
  'Contract variation for {{employee_name}}',
  E'Dear {{employee_name}},\n\nThis letter confirms the agreed variation to your employment with Après School.\n\nVariation: {{variation_type}}\nCurrent value: {{current_value}}\nNew value: {{new_value}}\nEffective date: {{effective_date}}\nReason: {{reason}}\n\nAll other terms and conditions remain unchanged. Please review and sign this document to confirm that you have read and understood the variation.\n\nYours sincerely,\n{{manager_name}}\nAprès School',1
from public.employee_document_types type where type.key='contract_variation'
on conflict(document_type_id,name,version) do nothing;

insert into public.employee_document_templates(document_type_id,name,description,subject,body_template,version)
select type.id,'Standard Employment Letter','General employment letter with editable wording.',
  '{{document_title}} for {{employee_name}}',
  E'Dear {{employee_name}},\n\n{{letter_body}}\n\nEffective date: {{effective_date}}\n\nPlease review this document carefully.\n\nYours sincerely,\n{{manager_name}}\nAprès School',1
from public.employee_document_types type where type.key in ('offer_letter','promotion_letter','salary_review','probation_confirmation','probation_extension','flexible_working','change_hours','change_role','change_workplace')
on conflict(document_type_id,name,version) do nothing;
