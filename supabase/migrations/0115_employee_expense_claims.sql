-- Employee expense claims: private receipt storage, direct-report approval and
-- explicit Admin/Superadmin transfer into a payroll run.

create table if not exists public.employee_expense_claims (
  id uuid primary key default gen_random_uuid(),
  staff_record_id uuid not null references public.staff_records(id) on delete restrict,
  expense_date date not null,
  category text not null check (category in ('Travel','Mileage','Supplies','Training','Food','Other')),
  amount numeric(10,2) not null check (amount > 0 and amount <= 10000),
  description text not null check (char_length(btrim(description)) between 3 and 1000),
  receipt_path text,
  receipt_name text,
  receipt_mime_type text,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','payroll_added')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewer_note text,
  payroll_period text,
  payroll_added_at timestamptz,
  payroll_added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_expense_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.employee_expense_claims(id) on delete cascade,
  action text not null,
  detail text,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists employee_expense_claims_staff_idx on public.employee_expense_claims(staff_record_id, created_at desc);
create index if not exists employee_expense_claims_status_idx on public.employee_expense_claims(status, created_at desc);
create index if not exists employee_expense_events_claim_idx on public.employee_expense_events(claim_id, created_at desc);

alter table public.employee_expense_claims enable row level security;
alter table public.employee_expense_events enable row level security;

grant select on public.employee_expense_claims to authenticated;
grant select on public.employee_expense_events to authenticated;

create or replace function public.can_access_employee_expense(target_staff_record_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_profile_active() and (
    public.current_user_owns_staff_record(target_staff_record_id)
    or public.current_user_app_role() in ('admin','superadmin')
    or (
      public.current_user_app_role() = 'manager'
      and exists (
        select 1
        from public.hr_reporting_lines h
        where h.staff_record_id = target_staff_record_id
          and h.manager_staff_record_id = public.current_user_staff_record_id()
          and h.archived_at is null
          and (h.effective_to is null or h.effective_to >= current_date)
      )
    )
  )
$$;
grant execute on function public.can_access_employee_expense(uuid) to authenticated;

create policy "expense claims scoped read" on public.employee_expense_claims
for select using (public.can_access_employee_expense(staff_record_id));

create policy "expense events scoped read" on public.employee_expense_events
for select using (
  exists (
    select 1 from public.employee_expense_claims c
    where c.id = employee_expense_events.claim_id
      and public.can_access_employee_expense(c.staff_record_id)
  )
);

create or replace function public.create_employee_expense_claim(
  p_expense_date date,
  p_category text,
  p_amount numeric,
  p_description text,
  p_receipt_name text,
  p_receipt_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_claim_id uuid;
begin
  if not public.current_user_profile_active() then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;
  v_staff_id := public.current_user_staff_record_id();
  if v_staff_id is null then
    raise exception 'No staff record is linked to this account.' using errcode = '42501';
  end if;
  if p_expense_date is null or p_expense_date > current_date then
    raise exception 'Choose a valid expense date.';
  end if;
  if p_category not in ('Travel','Mileage','Supplies','Training','Food','Other') then
    raise exception 'Choose a valid expense category.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then
    raise exception 'Enter an expense amount between £0.01 and £10,000.';
  end if;
  if char_length(btrim(coalesce(p_description,''))) < 3 then
    raise exception 'Explain what the expense was for.';
  end if;
  if nullif(btrim(coalesce(p_receipt_name,'')), '') is null then
    raise exception 'Attach a receipt before submitting.';
  end if;

  insert into public.employee_expense_claims (
    staff_record_id, expense_date, category, amount, description,
    receipt_name, receipt_mime_type, status
  ) values (
    v_staff_id, p_expense_date, p_category, p_amount, btrim(p_description),
    p_receipt_name, p_receipt_mime_type, 'draft'
  ) returning id into v_claim_id;

  return v_claim_id;
end
$$;
grant execute on function public.create_employee_expense_claim(date,text,numeric,text,text,text) to authenticated;

create or replace function public.submit_employee_expense_claim(p_claim_id uuid, p_receipt_path text)
returns public.employee_expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.employee_expense_claims;
begin
  select * into v_claim from public.employee_expense_claims where id = p_claim_id for update;
  if v_claim.id is null or not public.current_user_owns_staff_record(v_claim.staff_record_id) then
    raise exception 'Expense claim not found.' using errcode = '42501';
  end if;
  if v_claim.status <> 'draft' then raise exception 'This expense has already been submitted.'; end if;
  if p_receipt_path not like v_claim.staff_record_id::text || '/' || v_claim.id::text || '/%' then
    raise exception 'Receipt path does not match this expense.';
  end if;

  update public.employee_expense_claims
  set receipt_path = p_receipt_path, status = 'submitted', submitted_at = now(), updated_at = now()
  where id = v_claim.id returning * into v_claim;
  insert into public.employee_expense_events(claim_id, action, detail, actor_id)
  values (v_claim.id, 'submitted', 'Expense submitted for approval.', auth.uid());
  return v_claim;
end
$$;
grant execute on function public.submit_employee_expense_claim(uuid,text) to authenticated;

create or replace function public.review_employee_expense_claim(p_claim_id uuid, p_decision text, p_note text default null)
returns public.employee_expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.employee_expense_claims;
  v_role public.app_role;
  v_allowed boolean := false;
begin
  v_role := public.current_user_app_role();
  select * into v_claim from public.employee_expense_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Expense claim not found.'; end if;
  if v_claim.status <> 'submitted' then raise exception 'Only submitted expenses can be reviewed.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject.'; end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_note,''))) < 3 then
    raise exception 'Add a reason when rejecting an expense.';
  end if;
  v_allowed := v_role in ('admin','superadmin') or (
    v_role = 'manager' and exists (
      select 1 from public.hr_reporting_lines h
      where h.staff_record_id = v_claim.staff_record_id
        and h.manager_staff_record_id = public.current_user_staff_record_id()
        and h.archived_at is null
        and (h.effective_to is null or h.effective_to >= current_date)
    )
  );
  if not v_allowed then raise exception 'You are not authorised to review this expense.' using errcode = '42501'; end if;

  update public.employee_expense_claims
  set status = p_decision, reviewer_note = nullif(btrim(coalesce(p_note,'')), ''),
      reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  where id = v_claim.id returning * into v_claim;
  insert into public.employee_expense_events(claim_id, action, detail, actor_id)
  values (v_claim.id, p_decision, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());
  return v_claim;
