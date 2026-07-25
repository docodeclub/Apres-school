alter table public.staff_hr_files
  add column if not exists payslip_gross_pay numeric(12,2),
  add column if not exists payslip_net_pay numeric(12,2),
  add column if not exists payslip_process_date date,
  add column if not exists payslip_pay_source text,
  add column if not exists payslip_pay_verified_at timestamptz;

alter table public.staff_hr_files
  drop constraint if exists staff_hr_files_payslip_gross_pay_nonnegative;

alter table public.staff_hr_files
  add constraint staff_hr_files_payslip_gross_pay_nonnegative
  check (payslip_gross_pay is null or payslip_gross_pay >= 0);

comment on column public.staff_hr_files.payslip_gross_pay is
  'Total Gross Pay printed on the payslip for this file.';

comment on column public.staff_hr_files.payslip_net_pay is
  'Net Pay printed on the payslip for this file. May be negative when the payslip records a recovery.';

comment on column public.staff_hr_files.payslip_process_date is
  'Payroll process date printed on the payslip.';
