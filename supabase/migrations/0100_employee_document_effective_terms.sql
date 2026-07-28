-- Apply signed employment changes on their effective date without overwriting history.
alter table public.staff_records
  add column if not exists contract_hours numeric(8,2);

create or replace function public.apply_due_employment_terms()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  term record;
  applied_count integer := 0;
  numeric_value numeric;
begin
  for term in
    select history.*
    from public.employment_terms_history history
    join public.employee_documents document on document.id = history.source_document_id
    where history.status = 'pending'
      and history.effective_date <= current_date
      and document.status = 'signed'
      and document.deleted_at is null
  loop
    if term.term_key in ('salary','hourly_rate','contract_hours') then
      numeric_value := nullif(regexp_replace(coalesce(term.new_value->>'value',''), '[^0-9.-]', '', 'g'), '')::numeric;
      if numeric_value is null then
        continue;
      end if;
    end if;

    case term.term_key
      when 'salary' then update public.staff_records set annual_salary = numeric_value where id = term.staff_record_id;
      when 'hourly_rate' then update public.staff_records set pay_rate = numeric_value where id = term.staff_record_id;
      when 'contract_hours' then update public.staff_records set contract_hours = numeric_value where id = term.staff_record_id;
      when 'job_title' then update public.staff_records set job_role = term.new_value->>'value' where id = term.staff_record_id;
      when 'workplace' then update public.staff_records set primary_site = term.new_value->>'value' where id = term.staff_record_id;
      else null;
    end case;

    update public.employment_terms_history
    set status = 'applied', applied_at = now()
    where id = term.id;
    applied_count := applied_count + 1;
  end loop;
  return applied_count;
end;
$$;

revoke all on function public.apply_due_employment_terms() from public, anon, authenticated;
grant execute on function public.apply_due_employment_terms() to service_role;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'apply-due-employment-terms') then
    perform cron.schedule(
      'apply-due-employment-terms',
      '15 0 * * *',
      'select public.apply_due_employment_terms();'
    );
  end if;
end;
$$;
