-- Queue expense notifications as part of the secure submission workflow.
-- pg_net dispatches after the transaction commits, so the Edge Function sees
-- the completed claim and a closed browser cannot interrupt the notification.
create extension if not exists pg_net with schema extensions;

create or replace function public.submit_employee_expense_claim(p_claim_id uuid, p_receipt_path text)
returns public.employee_expense_claims
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claim public.employee_expense_claims;
  v_authorization text;
  v_request_id bigint;
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

  v_authorization := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'authorization',
    ''
  );

  if v_authorization <> '' then
    select net.http_post(
      url := 'https://djkfuftbtfthjpezvjuu.supabase.co/functions/v1/notify-expense-claim',
      headers := jsonb_build_object(
        'Authorization', v_authorization,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('claimId', v_claim.id)
    ) into v_request_id;

    insert into public.employee_expense_events(claim_id, action, detail, actor_id)
    values (
      v_claim.id,
      'notification_queued',
      'Superadmin expense notification queued securely (request ' || v_request_id::text || ').',
      auth.uid()
    );
  else
    insert into public.employee_expense_events(claim_id, action, detail, actor_id)
    values (
      v_claim.id,
      'notification_failed',
      'Superadmin notification could not be queued because the authenticated request header was unavailable.',
      auth.uid()
    );
  end if;

  return v_claim;
end
$$;

grant execute on function public.submit_employee_expense_claim(uuid,text) to authenticated;
