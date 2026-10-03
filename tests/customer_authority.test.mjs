import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { verifyGoogleIdentity } from '../server/google_identity.js';
import { requirePermission } from '../server/access_policy.js';
import { GOOGLE_OPERATION_PERMISSIONS } from '../server/integrations/google_command_policy.js';

const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const dataOperations = ['record_event', 'query_statistics', 'query_legacy_statistics', 'generate_report', 'finalize_report_batch', 'google_operation', 'reconcile_google_upload'];
const memberOperations = ['list_members', 'mutate_membership', 'team_list', 'team_history', 'team_preview', 'team_commit'];

test('every extension operation verifies the bearer identity before reaching persistence', async () => {
  let providerCalls = 0;
  const service = createCustomerApiService({
    repository: new Proxy({}, { get() { throw Error('Unauthenticated repository access'); } }),
    verifyIdentity: request => verifyGoogleIdentity(request, {
      expectedClientId: 'trusted-client', fetchImpl: async () => { providerCalls++; return Response.json({error: 'invalid_token'}, {status: 400}); }
    })
  });
  for (const [route, operations] of [['bootstrap', ['bootstrap']], ['data', dataOperations], ['memberships', memberOperations]]) {
    for (const operation of operations) {
      for (const token of ['', 'Bearer forged-token']) {
        const request = new Request('https://api.example.test', {headers: {authorization: token}});
        await assert.rejects(service[route](request, {operation, role: 'admin', permissions: ['*']}), {code: 'identity_error'});
      }
    }
  }
  assert.equal(providerCalls, 14);
});

test('forged extension authority is rejected, and accepted scope comes from the resolved member', async () => {
  const actor = {customerId: config.customerId, memberId: 'server-member', role: 'employee', customerConfig: config, platforms: ['youtube']};
  const accepted = [];
  const service = createCustomerApiService({repository: {
    requireActiveMember: async () => actor,
    recordEvent: async (current, event) => {accepted.push({current, event}); return event;}
  }, verifyIdentity: async () => ({email: 'verified@example.test', subject: 'verified-subject'})});
  const body = {protocol_version: 1, operation: 'record_event', event: {
    customer_id: config.customerId, user_id: actor.memberId, event_id: 'test', event_type: 'activity.item_added', occurred_at: Date.now(), attributes: {target_url: 'https://youtube.com/watch?v=1', platform: 'youtube'}
  }};
  for (const [field, value] of Object.entries({customerId: 'foreign', userId: 'foreign', role: 'admin', permissions: ['*'], subscriptionStatus: 'active', seatStatus: 'active', enabledFeatures: ['automate'], capabilities: {enabledPlatforms: ['tiktok']}})) {
    await assert.rejects(service.data({}, {...body, [field]: value}), {code: 'invalid_request'});
  }
  for (const hints of [{customer_id: 'foreign'}, {user_id: 'foreign'}]) {
    await assert.rejects(service.data({}, {...body, event: {...body.event, ...hints}}), {code: 'scope_mismatch'});
  }
  await service.data({}, body);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].current, actor);
});

test('management and over-cap snapshots cannot authorize operational permissions', () => {
  for (const restriction of [{managementOnly: true}, {overCap: true}]) {
    const actor = {role: 'admin', customerConfig: config, ...restriction};
    requirePermission(actor, 'settings.adminAccess');
    for (const permission of new Set(Object.values(GOOGLE_OPERATION_PERMISSIONS))) {
      assert.throws(() => requirePermission(actor, permission), {code: 'not_authorized'});
    }
  }
  const restricted = structuredClone(config);
  restricted.access.enabledRoles = ['employee'];
  assert.throws(() => requirePermission({role: 'admin', customerConfig: restricted}, 'settings.adminAccess'), {code: 'not_authorized'});
});
