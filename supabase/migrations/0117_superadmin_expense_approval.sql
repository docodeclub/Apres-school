-- Expense decisions are reserved for Superadmin. Managers and Admins retain
-- scoped/read access for operational awareness, but cannot approve or reject.
create or replace function public.review_employee_expense_claim(p_claim_id uuid, p_decision text, p_note text default null)
returns public.employee_expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.employee_expense_claims;
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
  return v_claim;
end
$$;
grant execute on function public.review_employee_expense_claim(uuid,text,text) to authenticated;
