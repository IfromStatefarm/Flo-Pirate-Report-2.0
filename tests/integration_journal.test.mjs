import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createGoogleOperations } from '../server/integrations/google_operations.js';
import { ApiError } from '../server/api_error.js';

const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const HOME = 'fixture-drive-home', FILE = 'fixture-upload-file';
const bytes = Buffer.from('%PDF-fixture');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

// Exercise the production repository, authorization, gateway and adapter against
// transactional SQL persistence and Google doubles. No database/provider access.
async function harness({event = false} = {}) {
  const members = new Map();
  const actor = {customerId: config.customerId, memberId: 'member-a', googleSubject: 'subject-a', email: 'operator@flosports.tv', role: 'admin', platforms: ['youtube'], configVersion: config.configVersion, customerConfig: structuredClone(config)};
  members.set(actor.googleSubject, actor);
  let operations = new Map(), uploads = new Map(), tail = Promise.resolve();
  const state = {failTransition: null, failUploadRecord: false, guardFailure: false, provider: 'success', writes: 0, reads: 0, metadata: null, extraMatches: [], incompleteSearch: false, inCallback: false,
    eventRows: [['Search', 'https://youtube.com'], ['Event', 'TikTok', 'Instagram', 'YouTube']], eventTitle: "Sports' Events", eventSheetId: 0};
  const key = (a, id) => JSON.stringify([a, id]);
  const pool = {async connect() {
    const before = tail, release = deferred(); tail = release.promise; await before;
    let saved, scope;
    return {release: release.resolve, async query(sql, p = []) {
      sql = sql.replace(/\s+/g, ' ').trim();
      const rows = values => ({rows: values, rowCount: values.length});
      if (sql === 'BEGIN') { saved = structuredClone({operations, uploads}); return rows([]); }
      if (sql === 'ROLLBACK') { ({operations, uploads} = saved); return rows([]); }
      if (sql === 'COMMIT' || sql.startsWith('SET ') || sql.startsWith('SELECT set_config')) return rows([]);
      if (sql.includes('rr_private.resolve_identity')) {
        const a = members.get(p[0]); scope = a?.customerId;
        return rows(a ? [{membership: {customer_id: a.customerId, member_id: a.memberId, google_subject: a.googleSubject, email: a.email, role: a.role, platforms: a.platforms, config: a.customerConfig, config_version: a.configVersion}}] : []);
      }
      if (sql.includes('FROM customer_subscriptions')) return rows([{starts_at: new Date(0), paid_through: new Date(Date.now() + 86400000)}]);
      if (sql.includes('FROM customer_memberships')) return rows([{role: 'admin', used: 1}]);
      if (sql.includes('rr_private.google_resources_available')) return rows([{available: true}]);
      if (sql.includes('FROM customer_integration_resources')) return rows([{customer_id: scope}]);
      assert.equal(p[0], scope, `SQL must use the resolved tenant: ${sql}`);
      if (sql.startsWith('SELECT count(*)')) return rows([{used: operations.size}]);
      if (sql.startsWith('SELECT *, lease_expires_at')) {
        const value = operations.get(key(...p)); return rows(value ? [{...structuredClone(value), lease_expired: value.expired || false}] : []);
      }
      if (sql.startsWith('INSERT INTO integration_operations')) {
        const [customer_id, operation_id, user_id, name, request_hash, attempt_id] = p;
        assert(!operations.has(key(customer_id, operation_id)));
        operations.set(key(customer_id, operation_id), {customer_id, operation_id, user_id, name, request_hash, attempt_id, status: 'preparing'}); return rows([{}]);
      }
      if (sql.startsWith('UPDATE integration_operations')) {
        const value = operations.get(key(...p));
        if (sql.includes('SET status=$4')) {
          if (state.failTransition === p[3]) throw Error('Journal persistence unavailable');
          if (value?.attempt_id !== p[2] || !['preparing', 'uncertain'].includes(value.status)) return rows([]);
          Object.assign(value, {status: p[3], result: JSON.parse(p[4]), expired: false});
        } else if (sql.includes("status='preparing'")) Object.assign(value, {status: 'preparing', attempt_id: p[2], expired: false});
        else if (sql.includes("status='completed'")) Object.assign(value, {status: 'completed', result: JSON.parse(p[2])});
        else assert.fail(`Unexpected mutation: ${sql}`);
        return rows([{}]);
      }
      if (sql.startsWith('INSERT INTO integration_uploaded_files')) {
        if (state.failUploadRecord) throw Error('Upload receipt persistence unavailable');
        uploads.set(key(p[0], p[1]), p); return rows([{}]);
      }
      assert.fail(`Unhandled SQL: ${sql}`);
    }};
  }};
  const repo = createPostgresRepository({pool});
  const root = actor.customerConfig.destinations.driveRootFolderId;
  const command = event
    ? {name: 'addNewEventToSheet', args: [state.eventTitle, '=Final A', 'https://youtube.com/watch?v=a', 'youtube'], requestId: 'stable-event-id'}
    : {name: 'uploadToDrive', args: [root, 'fixture.pdf', bytes.toString('base64'), 'application/pdf', 'event-1'], requestId: 'stable-upload-id'};
  const getReceipt = (a = actor, requestId = command.requestId) => operations.get(key(a.customerId, requestId));
  const originalRun = repo.runIntegrationOperation;
  repo.runIntegrationOperation = (a, c, work) => originalRun(a, c, (...args) => {state.inCallback = true; return work(...args);});
  const fetchImpl = async (value, options = {}) => {
    const url = new URL(value), id = url.pathname.split('/').at(-1);
    if (url.searchParams.get('fields')?.includes('capabilities')) {
      if (state.guardFailure && state.inCallback) return Response.json({}, {status: 503});
      const folder = [HOME, root].includes(id);
      return Response.json({id, mimeType: folder ? 'application/vnd.google-apps.folder' : id === FILE ? 'application/pdf' : 'application/vnd.google-apps.spreadsheet',
        parents: id === HOME ? [] : [id === FILE || id === 'fixture-config-file' ? root : HOME], driveId: HOME, trashed: false,
        capabilities: {canAddChildren: true, canListChildren: true, canEdit: true, canDownload: true}});
    }
    if (event) {
      if (url.searchParams.has('q')) return Response.json({files: [{id: 'fixture-config-file'}]});
      if (url.searchParams.get('alt') === 'media') return Response.json({verticals: [{name: state.eventTitle}]});
      if (url.searchParams.get('fields') === 'sheets.properties') {
        await state.beforeEventMetadata?.();
        return Response.json({sheets: [{properties: {title: state.eventTitle, sheetId: state.eventSheetId}}]});
      }
      assert.equal(url.href, `https://sheets.googleapis.com/v4/spreadsheets/${config.destinations.eventSpreadsheetId}:batchUpdate`);
      assert.equal(options.method, 'POST');
      const {requests} = JSON.parse(options.body);
      assert.equal(requests.length, 1);
      const append = requests[0].appendCells;
      assert.equal(append.sheetId, state.eventSheetId);
      assert.equal(append.fields, 'userEnteredValue');
      assert.equal(append.rows.length, 1);
      const values = append.rows[0].values.map(cell => {
        assert.deepEqual(Object.keys(cell.userEnteredValue), ['stringValue']);
        return cell.userEnteredValue.stringValue;
      });
      const receipt = [...operations.values()].find(value => value.status === 'uncertain' && value.name === 'addNewEventToSheet');
      assert(receipt, 'Uncertainty must commit before dispatch');
      state.writes++;
      await state.beforeEventAppend?.();
      if (typeof state.provider === 'number') return Response.json({error: {message: 'Provider rejected'}}, {status: state.provider});
      // Model Google's atomic append after the last data row, with no client row allocation.
      state.eventRows.push(values);
      if (state.provider === 'lost-response') throw Error('Append response lost');
      if (state.provider === 'malformed') return new Response('not json');
      return Response.json({replies: [{}]});
    }
    if (options.method === 'POST') {
      assert.equal(getReceipt().status, 'uncertain', 'Uncertainty must commit before dispatch');
      state.writes++;
      const metadata = JSON.parse(await options.body.get('metadata').text());
      if (typeof state.provider === 'number') return Response.json({error: {message: 'Provider rejected'}}, {status: state.provider});
      if (state.provider === 'transport') throw Error('Transport unavailable');
      state.metadata = {...metadata, id: FILE, mimeType: 'application/pdf', size: String(bytes.length), sha256Checksum: digest, trashed: false, webViewLink: `https://drive.google.com/file/d/${FILE}/view`};
      if (state.provider === 'lost-response') throw Error('Upload response lost');
      if (state.provider === 'malformed') return new Response('not json');
      return Response.json({id: FILE, webViewLink: state.metadata.webViewLink});
    }
    state.reads++;
    if (url.searchParams.has('q')) return Response.json({files: [...(state.metadata ? [state.metadata] : []), ...state.extraMatches], incompleteSearch: state.incompleteSearch});
    if (id === FILE) return Response.json(state.metadata);
    if (state.provider === 'post-read-failure') throw Error('Folder read failed');
    return Response.json({webViewLink: `https://drive.google.com/drive/folders/${root}`});
  };
  const service = createGoogleOperations({repository: repo, fetchImpl, tokenProvider: async () => 'fixture-token'});
  return {actor, members, command, repo, service, state, getReceipt, getUploads: () => uploads, run: () => {state.inCallback = false; return service.execute(actor, command);}, reconcile: () => service.reconcileUpload(actor, command)};
}

