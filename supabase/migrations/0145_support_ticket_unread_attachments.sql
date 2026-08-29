create table if not exists public.support_ticket_reads (
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  reader_profile_id uuid not null references public.profiles(id) on delete cascade,
  reader_type text not null check (reader_type in ('parent', 'staff')),
  last_read_at timestamptz not null default now(),
  primary key (enquiry_id, reader_profile_id, reader_type)
);

create table if not exists public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  parent_account_id uuid references public.parent_accounts(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  media_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 8388608),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploader_type text not null check (uploader_type in ('parent', 'staff')),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_attachments_ticket_idx on public.support_ticket_attachments(enquiry_id, created_at);
alter table public.support_ticket_reads enable row level security;
alter table public.support_ticket_attachments enable row level security;
grant select on public.support_ticket_reads, public.support_ticket_attachments to authenticated;
grant all privileges on public.support_ticket_reads, public.support_ticket_attachments to service_role;

drop policy if exists "Users read own ticket receipts" on public.support_ticket_reads;
create policy "Users read own ticket receipts" on public.support_ticket_reads for select to authenticated
using (reader_profile_id = auth.uid());

drop policy if exists "Families read own ticket attachments" on public.support_ticket_attachments;
create policy "Families read own ticket attachments" on public.support_ticket_attachments for select to authenticated
using (public.current_profile_is_admin() or (parent_account_id is not null and public.parent_account_has_access(parent_account_id)));

create or replace function public.can_access_support_ticket(p_enquiry_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.enquiries enquiry
    where enquiry.id = p_enquiry_id and enquiry.archived_at is null
      and (public.current_profile_is_admin() or (enquiry.parent_account_id is not null and public.parent_account_has_access(enquiry.parent_account_id)))
  )
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-ticket-private', 'support-ticket-private', false, 8388608,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "support_ticket_attachment_upload" on storage.objects;
create policy "support_ticket_attachment_upload" on storage.objects for insert to authenticated
with check (bucket_id = 'support-ticket-private' and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_support_ticket(split_part(name, '/', 1)::uuid));

drop policy if exists "support_ticket_attachment_read" on storage.objects;
create policy "support_ticket_attachment_read" on storage.objects for select to authenticated
using (bucket_id = 'support-ticket-private' and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_support_ticket(split_part(name, '/', 1)::uuid));

create or replace function public.record_support_ticket_attachment(p_enquiry_id uuid, p_storage_path text, p_file_name text, p_media_type text, p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket public.enquiries%rowtype; v_type text; v_id uuid; v_uploader_type text;
begin
  select * into v_ticket from public.enquiries where id = p_enquiry_id and archived_at is null;
  if not found or not public.can_access_support_ticket(p_enquiry_id) then raise exception 'Support ticket attachment access is required.' using errcode = '42501'; end if;
  v_type := lower(btrim(coalesce(p_media_type,'')));
  if v_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_byte_size <= 0 or p_byte_size > 8388608 then raise exception 'Use a JPG, PNG, WebP or PDF file no larger than 8MB.'; end if;
  if not (p_storage_path like (p_enquiry_id::text || '/%')) or position('..' in p_storage_path) > 0 then raise exception 'Invalid support attachment path.'; end if;
  v_uploader_type := case when public.current_profile_is_admin() then 'staff' else 'parent' end;
  if v_uploader_type = 'parent' and not public.parent_account_has_access(v_ticket.parent_account_id) then raise exception 'This ticket does not belong to your family account.' using errcode = '42501'; end if;
  insert into public.support_ticket_attachments(enquiry_id,parent_account_id,storage_path,file_name,media_type,byte_size,uploaded_by,uploader_type)
  values(p_enquiry_id,v_ticket.parent_account_id,p_storage_path,left(btrim(p_file_name),180),v_type,p_byte_size,auth.uid(),v_uploader_type) returning id into v_id;
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata) values(auth.uid(),'support_ticket_attachment_added','enquiries',p_enquiry_id,jsonb_build_object('attachmentId',v_id,'fileName',left(btrim(p_file_name),180),'byteSize',p_byte_size,'uploaderType',v_uploader_type));
  return jsonb_build_object('id',v_id,'storagePath',p_storage_path,'fileName',left(btrim(p_file_name),180),'mediaType',v_type,'byteSize',p_byte_size,'uploaderType',v_uploader_type,'createdAt',now());
