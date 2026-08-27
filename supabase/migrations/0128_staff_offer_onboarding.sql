create table if not exists public.staff_offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.staff_applications(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','withdrawn','expired','onboarding')),
  job_title text not null,
  school_name text,
  manager_name text,
  employment_type text,
  contract_type text,
  pay_basis text not null default 'hourly' check (pay_basis in ('hourly','salary')),
  pay_amount numeric(10,2),
  contract_hours numeric(8,2),
  start_date date,
  offer_expires_at timestamptz,
  account_email text not null,
  access_role text not null default 'staff' check (access_role in ('staff','manager')),
  personal_message text,
  rendered_offer text not null,
  response_token_hash text,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  staff_record_id uuid references public.staff_records(id) on delete set null,
  account_created_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_candidate_onboarding (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.staff_applications(id) on delete restrict,
  offer_id uuid not null unique references public.staff_offers(id) on delete restrict,
  staff_record_id uuid references public.staff_records(id) on delete set null,
  status text not null default 'offered' check (status in ('offered','accepted','in_progress','ready','completed','declined')),
  section_status jsonb not null default '{}'::jsonb,
  imported_application_data jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  completed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_offers_status_idx on public.staff_offers(status,updated_at desc);
create index if not exists staff_candidate_onboarding_status_idx on public.staff_candidate_onboarding(status,updated_at desc);

alter table public.staff_offers enable row level security;
alter table public.staff_candidate_onboarding enable row level security;

grant select on public.staff_offers,public.staff_candidate_onboarding to authenticated;
grant all on public.staff_offers,public.staff_candidate_onboarding to service_role;

create policy "Admins can read staff offers" on public.staff_offers for select to authenticated using (
  exists(select 1 from public.profiles where id=auth.uid() and active=true and role in ('admin','superadmin'))
);
create policy "Admins can read candidate onboarding" on public.staff_candidate_onboarding for select to authenticated using (
  exists(select 1 from public.profiles where id=auth.uid() and active=true and role in ('admin','superadmin'))
);

create or replace function public.save_staff_offer(
  p_application_id uuid,
  p_job_title text,
  p_school_name text default null,
  p_manager_name text default null,
  p_employment_type text default null,
  p_contract_type text default null,
  p_pay_basis text default 'hourly',
  p_pay_amount numeric default null,
  p_contract_hours numeric default null,
  p_start_date date default null,
  p_offer_expires_at timestamptz default null,
  p_account_email text default null,
  p_access_role text default 'staff',
  p_personal_message text default null,
  p_rendered_offer text default null
)
returns public.staff_offers
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text;
  v_application public.staff_applications;
  v_offer public.staff_offers;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','superadmin') then raise exception 'Only Admin can prepare job offers.' using errcode='42501'; end if;
  select * into v_application from public.staff_applications where id=p_application_id;
  if v_application.id is null then raise exception 'Application not found.'; end if;
  if nullif(trim(coalesce(p_job_title,'')),'') is null then raise exception 'Enter the offered job title.'; end if;
  if p_pay_basis not in ('hourly','salary') then raise exception 'Choose hourly or salary pay.'; end if;
  if p_access_role not in ('staff','manager') then raise exception 'Choose Staff or Manager access.'; end if;
  if nullif(trim(coalesce(p_account_email,v_application.email,'')),'') is null then raise exception 'Enter an account email.'; end if;

  insert into public.staff_offers(
    application_id,status,job_title,school_name,manager_name,employment_type,contract_type,
    pay_basis,pay_amount,contract_hours,start_date,offer_expires_at,account_email,access_role,
    personal_message,rendered_offer,created_by,updated_by,updated_at
  ) values (
    v_application.id,'draft',trim(p_job_title),nullif(trim(coalesce(p_school_name,'')),''),
    nullif(trim(coalesce(p_manager_name,'')),''),nullif(trim(coalesce(p_employment_type,'')),''),
    nullif(trim(coalesce(p_contract_type,'')),''),p_pay_basis,p_pay_amount,p_contract_hours,p_start_date,
    p_offer_expires_at,lower(trim(coalesce(p_account_email,v_application.email))),p_access_role,
    nullif(trim(coalesce(p_personal_message,'')),''),coalesce(nullif(trim(coalesce(p_rendered_offer,'')),''),'Offer details pending.'),
    auth.uid(),auth.uid(),now()
  )
  on conflict(application_id) do update set
    job_title=excluded.job_title,school_name=excluded.school_name,manager_name=excluded.manager_name,
    employment_type=excluded.employment_type,contract_type=excluded.contract_type,pay_basis=excluded.pay_basis,
    pay_amount=excluded.pay_amount,contract_hours=excluded.contract_hours,start_date=excluded.start_date,
    offer_expires_at=excluded.offer_expires_at,account_email=excluded.account_email,access_role=excluded.access_role,
    personal_message=excluded.personal_message,rendered_offer=excluded.rendered_offer,updated_by=auth.uid(),updated_at=now()
  returning * into v_offer;

  insert into public.staff_candidate_onboarding(application_id,offer_id,status,section_status,imported_application_data,updated_by)
  values(v_application.id,v_offer.id,'offered',jsonb_build_object(
    'offer','draft','personal','imported_unverified','rightToWork','incomplete','identity','incomplete','dbs','incomplete',
    'references','imported_unverified','qualifications','imported_unverified','health','imported_unverified',
    'documents','incomplete','scrReview','incomplete','siteSetup','incomplete'
  ),jsonb_build_object('identity',jsonb_build_object('name',v_application.name,'email',v_application.email,'phone',v_application.phone,'dateOfBirth',v_application.date_of_birth,'address',v_application.address),'application',v_application.application_data),auth.uid())
  on conflict(application_id) do update set offer_id=excluded.offer_id,imported_application_data=excluded.imported_application_data,updated_by=auth.uid(),updated_at=now();

  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'staff_offer_saved','staff_offers',v_offer.id,jsonb_build_object('applicationId',v_application.id,'status',v_offer.status));
  return v_offer;
end;
$$;

revoke all on function public.save_staff_offer(uuid,text,text,text,text,text,text,numeric,numeric,date,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.save_staff_offer(uuid,text,text,text,text,text,text,numeric,numeric,date,timestamptz,text,text,text,text) to authenticated;
