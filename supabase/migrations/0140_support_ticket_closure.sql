alter table public.enquiries
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists parent_reopened_at timestamptz,
  add column if not exists reopen_token uuid not null default gen_random_uuid();

create index if not exists enquiries_closed_at_idx
  on public.enquiries (closed_at desc)
  where closed_at is not null and archived_at is null;

create unique index if not exists enquiries_reopen_token_idx
  on public.enquiries (reopen_token);

create or replace function public.set_support_ticket_closed(
  p_enquiry_id uuid,
  p_closed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.enquiries%rowtype;
begin
  select * into v_actor
    from public.profiles
   where id = auth.uid()
     and active = true
     and role in ('admin', 'superadmin');

  if not found then
    raise exception 'An active administrator is required to close or reopen support tickets';
  end if;

  select * into v_ticket
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    raise exception 'Support ticket not found';
  end if;

  if v_ticket.archived_at is not null then
    raise exception 'Restore this ticket from the archive before changing its status';
  end if;

  update public.enquiries
     set status = case when p_closed then 'closed'::public.enquiry_status else 'reviewing'::public.enquiry_status end,
         closed_at = case when p_closed then now() else null end,
         closed_by = case when p_closed then v_actor.id else null end,
         parent_reopened_at = case when p_closed then null else parent_reopened_at end
   where id = p_enquiry_id
   returning * into v_ticket;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    v_actor.id,
    case when p_closed then 'support_ticket_closed' else 'support_ticket_reopened' end,
    'enquiries',
    p_enquiry_id,
    jsonb_build_object(
      'ticketName', v_ticket.name,
      'ticketEmail', v_ticket.email,
      'closed', p_closed,
      'actorName', v_actor.full_name,
      'source', 'support-tickets'
    )
  );

  return jsonb_build_object(
    'id', v_ticket.id,
    'status', v_ticket.status,
    'closedAt', v_ticket.closed_at,
    'closedBy', v_ticket.closed_by,
    'closedByName', case when p_closed then v_actor.full_name else null end,
    'parentReopenedAt', v_ticket.parent_reopened_at
  );
end;
$$;

revoke all on function public.set_support_ticket_closed(uuid, boolean) from public;
revoke all on function public.set_support_ticket_closed(uuid, boolean) from anon;
grant execute on function public.set_support_ticket_closed(uuid, boolean) to authenticated;

comment on function public.set_support_ticket_closed(uuid, boolean)
  is 'Closes or reopens a support ticket while retaining its full enquiry and reply history.';
