alter table public.child_profiles
  add column if not exists photo_storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'child-profile-photos',
  'child-profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "child_profile_photos_read_staff" on storage.objects;
create policy "child_profile_photos_read_staff" on storage.objects for select using (
  bucket_id = 'child-profile-photos'
  and public.current_user_app_role() in ('staff', 'manager', 'admin', 'superadmin')
);

drop policy if exists "child_profile_photos_manager_insert" on storage.objects;
create policy "child_profile_photos_manager_insert" on storage.objects for insert with check (
  bucket_id = 'child-profile-photos'
  and public.current_user_app_role() in ('manager', 'admin', 'superadmin')
);

drop policy if exists "child_profile_photos_manager_update" on storage.objects;
create policy "child_profile_photos_manager_update" on storage.objects for update using (
  bucket_id = 'child-profile-photos'
  and public.current_user_app_role() in ('manager', 'admin', 'superadmin')
) with check (
  bucket_id = 'child-profile-photos'
  and public.current_user_app_role() in ('manager', 'admin', 'superadmin')
);

drop policy if exists "child_profile_photos_manager_delete" on storage.objects;
create policy "child_profile_photos_manager_delete" on storage.objects for delete using (
  bucket_id = 'child-profile-photos'
  and public.current_user_app_role() in ('manager', 'admin', 'superadmin')
);

create or replace function public.staff_child_profile_overview(p_child_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid()
    and active = true
    and role in ('staff', 'manager', 'admin', 'superadmin');

  if v_role is null then
    raise exception 'Staff register access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', child.id,
    'fullName', child.full_name,
    'preferredName', child.preferred_name,
    'dateOfBirth', child.date_of_birth,
    'schoolName', child.school_name,
    'yearGroup', child.year_group,
    'medicalNotes', coalesce(child.medical_notes, ''),
    'allergyNotes', coalesce(child.allergy_notes, ''),
    'dietaryNotes', coalesce(child.dietary_notes, ''),
    'photoStoragePath', coalesce(child.photo_storage_path, ''),
    'incidentCount', (
      select count(*) from public.incidents incident
      where incident.child_id = child.id
        and incident.type = 'incident'
        and incident.sensitivity = 'standard'
        and incident.archived_at is null
    ),
    'firstAidCount', (
      select count(*) from public.incidents incident
      where incident.child_id = child.id
        and incident.type = 'first_aid'
        and incident.sensitivity = 'standard'
        and incident.archived_at is null
    ),
    'rewardCount', (
      select count(*) from public.child_rewards reward
      where reward.child_id = child.id
    ),
    'safeguardingConcernRaised', exists (
      select 1 from public.safeguarding_cases safeguarding
      where safeguarding.primary_child_id = child.id
    )
  ) into v_result
  from public.child_profiles child
  where child.id = p_child_id
    and child.active is not false
    and child.archived_at is null;

  if v_result is null then
    raise exception 'Child profile not found.' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.set_child_profile_photo(
  p_child_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role not in ('manager', 'admin', 'superadmin') then
    raise exception 'Manager access is required to update a child photo.' using errcode = '42501';
  end if;

  if p_storage_path is null
    or length(trim(p_storage_path)) < 3
    or split_part(p_storage_path, '/', 1) <> p_child_id::text then
    raise exception 'The child photo storage path is invalid.' using errcode = '22023';
  end if;

  update public.child_profiles
  set photo_storage_path = trim(p_storage_path), updated_at = now()
  where id = p_child_id and archived_at is null;

  if not found then
    raise exception 'Child profile not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('childId', p_child_id, 'photoStoragePath', trim(p_storage_path));
end;
$$;

revoke all on function public.staff_child_profile_overview(uuid) from public;
revoke all on function public.set_child_profile_photo(uuid, text) from public;
grant execute on function public.staff_child_profile_overview(uuid) to authenticated;
grant execute on function public.set_child_profile_photo(uuid, text) to authenticated;

comment on function public.staff_child_profile_overview(uuid) is
  'Returns a staff-safe operational child profile, including only a boolean safeguarding indicator and no safeguarding case content.';

