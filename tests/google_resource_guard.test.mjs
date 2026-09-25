import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleResourceGuard } from '../server/integrations/google_resource_guard.js';
import { createGoogleOperations } from '../server/integrations/google_operations.js';
import { createGoogleAdapter } from '../server/integrations/google_adapter.js';
import { ApiError } from '../server/api_error.js';
import fs from 'node:fs/promises';

const FOLDER = 'application/vnd.google-apps.folder';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const ROOT = 'root-customer-a', FOREIGN = 'root-customer-b', HOME = 'shared-drive-home';
const FILE = 'config-customer-a', SHEET_A = 'sheet-customer-a', SHEET_B = 'sheet-customer-b';
function file(id, mimeType, parents = [], changes = {}) {
  return {id, mimeType, parents, trashed: false, capabilities: {canEdit: true, canAddChildren: true, canListChildren: true, canDownload: true}, ...changes};
}
function harness() {
  const actor = {customerId: 'customer-a', memberId: 'member-a', role: 'admin', platforms: ['youtube'], customerConfig: structuredClone(config)};
  actor.customerConfig.customerId = actor.customerId;
  actor.customerConfig.destinations = {driveRootFolderId: ROOT, reportSpreadsheetId: SHEET_A, eventSpreadsheetId: SHEET_A};
  const resources = new Map([
    [HOME, file(HOME, FOLDER, [], {driveId: HOME})], [ROOT, file(ROOT, FOLDER, [HOME])],
    [FOREIGN, file(FOREIGN, FOLDER, [HOME])],
    [FILE, file(FILE, 'application/json', [ROOT])],
    [SHEET_A, file(SHEET_A, SHEET, [HOME])], [SHEET_B, file(SHEET_B, SHEET, [FOREIGN])]
  ]);
  const scopes = [], requests = [];
  const repository = {
    claimIntegrationResources: async () => actor,
    requireUploadFolder: async () => {},
    runIntegrationOperation: async (_actor, _command, work) => work(actor),
    verifyGoogleResourceScope: async (current, ids, permission) => {
      assert.equal(current.customerId, 'customer-a');
      assert.equal(permission, 'sidepanel.report');
      scopes.push(ids);
      if (ids.includes(FOREIGN) || ids.includes(SHEET_B)) throw new ApiError(403, 'scope_mismatch', 'Foreign resource');
    }
  };
  let business = async () => Response.json({});
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    requests.push({url, options});
    if (url.searchParams.get('fields')?.includes('capabilities')) {
      assert.equal(options.headers.Authorization, 'Bearer connector-a');
      const metadata = resources.get(url.pathname.split('/').at(-1));
      return metadata ? Response.json(metadata) : Response.json({}, {status: 404});
    }
    return business(url, options);
  };
  const guard = createGoogleResourceGuard({actor, token: 'connector-a', permission: 'sidepanel.report', repository, fetchImpl});
  return {actor, resources, scopes, requests, repository, fetchImpl, guard, setBusiness: callback => {business = callback;}};
}
const drive = id => `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
const sheet = id => `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1`;
const search = q => `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`;

test('resource guard accepts own files and separately configured Sheets under a shared ancestor', async () => {
  const h = harness();
  await h.guard.authorizeRequest(drive(FILE));
  await h.guard.authorizeRequest(sheet(SHEET_A));
  await h.guard.authorizeRequest(sheet(SHEET_A), {method: 'PUT'});
  assert.deepEqual(h.scopes, [[FILE, ROOT, HOME], [SHEET_A, HOME], [SHEET_A, HOME]]);
  assert.equal(h.requests.every(r => r.options.redirect === 'error'), true);
});

test('foreign and nested customer roots never become valid upload folders', async () => {
  const h = harness();
  await assert.rejects(h.guard.assertFolder(FOREIGN, true), {code: 'scope_mismatch'});
  h.resources.get(FOREIGN).parents = [ROOT];
  await assert.rejects(h.guard.assertFolder(FOREIGN, true), {code: 'scope_mismatch'});
  h.resources.get(FOREIGN).parents = [HOME];
  h.resources.get(ROOT).parents = [FOREIGN];
  await assert.rejects(h.guard.assertFolder(ROOT), {code: 'scope_mismatch'});
});

test('foreign and nonexistent resource IDs have identical public errors', async () => {
  const h = harness();
  const errors = [];
  for (const id of [FOREIGN, 'nonexistent-folder']) {
    try { await h.guard.assertFolder(id, true); assert.fail('Must deny guessed resource'); }
    catch (error) { errors.push({status: error.status, code: error.code, message: error.message}); }
  }
  assert.deepEqual(errors[0], errors[1]);
  assert.equal(errors[0].status, 403);
});

test('shortcuts, trashed files, wrong types, cycles and malformed ancestry fail closed', async () => {
  for (const changes of [
    {mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: {targetId: FOREIGN}},
    {trashed: true}, {id: 'wrong-resource-id'}, {parents: [ROOT, FOREIGN]}, {parents: [17]},
    {parents: [FILE]}, {parents: ['missing-parent']}, {parents: 'not-an-array'}
  ]) {
    const h = harness(); Object.assign(h.resources.get(FILE), changes);
    await assert.rejects(h.guard.authorizeRequest(drive(FILE)));
  }
  const h = harness(); h.resources.get(SHEET_A).mimeType = FOLDER;
  await assert.rejects(h.guard.authorizeRequest(sheet(SHEET_A)), {code: 'scope_mismatch'});
  h.resources.get(FILE).parents = ['deep-folder-00'];
  for (let i = 0; i < 33; i++) {
    const id = `deep-folder-${String(i).padStart(2,'0')}`;
    h.resources.set(id, file(id, FOLDER, [i === 32 ? ROOT : `deep-folder-${String(i+1).padStart(2,'0')}`]));
  }
  await assert.rejects(h.guard.authorizeRequest(drive(FILE)), {code: 'scope_mismatch'});
});

test('connector capabilities and live server authorization are required before provider business requests', async () => {
  const h = harness();
  h.resources.get(SHEET_A).capabilities.canEdit = false;
  await assert.rejects(h.guard.authorizeRequest(sheet(SHEET_A), {method: 'PUT'}), {code: 'scope_mismatch'});
  await h.guard.authorizeRequest(sheet(SHEET_A));
  h.resources.get(ROOT).capabilities.canAddChildren = false;
  await assert.rejects(h.guard.assertFolder(ROOT, true), {code: 'scope_mismatch'});
  h.resources.get(FILE).capabilities.canDownload = false;
  await assert.rejects(h.guard.authorizeRequest(drive(FILE)), {code: 'scope_mismatch'});
  h.resources.get(FILE).capabilities.canDownload = true;
  h.repository.verifyGoogleResourceScope = async () => {throw new ApiError(403, 'not_authorized', 'Access revoked');};
  let reads = 0; h.setBusiness(async () => {reads++; return Response.json({});});
  const adapter = createGoogleAdapter({token: 'connector-a', actor: h.actor, integrations: h.actor.customerConfig.destinations, resourceGuard: h.guard, fetchImpl: h.fetchImpl});
  await assert.rejects(adapter.fetchConfig(), {code: 'not_authorized'});
  assert.equal(reads, 0);
});

test('unscoped searches, arbitrary Sheets, hosts, methods and unparented uploads are rejected', async () => {
  const h = harness();
  for (const [url, options] of [
    [sheet(SHEET_B)], ['http://www.googleapis.com/drive/v3/files'],
    ['https://evil.test/drive/v3/files'], [search("name='events_config.json'")],
    [search(`'${ROOT}' in parents and name='x' or trashed=false`)],
    [drive(FILE), {method: 'DELETE'}],
    ['https://www.googleapis.com/drive/v3/files', {method: 'POST', body: JSON.stringify({mimeType: FOLDER})}],
    ['https://www.googleapis.com/drive/v3/files', {method: 'POST', body: JSON.stringify({mimeType: FOLDER, parents: [ROOT, FOREIGN]})}]
  ]) await assert.rejects(h.guard.authorizeRequest(url, options), {code: 'scope_mismatch'});
  assert.equal(h.requests.length, 0);
  await h.guard.authorizeRequest(search(`'${ROOT}' in parents and name='or (not) a problem' and trashed=false`));
});

test('metadata failures never fall back to direct access', async () => {
  for (const fetchImpl of [async () => {throw Error('offline');}, async () => Response.json({}, {status: 429}), async () => Response.json({}, {status: 503}), async () => new Response('bad JSON')]) {
    const h = harness();
    const guard = createGoogleResourceGuard({actor: h.actor, token: 'connector-a', permission: 'sidepanel.report', repository: h.repository, fetchImpl});
    await assert.rejects(guard.assertFolder(ROOT), {code: 'resource_verification_unavailable'});
    assert.equal(h.scopes.length, 0);
  }
});

test('adapter refuses a discovered foreign folder before returning its ID', async () => {
  const h = harness(); h.resources.get(FOREIGN).parents = [ROOT];
  h.setBusiness(async () => Response.json({files: [{id: FOREIGN}]}));
  const service = createGoogleOperations({repository: h.repository, fetchImpl: h.fetchImpl, tokenProvider: async () => 'connector-a'});
  await assert.rejects(service.execute(h.actor, {name: 'ensureRogueScreenshotFolder', args: [], requestId: 'folder-request'}), {code: 'scope_mismatch'});
});

test('config patch rechecks ancestry after read and refuses a file moved to another customer', async () => {
  const h = harness(); let patches = 0;
  h.setBusiness(async (url, options) => {
    if (url.searchParams.has('q')) return Response.json({files: [{id: FILE}]});
    if (url.searchParams.get('alt') === 'media') {
      h.resources.get(FILE).parents = [FOREIGN];
      return Response.json({platform_selectors: {}}, {headers: {ETag: 'test-etag'}});
    }
    if (options.method === 'PATCH') patches++;
    return Response.json({});
  });
  const adapter = createGoogleAdapter({token: 'connector-a', actor: h.actor, integrations: h.actor.customerConfig.destinations, resourceGuard: h.guard, fetchImpl: h.fetchImpl});
  await assert.rejects(adapter.patchConfigSelector('youtube', 'scraper', 'handle', '.handle', null), {code: 'scope_mismatch'});
  assert.equal(patches, 0);
});

test('adapter cannot be constructed into an unguarded operational path', async () => {
  const h = harness(); let calls = 0;
  const adapter = createGoogleAdapter({token: 'connector-a', integrations: h.actor.customerConfig.destinations, fetchImpl: async () => {calls++; return Response.json({});}});
  await assert.rejects(adapter.getColumnHDataWithFormatting(), /resource guard is required/);
  assert.equal(calls, 0);
});

test('guarded adapter preserves scoped multipart uploads and provider receipts', async () => {
  const h = harness(); let uploaded = 0;
  h.setBusiness(async (url, options) => {
    if (url.pathname === '/upload/drive/v3/files') {
      uploaded++;
      const value = JSON.parse(await options.body.get('metadata').text());
      assert.deepEqual(value.parents, [ROOT]);
      assert.deepEqual(value.appProperties, {customer_id: 'customer-a', user_id: 'member-a', event_id: 'event-a'});
      return Response.json({id: 'created-file-a', webViewLink: 'https://drive.google.com/file/d/created-file-a/view'});
    }
    assert.equal(url.searchParams.get('fields'), 'webViewLink');
    return Response.json({webViewLink: 'https://drive.google.com/drive/folders/root-customer-a'});
  });
  const adapter = createGoogleAdapter({token: 'connector-a', actor: h.actor, integrations: h.actor.customerConfig.destinations, resourceGuard: h.guard, fetchImpl: h.fetchImpl});
  const result = await adapter.uploadToDrive('connector-a', ROOT, 'a.pdf', new Blob(['%PDF-fixture'], {type: 'application/pdf'}), 'application/pdf', {customerId: 'customer-a', userId: 'member-a', eventId: 'event-a'});
  assert.equal(result.id, 'created-file-a');
  assert.equal(uploaded, 1);
  assert.equal(h.scopes.length, 2);
});

test('completed folder and upload receipts cannot bypass current Google ownership', async () => {
  for (const command of [
    {name: 'ensureRogueScreenshotFolder', args: [], requestId: 'cached-folder'},
    {name: 'uploadToDrive', args: [ROOT, 'x.pdf', Buffer.from('%PDF-fixture').toString('base64'), 'application/pdf', 'event-a'], requestId: 'cached-upload'}
  ]) {
    const h = harness();
    h.resources.get(FOREIGN).parents = [ROOT];
    const movedFile = 'moved-file-customer-a';
    h.resources.set(movedFile, file(movedFile, 'application/pdf', [FOREIGN]));
    let workCalled = false;
    h.repository.runIntegrationOperation = async () => command.name === 'uploadToDrive' ? {id: movedFile} : FOREIGN;
    h.setBusiness(async () => {workCalled = true; return Response.json({});});
    const service = createGoogleOperations({repository: h.repository, fetchImpl: h.fetchImpl, tokenProvider: async () => 'connector-a'});
    await assert.rejects(service.execute(h.actor, command), {code: 'scope_mismatch'});
    assert.equal(workCalled, false);
  }
});

test('missing parents cannot disguise an arbitrary resource as a root', async () => {
  const h = harness();
  delete h.resources.get(HOME).driveId; // Exercise canonical My Drive root resolution.
  const fetchImpl = async (value, options) => new URL(value).pathname.endsWith('/root') ? Response.json(h.resources.get(HOME)) : h.fetchImpl(value, options);
  const guard = createGoogleResourceGuard({actor: h.actor, token: 'connector-a', permission: 'sidepanel.report', repository: h.repository, fetchImpl});
  await guard.assertFolder(ROOT);
  h.resources.get(ROOT).parents = [];
  await assert.rejects(guard.assertFolder(ROOT), {code: 'scope_mismatch'});
  h.resources.get(ROOT).parents = undefined;
  await assert.rejects(guard.assertFolder(ROOT), {code: 'scope_mismatch'});
  h.resources.get(SHEET_A).parents = [];
  await assert.rejects(guard.authorizeRequest(sheet(SHEET_A)), {code: 'scope_mismatch'});
});
