import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { uploadToDrive } from '../utils/google_api.js';
import { stableOperationId } from '../services/google_operation_service.js';
import { CUSTOMER_ACCESS_PROFILE_CACHE_KEY, CUSTOMER_OPERATION_SESSION_KEY } from '../utils/access_control.js';
import { createCustomerApiService } from '../server/customer_api_service.js';

function browser(t, {errorCode = 'operation_uncertain', reconcileError, switchAccount = false} = {}) {
  let profile = {customerId: 'fixture-customer', userId: 'fixture-member'};
  const scope = {...profile, eventId: 'fixture-event'};
  const calls = [], originalChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {local: {get: async () => ({[CUSTOMER_ACCESS_PROFILE_CACHE_KEY]: profile, [CUSTOMER_OPERATION_SESSION_KEY]: 'fixture-session'})}},
    runtime: {getURL: path => `chrome-extension://fixture/${path}`},
    identity: {getAuthToken: (_options, callback) => callback('fixture-token')}
  };
  t.after(() => { if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('chrome-extension:')) return Response.json({dataEndpoint: 'https://api.example.test/data'});
    const body = JSON.parse(options.body); calls.push(body);
    if (body.operation === 'google_operation' || reconcileError) {
      if (switchAccount) profile = {customerId: 'other-customer', userId: 'other-member'};
      return Response.json({error: {code: body.operation === 'google_operation' ? errorCode : reconcileError, message: 'Upload failed'}}, {status: 409});
    }
    return Response.json({...profile, requestId: body.command.requestId, result: {id: 'recovered-file'}});
  });
  return {scope, calls, upload: () => uploadToDrive(null, 'fixture-folder', 'evidence.pdf', new Blob(['%PDF-fixture']), 'application/pdf', scope)};
}

test('the browser reconciles an uncertain upload once with its unchanged deterministic ID and payload', async t => {
  const h = browser(t);
  assert.deepEqual(await h.upload(), {id: 'recovered-file'});
  assert.deepEqual(h.calls.map(c => c.operation), ['google_operation', 'reconcile_google_upload']);
  assert.deepEqual(h.calls[0].command, h.calls[1].command);
  assert.equal(h.calls[0].command.requestId, await stableOperationId(h.scope.customerId, h.scope.userId, h.scope.eventId, 'evidence.pdf', Buffer.from('%PDF-fixture').toString('base64')));
  await h.upload();
  assert.deepEqual(h.calls[2].command, h.calls[0].command);
});

test('an unresolved receipt stops after one read-only reconciliation request', async t => {
  const h = browser(t, {reconcileError: 'operation_uncertain'});
  await assert.rejects(h.upload(), {code: 'operation_uncertain'});
  assert.equal(h.calls.length, 2);
});

test('ordinary guard/provider failures do not trigger a reconciliation or a fresh upload ID', async t => {
  const h = browser(t, {errorCode: 'resource_verification_unavailable'});
  await assert.rejects(h.upload(), {code: 'resource_verification_unavailable'});
  await assert.rejects(h.upload(), {code: 'resource_verification_unavailable'});
  assert.deepEqual(h.calls.map(c => c.operation), ['google_operation', 'google_operation']);
  assert.deepEqual(h.calls[0].command, h.calls[1].command);
});

test('an account switch prevents the automatic reconciliation request', async t => {
  const h = browser(t, {switchAccount: true});
  await assert.rejects(h.upload(), /Account changed before upload/);
  assert.equal(h.calls.length, 1);
});

test('the reconciliation API admits only an authenticated original upload command', async () => {
  const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
  const actor = {customerId: config.customerId, memberId: 'verified-member', role: 'admin', platforms: ['youtube'], customerConfig: config};
  let calls = 0;
  const service = createCustomerApiService({verifyIdentity: async () => ({subject: 'verified-subject'}), repository: {
    requireActiveMember: async identity => {assert.equal(identity.subject, 'verified-subject'); return actor;},
    reconcileIntegrationUpload: async (current, command) => {
      assert.equal(current, actor); assert.equal(command.requestId, 'original-id'); calls++;
      throw Error('Reached authorized reconciliation');
    }
  }});
  const request = new Request('https://api.example.test/data', {headers: {Authorization: 'Bearer fixture-token'}});
  const body = {protocol_version: 1, operation: 'reconcile_google_upload', intended_scope: {customer_id: actor.customerId, user_id: actor.memberId}, command: {name: 'uploadToDrive', requestId: 'original-id', args: ['fixture-folder', 'file.pdf', Buffer.from('%PDF-fixture').toString('base64'), 'application/pdf', 'fixture-event']}};
  await assert.rejects(service.data(request, body), /Reached authorized reconciliation/);
  await assert.rejects(service.data(request, {...body, customerId: 'foreign'}), {code: 'invalid_request'});
  await assert.rejects(service.data(request, {...body, command: {...body.command, name: 'ensureBriefingFolder', args: []}}), {code: 'invalid_operation'});
  assert.equal(calls, 1);
});
