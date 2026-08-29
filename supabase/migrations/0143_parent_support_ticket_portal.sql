alter table public.enquiries
  add column if not exists parent_account_id uuid references public.parent_accounts(id) on delete set null,
  add column if not exists reopen_token_expires_at timestamptz;

create index if not exists enquiries_parent_account_created_idx
  on public.enquiries (parent_account_id, created_at desc)
  where archived_at is null;

update public.enquiries enquiry
set parent_account_id = account.id
from public.parent_accounts account
where enquiry.parent_account_id is null
  and lower(enquiry.email) = lower(account.email)
  and account.archived_at is null;

create or replace function public.link_enquiry_to_parent_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parent_account_id is null and nullif(btrim(new.email), '') is not null then
    select account.id into new.parent_account_id
    from public.parent_accounts account
    where account.archived_at is null
      and lower(account.email) = lower(new.email)
    order by account.updated_at desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists enquiries_link_parent_account on public.enquiries;
create trigger enquiries_link_parent_account
before insert or update of email on public.enquiries
for each row execute function public.link_enquiry_to_parent_account();

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  parent_account_id uuid references public.parent_accounts(id) on delete cascade,
  sender_profile_id uuid references public.profiles(id) on delete set null,
  sender_type text not null check (sender_type in ('parent', 'staff')),
  body text not null check (char_length(btrim(body)) between 2 and 8000),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (enquiry_id, created_at);

alter table public.support_ticket_messages enable row level security;

grant all privileges on public.support_ticket_messages to service_role;
grant select on public.support_ticket_messages to authenticated;

drop policy if exists "Parents can read own support messages" on public.support_ticket_messages;
create policy "Parents can read own support messages"
  on public.support_ticket_messages
  for select
  using (public.parent_account_has_access(parent_account_id));

drop policy if exists "Admins can read support messages" on public.support_ticket_messages;
create policy "Admins can read support messages"
  on public.support_ticket_messages
  for select
  using (public.current_profile_is_admin());

create or replace function public.current_parent_account_id()
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select account.id
  from public.parent_accounts account
  where account.archived_at is null
    and public.parent_account_has_access(account.id)
  order by
    case when account.profile_id = auth.uid() then 0 else 1 end,
    account.updated_at desc
  limit 1
$$;

revoke all on function public.current_parent_account_id() from public;
grant execute on function public.current_parent_account_id() to authenticated;
grant execute on function public.current_parent_account_id() to service_role;

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
  select * into v_actor from public.profiles
  where id = auth.uid() and active = true and role in ('admin', 'superadmin');
  if not found then raise exception 'An active administrator is required to close or reopen support tickets'; end if;

  select * into v_ticket from public.enquiries where id = p_enquiry_id for update;
  if not found then raise exception 'Support ticket not found'; end if;
  if v_ticket.archived_at is not null then raise exception 'Restore this ticket from the archive before changing its status'; end if;

  update public.enquiries
  set status = case when p_closed then 'closed'::public.enquiry_status else 'reviewing'::public.enquiry_status end,
      closed_at = case when p_closed then now() else null end,
      closed_by = case when p_closed then v_actor.id else null end,
      parent_reopened_at = case when p_closed then null else parent_reopened_at end,
      reopen_token_expires_at = case when p_closed and parent_account_id is null then now() + interval '30 days' else null end
  where id = p_enquiry_id returning * into v_ticket;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (v_actor.id, case when p_closed then 'support_ticket_closed' else 'support_ticket_reopened' end, 'enquiries', p_enquiry_id,
    jsonb_build_object('ticketName', v_ticket.name, 'ticketEmail', v_ticket.email, 'closed', p_closed, 'actorName', v_actor.full_name, 'source', 'support-tickets'));

  return jsonb_build_object('id', v_ticket.id, 'status', v_ticket.status, 'closedAt', v_ticket.closed_at,
    'closedBy', v_ticket.closed_by, 'closedByName', case when p_closed then v_actor.full_name else null end,
    'parentReopenedAt', v_ticket.parent_reopened_at);
end;
$$;

create or replace function public.parent_support_ticket_workspace(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_account_id uuid := public.current_parent_account_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_tickets jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your support tickets.';
  end if;
  if v_account_id is null then
    return jsonb_build_object('parentAccountId', null, 'tickets', '[]'::jsonb, 'fetchedAt', now());
  end if;

  select coalesce(jsonb_agg(ticket_payload order by created_at desc), '[]'::jsonb)
    into v_tickets
  from (
    select
      enquiry.created_at,
      jsonb_build_object(
        'id', enquiry.id,
        'subject', coalesce(enquiry.subject, 'Support request'),
        'message', enquiry.message,
        'status', enquiry.status,
        'createdAt', enquiry.created_at,
        'closedAt', enquiry.closed_at,
        'parentReopenedAt', enquiry.parent_reopened_at,
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', reply.id,
            'subject', reply.subject,
            'body', reply.body,
            'sentAt', coalesce(reply.sent_at, reply.created_at),
            'senderType', 'staff'
          ) order by coalesce(reply.sent_at, reply.created_at))
          from public.enquiry_replies reply
          where reply.enquiry_id = enquiry.id
            and reply.status = 'sent'
        ), '[]'::jsonb),
        'parentMessages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', message.id,
            'body', message.body,
            'createdAt', message.created_at,
            'senderType', message.sender_type
          ) order by message.created_at)
          from public.support_ticket_messages message
          where message.enquiry_id = enquiry.id
        ), '[]'::jsonb)
      ) as ticket_payload
    from public.enquiries enquiry
    where enquiry.parent_account_id = v_account_id
      and enquiry.archived_at is null
    order by enquiry.created_at desc
    limit v_limit
  ) rows;

  return jsonb_build_object(
    'parentAccountId', v_account_id,
    'tickets', v_tickets,
    'fetchedAt', now()
  );
