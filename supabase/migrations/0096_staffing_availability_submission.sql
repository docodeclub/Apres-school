-- Staff can maintain recurring availability without gaining access to another staff record.

create or replace function public.staffing_save_own_availability(
  p_weekday integer,
  p_status text,
  p_available_from time default null,
  p_available_until time default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_staff_id uuid;
  v_row public.staff_availability%rowtype;
begin
  select id into v_staff_id from public.staff_records
  where profile_id=auth.uid() and archived_at is null limit 1;
  if v_staff_id is null then raise exception 'A linked staff record is required.' using errcode='42501'; end if;
  if p_weekday not between 1 and 7 then raise exception 'Choose a valid weekday.'; end if;
  if p_status not in ('available','preferred','unavailable') then raise exception 'Choose a valid availability status.'; end if;
  if p_available_until is not null and p_available_from is not null and p_available_until <= p_available_from then
    raise exception 'The finish time must be after the start time.';
  end if;

  insert into public.staff_availability(
    staff_record_id,weekday,specific_date,availability_status,available_from,available_until,note,approved_at,approved_by,updated_at
  ) values (
    v_staff_id,p_weekday,null,p_status,p_available_from,p_available_until,nullif(trim(coalesce(p_note,'')),''),null,null,now()
  )
  on conflict (staff_record_id,weekday) where specific_date is null do update set
    availability_status=excluded.availability_status,
    available_from=excluded.available_from,
    available_until=excluded.available_until,
    note=excluded.note,
    approved_at=null,
    approved_by=null,
    updated_at=now()
  returning * into v_row;

  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'staffing_availability_submitted','staff_availability',v_row.id,
    jsonb_build_object('weekday',p_weekday,'status',p_status,'availableFrom',p_available_from,'availableUntil',p_available_until));
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.staffing_save_own_availability(integer,text,time,time,text) to authenticated;
