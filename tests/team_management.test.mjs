import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTeamRequest, isTeamPageSender } from '../utils/team_access.js';
import { projectTeamChanges } from '../server/team_management.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { createCustomerMembershipService } from '../services/customer_membership_service.js';

const config = { access: { totalUserCap: 3, roleSeatCaps: { employee: 1, manager: 1, admin: 1 }, enabledRoles: ['employee','manager','admin'], allowedEmailDomains: ['example.test'] } };
const rows = ['admin','employee','manager'].map((role,i) => ({ member_id: `m${i}`, email: `${role}@example.test`, name: role, role, status: 'active', version: 1 }));
const change = (i,role) => ({ action: 'change_role', memberId: `m${i}`, expectedVersion: 1, role });
const request = changes => ({ protocolVersion: 1, operation: 'team_preview', requestId: 'test-review', changes });
test('membership messages are restricted to the extension administration pages', () => {
  assert.equal(isTeamPageSender({id:'abc',url:'chrome-extension://abc/options/team.html'},'abc'),true);
  assert.equal(isTeamPageSender({id:'abc',url:'chrome-extension://abc/options.html#team'},'abc'),true);
  for (const sender of [{id:'abc',url:'https://site.test/options/team.html'},{id:'other',url:'chrome-extension://abc/options/team.html'},{id:'abc',url:'chrome-extension://abc/options/team.html.evil'},{id:'abc',url:'chrome-extension://abc/content_form.js'},null]) assert.equal(isTeamPageSender(sender,'abc'),false);
});
test('team schema rejects injected authority, duplicate people, invalid cursors and oversized batches', () => {
  const valid = request([{ action: 'add', email: ' New@Example.Test ', name: 'New', role: 'employee' }]);
  assert.equal(validateTeamRequest(valid).changes[0].email,'new@example.test');
  for (const candidate of [ {...valid, customerId:'other'}, {...valid, actorEmail:'other@example.test'}, request([...valid.changes,...valid.changes]), request(Array(51).fill(change(1,'manager'))), {protocolVersion:1,operation:'team_history',cursor:'["bad-date","id"]'}, request([{action:'add', email:'me@example.test',name:'=formula',role:'admin'}]) ]) assert.throws(() => validateTeamRequest(candidate));
});
test('atomic role swaps and replacements fit final seat totals', () => {
  const swap = projectTeamChanges(rows,[change(1,'manager'),change(2,'employee')],config);
  assert.equal(swap.after.activeUsers.used,3); assert.equal(swap.after.roles.manager.used,1);
  assert.throws(() => projectTeamChanges(rows,[change(1,'manager')],config), { code:'seat_limit_exceeded' });
  const replace = projectTeamChanges(rows,[{action:'disable',memberId:'m1',expectedVersion:1},{action:'add',email:'new@example.test',name:'New',role:'employee'}],config);
  assert.equal(replace.after.activeUsers.used,3);
});
test('last admin, member versions, domain rules, transitions and restricted access are enforced', () => {
  assert.throws(() => projectTeamChanges(rows,[{action:'disable',memberId:'m0',expectedVersion:1}],config), {code:'final_admin_required'});
  assert.throws(() => projectTeamChanges(rows,[{...change(1,'manager'),expectedVersion:9}],config), {code:'stale_member_version'});
  assert.throws(() => projectTeamChanges(rows,[{action:'add',email:'bad@elsewhere.test',name:'Bad',role:'employee'}],config), {code:'domain_not_allowed'});
  assert.throws(() => projectTeamChanges(rows,[{...change(1,'employee'),action:'reactivate'}],config), {code:'invalid_transition'});
  assert.throws(() => projectTeamChanges(rows,[change(1,'employee')],config,true), {code:'team_read_only'});
  assert.equal(projectTeamChanges(rows,[{action:'disable',memberId:'m1',expectedVersion:1}],config,true).after.activeUsers.used,2);
});
test('over-cap recovery must reduce overage without creating another', () => {
  const extra = [...rows,{...rows[1],member_id:'extra',email:'extra@example.test'}];
  assert.equal(projectTeamChanges(extra,[{action:'disable',memberId:'m1',expectedVersion:1}],config).after.activeUsers.used,3);
  assert.throws(() => projectTeamChanges(extra,[change(1,'manager')],config), {code:'seat_limit_exceeded'});
});
test('team API validates before handing verified identity to the repository', async () => {
  const identity = {email:'admin@example.test',subject:'verified-sub'}; let called=0;
  const service = createCustomerApiService({verifyIdentity:async()=>identity,repository:{teamOperation: async (actor, body) => {called++;assert.equal(actor,identity);return body;}}});
  const body = {protocolVersion:1,operation:'team_list',query:'',role:'',status:'',cursor:''};
  assert.deepEqual(await service.memberships({},body),body);assert.equal(called,1);
  await assert.rejects(service.memberships({}, {...body,customerId:'other'}),{code:'invalid_request'});assert.equal(called,1);
});
test('client preserves safe team errors and rejects another customer response', async () => {
  const profile={status:'ready',verification:'verified',role:'admin',customerId:'test',email:'admin@example.test'};
  const options={getAuthToken:async()=> 'token',loadSettings:async()=>({schemaVersion:1,bootstrapEndpoint:'https://example.test/bootstrap'})};
  const call={operation:'team_list',query:'',role:'',status:'',cursor:''};
  const wrong=createCustomerMembershipService({...options,fetchImpl:async()=>new Response(JSON.stringify({protocolVersion:1,customerId:'other',configVersion:1}))});
  await assert.rejects(wrong.teamRequest(profile,call),{code:'invalid_response'});
  const conflict=createCustomerMembershipService({...options,fetchImpl:async()=>new Response(JSON.stringify({error:{code:'stale_review',message:'ignored',utilization:null}}),{status:409})});
  await assert.rejects(conflict.teamRequest(profile,call),{code:'stale_review'});
});