test('callback-side guard failure retries the same upload ID and completed replay sends no write', async () => {
  const h = await harness(); h.state.guardFailure = true;
  await assert.rejects(h.run(), {code: 'resource_verification_unavailable'});
  assert.equal(h.getReceipt().status, 'retryable'); assert.equal(h.state.writes, 0);
  h.state.guardFailure = false;
  const receipt = await h.run();
  assert.deepEqual(await h.run(), receipt); assert.equal(h.state.writes, 1);
  await assert.rejects(h.service.execute(h.actor, {...h.command, args: [...h.command.args.slice(0, 4), 'other-event']}), {code: 'operation_conflict'});
});

test('definitive provider rejections are retryable; transport, 5xx and invalid success bodies remain uncertain', async t => {
  for (const outcome of [400, 401, 403, 404, 412, 429, 408, 409, 500, 503, 'transport', 'malformed']) await t.test(String(outcome), async () => {
    const h = await harness(); h.state.provider = outcome;
    await assert.rejects(h.run());
    const retryable = [400, 401, 403, 404, 412, 429].includes(outcome);
    assert.equal(h.getReceipt().status, retryable ? 'retryable' : 'uncertain');
    h.state.provider = 'success';
    if (retryable) { await h.run(); assert.equal(h.state.writes, 2); }
    else { await assert.rejects(h.run(), {code: 'operation_uncertain'}); assert.equal(h.state.writes, 1); }
  });
});

