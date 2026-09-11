// Executes the real Edge handler with synthetic auth/database/email substitutes.
// No secrets, network requests, real bookings or email deliveries.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = (await readFile(new URL('../supabase/functions/update-parent-booking/index.ts',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'');
let handler, valid = true, active = true, role = 'parent', profileFailure = false;
const calls = [], tokens = [];
const client = {
  auth: { async getUser(token) {
    tokens.push(token);
    return valid ? { data: { user: { id:'verified-parent',user_metadata:{role:'superadmin'} } } } : {data:{user:null},error:new Error('Invalid token')};
  } },
  from(table) {
    assert.equal(table,'profiles');
    return { select() { return this; },eq(key,value) { assert.equal(key,'id'); assert.equal(value,'verified-parent'); return this; },
      async maybeSingle() { return {data:profileFailure ? null : {id:'verified-parent',email:'',full_name:'Synthetic',active,role},error:profileFailure ? new Error('Profile unavailable') : null}; } };
  },
  async rpc(name,args) {
    calls.push({name,args});
    if (name === 'apply_booking_pricing') return {data:{booking:{id:'synthetic-booking'}}};
    assert.equal(name,'amend_parent_booking_remove_items');
    return {data:{amended:true,booking:{id:'synthetic-booking'},removedItems:1,removedTotal:10}};
  },
};
const context = vm.createContext({ Deno:{env:{get:()=> 'synthetic'}},createClient:()=>client,
  serve: fn => {handler=fn;},Response,Request,console:{error(){}},
  sendBookingEmail(){throw new Error('Email forbidden in this test');},paragraphsToHtml(){throw new Error('Email forbidden');} });
vm.runInContext(stripTypeScriptTypes(source),context);
const request = async (authorization='Bearer synthetic-token') => handler(new Request('https://synthetic.invalid',{method:'POST',headers:authorization ? {Authorization:authorization} : {},body:JSON.stringify({action:'remove_items',bookingId:'synthetic-booking',bookingItemIds:['synthetic-item'],parentId:'victim',p_parent_id:'victim',role:'superadmin',p_actor_role:'superadmin',actor:{id:'victim',role:'superadmin'}})}));
assert.equal((await request('')).status,401);
valid=false;
assert.equal((await request()).status,401);
valid=true; active=false;
assert.equal((await request()).status,401);
active=true; profileFailure=true;
assert.equal((await request()).status,500);
assert.equal(calls.length,0,'Rejected auth must never mutate bookings');
profileFailure=false;
assert.equal((await request()).status,200);
assert.equal(calls[0].args.p_parent_id,'verified-parent');
assert.equal(calls[0].args.p_actor_role,'parent','Body and user-editable metadata cannot grant staff privileges');
role='manager'; calls.length=0;
assert.equal((await request()).status,200);
assert.equal(calls[0].args.p_actor_role,'manager','Server profile role is authoritative');
assert.ok(tokens.every(token=>token === 'synthetic-token'));
console.log('PASS: missing/invalid/inactive/error auth cannot mutate; forged body and auth metadata ignored; verified profile supplies identity and role. No emails or network.');
