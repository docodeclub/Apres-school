alter table public.migration_health_review_items
  add column if not exists resolved_item_name text,
  add column if not exists resolved_expiry_date date,
  add column if not exists confirmation_method text,
  add column if not exists resolution_notes text,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_at timestamptz;

create or replace function public.resolve_migration_health_review(
  p_item_id uuid,
  p_item_name text,
  p_expiry_date date,
  p_confirmation_method text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.migration_health_review_items%rowtype;
  v_child public.child_profiles%rowtype;
  v_consents jsonb;
  v_registration jsonb;
  v_auto_injectors jsonb;
  v_updated_auto_injectors jsonb;
  v_migration_metadata jsonb;
  v_resolutions jsonb;
  v_match_count integer := 0;
  v_now timestamptz := now();
  v_item_name text := btrim(coalesce(p_item_name, ''));
  v_confirmation_method text := lower(btrim(coalesce(p_confirmation_method, '')));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if public.current_user_app_role() not in ('admin', 'superadmin') then
    raise exception 'Admin or Superadmin access is required';
  end if;
  if v_item_name = '' then
    raise exception 'Replacement device name is required';
  end if;
  if p_expiry_date is null or p_expiry_date <= current_date then
    raise exception 'Enter a future expiry date';
  end if;
  if v_confirmation_method not in ('parent_email', 'parent_phone', 'parent_portal', 'in_person', 'document') then
    raise exception 'Choose how the replacement details were confirmed';
  end if;

  select * into v_item
  from public.migration_health_review_items
  where id = p_item_id
  for update;

  if not found then raise exception 'Safety review item not found'; end if;
  if v_item.status = 'resolved' then raise exception 'This safety review has already been resolved'; end if;
  if v_item.imported_child_profile_id is null then
    raise exception 'Import the family before resolving this safety review';
  end if;

  select * into v_child
  from public.child_profiles
  where id = v_item.imported_child_profile_id
  for update;

  if not found then raise exception 'Imported child record not found'; end if;

  v_consents := coalesce(v_child.consents, '{}'::jsonb);
  v_registration := coalesce(v_consents -> 'registration', '{}'::jsonb);
  v_auto_injectors := case
    when jsonb_typeof(v_registration -> 'autoInjectors') = 'array' then v_registration -> 'autoInjectors'
    else '[]'::jsonb
  end;

  select
    count(*) filter (where lower(coalesce(entry.value ->> 'type', '')) = lower(v_item.item_name)
      and coalesce(entry.value ->> 'expiry', '') = coalesce(v_item.expiry_date::text, '')),
    coalesce(jsonb_agg(
      case
        when lower(coalesce(entry.value ->> 'type', '')) = lower(v_item.item_name)
          and coalesce(entry.value ->> 'expiry', '') = coalesce(v_item.expiry_date::text, '')
        then entry.value || jsonb_build_object(
          'type', v_item_name,
          'expiry', p_expiry_date::text,
          'confirmedAt', v_now,
          'confirmationMethod', v_confirmation_method
        )
        else entry.value
      end
      order by entry.ordinality
    ), '[]'::jsonb)
  into v_match_count, v_updated_auto_injectors
  from jsonb_array_elements(v_auto_injectors) with ordinality as entry(value, ordinality);

  if v_match_count = 0 then
    v_updated_auto_injectors := v_updated_auto_injectors || jsonb_build_array(jsonb_build_object(
      'type', v_item_name,
      'expiry', p_expiry_date::text,
      'confirmedAt', v_now,
      'confirmationMethod', v_confirmation_method
    ));
  end if;

  v_registration := jsonb_set(v_registration, '{autoInjectors}', v_updated_auto_injectors, true);
  v_consents := jsonb_set(v_consents, '{registration}', v_registration, true);
  v_migration_metadata := coalesce(v_child.migration_metadata, '{}'::jsonb);
  v_resolutions := case
    when jsonb_typeof(v_migration_metadata -> 'healthReviewResolutions') = 'array'
      then v_migration_metadata -> 'healthReviewResolutions'
    else '[]'::jsonb
  end;
  v_migration_metadata := jsonb_set(
    v_migration_metadata,
    '{healthReviewResolutions}',
    v_resolutions || jsonb_build_array(jsonb_build_object(
      'reviewItemId', v_item.id,
      'itemType', v_item.item_type,
      'previousItemName', v_item.item_name,
      'previousExpiryDate', v_item.expiry_date,
      'replacementItemName', v_item_name,
      'replacementExpiryDate', p_expiry_date,
      'confirmationMethod', v_confirmation_method,
      'resolvedAt', v_now,
      'resolvedBy', auth.uid()
    )),
    true
  );

  update public.child_profiles
  set consents = v_consents,
      migration_metadata = v_migration_metadata,
      updated_at = v_now
  where id = v_child.id;

  update public.migration_health_review_items
  set status = 'resolved',
      resolved_item_name = v_item_name,
      resolved_expiry_date = p_expiry_date,
      confirmation_method = v_confirmation_method,
      resolution_notes = v_notes,
      resolved_by = auth.uid(),
      resolved_at = v_now,
      updated_at = v_now
  where id = v_item.id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'migration_health_review_resolved',
    'migration_health_review_items',
    v_item.id,
    jsonb_build_object(
      'childProfileId', v_child.id,
      'childName', v_child.full_name,
      'previousItemName', v_item.item_name,
      'previousExpiryDate', v_item.expiry_date,
      'replacementItemName', v_item_name,
      'replacementExpiryDate', p_expiry_date,
      'confirmationMethod', v_confirmation_method,
      'notes', v_notes
    )
  );

  return jsonb_build_object(
    'id', v_item.id,
    'status', 'resolved',
    'childProfileId', v_child.id,
    'itemName', v_item_name,
    'expiryDate', p_expiry_date,
    'resolvedAt', v_now
  );
end;
$$;

revoke all on function public.resolve_migration_health_review(uuid, text, date, text, text) from public;
grant execute on function public.resolve_migration_health_review(uuid, text, date, text, text) to authenticated;

comment on function public.resolve_migration_health_review(uuid, text, date, text, text) is
  'Atomically records a replacement auto-injector, resolves the migration safety review and writes an audit entry.';
