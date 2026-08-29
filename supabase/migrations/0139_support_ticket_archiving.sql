alter table public.enquiries
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists enquiries_archived_at_idx
  on public.enquiries (archived_at desc)
  where archived_at is not null;

create or replace function public.set_support_ticket_archived(
  p_enquiry_id uuid,
  p_archived boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.enquiries%rowtype;
  v_archived_at timestamptz;
begin
  select * into v_actor
    from public.profiles
   where id = auth.uid()
     and active = true
     and role in ('admin', 'superadmin');

  if not found then
    raise exception 'An active administrator is required to archive support tickets';
  end if;

  select * into v_ticket
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    raise exception 'Support ticket not found';
  end if;

  v_archived_at := case when p_archived then now() else null end;

  update public.enquiries
     set archived_at = v_archived_at,
         archived_by = case when p_archived then v_actor.id else null end,
         status = case
           when p_archived then 'closed'::public.enquiry_status
           when status = 'closed' then 'reviewing'::public.enquiry_status
           else status
         end
   where id = p_enquiry_id
   returning * into v_ticket;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    v_actor.id,
    case when p_archived then 'support_ticket_archived' else 'support_ticket_restored' end,
    'enquiries',
    p_enquiry_id,
    jsonb_build_object(
      'ticketName', v_ticket.name,
      'ticketEmail', v_ticket.email,
      'archived', p_archived,
      'actorName', v_actor.full_name,
      'source', 'support-tickets'
    )
  );

  return jsonb_build_object(
    'id', v_ticket.id,
    'status', v_ticket.status,
    'archivedAt', v_ticket.archived_at,
    'archivedBy', v_ticket.archived_by,
    'archivedByName', case when p_archived then v_actor.full_name else null end
  );
end;
$$;

revoke all on function public.set_support_ticket_archived(uuid, boolean) from public;
revoke all on function public.set_support_ticket_archived(uuid, boolean) from anon;
grant execute on function public.set_support_ticket_archived(uuid, boolean) to authenticated;

comment on function public.set_support_ticket_archived(uuid, boolean)
  is 'Archives or restores a support ticket without deleting its enquiry or reply history.';
