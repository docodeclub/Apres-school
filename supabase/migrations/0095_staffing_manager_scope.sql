-- Enforce manager scope at the database boundary. UI filtering is not a security boundary.

alter table public.rota_publications
  add column if not exists location_ids uuid[] not null default '{}';

create or replace function public.staffing_location_in_scope(target_location_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with viewer as (
    select p.role, sr.id as staff_record_id, lower(regexp_replace(coalesce(sr.primary_site, ''), '\\s+school$', '')) as primary_site
    from public.profiles p
    left join public.staff_records sr on sr.profile_id = p.id and sr.archived_at is null
    where p.id = auth.uid() and p.active = true
    limit 1
  ), target as (
    select lower(regexp_replace(coalesce(l.name, ''), '\\s+school$', '')) as site_name
    from public.locations l where l.id = target_location_id
  )
  select coalesce((
    select case
      when v.role in ('admin','superadmin') then true
      when v.role <> 'manager' then false
      when v.primary_site = t.site_name then true
      else exists (
        select 1
        from public.hr_reporting_lines h
        join public.staff_records report on report.id = h.staff_record_id
        where h.manager_staff_record_id = v.staff_record_id
          and h.archived_at is null
          and h.effective_from <= current_date
          and (h.effective_to is null or h.effective_to >= current_date)
          and lower(regexp_replace(coalesce(report.primary_site, ''), '\\s+school$', '')) = t.site_name
      )
    end
    from viewer v cross join target t
  ), false)
$$;

create or replace function public.staffing_staff_in_scope(target_staff_record_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select case
      when p.role in ('admin','superadmin') then true
      when p.role = 'manager' then target_staff_record_id = sr.id or public.current_user_manages_staff_record(target_staff_record_id)
      when p.role = 'staff' then target_staff_record_id = sr.id
      else false
    end
    from public.profiles p
    left join public.staff_records sr on sr.profile_id = p.id and sr.archived_at is null
    where p.id = auth.uid() and p.active = true
    limit 1
  ), false)
$$;

grant execute on function public.staffing_location_in_scope(uuid) to authenticated;
grant execute on function public.staffing_staff_in_scope(uuid) to authenticated;

drop policy if exists "Staffing settings manage" on public.staffing_site_settings;
create policy "Staffing settings manage" on public.staffing_site_settings for all
  using (public.staffing_location_in_scope(location_id))
  with check (public.staffing_location_in_scope(location_id));

drop policy if exists "Staff availability read" on public.staff_availability;
create policy "Staff availability read" on public.staff_availability for select
  using (public.staffing_staff_in_scope(staff_record_id));
drop policy if exists "Staff availability manage" on public.staff_availability;
create policy "Staff availability manage" on public.staff_availability for all
  using (public.staffing_staff_in_scope(staff_record_id))
  with check (public.staffing_staff_in_scope(staff_record_id));

drop policy if exists "Staff absences read" on public.staff_absences;
create policy "Staff absences read" on public.staff_absences for select
  using (public.staffing_staff_in_scope(staff_record_id));
drop policy if exists "Staff absences manage" on public.staff_absences;
create policy "Staff absences manage" on public.staff_absences for all
  using (public.staffing_staff_in_scope(staff_record_id))
  with check (public.staffing_staff_in_scope(staff_record_id));

drop policy if exists "Rota publications read" on public.rota_publications;
create policy "Rota publications read" on public.rota_publications for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active = true and p.role in ('manager','admin','superadmin'))
);

drop policy if exists "Cover requests read" on public.staffing_cover_requests;
create policy "Cover requests read" on public.staffing_cover_requests for select using (
  exists (
    select 1 from public.sessions s
    join public.programmes p on p.id = s.programme_id
    where s.id = staffing_cover_requests.session_id
      and public.staffing_location_in_scope(p.location_id)
  )
  or exists (
    select 1 from public.staff_records sr
    where sr.profile_id = auth.uid()
      and (sr.id = any(requested_staff_ids) or sr.id = accepted_by_staff_id)
  )
);
drop policy if exists "Cover requests manage" on public.staffing_cover_requests;
create policy "Cover requests manage" on public.staffing_cover_requests for all using (
  exists (
    select 1 from public.sessions s
    join public.programmes p on p.id = s.programme_id
    where s.id = staffing_cover_requests.session_id
      and public.staffing_location_in_scope(p.location_id)
  )
) with check (
  exists (
    select 1 from public.sessions s
    join public.programmes p on p.id = s.programme_id
    where s.id = staffing_cover_requests.session_id
      and public.staffing_location_in_scope(p.location_id)
  )
);