end $$;

create or replace function public.mark_support_ticket_read(p_enquiry_id uuid, p_reader_type text)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := now();
begin
  if auth.uid() is null or p_reader_type not in ('parent','staff') then raise exception 'Sign in to update this ticket.' using errcode='42501'; end if;
  if p_reader_type = 'parent' and not exists(select 1 from public.enquiries where id=p_enquiry_id and parent_account_id is not null and public.parent_account_has_access(parent_account_id)) then raise exception 'Support ticket not found.' using errcode='42501'; end if;
  if p_reader_type = 'staff' and not public.current_profile_is_admin() then raise exception 'Administrator access is required.' using errcode='42501'; end if;
  insert into public.support_ticket_reads(enquiry_id,reader_profile_id,reader_type,last_read_at) values(p_enquiry_id,auth.uid(),p_reader_type,v_now)
  on conflict(enquiry_id,reader_profile_id,reader_type) do update set last_read_at=excluded.last_read_at;
  return v_now;
end $$;

revoke all on function public.record_support_ticket_attachment(uuid,text,text,text,bigint) from public, anon;
revoke all on function public.mark_support_ticket_read(uuid,text) from public, anon;
grant execute on function public.record_support_ticket_attachment(uuid,text,text,text,bigint) to authenticated;
grant execute on function public.mark_support_ticket_read(uuid,text) to authenticated;

create or replace function public.parent_support_ticket_workspace(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = public, pg_temp stable as $$
declare v_account_id uuid := public.current_parent_account_id(); v_limit integer := greatest(1,least(coalesce(p_limit,50),100)); v_tickets jsonb := '[]'::jsonb; v_unread integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to view your support tickets.'; end if;
  if v_account_id is null then return jsonb_build_object('parentAccountId',null,'tickets','[]'::jsonb,'unreadCount',0,'fetchedAt',now()); end if;
  select count(*) into v_unread from public.enquiries e where e.parent_account_id=v_account_id and e.archived_at is null and exists(
    select 1 from public.enquiry_replies r where r.enquiry_id=e.id and r.status='sent' and coalesce(r.sent_at,r.created_at) > coalesce((select sr.last_read_at from public.support_ticket_reads sr where sr.enquiry_id=e.id and sr.reader_profile_id=auth.uid() and sr.reader_type='parent'),'-infinity'::timestamptz));
  select coalesce(jsonb_agg(payload order by created_at desc),'[]'::jsonb) into v_tickets from (
    select e.created_at, jsonb_build_object('id',e.id,'subject',coalesce(e.subject,'Support request'),'message',e.message,'status',e.status,'createdAt',e.created_at,'closedAt',e.closed_at,'parentReopenedAt',e.parent_reopened_at,
      'unread',exists(select 1 from public.enquiry_replies r where r.enquiry_id=e.id and r.status='sent' and coalesce(r.sent_at,r.created_at)>coalesce((select sr.last_read_at from public.support_ticket_reads sr where sr.enquiry_id=e.id and sr.reader_profile_id=auth.uid() and sr.reader_type='parent'),'-infinity'::timestamptz)),
      'replies',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'subject',r.subject,'body',r.body,'sentAt',coalesce(r.sent_at,r.created_at),'senderType','staff') order by coalesce(r.sent_at,r.created_at)) from public.enquiry_replies r where r.enquiry_id=e.id and r.status='sent'),'[]'::jsonb),
      'parentMessages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'createdAt',m.created_at,'senderType',m.sender_type) order by m.created_at) from public.support_ticket_messages m where m.enquiry_id=e.id),'[]'::jsonb),
      'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'fileName',a.file_name,'mediaType',a.media_type,'byteSize',a.byte_size,'storagePath',a.storage_path,'uploaderType',a.uploader_type,'createdAt',a.created_at) order by a.created_at) from public.support_ticket_attachments a where a.enquiry_id=e.id),'[]'::jsonb)) payload
    from public.enquiries e where e.parent_account_id=v_account_id and e.archived_at is null order by e.created_at desc limit v_limit) rows;
  return jsonb_build_object('parentAccountId',v_account_id,'tickets',v_tickets,'unreadCount',v_unread,'fetchedAt',now());
end $$;

grant execute on function public.parent_support_ticket_workspace(integer) to authenticated;
