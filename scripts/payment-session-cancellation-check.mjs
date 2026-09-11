// Synthetic fixtures only; called inside the isolated PostgreSQL harness.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function checkSessionCancellation(sql, { commit, successEvent }) {
  const id = n => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
  await sql(`alter table bookings add column booking_reference text, add column total_amount numeric,
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
  // Existing bookings have immutable pricing-adjustment snapshots. Exercise the
  // same repricing RPC called by the HTTP handler after individual removal.
  await sql(`alter table bookings add column payment_plan text,add column gross_total numeric,add column discount_amount numeric,add column pricing_group_id uuid,add column pricing_group_name text;
    alter table booking_items add column quantity integer default 1;
    alter table sessions add column price numeric,add column booking_metadata jsonb,add column programme_id uuid;
    create table session_blocks(id uuid,label text,price numeric);
    create table programmes(id uuid,name text,category text,location_id uuid);
    create table locations(id uuid);
    create table booking_pricing_adjustments(id uuid,booking_item_id uuid,original_unit_amount numeric,final_unit_amount numeric,discount_amount numeric,pricing_group_id uuid,pricing_group_name text);
    insert into programmes values('${id(20)}','After-school Club','wraparound',null);
    update sessions set programme_id='${id(20)}';
    insert into session_blocks values('${id(21)}','Session 1',20),('${id(22)}','Session 2',40);
    update booking_items set session_block_id=case when session_id='${id(5)}' then '${id(21)}'::uuid else '${id(22)}'::uuid end where booking_id='${id(7)}';
    insert into booking_pricing_adjustments select gen_random_uuid(),id,line_total*2,line_total,line_total,null,'Synthetic 50% Staff' from booking_items where booking_id='${id(7)}';
    update booking_items set starts_at=current_date+interval '7 days 16 hours' where id='${id(9)}';`);
  const pricingSource = await readFile(new URL('../supabase/migrations/0133_willington_holiday_camp_pricing.sql',import.meta.url),'utf8');
  await sql(pricingSource.slice(pricingSource.indexOf('create or replace function public.apply_booking_pricing(')));
  await sql(await readFile(new URL('../supabase/migrations/0181_preserve_cancelled_booking_during_repricing.sql',import.meta.url),'utf8'));
  const reprice = async () => JSON.parse(await sql(`set role service_role; select apply_booking_pricing('${id(7)}');`));
  const repriced = await reprice();
  assert.equal(Number(repriced.totalAmount),30);
  assert.equal(Number(repriced.discountTotal),30,'Existing 50% discount retained');
  assert.equal(await balance(),10);
  assert.deepEqual(await register(),[id(9),id(10)]);
  await reprice();
  assert.equal(await balance(),10);
  await cancel(id(2),id(9));
  await reprice();
  assert.equal(await balance(),30);
  await cancel(id(2),id(10));
  await reprice();
  assert.equal(await balance(),40);
  assert.deepEqual(await register(),[]);
  assert.equal(await sql(`select status from bookings where id='${id(7)}';`),'cancelled','Repricing must not reopen fully cancelled bookings');
  console.log('PASS: actual follow-up repricing retains recorded staff discount, exact cumulative credits, empty register and cancelled booking');
  // Reset only these synthetic fixtures for an unpaid cancellation/payment race.
  await sql(`update bookings set status='confirmed',total_amount=40,outstanding_balance=40 where id='${id(7)}';
    update booking_items set status='confirmed' where booking_id='${id(7)}';
    update booking_invoices set paid_amount=0,total_amount=40,balance=40,payment_status='pending' where id='synthetic-siblings';
    delete from parent_account_credit_entries where parent_account_id='${id(2)}';`);
  const raceEvent = {...successEvent,id:id(30),provider_event_id:'cancel-race',invoice_id:'synthetic-siblings',amount:40,expected_amount:40};
  await sql(`insert into ponchopay_webhook_events(id,provider_event_id,event_type,invoice_id,signature_status,raw_payload_hash) values('${id(30)}','cancel-race','payment_completed','synthetic-siblings','verified','synthetic');`);
  const invoice = () => sql("select row_to_json(i) from booking_invoices i where id='synthetic-siblings';").then(JSON.parse);
  const before = await invoice();
  // Hold the booking row while the payment worker starts. The cancellation and
  // pricing share one transaction here, allowing genuine lock contention.
  const cancellation = sql(`begin; select id from bookings where id='${id(7)}' for update; select pg_sleep(0.3);
    select amend_parent_booking_remove_items('${id(2)}','${id(7)}',array['${id(8)}']::uuid[],'Race','parent'); select apply_booking_pricing('${id(7)}'); commit;`);
  const payment = sql(`select pg_sleep(0.1); ${commit(raceEvent,before)}`);
  const outcomes = await Promise.allSettled([cancellation,payment]);
  for (const outcome of outcomes) if(outcome.status === 'rejected') throw outcome.reason;
  await sql(commit(raceEvent,await invoice())); // Conflicting snapshot / duplicate retry.
  assert.equal(Number((await invoice()).total_amount),30);
  assert.equal(Number((await invoice()).paid_amount),40);
  assert.equal(Number((await invoice()).balance),0);
  assert.equal(await balance(),10);
  assert.deepEqual(await register(),[id(9),id(10)]);
  // Actual handler failure window: removal commits, repricing rolls back.
  await cancel(id(2),id(9));
  await assert.rejects(sql(`begin; select apply_booking_pricing('${id(7)}'); select 1/0; commit;`),/division by zero/);
  assert.equal(Number((await invoice()).total_amount),10);
  assert.equal(await balance(),30);
  assert.equal((await cancel(id(2),id(9))).amended,false);
  await reprice();
  assert.equal(await balance(),30);
  assert.deepEqual(await register(),[id(10)]);
  console.log('PASS: concurrent payment/removal retry and failed repricing recovery preserve invoice, credit and sibling');
  await sql(await readFile(new URL('../supabase/migrations/0182_atomic_session_removal.sql',import.meta.url),'utf8'));
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal(await sql(`select has_function_privilege('${role}','remove_parent_booking_items_atomic(uuid,uuid,uuid[],text,text)','execute');`),role==='service_role'?'t':'f');
  }
  await sql(`update booking_capacity_holds set released_at=null,status='held' where booking_item_id='${id(10)}';
    create function synthetic_fail_pricing() returns trigger language plpgsql as $$begin raise exception 'Synthetic pricing failure'; end$$;
    create trigger synthetic_fail_pricing before update of gross_total on bookings for each row execute function synthetic_fail_pricing();`);
  const snapshot = () => sql(`select jsonb_build_object('booking',(select to_jsonb(b) from bookings b where id='${id(7)}'),
    'invoice',(select to_jsonb(i) from booking_invoices i where id='synthetic-siblings'),
    'items',(select jsonb_agg(to_jsonb(bi) order by id) from booking_items bi where booking_id='${id(7)}'),
    'holds',(select jsonb_agg(to_jsonb(h) order by booking_item_id) from booking_capacity_holds h),
    'credit',(select jsonb_agg(to_jsonb(c) order by id) from parent_account_credit_entries c where parent_account_id='${id(2)}'),
    'auditCount',(select count(*) from audit_log));`);
  const atomic = () => sql(`set role service_role; select remove_parent_booking_items_atomic('${id(2)}','${id(7)}',array['${id(10)}']::uuid[],'Atomic test','parent');`).then(JSON.parse);
  const unchanged = await snapshot();
  await assert.rejects(atomic(),/Synthetic pricing failure/);
  assert.equal(await snapshot(),unchanged,'Pricing failure rolls back booking, invoice, items, holds, ledger and audit');
  await sql('drop trigger synthetic_fail_pricing on bookings; drop function synthetic_fail_pricing();');
  assert.equal((await atomic()).amended,true);
  assert.equal(await balance(),40);
  assert.deepEqual(await register(),[]);
  const committed = await snapshot();
  assert.equal((await atomic()).amended,false);
  assert.equal(await snapshot(),committed,'Retry of final cancellation cannot mutate or credit twice');
  await assert.rejects(sql(`set role service_role; select remove_parent_booking_items_atomic('${id(99)}','${id(7)}',array['${id(10)}']::uuid[]);`),/not found for this parent/);
  console.log('PASS: atomic removal rolls all state back on pricing failure; final-session retry is a no-op and server-only access retained');
}
