import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const bin = '/opt/homebrew/opt/postgresql@17/bin';
const root = await mkdtemp(join(tmpdir(), 'apres-profile-test-'));
const data = join(root, 'data'), socket = join(root, 'socket');
await mkdir(socket, { mode: 0o700 });
const env = { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C' };
const sql = async query => (await run(join(bin, 'psql'), ['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-p','55440','-U','apres_test','-d','postgres','-c',query], { env })).stdout.trim();
let started = false;
try {
  await run(join(bin,'initdb'), ['-D',data,'-U','apres_test','--auth-local=trust','--auth-host=reject','--no-locale'], {env});
  await run(join(bin,'pg_ctl'), ['-D',data,'-l',join(root,'server.log'),'-o',`-h '' -k ${socket} -p 55440`,'-w','start'], {env});
  started = true;
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key, role text, active boolean, email text, onboarding_only boolean, staff_access_status text, must_change_password boolean, password_changed_at timestamptz);
    insert into profiles values ('00000000-0000-4000-8000-000000000001','parent',true,'synthetic@example.invalid',false,'active',true,null),('00000000-0000-4000-8000-000000000002','staff',true,'other@example.invalid',false,'active',true,null);
    alter table profiles enable row level security;
    create policy own_read on profiles for select to authenticated using(id=auth.uid());
    create policy profiles_update_own_password_state on profiles for update using(id=auth.uid());
    grant all on profiles to anon,authenticated,service_role;
    grant update(role),insert(role) on profiles to public;
  `);
  const migration = await readFile(new URL('../supabase/migrations/0183_restrict_profile_browser_writes.sql',import.meta.url),'utf8');
  await sql(migration); await sql(migration);
  const caller = `set role authenticated; set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';`;
  for (const assignment of ["role='superadmin'",'active=false',"email='changed@example.invalid'",'onboarding_only=true',"staff_access_status='former'"]) {
    await assert.rejects(sql(`${caller} update profiles set ${assignment};`), /permission denied/);
  }
  for (const role of ['anon','authenticated']) {
    for (const action of ['delete from profiles','truncate profiles',"insert into profiles(id,role) values(gen_random_uuid(),'superadmin')"]) {
      await assert.rejects(sql(`set role ${role}; ${action};`), /permission denied/);
    }
  }
  await sql(`${caller} update profiles set must_change_password=false,password_changed_at=now();`);
  assert.equal(await sql("select must_change_password from profiles where role='staff'"),'t');
  assert.equal(await sql("select must_change_password from profiles where role='parent'"),'f');
  assert.equal(await sql(`${caller} select count(*) from profiles;`),'1');
  await sql("set role service_role; update profiles set role='manager' where role='staff'; insert into profiles(id,role) values(gen_random_uuid(),'parent');");
  assert.equal(await sql("select count(*) from profiles where role='manager'"),'1');
  console.log('PASS: role/access/identity writes, insertion, deletion and truncation blocked; own password acknowledgement and reads preserved; server management works; migration idempotent. Synthetic local database only.');
} finally {
  if(started) await run(join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{env});
}
