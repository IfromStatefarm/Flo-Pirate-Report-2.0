import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { verifyGoogleIdentity } from '../server/google_identity.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';

// Real service + repository + SQL. Only the external identity provider is stubbed;
// caller scope and all access state are resolved from the isolated database.
test('P0 customer authority and isolation through the raw API', {skip: !process.env.TEST_DATABASE_URL}, async t => {
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true');
  const pool = new pg.Pool({connectionString: process.env.TEST_DATABASE_URL, max: 4});
  t.after(() => pool.end());
  await migrateTeamTestDatabase(pool);
  const repo = createPostgresRepository({pool});
  const a = await teamFixture(pool), b = await teamFixture(pool);
  const actorA = await repo.requireActiveMember(a.identity), actorB = await repo.requireActiveMember(b.identity);
  const identities = new Map([['token-a', a.identity], ['token-b', b.identity]]);
  const service = createCustomerApiService({repository: repo, allowedExtensionIds: new Set(['test-extension']),
    verifyIdentity: request => verifyGoogleIdentity(request, {expectedClientId: 'test-client', fetchImpl: async (_url, options) => {
      const identity = identities.get(options.body.get('access_token'));
      return identity ? Response.json({sub: identity.subject, email: identity.email, email_verified: true, aud: 'test-client', expires_in: 3600, scope: 'https://www.googleapis.com/auth/userinfo.email'}) : Response.json({}, {status: 401});
    }})
  });
  const request = token => new Request('https://api.example.test', {headers: {authorization: `Bearer ${token}`}});
  const call = (route, body, token = 'token-a') => service[route](request(token), structuredClone(body));
  const observation = (actor, eventId = 'shared-event-id') => ({protocol_version: 1, operation: 'record_event', event: {customer_id: actor.customerId, user_id: actor.memberId, event_id: eventId, event_type: 'activity.item_added', occurred_at: Date.now(), attributes: {platform: 'youtube', target_url: 'https://youtube.com/watch?v=one'}}});
  const statistics = actor => ({protocol_version: 1, operation: 'query_statistics', customer_id: actor.customerId, user_id: actor.memberId, query_type: 'scoreboard', query: {dashboard_id: actor.customerConfig.stats.dashboardId, period: 'current_month'}});
  const list = {protocolVersion: 1, operation: 'team_list', query: '', role: '', status: '', cursor: ''};
  const history = {protocolVersion: 1, operation: 'team_history', cursor: ''};
  const bootstrap = identity => ({protocolVersion: 1, identity: {email: identity.email}, extension: {id: 'test-extension', version: '1'}});

  await t.test('forged customer/user hints and dashboard IDs never select another tenant', async () => {
    await call('data', observation(actorA));
    await call('data', observation(actorB), 'token-b');
    await assert.rejects(call('data', observation(actorB, 'foreign-write')), {code: 'scope_mismatch'});
    await assert.rejects(call('data', statistics(actorB)), {code: 'scope_mismatch'});
    const query = statistics(actorA); query.query.dashboard_id = actorB.customerConfig.stats.dashboardId;
    await assert.rejects(call('data', query), {code: 'scope_mismatch'});
    const result = await call('data', statistics(actorA));
    assert.equal(result.customer_id, a.id);
    assert.equal(result.user_id, actorA.memberId);
    const roster = await call('memberships', list);
    assert.deepEqual(roster.members.map(m => m.memberId), [actorA.memberId]);
    assert.equal((await pool.query('SELECT 1 FROM customer_events WHERE customer_id=$1 AND event_id=$2', [b.id, 'foreign-write'])).rowCount, 0);
  });

  await t.test('foreign members, previews, commits and history remain customer scoped', async () => {
    const change = {action: 'disable', memberId: actorB.memberId, expectedVersion: 1};
    await assert.rejects(call('memberships', {protocolVersion: 1, operation: 'mutate_membership', mutation: change}), {code: 'member_not_found'});
    await assert.rejects(call('memberships', {protocolVersion: 1, operation: 'team_preview', requestId: 'foreign-target', changes: [change]}), {code: 'member_not_found'});
    const preview = {protocolVersion: 1, operation: 'team_preview', requestId: 'foreign-review', changes: [{action: 'add', email: b.email('employee'), name: 'Foreign Employee', role: 'employee'}]};
    await call('memberships', preview, 'token-b');
    await assert.rejects(call('memberships', {protocolVersion: 1, operation: 'team_commit', requestId: preview.requestId}), {code: 'review_required'});
    await call('memberships', {protocolVersion: 1, operation: 'team_commit', requestId: preview.requestId}, 'token-b');
    assert.equal((await call('memberships', history)).entries.length, 0);
    assert.equal((await call('memberships', history, 'token-b')).entries.length, 1);
    assert.equal((await pool.query('SELECT status FROM customer_memberships WHERE customer_id=$1 AND member_id=$2', [b.id, actorB.memberId])).rows[0].status, 'active');
  });

  await t.test('identical report, operation and scanner identifiers cannot replay another tenant result', async () => {
    const report = {reportId: 'same-report', eventId: 'same-evidence-event', items: [{url: 'https://youtube.com/watch?v=one', screenshotLink: ''}]};
    const policy = {version: 1, platform: 'youtube'};
    const first = await repo.generateReport(actorB, report, async () => new Blob(['%PDF-foreign-private'], {type: 'application/pdf'}), policy);
    const second = await repo.generateReport(actorA, report, async () => new Blob(['%PDF-own-private'], {type: 'application/pdf'}), policy);
    assert.notEqual(first.pdf, second.pdf);
    const command = {name: 'updateRowStatus', args: [1, 'Resolved'], requestId: 'same-operation'};
    await repo.runIntegrationOperation(actorB, command, async () => 'foreign-private');
    assert.equal(await repo.runIntegrationOperation(actorA, command, async () => 'own-private'), 'own-private');
    const rowKey = 'a'.repeat(64);
    await repo.recordScannerResolutions(actorB, rowKey, ['https://youtube.com/watch?v=foreign']);
    assert.equal(await repo.reserveScannerBonus(actorA, rowKey), null);
    await repo.completeScannerBonus(actorA, rowKey, 'foreign-award', 1);
    assert.equal((await pool.query('SELECT rewarded_at FROM scanner_resolutions WHERE customer_id=$1 AND row_key=$2', [b.id, rowKey])).rows[0].rewarded_at, null);
    await assert.rejects(repo.projectReport(actorA, 'only-foreign-report', () => assert.fail('Foreign projection ran')), {code: 'report_required'});
  });

  await t.test('fresh permissions defeat forged roles, capabilities and old actor snapshots', async () => {
    const config = structuredClone(actorA.customerConfig);
    config.capabilities.enabledFeatures = ['report'];
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [a.id, config]);
    // Deliberately do not increment config_version: every operation must re-read
    // permission state, not rely on equality with an old version/role snapshot.
    await assert.rejects(repo.queryStatistics(actorA, 'scoreboard', statistics(actorA).query, Date.now()), {code: 'not_authorized'});
    await assert.rejects(repo.runIntegrationOperation(actorA, {name: 'updateRowStatus', args: [1, 'Resolved'], requestId: 'forged-admin'}, () => assert.fail('Unauthorized external write')), {code: 'not_authorized'});
    await assert.rejects(repo.recordScannerResolutions(actorA, 'b'.repeat(64), ['https://youtube.com/watch?v=1']), {code: 'not_authorized'});
    await assert.rejects(repo.runIntegrationOperation(actorA, {name: 'invented', args: [], requestId: 'new'}, () => assert.fail('Unknown operation')), {code: 'invalid_operation'});
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [a.id, actorA.customerConfig]);
    await assert.rejects(repo.listMembers({...actorA, customerId: b.id}, ''), {code: 'scope_mismatch'});
    await assert.rejects(repo.generateReport({...actorA, memberId: actorB.memberId}, {items: []}, () => assert.fail(), {}), {code: 'scope_mismatch'});
  });

  await t.test('disabled membership, inactive customer and revoked/expired subscription deny fresh requests', async () => {
    const denied = async code => {
      await assert.rejects(call('data', observation(actorA, 'denied-event')), {code});
      await assert.rejects(call('memberships', list), {code});
      await assert.rejects(call('bootstrap', bootstrap(a.identity)), {code});
      await assert.rejects(repo.recordUploadedFile(actorA, 'denied-upload', 'image/png', {id: 'denied-file', webViewLink: 'https://drive.google.com/file/d/denied/view'}, 'a'.repeat(64)), {code});
    };
    await pool.query("UPDATE customer_memberships SET status='disabled' WHERE customer_id=$1 AND member_id=$2", [a.id, actorA.memberId]);
    await denied('not_a_member');
    await pool.query("UPDATE customer_memberships SET status='active' WHERE customer_id=$1 AND member_id=$2", [a.id, actorA.memberId]);
    await pool.query('UPDATE customers SET active=false WHERE customer_id=$1', [a.id]);
    await denied('not_a_member');
    await pool.query('UPDATE customers SET active=true WHERE customer_id=$1', [a.id]);
    await pool.query("UPDATE customer_subscriptions SET service_status='revoked' WHERE customer_id=$1", [a.id]);
    await denied('subscription_suspended');
    await pool.query("UPDATE customer_subscriptions SET service_status='active',paid_through=now()-interval '1 hour' WHERE customer_id=$1", [a.id]);
    await assert.rejects(call('data', observation(actorA)), {code: 'subscription_expired'});
    const profile = (await call('bootstrap', bootstrap(a.identity))).profile;
    assert.deepEqual(profile.permissions, ['settings.adminAccess']);
    assert.equal((await call('memberships', list)).subscription.managementOnly, true);
  });
});
