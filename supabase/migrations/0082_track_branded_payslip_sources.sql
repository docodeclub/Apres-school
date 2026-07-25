alter table public.staff_hr_files
  add column if not exists source_storage_path text,
  add column if not exists document_brand_version text,
  add column if not exists branded_at timestamptz;

comment on column public.staff_hr_files.source_storage_path is
  'Private original payroll PDF retained for audit when a branded staff-facing payslip is generated.';

comment on column public.staff_hr_files.document_brand_version is
  'Generator version used for the current staff-facing document.';

comment on column public.staff_hr_files.branded_at is
  'Time the current branded staff-facing document was generated and verified.';