end
$$;
grant execute on function public.review_employee_expense_claim(uuid,text,text) to authenticated;

create or replace function public.add_employee_expense_to_payroll(p_claim_id uuid, p_payroll_period text)
returns public.employee_expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.employee_expense_claims;
  v_run_id uuid;
begin
  if public.current_user_app_role() not in ('admin','superadmin') then
    raise exception 'Only Admin can add expenses to payroll.' using errcode = '42501';
  end if;
  if p_payroll_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Choose a valid payroll month.'; end if;
  select * into v_claim from public.employee_expense_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Expense claim not found.'; end if;
  if v_claim.status <> 'approved' then raise exception 'Only approved expenses can be added to payroll.'; end if;

  insert into public.payroll_runs(payroll_period, status, updated_by)
  values (p_payroll_period, 'Draft', auth.uid())
  on conflict (payroll_period) do update set updated_at = now(), updated_by = auth.uid()
  returning id into v_run_id;

  if exists (select 1 from public.payroll_runs where id = v_run_id and status = 'Paid') then
    raise exception 'That payroll run is already paid and locked.';
  end if;

  insert into public.payroll_run_adjustments(payroll_run_id, staff_record_id, expenses, note)
  values (v_run_id, v_claim.staff_record_id, v_claim.amount, 'Approved employee expense claim ' || v_claim.id::text)
  on conflict (payroll_run_id, staff_record_id) do update
    set expenses = public.payroll_run_adjustments.expenses + excluded.expenses,
        note = concat_ws(E'\n', nullif(public.payroll_run_adjustments.note,''), excluded.note),
        updated_at = now();

  update public.employee_expense_claims
  set status = 'payroll_added', payroll_period = p_payroll_period,
      payroll_added_at = now(), payroll_added_by = auth.uid(), updated_at = now()
  where id = v_claim.id returning * into v_claim;
  insert into public.employee_expense_events(claim_id, action, detail, actor_id)
  values (v_claim.id, 'payroll_added', 'Added to payroll ' || p_payroll_period || '.', auth.uid());
  return v_claim;
end
$$;
grant execute on function public.add_employee_expense_to_payroll(uuid,text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-expense-receipts','employee-expense-receipts',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "expense receipts owner upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-expense-receipts'
  and (storage.foldername(name))[1] = public.current_user_staff_record_id()::text
);

create policy "expense receipts scoped read" on storage.objects for select to authenticated
using (
  bucket_id = 'employee-expense-receipts'
  and exists (
    select 1 from public.employee_expense_claims c
    where c.receipt_path = name and public.can_access_employee_expense(c.staff_record_id)
  )
);

create policy "expense receipts owner cleanup" on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-expense-receipts'
  and (storage.foldername(name))[1] = public.current_user_staff_record_id()::text
  and exists (
    select 1 from public.employee_expense_claims c
    where c.receipt_path = name and c.status = 'draft'
  )
);