test('failed boundary persistence sends no upload and can retry', async () => {
  const h = await harness(); h.state.failTransition = 'uncertain';
  await assert.rejects(h.run(), /Journal persistence unavailable/); assert.equal(h.state.writes, 0);
  h.state.failTransition = null; await h.run(); assert.equal(h.state.writes, 1);
});

test('post-write read, local receipt and completion failures reconcile without uploading again', async t => {
  for (const mode of ['lost-response', 'post-read-failure', 'receipt', 'completion']) await t.test(mode, async () => {
    const h = await harness();
    h.state.provider = mode; h.state.failUploadRecord = mode === 'receipt'; h.state.failTransition = mode === 'completion' ? 'completed' : null;
    await assert.rejects(h.run()); assert.equal(h.getReceipt().status, 'uncertain');
    h.state.provider = 'success'; h.state.failUploadRecord = false; h.state.failTransition = null;
    const reconciled = await h.reconcile();
    assert.equal(h.getReceipt().status, 'completed'); assert.equal(h.getUploads().size, 1);
    assert.deepEqual(await h.run(), reconciled); assert.deepEqual(await h.reconcile(), reconciled); assert.equal(h.state.writes, 1);
  });
});

test('receipt reconciliation rejects missing, duplicate, mismatched and incomplete provider evidence', async t => {
  for (const mode of ['missing', 'duplicate', 'digest', 'member', 'event', 'operation', 'parent', 'mime', 'size', 'name', 'incomplete']) await t.test(mode, async () => {
    const h = await harness(); h.state.provider = 'lost-response'; await assert.rejects(h.run());
    const file = h.state.metadata;
    if (mode === 'missing') h.state.metadata = null;
    if (mode === 'duplicate') h.state.extraMatches.push({...file, id: 'duplicate-file'});
    if (mode === 'digest') file.sha256Checksum = 'wrong';
    if (mode === 'member') file.appProperties.user_id = 'foreign';
    if (mode === 'event') file.appProperties.event_id = 'foreign';
    if (mode === 'operation') file.appProperties.operation_key = 'foreign';
    if (mode === 'parent') file.parents = ['foreign-folder'];
    if (mode === 'mime') file.mimeType = 'image/png';
    if (mode === 'size') file.size = '0';
    if (mode === 'name') file.name = 'other.pdf';
    if (mode === 'incomplete') h.state.incompleteSearch = true;
    await assert.rejects(h.reconcile(), {code: 'operation_uncertain'});
    assert.equal(h.getReceipt().status, 'uncertain'); assert.equal(h.state.writes, 1); assert.equal(h.getUploads().size, 0);
  });
});

