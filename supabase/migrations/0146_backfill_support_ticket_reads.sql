insert into public.support_ticket_reads (
  enquiry_id,
  reader_profile_id,
  reader_type,
  last_read_at
)
select
  enquiry.id,
  enquiry.first_opened_by,
  'staff',
  enquiry.first_opened_at
from public.enquiries enquiry
where enquiry.first_opened_by is not null
  and enquiry.first_opened_at is not null
on conflict (enquiry_id, reader_profile_id, reader_type) do nothing;

comment on table public.support_ticket_reads
  is 'Per-user support-ticket read receipts. Historical staff receipts are seeded from the existing first-opened audit fields.';
