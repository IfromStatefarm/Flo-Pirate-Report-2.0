import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { permissionsFor, requirePermission } from '../server/access_policy.js';
import { validateGoogleCommand } from '../server/integrations/google_command_policy.js';
import { PERMISSIONS, hasPermission, hasPlatformAccess } from '../utils/access_control.js';
import { validateTeamRequest } from '../utils/team_access.js';
import { createCustomerApiService } from '../server/customer_api_service.js';

const config = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url)));
const command = (name, args) => ({ name, args, requestId: 'rbac-operation' });
// Explicit expectations: adding a permission requires a deliberate role decision.
const expected = {
  employee: ['sidepanel.report', 'sidepanel.scoreboard', 'settings.coreConnectivity', 'settings.feedbackComms'],
  manager: ['sidepanel.report', 'sidepanel.scoreboard', 'settings.coreConnectivity', 'settings.feedbackComms',
    'sidepanel.enforce', 'sidepanel.automate', 'sidepanel.intel', 'settings.openLocker', 'settings.intelligenceTools', 'settings.briefingStats', 'settings.briefingContent'],
  admin: ['sidepanel.report', 'sidepanel.scoreboard', 'settings.coreConnectivity', 'settings.feedbackComms',
    'sidepanel.enforce', 'sidepanel.automate', 'sidepanel.intel', 'settings.openLocker', 'settings.intelligenceTools', 'settings.briefingStats', 'settings.briefingContent',
    'sidepanel.repair', 'settings.selectorPaths', 'settings.gamification', 'settings.adminAccess']
};

for (const role of ['employee', 'manager', 'admin']) {
  test(`${role}: explicit allowed and prohibited permissions and Google operations`, async () => {
    const actor = { role, customerConfig: config, platforms: ['youtube'] };
    assert.deepEqual(permissionsFor(config, role).sort(), [...expected[role]].sort());
    for (const permission of [...Object.values(PERMISSIONS), '*', 'seller.admin', 'platform.admin', 'constructor']) {
      if (expected[role].includes(permission)) requirePermission(actor, permission);
      else assert.throws(() => requirePermission(actor, permission), { code: 'not_authorized' });
    }
    for (const [name, args, allowed] of [
      ['fetchConfig', [], true],
      ['submitSuggestionToSheet', ['Feedback'], true],
      ['updateRowStatus', [2, 'Resolved'], role !== 'employee'],
      ['ensureBriefingFolder', [], role !== 'employee'],
      ['patchConfigSelector', ['youtube', 'scraper', 'title', '.title', null], role === 'admin'],
      ['updateConfigSections', [{ community_highlights: {} }], role !== 'employee'],
      ['updateConfigSections', [{ platform_selectors: { youtube: {} } }], role === 'admin'],
      ['updateConfigSections', [{ double_xp_settings: { retention_days: 7 } }], role === 'admin']
    ]) {
      if (allowed) validateGoogleCommand(actor, command(name, args));
      else assert.throws(() => validateGoogleCommand(actor, command(name, args)), { code: 'not_authorized' });
    }
    // Even Admin cannot promote a customer member into the seller namespace.
    for (const privilegedRole of ['seller', 'platform_admin', 'seller.admin', '*']) {
      assert.throws(() => validateTeamRequest({ protocolVersion: 1, operation: 'team_preview', requestId: 'escalate',
        changes: [{ action: 'add', email: 'new@example.test', name: 'New', role: privilegedRole }] }));
      const service = createCustomerApiService({ repository: {}, verifyIdentity: async () => ({}) });
      await assert.rejects(service.memberships({}, { protocolVersion: 1, operation: 'mutate_membership',
        mutation: { action: 'change_role', memberId: 'member', expectedVersion: 1, role: privilegedRole } }), { code: 'invalid_request' });
    }
  });
}

test('feature removal denies specific configuration edits even to an Admin', () => {
  for (const [feature, section] of [
    ['briefing', { community_highlights: {} }],
    ['briefing', { briefing_content: {} }],
    ['selector_editor', { platform_selectors: { youtube: {} } }],
    ['gamification', { double_xp_settings: { retention_days: 7 } }]
  ]) {
    const restricted = structuredClone(config);
    restricted.capabilities.enabledFeatures = restricted.capabilities.enabledFeatures.filter(value => value !== feature);
    const actor = { role: 'admin', customerConfig: restricted, platforms: ['youtube'] };
    requirePermission(actor, 'settings.intelligenceTools');
    assert.throws(() => validateGoogleCommand(actor, command('updateConfigSections', [section])), { code: 'not_authorized' });
  }
});

test('unknown, disabled and missing role authority fails closed', () => {
  for (const role of ['seller', 'platform_admin', 'constructor', '__proto__', 'waiting_approval', undefined]) {
    assert.deepEqual(permissionsFor(config, role), []);
    assert.throws(() => requirePermission({ role, permissions: ['*'], customerConfig: config }, 'settings.adminAccess'), { code: 'not_authorized' });
  }
  assert.throws(() => requirePermission(null, 'sidepanel.report'), { code: 'not_authorized' });
});

test('bootstrap expiry blocks every role, permission and platform at the exact boundary', () => {
  for (const role of Object.keys(expected)) {
    for (const expiresAt of [Date.now(), undefined, Infinity, 'never']) {
      const profile = { schemaVersion: 1, customerId: 'customer', status: 'ready', verification: 'verified', role,
        permissions: expected[role], platforms: ['youtube'], expiresAt };
      for (const permission of expected[role]) assert.equal(hasPermission(profile, permission), false);
      assert.equal(hasPlatformAccess(profile, 'youtube'), false);
    }
  }
});
