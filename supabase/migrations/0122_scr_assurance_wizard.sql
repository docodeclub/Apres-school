-- Persistent, auditable progress for the site SCR and assurance-letter wizard.
create table if not exists public.scr_assurance_workflows (
  id uuid primary key default gen_random_uuid(),
  school_key text not null unique,
  school_name text not null,
  step_status jsonb not null default '{}'::jsonb,
  assurance_reviewed boolean not null default false,
  include_evidence_appendix boolean not null default false,
  recipient_name text,
  submission_method text,
  submission_note text,
  letter_status text not null default 'draft' check (letter_status in ('draft','generated','submitted')),
  generated_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scr_assurance_workflows_status_idx
  on public.scr_assurance_workflows(letter_status, updated_at desc);

alter table public.scr_assurance_workflows enable row level security;

grant select, insert, update on public.scr_assurance_workflows to authenticated;

drop policy if exists "scr assurance admin read" on public.scr_assurance_workflows;
create policy "scr assurance admin read" on public.scr_assurance_workflows
for select using (public.current_user_app_role() in ('admin','superadmin'));

drop policy if exists "scr assurance admin insert" on public.scr_assurance_workflows;
create policy "scr assurance admin insert" on public.scr_assurance_workflows
for insert with check (
  public.current_user_app_role() in ('admin','superadmin')
  and updated_by = auth.uid()
);

drop policy if exists "scr assurance admin update" on public.scr_assurance_workflows;
create policy "scr assurance admin update" on public.scr_assurance_workflows
for update using (public.current_user_app_role() in ('admin','superadmin'))
with check (
  public.current_user_app_role() in ('admin','superadmin')
  and updated_by = auth.uid()
);

create or replace function public.save_scr_assurance_workflow(
  p_school_name text,
  p_step_status jsonb default '{}'::jsonb,
  p_assurance_reviewed boolean default false,
  p_include_evidence_appendix boolean default false,
  p_recipient_name text default null,
  p_submission_method text default null,
  p_submission_note text default null,
  p_letter_status text default 'draft'
)
returns public.scr_assurance_workflows
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_row public.scr_assurance_workflows;
  v_existing public.scr_assurance_workflows;
begin
  if public.current_user_app_role() not in ('admin','superadmin') then
    raise exception 'Only Admin can manage SCR assurance workflows.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_school_name,'')), '') is null then
    raise exception 'Choose a school before saving the assurance workflow.';
  end if;
  if p_letter_status not in ('draft','generated','submitted') then
    raise exception 'Choose a valid assurance letter status.';
  end if;

  v_key := lower(regexp_replace(btrim(p_school_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_key := trim(both '-' from v_key);
  select * into v_existing from public.scr_assurance_workflows where school_key = v_key;

  if p_letter_status = 'submitted' then
    if coalesce(p_step_status ->> 'site', '') <> 'complete'
      or coalesce(p_step_status ->> 'staff', '') <> 'complete'
      or coalesce(p_step_status ->> 'evidence', '') <> 'complete'
      or coalesce(p_step_status ->> 'cover', '') <> 'complete'
      or coalesce(p_step_status ->> 'assurance', '') <> 'complete' then
      raise exception 'Complete every required SCR section before marking the assurance letter submitted.';
    end if;
    if nullif(btrim(coalesce(p_recipient_name,'')), '') is null then
      raise exception 'Record who received the assurance letter.';
    end if;
    if nullif(btrim(coalesce(p_submission_method,'')), '') is null then
      raise exception 'Record how the assurance letter was submitted.';
    end if;
  end if;

  insert into public.scr_assurance_workflows (
    school_key, school_name, step_status, assurance_reviewed,
    include_evidence_appendix, recipient_name, submission_method,
    submission_note, letter_status, generated_at, submitted_at,
    submitted_by, updated_by, updated_at
  ) values (
    v_key, btrim(p_school_name), coalesce(p_step_status, '{}'::jsonb), p_assurance_reviewed,
    p_include_evidence_appendix, nullif(btrim(coalesce(p_recipient_name,'')), ''),
    nullif(btrim(coalesce(p_submission_method,'')), ''), nullif(btrim(coalesce(p_submission_note,'')), ''),
    p_letter_status,
    case when p_letter_status in ('generated','submitted') then coalesce(v_existing.generated_at, now()) else v_existing.generated_at end,
    case when p_letter_status = 'submitted' then coalesce(v_existing.submitted_at, now()) else v_existing.submitted_at end,
    case when p_letter_status = 'submitted' then coalesce(v_existing.submitted_by, auth.uid()) else v_existing.submitted_by end,
    auth.uid(), now()
  )
  on conflict (school_key) do update set
    school_name = excluded.school_name,
    step_status = excluded.step_status,
    assurance_reviewed = excluded.assurance_reviewed,
    include_evidence_appendix = excluded.include_evidence_appendix,
    recipient_name = excluded.recipient_name,
    submission_method = excluded.submission_method,
    submission_note = excluded.submission_note,
    letter_status = excluded.letter_status,
    generated_at = excluded.generated_at,
    submitted_at = excluded.submitted_at,
    submitted_by = excluded.submitted_by,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_row;

  insert into public.audit_log(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    case when p_letter_status = 'submitted' then 'scr_assurance_letter_submitted' else 'scr_assurance_workflow_saved' end,
    'scr_assurance_workflows',
    v_row.id,
    jsonb_build_object(
      'school', v_row.school_name,
      'letterStatus', v_row.letter_status,
      'recipient', v_row.recipient_name,
      'submissionMethod', v_row.submission_method,
      'stepStatus', v_row.step_status
    )
  );

  return v_row;
end
$$;

grant execute on function public.save_scr_assurance_workflow(text,jsonb,boolean,boolean,text,text,text,text) to authenticated;
