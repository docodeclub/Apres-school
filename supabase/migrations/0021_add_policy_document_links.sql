insert into public.document_versions (title, category, version, source_url, published_at)
values
  ('Safeguarding Policy', 'Safeguarding', '2026.1', 'https://docs.google.com/document/d/1-sBrvy1_dgiyotPrYMuht5x2qqWgnqulmnMT-jX52sY/edit?usp=sharing', now()),
  ('Behaviour Policy', 'Operations', '2026.1', 'https://docs.google.com/document/d/1aifILuwBk-fTHkP6THMMhRxiwxrq2Wg16WDYelVwUR0/edit?usp=sharing', now()),
  ('Health and Safety Policy', 'Health and safety', '2026.1', 'https://docs.google.com/document/d/1va5usccmebzYtUWQ325Yavt8jDTqdfhOkkJAmfn1V3Y/edit?usp=sharing', now()),
  ('Complaints Policy', 'Governance', '2026.1', 'https://docs.google.com/document/d/1DaKmiYsO7cUtd7dLTddfDc1LxrncaHS8MbSi1uAMaTk/edit?usp=sharing', now()),
  ('Illness and Accidents Policy', 'Health and safety', '2026.1', 'https://docs.google.com/document/d/1EpjzKNP5o_AMC2lbig33cx0MxlZkQecvr2_JGzRT2l8/edit?usp=sharing', now()),
  ('Code of Conduct', 'HR', '2026.1', 'https://docs.google.com/document/d/19p3-98CF-6jdYQYmewGn6IWyB4Vp7uJs0FADwdRyLkE/edit?usp=sharing', now()),
  ('Privacy Policy', 'Privacy', '2026.1', 'https://docs.google.com/document/d/19MmgmbDgaKjOMyXYusx86AWtrXtMcGySHntY34XdiUM/edit?usp=sharing', now())
on conflict (title, version) do update set
  category = excluded.category,
  source_url = excluded.source_url,
  published_at = coalesce(public.document_versions.published_at, excluded.published_at);

insert into public.document_assignments (document_version_id, staff_record_id, due_at)
select document.id, staff.id, now() + interval '14 days'
from public.document_versions document
cross join public.staff_records staff
where document.version = '2026.1'
  and document.title in (
    'Safeguarding Policy',
    'Behaviour Policy',
    'Health and Safety Policy',
    'Complaints Policy',
    'Illness and Accidents Policy',
    'Code of Conduct',
    'Privacy Policy'
  )
  and staff.archived_at is null
on conflict (document_version_id, staff_record_id) do nothing;
