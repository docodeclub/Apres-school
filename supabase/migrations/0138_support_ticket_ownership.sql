alter table public.enquiries
  add column if not exists first_opened_at timestamptz,
  add column if not exists first_opened_by uuid references public.profiles(id) on delete set null;

create index if not exists enquiries_open_ticket_age_idx
  on public.enquiries (status, created_at desc);

create or replace function public.claim_support_ticket(p_enquiry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.enquiries%rowtype;
  v_first_open boolean := false;
begin
  select * into v_actor
    from public.profiles
   where id = auth.uid()
     and active = true
     and role in ('admin', 'superadmin');

  if not found then
    raise exception 'An active administrator is required to open support tickets';
  end if;

  select * into v_ticket
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    raise exception 'Support ticket not found';
  end if;

  v_first_open := v_ticket.first_opened_at is null;

  update public.enquiries
     set owner_id = coalesce(owner_id, v_actor.id),
         first_opened_at = coalesce(first_opened_at, now()),
         first_opened_by = coalesce(first_opened_by, v_actor.id),
         status = case when status = 'new' then 'reviewing'::public.enquiry_status else status end
   where id = p_enquiry_id
   returning * into v_ticket;

  if v_first_open then
    insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
    values (
      v_actor.id,
      'support_ticket_opened',
      'enquiries',
      p_enquiry_id,
      jsonb_build_object(
        'ticketName', v_ticket.name,
        'ticketEmail', v_ticket.email,
        'ownerName', v_actor.full_name,
        'source', 'support-tickets'
      )
    );
  end if;

  return jsonb_build_object(
    'id', v_ticket.id,
    'status', v_ticket.status,
    'ownerId', v_ticket.owner_id,
    'ownerName', coalesce((select full_name from public.profiles where id = v_ticket.owner_id), v_actor.full_name),
    'firstOpenedAt', v_ticket.first_opened_at,
    'firstOpenedBy', v_ticket.first_opened_by,
    'firstOpenedByName', coalesce((select full_name from public.profiles where id = v_ticket.first_opened_by), v_actor.full_name)
  );
end;
$$;

revoke all on function public.claim_support_ticket(uuid) from public;
revoke all on function public.claim_support_ticket(uuid) from anon;
grant execute on function public.claim_support_ticket(uuid) to authenticated;

comment on function public.claim_support_ticket(uuid)
  is 'Atomically records the first administrator to open a support ticket and assigns unowned tickets.';