test('reconciliation is tenant/member/hash scoped and rechecks current membership', async () => {
  const h = await harness(); h.state.provider = 'lost-response'; await assert.rejects(h.run());
  const foreign = {...h.actor, customerId: 'other', googleSubject: 'other-subject', memberId: 'other-member', customerConfig: {...h.actor.customerConfig, customerId: 'other'}};
  h.members.set(foreign.googleSubject, foreign);
  const reads = h.state.reads;
  await assert.rejects(h.service.reconcileUpload(foreign, h.command), {code: 'operation_unavailable'});
  const teammate = {...h.actor, memberId: 'teammate', googleSubject: 'teammate-subject'};
  h.members.set(teammate.googleSubject, teammate);
  await assert.rejects(h.service.reconcileUpload(teammate, h.command), {code: 'operation_conflict'});
  await assert.rejects(h.service.reconcileUpload(h.actor, {...h.command, args: [...h.command.args.slice(0, 4), 'changed-event']}), {code: 'operation_conflict'});
  h.members.delete(h.actor.googleSubject);
  await assert.rejects(h.reconcile(), {code: 'not_a_member'});
  assert.equal(h.state.reads, reads); assert.equal(h.state.writes, 1);
});

test('concurrent retries do not write twice and expired pre-write attempts are fenced', async () => {
  const h = await harness(), entered = deferred(), resume = deferred();
  let writes = 0;
  const stale = h.repo.runIntegrationOperation(h.actor, h.command, async (_actor, journal) => {
    entered.resolve(); await resume.promise; await journal.beforeWrite(); writes++; return {ok: true};
  });
  await entered.promise;
  await assert.rejects(h.repo.runIntegrationOperation(h.actor, h.command, () => assert.fail('Concurrent callback')), {code: 'operation_in_progress'});
  h.getReceipt().expired = true;
  const recovered = await h.repo.runIntegrationOperation(h.actor, h.command, async (_actor, journal) => {await journal.beforeWrite(); writes++; return {ok: true};});
  resume.resolve(); await assert.rejects(stale, {code: 'operation_uncertain'});
  assert.equal(writes, 1); assert.deepEqual(recovered, {ok: true}); assert.equal(h.getReceipt().status, 'completed');
});

test('a later definitive rejection cannot clear an earlier provider write', async () => {
  const h = await harness();
  await assert.rejects(h.repo.runIntegrationOperation(h.actor, h.command, async (_actor, journal) => {
    await journal.beforeWrite();
    const rejectSecondWrite = await journal.beforeWrite(); await rejectSecondWrite();
    throw Error('Second write rejected');
  }), /Second write rejected/);
  assert.equal(h.getReceipt().status, 'uncertain');
  await assert.rejects(h.run(), {code: 'operation_uncertain'});
});

test('reconciliation persists the evidence and completed journal atomically', async () => {
  const h = await harness(); h.state.provider = 'lost-response'; await assert.rejects(h.run());
  h.state.failUploadRecord = true;
  await assert.rejects(h.reconcile(), /Upload receipt persistence unavailable/);
  assert.equal(h.getReceipt().status, 'uncertain'); assert.equal(h.getUploads().size, 0);
  h.state.failUploadRecord = false; await h.reconcile(); assert.equal(h.getReceipt().status, 'completed');
});

