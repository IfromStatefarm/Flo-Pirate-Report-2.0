import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createGoogleOperations } from '../server/integrations/google_operations.js';
import { createGoogleResourceGuard } from '../server/integrations/google_resource_guard.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';

const FOLDER = 'application/vnd.google-apps.folder';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const metadata = (id, mimeType, parents = []) => ({id, mimeType, parents, trashed: false, capabilities: {canListChildren: true, canAddChildren: true, canEdit: true, canDownload: true}});

test('Google resource isolation uses live Postgres customer ownership and access', {skip: !process.env.TEST_DATABASE_URL}, async t => {
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true');
  const pool = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL, max: 4});
  t.after(() => pool.end()); await migrateTeamTestDatabase(pool);
  const repo = createPostgresRepository({pool});
  const a = await teamFixture(pool), b = await teamFixture(pool);
  const actor = await repo.requireActiveMember(a.identity), foreign = await repo.requireActiveMember(b.identity);
  const roots = [actor.customerConfig.destinations.driveRootFolderId, foreign.customerConfig.destinations.driveRootFolderId];
  const home = 'fixture-shared-drive-home';
  const resources = new Map([[home, {...metadata(home, FOLDER), driveId: home}]]);
  for (const current of [actor, foreign]) {
    const d = current.customerConfig.destinations;
    resources.set(d.driveRootFolderId, metadata(d.driveRootFolderId, FOLDER, [home]));
    for (const id of [d.reportSpreadsheetId, d.eventSpreadsheetId]) resources.set(id, metadata(id, SHEET, [home]));
  }
  let businessCalls = 0;
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    if (url.searchParams.get('fields')?.includes('capabilities')) {
      assert.equal(options.headers.Authorization, 'Bearer isolated-connector-a');
      const data = resources.get(url.pathname.split('/').at(-1));
      return data ? Response.json(data) : Response.json({}, {status: 404});
    }
    businessCalls++;
    return Response.json({sheets: [], files: []});
  };
  const guard = createGoogleResourceGuard({actor, token: 'isolated-connector-a', permission: 'sidepanel.report', repository: repo, fetchImpl});
  const service = createGoogleOperations({repository: repo, fetchImpl, tokenProvider: async customerId => {
    assert.equal(customerId, a.id); return 'isolated-connector-a';
  }});
  const upload = folder => ({name: 'uploadToDrive', args: [folder, 'fixture.pdf', Buffer.from('%PDF-fixture').toString('base64'), 'application/pdf', 'evidence-fixture'], requestId: `upload-${folder}`});

  await t.test('database registry rejects foreign roots even when Google places them below the caller root', async () => {
    await guard.assertFolder(roots[0]);
    resources.get(roots[1]).parents = [roots[0]];
    await assert.rejects(service.execute(actor, upload(roots[1])), {code: 'scope_mismatch'});
    assert.equal(businessCalls, 0);
    const journal = (await pool.query('SELECT status FROM integration_operations WHERE customer_id=$1 AND operation_id=$2', [a.id, upload(roots[1]).requestId])).rows[0];
    assert.equal(journal, undefined);
    assert.equal((await pool.query('SELECT 1 FROM integration_uploaded_files WHERE customer_id=$1', [a.id])).rowCount, 0);
    resources.get(roots[1]).parents = [home];
    resources.get(roots[0]).parents = [roots[1]];
    await assert.rejects(guard.assertFolder(roots[0]), {code: 'scope_mismatch'});
    resources.get(roots[0]).parents = [home];
  });

  await t.test('configured Sheets can share a neutral parent but cannot move into another registered tenant root', async () => {
    const id = actor.customerConfig.destinations.reportSpreadsheetId;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1`;
    await guard.authorizeRequest(url);
    resources.get(id).parents = [roots[1]];
    await assert.rejects(guard.authorizeRequest(url), {code: 'scope_mismatch'});
    resources.get(id).parents = [home];
    await assert.rejects(repo.verifyGoogleResourceScope(actor, [foreign.customerConfig.destinations.reportSpreadsheetId], 'sidepanel.report'), {code: 'scope_mismatch'});
    // Even suspended customers retain resource reservations; inactivity does not
    // release ownership to another tenant.
    await pool.query('UPDATE customers SET active=false WHERE customer_id=$1', [b.id]);
    await assert.rejects(repo.verifyGoogleResourceScope(actor, [roots[1]], 'sidepanel.report'), {code: 'scope_mismatch'});
  });

  await t.test('real operation journal replay denies a formerly owned folder moved to another customer', async () => {
    const folderId = 'cached-folder-originally-a';
    resources.set(folderId, metadata(folderId, FOLDER, [roots[0]]));
    const command = {name: 'ensureRogueScreenshotFolder', args: [], requestId: 'cached-folder-a'};
    await repo.runIntegrationOperation(actor, command, async () => folderId);
    resources.get(folderId).parents = [roots[1]];
    await assert.rejects(service.execute(actor, command), {code: 'scope_mismatch'});
    assert.equal(businessCalls, 0);
    assert.equal((await pool.query('SELECT status FROM integration_operations WHERE customer_id=$1 AND operation_id=$2', [a.id, command.requestId])).rows[0].status, 'completed');
  });

  await t.test('resource ownership checks revalidate scope, permissions, platforms and destinations', async () => {
    await assert.rejects(repo.verifyGoogleResourceScope({...actor, customerId: b.id}, [roots[0]], 'sidepanel.report'), {code: 'scope_mismatch'});
    await assert.rejects(repo.verifyGoogleResourceScope(actor, [roots[0]], undefined), {code: 'configuration_error'});
    const config = structuredClone(actor.customerConfig);
    config.capabilities.enabledFeatures = ['scoreboard'];
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [a.id, config]);
    await assert.rejects(guard.assertFolder(roots[0]), {code: 'not_authorized'});
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [a.id, actor.customerConfig]);
    await pool.query("UPDATE customer_memberships SET platforms=ARRAY['youtube'] WHERE customer_id=$1 AND member_id=$2", [a.id, actor.memberId]);
    await assert.rejects(guard.assertFolder(roots[0]), {code: 'access_changed'});
    await pool.query("UPDATE customer_memberships SET platforms='{}' WHERE customer_id=$1 AND member_id=$2", [a.id, actor.memberId]);
    const destinations = structuredClone(actor.customerConfig);
    destinations.destinations.driveRootFolderId = `${a.id}-replacement-root`;
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [a.id, destinations]);
    await assert.rejects(guard.assertFolder(roots[0]), {code: 'access_changed'});
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [a.id, actor.customerConfig]);
    await pool.query("UPDATE customer_memberships SET status='disabled' WHERE customer_id=$1 AND member_id=$2", [a.id, actor.memberId]);
    await assert.rejects(guard.assertFolder(roots[0]), {code: 'not_a_member'});
    assert.equal(businessCalls, 0);
  });
});