drop policy if exists "Staffing assignments manager all" on public.session_assignments;
create policy "Staffing assignments manager scoped" on public.session_assignments for all using (
  public.staffing_staff_in_scope(staff_record_id)
  and exists (
    select 1 from public.sessions s
    join public.programmes p on p.id = s.programme_id
    where s.id = session_assignments.session_id
      and public.staffing_location_in_scope(p.location_id)
  )
) with check (
  public.staffing_staff_in_scope(staff_record_id)
  and exists (
    select 1 from public.sessions s
    join public.programmes p on p.id = s.programme_id
    where s.id = session_assignments.session_id
      and public.staffing_location_in_scope(p.location_id)
  )
);

alter function public.staffing_planner_for_range(date,date) rename to staffing_planner_for_range_unscoped;
revoke all on function public.staffing_planner_for_range_unscoped(date,date) from public, authenticated;

create function public.staffing_planner_for_range(p_date_from date, p_date_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_result jsonb;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  v_result := public.staffing_planner_for_range_unscoped(p_date_from, p_date_to);

  -- Publication snapshots can contain other staff and sites; the planner only needs metadata.
  if v_role in ('staff','manager') then
    v_result := jsonb_set(v_result, '{publications}', coalesce((
      select jsonb_agg(value - 'assignment_snapshot') from jsonb_array_elements(v_result->'publications')
    ), '[]'::jsonb));
  end if;

  if v_role = 'manager' then
    v_result := jsonb_set(v_result, '{sessions}', coalesce((
      select jsonb_agg(value) from jsonb_array_elements(v_result->'sessions')
      where public.staffing_location_in_scope((value->>'siteId')::uuid)
    ), '[]'::jsonb));
    v_result := jsonb_set(v_result, '{staff}', coalesce((
      select jsonb_agg(value) from jsonb_array_elements(v_result->'staff')
      where public.staffing_staff_in_scope((value->>'id')::uuid)
    ), '[]'::jsonb));
    v_result := jsonb_set(v_result, '{availability}', coalesce((
      select jsonb_agg(value) from jsonb_array_elements(v_result->'availability')
      where public.staffing_staff_in_scope((value->>'staff_record_id')::uuid)
    ), '[]'::jsonb));
    v_result := jsonb_set(v_result, '{absences}', coalesce((
      select jsonb_agg(value) from jsonb_array_elements(v_result->'absences')
      where public.staffing_staff_in_scope((value->>'staff_record_id')::uuid)
    ), '[]'::jsonb));
    v_result := jsonb_set(v_result, '{coverRequests}', coalesce((
      select jsonb_agg(request.value)
      from jsonb_array_elements(v_result->'coverRequests') request
      join jsonb_array_elements(v_result->'sessions') session
        on session->>'id' = request.value->>'session_id'
    ), '[]'::jsonb));
    v_result := jsonb_set(v_result, '{publications}', coalesce((
      select jsonb_agg(value) from jsonb_array_elements(v_result->'publications')
      where coalesce(value->'location_ids', '[]'::jsonb) = '[]'::jsonb
        or exists (
          select 1 from jsonb_array_elements_text(value->'location_ids') lid
          where public.staffing_location_in_scope(lid::uuid)
        )
    ), '[]'::jsonb));
  end if;
  return v_result;
end;
$$;

grant execute on function public.staffing_planner_for_range(date,date) to authenticated;

alter function public.staffing_save_assignment(uuid,uuid,text,boolean,boolean,boolean,text) rename to staffing_save_assignment_unscoped;
revoke all on function public.staffing_save_assignment_unscoped(uuid,uuid,text,boolean,boolean,boolean,text) from public, authenticated;

create function public.staffing_save_assignment(
  p_session_id uuid, p_staff_record_id uuid, p_session_role text default 'assistant',
  p_acting_manager boolean default false, p_acting_dsl boolean default false,
  p_acting_sendco boolean default false, p_override_reason text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_location_id uuid;
begin
  select p.location_id into v_location_id
  from public.sessions s join public.programmes p on p.id=s.programme_id
  where s.id=p_session_id;
  if not public.staffing_location_in_scope(v_location_id) then
    raise exception 'This session is outside your managed sites.' using errcode='42501';
  end if;
  if not public.staffing_staff_in_scope(p_staff_record_id) then
    raise exception 'This staff member is outside your managed team.' using errcode='42501';
  end if;
  return public.staffing_save_assignment_unscoped(p_session_id,p_staff_record_id,p_session_role,p_acting_manager,p_acting_dsl,p_acting_sendco,p_override_reason);
end; $$;
grant execute on function public.staffing_save_assignment(uuid,uuid,text,boolean,boolean,boolean,text) to authenticated;

alter function public.staffing_remove_assignment(uuid,text) rename to staffing_remove_assignment_unscoped;
revoke all on function public.staffing_remove_assignment_unscoped(uuid,text) from public, authenticated;

create function public.staffing_remove_assignment(p_assignment_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_allowed boolean;
begin
  select public.staffing_staff_in_scope(sa.staff_record_id) and public.staffing_location_in_scope(p.location_id)
  into v_allowed
  from public.session_assignments sa
  join public.sessions s on s.id=sa.session_id
  join public.programmes p on p.id=s.programme_id
  where sa.id=p_assignment_id;
  if not coalesce(v_allowed,false) then raise exception 'This assignment is outside your managed scope.' using errcode='42501'; end if;
  return public.staffing_remove_assignment_unscoped(p_assignment_id,p_reason);
end; $$;
grant execute on function public.staffing_remove_assignment(uuid,text) to authenticated;

create or replace function public.staffing_publish_rota(p_date_from date,p_date_to date,p_warnings jsonb default '[]'::jsonb,p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role app_role; v_version integer; v_publication public.rota_publications%rowtype; v_snapshot jsonb; v_location_ids uuid[];
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('manager','admin','superadmin') then raise exception 'Rota publishing access is required.' using errcode='42501'; end if;
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then raise exception 'Choose a valid publication range.'; end if;
  if jsonb_array_length(coalesce(p_warnings,'[]'::jsonb))>0 and nullif(trim(coalesce(p_override_reason,'')),'') is null then raise exception 'PUBLISH_WARNINGS|Resolve the warnings or provide an authorised override reason.'; end if;

  select coalesce(array_agg(distinct p.location_id), '{}') into v_location_ids
  from public.sessions s join public.programmes p on p.id=s.programme_id
  where (s.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to
    and public.staffing_location_in_scope(p.location_id);
  if cardinality(v_location_ids)=0 then raise exception 'No sessions are available in your managed sites for this period.' using errcode='42501'; end if;

  select coalesce(max(version),0)+1 into v_version from public.rota_publications where period_start=p_date_from and period_end=p_date_to;
  select coalesce(jsonb_agg(to_jsonb(sa) order by sa.session_id,sa.sort_order),'[]'::jsonb) into v_snapshot
  from public.session_assignments sa
  join public.sessions s on s.id=sa.session_id
  join public.programmes p on p.id=s.programme_id
  where (s.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to
    and sa.status<>'cancelled' and public.staffing_location_in_scope(p.location_id);
  update public.rota_publications set status='superseded'
  where period_start=p_date_from and period_end=p_date_to and status='published'
    and (location_ids && v_location_ids or cardinality(location_ids)=0);
  insert into public.rota_publications(period_start,period_end,version,status,warning_snapshot,assignment_snapshot,override_reason,published_by,published_at,location_ids)
  values(p_date_from,p_date_to,v_version,'published',coalesce(p_warnings,'[]'::jsonb),v_snapshot,nullif(trim(coalesce(p_override_reason,'')),''),auth.uid(),now(),v_location_ids)
  returning * into v_publication;
  update public.session_assignments sa set publication_version=v_version,
    acknowledgement_status=case when acknowledgement_status='acknowledged' then 'changed' else 'awaiting' end,
    changed_since_acknowledgement=acknowledgement_status='acknowledged',updated_by=auth.uid(),updated_at=now()
  from public.sessions s join public.programmes p on p.id=s.programme_id
  where s.id=sa.session_id and (s.starts_at at time zone 'Europe/London')::date between p_date_from and p_date_to
    and sa.status<>'cancelled' and public.staffing_location_in_scope(p.location_id);
  insert into public.audit_log(actor_id,action,table_name,record_id,metadata)
  values(auth.uid(),'staffing_rota_published','rota_publications',v_publication.id,
    jsonb_build_object('periodStart',p_date_from,'periodEnd',p_date_to,'version',v_version,'locationIds',v_location_ids,'warnings',p_warnings,'overrideReason',p_override_reason));
  return to_jsonb(v_publication);
end; $$;

