import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { handleCustomerApi } from '../server/http.js';
import { verifyGoogleIdentity } from '../server/google_identity.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';

test('RBAC through HTTP with real persisted roles and immediate revocation', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true');
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  t.after(() => pool.end());
  await migrateTeamTestDatabase(pool);
  const f = await teamFixture(pool);
  const repository = createPostgresRepository({ pool });
  const identities = { admin: f.identity };
  for (const role of ['employee', 'manager']) {
    identities[role] = { email: f.email(role), subject: `${f.id}-${role}` };
    await repository.teamOperation(f.identity, { protocolVersion: 1, operation: 'team_preview', requestId: `add-${role}`,
      changes: [{ action: 'add', email: identities[role].email, name: role, role }] });
    await repository.teamOperation(f.identity, { protocolVersion: 1, operation: 'team_commit', requestId: `add-${role}` });
  }
  const tokens = new Map(Object.entries(identities));
  const service = createCustomerApiService({ repository, allowedExtensionIds: new Set(['rbac-test']),
    verifyIdentity: request => verifyGoogleIdentity(request, { expectedClientId: 'rbac-client', fetchImpl: async (_url, options) => {
      const identity = tokens.get(options.body.get('access_token'));
      return identity ? Response.json({ sub: identity.subject, email: identity.email, email_verified: true,
        aud: 'rbac-client', expires_in: 3600, scope: 'https://www.googleapis.com/auth/userinfo.email' })
        : Response.json({ error: 'invalid_token' }, { status: 400 });
    } })
  });
  const call = (role, route, body) => handleCustomerApi(route, new Request('https://api.example.test', {
    method: 'POST', headers: { Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), { service });
  const check = async (role, route, body, status, code) => {
    const response = await call(role, route, body);
    const result = await response.json();
    assert.equal(response.status, status, `${role} ${body.operation || route}: ${JSON.stringify(result)}`);
    if (code) assert.equal(result.error.code, code);
    return result;
  };
  const bootstrap = role => ({ protocolVersion: 1, identity: { email: identities[role].email }, extension: { id: 'rbac-test', version: '1' } });
  const event = (role, type = 'activity.item_added') => ({ protocol_version: 1, operation: 'record_event',
    event: { event_id: `${role}-${type.replaceAll('.', '-')}`, event_type: type, occurred_at: Date.now(),
      attributes: type === 'activity.item_added' ? { platform: 'youtube', target_url: 'https://youtube.com/watch?v=rbac' } : {} } });
  const list = { protocolVersion: 1, operation: 'list_members', query: '' };
  const team = { protocolVersion: 1, operation: 'team_list', query: '', role: '', status: '', cursor: '' };
  const actors = {};

  for (const role of ['employee', 'manager', 'admin']) {
    await t.test(`${role}: HTTP bootstrap, reporting, statistics and membership permissions`, async () => {
      const { profile } = await check(role, 'bootstrap', bootstrap(role), 200);
      assert.equal(profile.role, role);
      assert.ok(profile.expiresAt > Date.now() && profile.expiresAt - profile.issuedAt <= 15 * 60000);
      actors[role] = await repository.requireActiveMember(identities[role]);
      await check(role, 'data', event(role), 200);
      await check(role, 'data', event(role, 'automation.scan_started'), role === 'employee' ? 403 : 200,
        role === 'employee' ? 'not_authorized' : undefined);
      for (const query_type of ['scoreboard', 'intelligence']) {
        const query = query_type === 'scoreboard' ? { period: 'current_month' }
          : { start_date: '2026-09-01', end_date: '2026-09-30', platforms: [] };
        const denied = role === 'employee' && query_type === 'intelligence';
        await check(role, 'data', { protocol_version: 1, operation: 'query_statistics', query_type,
          query: { ...query, dashboard_id: profile.integrations.statsDashboardId } }, denied ? 403 : 200,
        denied ? 'not_authorized' : undefined);
      }
      for (const request of [list, team, { protocolVersion: 1, operation: 'team_history', cursor: '' }]) {
        await check(role, 'memberships', request, role === 'admin' ? 200 : 403, role === 'admin' ? undefined : 'not_authorized');
      }
      const review = { protocolVersion: 1, operation: 'team_preview', requestId: `review-${role}`,
        changes: [{ action: 'add', email: f.email(`invited-${role}`), name: 'Invited', role: 'employee' }] };
      await check(role, 'memberships', review, role === 'admin' ? 200 : 403, role === 'admin' ? undefined : 'not_authorized');
      await check(role, 'memberships', { protocolVersion: 1, operation: 'team_commit', requestId: review.requestId },
        role === 'admin' ? 200 : 403, role === 'admin' ? undefined : 'not_authorized');
      // Admin also has prohibited actions: customer APIs cannot assign platform authority.
      await check(role, 'memberships', { protocolVersion: 1, operation: 'mutate_membership', mutation: {
        action: 'change_role', memberId: profile.userId, expectedVersion: 1, role: 'platform_admin'
      } }, 400, 'invalid_request');
    });
  }

  await t.test('demotion and feature removal invalidate previously authorized operations', async () => {
    const manager = actors.manager;
    await pool.query("UPDATE customer_memberships SET role='employee' WHERE customer_id=$1 AND member_id=$2", [f.id, manager.memberId]);
    await check('manager', 'data', event('manager', 'automation.scan_started'), 403, 'not_authorized');
    await assert.rejects(repository.runIntegrationOperation(manager, { name: 'updateRowStatus', args: [2, 'Resolved'], requestId: 'stale-role' },
      () => assert.fail('Demoted actor dispatched a write')), { code: 'access_changed' });
    await pool.query("UPDATE customer_memberships SET role='manager' WHERE customer_id=$1 AND member_id=$2", [f.id, manager.memberId]);
    const config = structuredClone(actors.admin.customerConfig);
    config.capabilities.enabledFeatures = config.capabilities.enabledFeatures.filter(feature => feature !== 'selector_editor');
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [f.id, config]);
    await assert.rejects(repository.runIntegrationOperation(actors.admin, { name: 'updateConfigSections', args: [{ platform_selectors: { youtube: {} } }], requestId: 'stale-feature' },
      () => assert.fail('Disabled feature dispatched a write')), { code: 'not_authorized' });
    await pool.query('UPDATE customers SET config=$2 WHERE customer_id=$1', [f.id, actors.admin.customerConfig]);
  });

  for (const role of ['employee', 'manager', 'admin']) {
    await t.test(`${role}: disabled users and revoked tokens cannot reuse an unexpired bootstrap`, async () => {
      const actor = actors[role];
      await pool.query("UPDATE customer_memberships SET status='disabled' WHERE customer_id=$1 AND member_id=$2", [f.id, actor.memberId]);
      await check(role, 'bootstrap', bootstrap(role), 403, 'not_a_member');
      await check(role, 'data', event(role), 403, 'not_a_member');
      await check(role, 'memberships', team, 403, 'not_a_member');
      await assert.rejects(repository.recordEvent(actor, event(role).event, Date.now()), { code: 'not_a_member' });
      await pool.query("UPDATE customer_memberships SET status='active' WHERE customer_id=$1 AND member_id=$2", [f.id, actor.memberId]);
      tokens.delete(role);
      await check(role, 'bootstrap', bootstrap(role), 401, 'identity_error');
      await check(role, 'data', event(role), 401, 'identity_error');
      await check(role, 'memberships', team, 401, 'identity_error');
    });
  }
});
