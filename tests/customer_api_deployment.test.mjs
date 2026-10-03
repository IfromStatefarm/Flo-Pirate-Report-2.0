import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCustomerApi } from '../server/http.js';
import { verifyCustomerApi } from '../server/scripts/verify_customer_api.mjs';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { ApiError } from '../server/api_error.js';

const settings = { bootstrapEndpoint: 'https://bootstrap.example.test/',
  membershipEndpoint: 'https://memberships.example.test/', dataEndpoint: 'https://data.example.test/' };
const compatibleFetch = (url, options) => handleCustomerApi('memberships', new Request(url, options), {
  service: { memberships() { throw new ApiError(401, 'identity_error', 'A token is required.'); } },
});

test('all customer routes advertise compatibility without authenticating OPTIONS', async () => {
  const results = await verifyCustomerApi(settings, { fetchImpl: compatibleFetch });
  assert.ok(results.every(result => result.ok));
});

test('verification catches a stale data function even when other routes are current', async () => {
  const results = await verifyCustomerApi(settings, { fetchImpl: (url, options) => url === settings.dataEndpoint
    ? new Response(null, { status: 204 }) : compatibleFetch(url, options) });
  assert.deepEqual(results.map(result => result.ok), [true, true, false]);
  assert.match(results[2].message, /command support/);
});

test('verification checks Team & Access independently of Google command support', async () => {
  const results = await verifyCustomerApi(settings, { fetchImpl: (url, options) => url === settings.membershipEndpoint
    ? new Response(null, { status: 204, headers: { 'X-Rights-Reporter-API': 'google-operations-v1' } })
    : compatibleFetch(url, options) });
  assert.deepEqual(results.map(result => result.ok), [true, false, true]);
  assert.match(results[1].message, /Team & Access support is unverified/);
});

test('verification checks membership POST headers and unauthenticated denial after OPTIONS', async () => {
  const results = await verifyCustomerApi(settings, { fetchImpl: (url, options) => {
    if (url !== settings.membershipEndpoint || options.method === 'OPTIONS') {
      return compatibleFetch(url, options);
    }
    return new Response(JSON.stringify({ error: { code: 'identity_error' } }), {
      status: 401, headers: { 'X-Rights-Reporter-API': 'google-operations-v1' },
    });
  } });
  assert.deepEqual(results.map(result => result.ok), [true, false, true]);
  assert.match(results[1].message, /Membership POST does not advertise/);
});

test('membership validation errors advertise browser-readable compatibility metadata', async () => {
  const response = await handleCustomerApi('memberships', new Request(settings.membershipEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('X-Rights-Reporter-Team'), 'team-access-v1');
  assert.match(response.headers.get('Access-Control-Expose-Headers'), /X-Rights-Reporter-Team/);
  assert.equal((await response.json()).error.code, 'invalid_request');
});

test('verification rejects invalid endpoints before sending requests and checks CORS', async () => {
  let calls = 0;
  const results = await verifyCustomerApi({ ...settings, dataEndpoint: 'https://user:secret@data.example.test/' }, {
    origin: 'chrome-extension://expected', fetchImpl: () => { calls++; return new Response(null, {
      status: 204, headers: { 'X-Rights-Reporter-API': 'google-operations-v1' } }); },
  });
  assert.equal(calls, 2);
  assert.ok(results.every(result => !result.ok));
  assert.match(results[0].message, /origin/);
  assert.ok(!JSON.stringify(results).includes('secret'));
});

test('HTTP command requests reach membership authorization while unknown fields remain rejected', async () => {
  let memberships = 0;
  const service = createCustomerApiService({ verifyIdentity: async () => ({ subject: 'test', email: 'test@example.test' }),
    repository: { requireActiveMember() { memberships++; throw new ApiError(403, 'not_a_member', 'Test denial'); } } });
  const call = body => handleCustomerApi('data', new Request(settings.dataEndpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' }, body: JSON.stringify(body) }), { service });
  const body = { protocol_version: 1, operation: 'google_operation', intended_scope: {customer_id: 'fixture', user_id: 'member'}, command: { name: 'fetchConfig', args: [], requestId: 'probe' } };
  assert.equal((await (await call(body)).json()).error.code, 'not_a_member');
  assert.equal(memberships, 1);
  const invalid = await call({ ...body, customerId: 'injected' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error.message, /customerId is not supported/);
  assert.equal(memberships, 1);
});
