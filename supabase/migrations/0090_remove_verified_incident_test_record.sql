-- Remove the intentional end-to-end incident test after verification while
-- preserving a clear audit record of why it was removed.

do $$
declare
  v_test_record record;
begin
  select
    incident.id,
    incident.reporter_id,
    incident.child_id,
    incident.booking_item_id,
    incident.details
  into v_test_record
  from public.incidents incident
  where incident.type = 'incident'
    and incident.summary =
      'Cillian needed several reminders to follow the group instructions during the session.'
    and incident.details ->> 'category' = 'Behaviour'
    and incident.details ->> 'severity' = 'Minor'
    and incident.details ->> 'childName' = 'Cillian Currie'
    and (incident.occurred_at at time zone 'Europe/London')::date = date '2026-09-03'
  order by incident.created_at desc
  limit 1;

  if v_test_record.id is not null then
    insert into public.audit_log (
      actor_id,
      action,
      table_name,
      record_id,
      metadata
    ) values (
      v_test_record.reporter_id,
      'Verified incident test record removed',
      'incidents',
      v_test_record.id,
      jsonb_build_object(
        'testRecord', true,
        'childId', v_test_record.child_id,
        'bookingItemId', v_test_record.booking_item_id,
        'category', v_test_record.details ->> 'category',
        'severity', v_test_record.details ->> 'severity',
        'reason', 'Required production end-to-end test completed successfully'
      )
    );

    delete from public.incidents
    where id = v_test_record.id;
  end if;
end;
$$;