end;
$$;

revoke all on function public.parent_support_ticket_workspace(integer) from public;
revoke all on function public.parent_support_ticket_workspace(integer) from anon;
grant execute on function public.parent_support_ticket_workspace(integer) to authenticated;
grant execute on function public.parent_support_ticket_workspace(integer) to service_role;

create or replace function public.parent_create_support_ticket(p_subject text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.parent_accounts%rowtype;
  v_ticket public.enquiries%rowtype;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
begin
  if auth.uid() is null then raise exception 'Sign in to contact support.'; end if;
  if char_length(v_subject) < 3 or char_length(v_subject) > 180 then raise exception 'Enter a subject between 3 and 180 characters.'; end if;
  if char_length(v_message) < 10 or char_length(v_message) > 8000 then raise exception 'Enter a message between 10 and 8,000 characters.'; end if;

  select * into v_account from public.parent_accounts
  where id = public.current_parent_account_id()
  for update;
  if not found then raise exception 'No active family account was found.'; end if;

  insert into public.enquiries (name, email, organisation, type, subject, message, status, parent_account_id)
  values (v_account.full_name, v_account.email, coalesce(v_account.registered_centres ->> 0, 'Parent account'), 'Parent', v_subject, v_message, 'new', v_account.id)
  returning * into v_ticket;

  insert into public.support_ticket_messages (enquiry_id, parent_account_id, sender_profile_id, sender_type, body)
  values (v_ticket.id, v_account.id, auth.uid(), 'parent', v_message);

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'support_ticket_created_by_parent', 'enquiries', v_ticket.id, jsonb_build_object('parentAccountId', v_account.id, 'source', 'parent-portal'));

  return jsonb_build_object('id', v_ticket.id, 'status', v_ticket.status, 'createdAt', v_ticket.created_at);
end;
$$;

revoke all on function public.parent_create_support_ticket(text, text) from public;
revoke all on function public.parent_create_support_ticket(text, text) from anon;
grant execute on function public.parent_create_support_ticket(text, text) to authenticated;

create or replace function public.parent_reply_support_ticket(p_enquiry_id uuid, p_message text, p_reopen boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := public.current_parent_account_id();
  v_ticket public.enquiries%rowtype;
  v_message text := btrim(coalesce(p_message, ''));
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Sign in to update your support ticket.'; end if;
  if char_length(v_message) < 10 or char_length(v_message) > 8000 then raise exception 'Enter a message between 10 and 8,000 characters.'; end if;

  select * into v_ticket from public.enquiries
  where id = p_enquiry_id
    and parent_account_id = v_account_id
    and archived_at is null
  for update;
  if not found then raise exception 'Support ticket not found.'; end if;
  if v_ticket.status = 'closed' and not p_reopen then raise exception 'Add a message and choose to re-open this ticket.'; end if;

  insert into public.support_ticket_messages (enquiry_id, parent_account_id, sender_profile_id, sender_type, body)
  values (v_ticket.id, v_account_id, auth.uid(), 'parent', v_message);

  update public.enquiries
  set status = 'reviewing',
      closed_at = null,
      closed_by = null,
      parent_reopened_at = case when v_ticket.status = 'closed' then v_now else parent_reopened_at end,
      reopen_token = case when v_ticket.status = 'closed' then gen_random_uuid() else reopen_token end,
      reopen_token_expires_at = null
  where id = v_ticket.id
  returning * into v_ticket;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    case when p_reopen then 'support_ticket_reopened_by_parent' else 'support_ticket_message_from_parent' end,
    'enquiries',
    v_ticket.id,
    jsonb_build_object('parentAccountId', v_account_id, 'source', 'parent-portal')
  );

  return jsonb_build_object('id', v_ticket.id, 'status', v_ticket.status, 'parentReopenedAt', v_ticket.parent_reopened_at, 'updatedAt', v_now);
end;
$$;

revoke all on function public.parent_reply_support_ticket(uuid, text, boolean) from public;
revoke all on function public.parent_reply_support_ticket(uuid, text, boolean) from anon;
grant execute on function public.parent_reply_support_ticket(uuid, text, boolean) to authenticated;

comment on function public.parent_support_ticket_workspace(integer) is
  'Returns only support tickets belonging to the signed-in family account.';
comment on function public.parent_create_support_ticket(text, text) is
  'Creates a support ticket securely for the signed-in family account.';
comment on function public.parent_reply_support_ticket(uuid, text, boolean) is
  'Adds a required parent message and optionally reopens the signed-in family account ticket.';
