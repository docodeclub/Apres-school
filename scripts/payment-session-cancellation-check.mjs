// Synthetic fixtures only; called inside the isolated PostgreSQL harness.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function checkSessionCancellation(sql) {
  const id = n => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
  await sql(`create type booking_status as enum ('reserved','confirmed','cancelled','waitlist');
    alter table bookings alter column status type booking_status using status::booking_status;
    alter table bookings add column booking_reference text, add column total_amount numeric,
      add column amendment_deadline timestamptz, add column parent_name text;
    alter table booking_items alter column booking_id type uuid using booking_id::uuid;
    alter table booking_items add column id uuid default gen_random_uuid(), add column session_id uuid,
      add column session_block_id uuid, add column child_id uuid, add column child_name text,
      add column starts_at timestamptz, add column ends_at timestamptz, add column line_total numeric,
      add column metadata jsonb default '{}', add column site_name text, add column programme_name text,
      add column session_label text;
    create table sessions(id uuid primary key,cancellation_hours integer);
    create table booking_capacity_holds(booking_item_id uuid,status text,released_at timestamptz,expires_at timestamptz);
    alter table profiles add column role text;
    create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.auth_uid',true),'')::uuid$$;
    alter table parent_accounts add column full_name text,add column phone text,add column emergency_contact jsonb;
    create table child_profiles(id uuid,parent_account_id uuid,full_name text,preferred_name text,date_of_birth date,
      school_name text,year_group text,medical_notes text,allergy_notes text,dietary_notes text,flags jsonb,authorised_collectors jsonb,consents jsonb);
    create table booking_register_entries(booking_item_id uuid,attendance_status text,note text,checked_out_at timestamptz,checked_in_at timestamptz,updated_at timestamptz);
    create table parent_pricing_assignments(parent_account_id uuid,pricing_group_id uuid,deleted_at timestamptz,effective_from date,effective_to date);
    create table pricing_groups(id uuid,status text,deleted_at timestamptz,key text,name text);
    create table staff_records(profile_id uuid,archived_at timestamptz);`);
  for (const file of ['0142_individual_session_cancellation_window.sql','0163_register_secured_booking_fallback.sql']) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  await sql("create type booking_item_status as enum ('reserved','confirmed','cancelled','waitlist','attended');");
  for (const file of ['0032_cancel_parent_booking.sql','0034_amend_parent_booking_add_items.sql','0176_allow_same_day_staff_adhoc_cancellation.sql']) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  const signatures = [
    'amend_parent_booking_remove_items(uuid,uuid,uuid[],text,text)',
    'cancel_parent_booking(uuid,uuid,text,text)',
    'amend_parent_booking_add_items(uuid,uuid,jsonb,text,text)',
    'cancel_parent_staff_adhoc_booking(uuid,uuid,text,uuid)',
  ];
  // Simulate both inherited PUBLIC and explicit old API-role grants.
  for (const signature of signatures) await sql(`grant execute on function ${signature} to anon,authenticated;`);
  const permissionsMigration = await readFile(new URL('../supabase/migrations/0180_booking_change_rpc_permissions.sql',import.meta.url),'utf8');
  await sql(permissionsMigration);
  await sql(permissionsMigration); // Safe to reapply.
  for (const signature of signatures) {
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal(await sql(`select has_function_privilege('${role}','${signature}','execute');`),role === 'service_role' ? 't' : 'f');
    }
  }
  await sql('grant usage on schema public to anon,authenticated,service_role;');
  await sql(`insert into profiles(id,email,role) values('${id(1)}','staff@example.invalid','staff'),('${id(2)}','family@example.invalid','parent');
    insert into parent_accounts(id,email) values('${id(2)}','family@example.invalid');
    insert into child_profiles(id,parent_account_id,full_name) values('${id(3)}','${id(2)}','Synthetic Child A'),('${id(4)}','${id(2)}','Synthetic Child B');
    insert into sessions values('${id(5)}',24),('${id(6)}',24);
    insert into bookings(id,status,parent_id,parent_account_id,invoice_id,booking_reference,total_amount,due_today,outstanding_balance)
      values('${id(7)}','confirmed','${id(2)}','${id(2)}','synthetic-siblings','TEST-SIBLINGS',40,40,0);
    insert into booking_invoices(id,booking_id,total_amount,paid_amount,balance,payment_status)
      values('synthetic-siblings','${id(7)}',40,40,0,'paid');
    insert into booking_items(id,booking_id,session_id,child_id,status,starts_at,ends_at,line_total,site_name,programme_name,session_label) values
      ('${id(8)}','${id(7)}','${id(5)}','${id(3)}','confirmed',current_date+interval '7 days 15 hours',current_date+interval '7 days 16 hours',10,'Synthetic School','ASC','Session 1'),
      ('${id(9)}','${id(7)}','${id(6)}','${id(3)}','confirmed',current_date+interval '7 days 16 hours',current_date+interval '7 days 17 hours',20,'Synthetic School','ASC','Session 2'),
      ('${id(10)}','${id(7)}','${id(5)}','${id(4)}','confirmed',current_date+interval '7 days 15 hours',current_date+interval '7 days 16 hours',10,'Synthetic School','ASC','Session 1');
    insert into booking_capacity_holds select id,'held',null,starts_at from booking_items where booking_id='${id(7)}';`);
  const balance = async () => Number(await sql(`select coalesce(sum(amount),0) from parent_account_credit_entries where parent_account_id='${id(2)}' and status='posted';`));
  const register = async () => JSON.parse(await sql(`set test.auth_uid='${id(1)}'; select coalesce(jsonb_agg(booking_item_id order by booking_item_id),'[]') from staff_register_for_day(current_date+7,'Synthetic School','ASC');`));
  const cancel = (parent, item) => sql(`set role service_role; select amend_parent_booking_remove_items('${parent}','${id(7)}',array['${item}']::uuid[],'Synthetic test','parent');`).then(JSON.parse);
  for (const role of ['anon','authenticated']) {
    await assert.rejects(sql(`set role ${role}; select amend_parent_booking_remove_items('${id(2)}','${id(7)}',array['${id(8)}']::uuid[],'Forged staff request','superadmin');`),/permission denied for function/);
  }
  console.log('PASS: all four booking-change RPC grants are server-only; forged staff/parent identity blocked before mutation');
  assert.deepEqual(await register(),[id(8),id(9),id(10)]);
  await assert.rejects(cancel(id(99),id(8)),/Booking was not found/);
  await assert.rejects(cancel(id(2),id(99)),/do not belong/);
  assert.equal(await balance(),0);
  const result = await cancel(id(2),id(8));
  assert.equal(result.removedItems,1);
  assert.equal(Number(result.removedTotal),10);
  assert.equal(result.booking.status,'confirmed');
  assert.equal(Number(result.booking.totalAmount),30);
  assert.equal(await balance(),10,'Only the cancelled child-session is credited');
  assert.deepEqual(await register(),[id(9),id(10)],'Other session and sibling remain on real register');
  assert.equal(await sql(`select count(*) from booking_capacity_holds where released_at is not null;`),'1');
  assert.equal((await cancel(id(2),id(8))).amended,false);
  assert.equal(await balance(),10,'Retry cannot double credit');
  await sql(`update booking_items set starts_at=now()+interval '1 hour' where id='${id(9)}';`);
  await assert.rejects(cancel(id(2),id(9)),/cancellation notice period/);
  assert.equal(await balance(),10);
  assert.equal(await sql(`select status from booking_items where id='${id(9)}';`),'confirmed');
  console.log('PASS: real parent cancellation and register RPCs: two children, individual £10 credit, sibling/other session retained, hold released, duplicate safe, ownership and notice checks');
}