test('legacy started/uncertain receipts stay blocked but matching legacy uploads can be recovered', async t => {
  for (const status of ['started', 'uncertain']) await t.test(status, async () => {
    const h = await harness(); h.state.provider = 'lost-response'; await assert.rejects(h.run());
    h.getReceipt().status = status; h.getReceipt().attempt_id = null;
    delete h.state.metadata.appProperties.operation_key;
    await assert.rejects(h.run(), {code: 'operation_uncertain'});
    await h.reconcile(); assert.equal(h.getReceipt().status, 'completed'); assert.equal(h.state.writes, 1);
  });
});

test('different members concurrently create events without overwriting rows; completed retries do not append', async () => {
  const h = await harness({event: true}), bothRead = deferred();
  const teammate = {...h.actor, memberId: 'member-b', googleSubject: 'subject-b'};
  h.members.set(teammate.googleSubject, teammate);
  const second = {...h.command, requestId: 'second-event-id', args: [h.state.eventTitle, 'Final B', 'https://youtube.com/watch?v=b', 'youtube']};
  let reads = 0;
  h.state.beforeEventMetadata = async () => {
    if (++reads === 2) bothRead.resolve();
    await bothRead.promise;
  };
  const headers = structuredClone(h.state.eventRows);
  await Promise.all([h.run(), h.service.execute(teammate, second)]);
  assert.deepEqual(h.state.eventRows.slice(0, 2), headers);
  assert.deepEqual(h.state.eventRows.slice(2).sort((a, b) => a[0].localeCompare(b[0])), [
    ['=Final A', '', '', h.command.args[2], '', '', '', '', ''],
    ['Final B', '', '', second.args[2], '', '', '', '', '']
  ]);
  assert.equal(h.getReceipt().status, 'completed');
  assert.equal(h.getReceipt(teammate, second.requestId).status, 'completed');
  await Promise.all([h.run(), h.service.execute(teammate, second)]);
  assert.equal(h.state.writes, 2);
  assert.equal(h.state.eventRows.length, 4);
});

test('an in-flight retry of the same event never dispatches a second append', async () => {
  const h = await harness({event: true}), entered = deferred(), resume = deferred();
  h.state.beforeEventAppend = async () => { entered.resolve(); await resume.promise; };
  const first = h.run();
  await entered.promise;
  try { await assert.rejects(h.run(), {code: 'operation_uncertain'}); }
  finally { resume.resolve(); }
  await first;
  assert.equal(h.state.writes, 1);
  assert.equal(h.state.eventRows.length, 3);
});

test('ambiguous event appends and completion failures preserve the row and block repeat writes', async t => {
  for (const mode of ['lost-response', 'malformed', 'completion']) await t.test(mode, async () => {
    const h = await harness({event: true});
    h.state.provider = mode;
    if (mode === 'completion') h.state.failTransition = 'completed';
    await assert.rejects(h.run());
    assert.equal(h.getReceipt().status, 'uncertain');
    h.state.provider = 'success'; h.state.failTransition = null;
    await assert.rejects(h.run(), {code: 'operation_uncertain'});
    // Another operation still appends safely after the uncertain event.
    await h.service.execute(h.actor, {...h.command, requestId: 'another-event', args: [h.state.eventTitle, 'Final B', 'https://youtube.com/watch?v=b', 'youtube']});
    assert.deepEqual(h.state.eventRows.slice(2).map(row => row[0]), ['=Final A', 'Final B']);
    assert.equal(h.state.writes, 2);
  });
});

test('a rejected event append can retry its original ID without duplicating rows', async () => {
  const h = await harness({event: true}); h.state.provider = 429;
  await assert.rejects(h.run());
  assert.equal(h.getReceipt().status, 'retryable');
  assert.equal(h.state.writes, 1);
  assert.equal(h.state.eventRows.length, 2);
  h.state.provider = 'success';
  await h.run(); await h.run();
  assert.equal(h.state.writes, 2);
  assert.equal(h.state.eventRows.length, 3);
});

test('missing event tabs fail before dispatch and remain retryable', async () => {
  const h = await harness({event: true});
  h.state.eventSheetId = undefined;
  await assert.rejects(h.run(), {code: 'resource_unavailable'});
  assert.equal(h.state.writes, 0);
  assert.equal(h.getReceipt().status, 'retryable');
  h.state.eventSheetId = 0;
  await h.run();
  assert.equal(h.state.eventRows.length, 3);
});
