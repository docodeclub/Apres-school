-- Queue the claimant's confirmation email within the Superadmin decision RPC.
create extension if not exists pg_net with schema extensions;

create or replace function public.review_employee_expense_claim(p_claim_id uuid, p_decision text, p_note text default null)
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
  if public.current_user_app_role() <> 'superadmin' then
    raise exception 'Only Superadmin can approve or deny an expense.' using errcode = '42501';
  end if;
  select * into v_claim from public.employee_expense_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Expense claim not found.'; end if;
  if v_claim.status <> 'submitted' then raise exception 'Only submitted expenses can be reviewed.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject.'; end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_note,''))) < 3 then
    raise exception 'Add a reason when denying an expense.';
  end if;

  update public.employee_expense_claims
  set status = p_decision, reviewer_note = nullif(btrim(coalesce(p_note,'')), ''),
      reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  where id = v_claim.id returning * into v_claim;

  insert into public.employee_expense_events(claim_id, action, detail, actor_id)
  values (v_claim.id, p_decision, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());

  v_authorization := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'authorization',
    ''
  );

  if v_authorization <> '' then
    select net.http_post(
      url := 'https://djkfuftbtfthjpezvjuu.supabase.co/functions/v1/notify-expense-decision',
      headers := jsonb_build_object(
        'Authorization', v_authorization,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('claimId', v_claim.id)
    ) into v_request_id;

    insert into public.employee_expense_events(claim_id, action, detail, actor_id)
    values (
      v_claim.id,
      'decision_notification_queued',
      'Employee decision email queued securely (request ' || v_request_id::text || ').',
      auth.uid()
    );
  else
    insert into public.employee_expense_events(claim_id, action, detail, actor_id)
    values (
      v_claim.id,
      'decision_notification_failed',
      'Employee decision email could not be queued because the authenticated request header was unavailable.',
      auth.uid()
    );
  end if;

  return v_claim;
end
$$;

grant execute on function public.review_employee_expense_claim(uuid,text,text) to authenticated;
