import test from 'node:test';
import assert from 'node:assert/strict';
import { googleOperation } from '../services/google_operation_service.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { CUSTOMER_ACCESS_PROFILE_CACHE_KEY, CUSTOMER_OPERATION_SESSION_KEY } from '../utils/access_control.js';

const accountA = {customerId: 'customer-a', userId: 'member-a'};
const accountB = {customerId: 'customer-b', userId: 'member-b'};
const command = {name: 'updateEventUrl', args: ['Sports', 3, 'https://youtube.com/watch?v=example', 'youtube'], requestId: 'scope-probe'};

for (const boundary of ['settings fetch', 'settings JSON', 'post-settings storage read', 'OAuth token', 'post-token storage read', 'pre-dispatch storage read']) {
  for (const change of ['switch', 'logout', 'switch back']) {
    test(`Google operation ${change} during ${boundary} dispatches zero writes`, async t => {
      let profile = accountA;
      let session = 'session-a';
      let reads = 0;
      let providerWrites = 0;
      let tokenCalls = 0;
      const originalChrome = globalThis.chrome;
      const changeAccount = () => {
        session = 'session-b';
        profile = change === 'logout' ? undefined : change === 'switch' ? accountB : accountA;
      };
      globalThis.chrome = {
        storage: {local: {get: async () => {
          reads++;
          if ((boundary === 'post-settings storage read' && reads === 2) ||
              (boundary === 'post-token storage read' && reads === 3) ||
              (boundary === 'pre-dispatch storage read' && reads === 4)) changeAccount();
          return {[CUSTOMER_ACCESS_PROFILE_CACHE_KEY]: profile, [CUSTOMER_OPERATION_SESSION_KEY]: session};
        }}},
        runtime: {getURL: path => `chrome-extension://fixture/${path}`},
        identity: {getAuthToken: (_options, callback) => {
          tokenCalls++;
          if (boundary === 'OAuth token') changeAccount();
          callback('token-b');
        }}
      };
      t.after(() => { if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; });
      const fetchImpl = async (url, options) => {
        if (String(url).startsWith('chrome-extension:')) {
          if (boundary === 'settings fetch') changeAccount();
          return {ok: true, json: async () => {
            if (boundary === 'settings JSON') changeAccount();
            return {dataEndpoint: 'https://api.example.test/data'};
          }};
        }
        providerWrites++;
        return Response.json({...accountB, requestId: command.requestId, result: null});
      };
      await assert.rejects(googleOperation(command.name, command.args, {requestId: command.requestId, fetchImpl}), /customer changed/);
      assert.equal(providerWrites, 0);
      if (['settings fetch', 'settings JSON', 'post-settings storage read'].includes(boundary)) assert.equal(tokenCalls, 0);
    });
  }
}

test('Google operation carries the original intended scope on successful dispatch', async t => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {local: {get: async () => ({[CUSTOMER_ACCESS_PROFILE_CACHE_KEY]: accountA, [CUSTOMER_OPERATION_SESSION_KEY]: 'session-a'})}},
    runtime: {getURL: path => `chrome-extension://fixture/${path}`},
    identity: {getAuthToken: (_options, callback) => callback('token-a')}
  };
  t.after(() => { if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; });
  let body;
  const fetchImpl = async (url, options) => {
    if (String(url).startsWith('chrome-extension:')) return Response.json({dataEndpoint: 'https://api.example.test/data'});
    body = JSON.parse(options.body);
    return Response.json({...accountA, requestId: command.requestId, result: 'saved'});
  };
  assert.equal(await googleOperation(command.name, command.args, {requestId: command.requestId, fetchImpl}), 'saved');
  assert.deepEqual(body.intended_scope, {customer_id: accountA.customerId, user_id: accountA.userId});
});

test('server rejects mismatched or missing intended scope before any provider write', async t => {
  const actor = {customerId: accountB.customerId, memberId: accountB.userId};
  let providerWrites = 0;
  let integrationClaims = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerWrites++; throw Error('Provider should not be reached'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const service = createCustomerApiService({
    verifyIdentity: async () => ({subject: 'account-b'}),
    repository: {
      requireActiveMember: async () => actor,
      claimIntegrationResources: async () => { integrationClaims++; return actor; }
    }
  });
  const request = new Request('https://api.example.test/data', {headers: {Authorization: 'Bearer token-b'}});
  const base = {protocol_version: 1, operation: 'google_operation', intended_scope: {customer_id: accountA.customerId, user_id: accountA.userId}, command};
  for (const operation of ['google_operation', 'reconcile_google_upload']) {
    await assert.rejects(service.data(request, {...base, operation}), {code: 'scope_mismatch'});
    await assert.rejects(service.data(request, {...base, operation, intended_scope: {customer_id: accountB.customerId, user_id: accountA.userId}}), {code: 'scope_mismatch'});
    await assert.rejects(service.data(request, {...base, operation, intended_scope: undefined}), {code: 'invalid_request'});
  }
  assert.equal(integrationClaims, 0);
  assert.equal(providerWrites, 0);
});
