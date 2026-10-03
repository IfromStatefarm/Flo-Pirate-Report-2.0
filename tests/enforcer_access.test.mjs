import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PERMISSIONS, hasPermission } from '../utils/access_control.js';
import { enforcerPlatform, normalizeSessionAccount, tabHasApprovedEnforcerSession } from '../utils/enforcer_session.js';

const source = (await readFile(new URL('../sidepanel/main.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');

function setup({ role = 'manager', profile = {}, loggedIn = true, handle = '@approved',
  channelId, managerId, authorizedHandles = ['@approved'], authorizedChannelIds = [],
  authorizedStudioManagerIds = [], url = 'https://www.youtube.com/', injectionError = false } = {}) {
  const inspectedTabs = [];
  const page = vm.createContext({ window: { location: new URL(url), ytcfg: { get: key => ({ LOGGED_IN: loggedIn, DELEGATED_SESSION_ID: managerId })[key] } },
    document: { querySelector: selector => selector === 'ytd-active-account-header-renderer' ? {
      querySelector: selector => selector === '#channel-handle' ? { textContent: handle } : { href: channelId }
    } : { href: `https://www.tiktok.com/${handle}` } }
  });
  const scripting = { executeScript: async ({ target, world, func }) => {
    inspectedTabs.push(target.tabId);
    assert.equal(world, 'MAIN');
    if (injectionError) throw Error('Injection denied');
    return [{ result: await vm.runInContext(`(${func.toString()})()`, page) }];
  } };
  const context = vm.createContext({
    PERMISSIONS, hasPermission, enforcerPlatform,
    tabHasApprovedEnforcerSession: (id, config) => tabHasApprovedEnforcerSession(id, config, scripting),
    profile: { schemaVersion: 1, customerId: 'customer-a', status: 'ready', verification: 'verified',
      role, permissions: [PERMISSIONS.SIDEPANEL_REPORT, ...(role === 'employee' ? [] : [PERMISSIONS.SIDEPANEL_ENFORCE])],
      expiresAt: Date.now() + 60_000, ...profile },
    config: { platform_selectors: { youtube: { session: { authorized_handles: authorizedHandles, authorized_channel_ids: authorizedChannelIds, authorized_studio_manager_ids: authorizedStudioManagerIds } }, tiktok: { session: { authorized_handles: authorizedHandles } } } },
    document: { addEventListener() {} },
    chrome: { runtime: { onMessage: { addListener() {} } }, tabs: { query: async () => [{ id: 1, url }] } }
  });
  vm.runInContext(source, context);
  vm.runInContext('currentAccessProfile = profile; configData = config;', context);
  return { enforcer: platform => context.canUseEnforcerMode(platform), scout: () => context.canUseScoutMode(), inspectedTabs };
}

test('report-only employee cannot gain enforcement from an approved page session', async () => {
  const fixture = setup({ role: 'employee' });
  assert.equal(fixture.scout(), true);
  assert.equal(await fixture.enforcer(), false);
  assert.equal(await fixture.enforcer('instagram'), false);
  assert.equal(await fixture.enforcer('tiktok'), false);
  assert.deepEqual(fixture.inspectedTabs, []);
});
for (const role of ['manager', 'admin']) {
  test(`${role} requires the capability and an exact approved active-account hint`, async () => {
    assert.equal(await setup({ role }).enforcer(), true);
    assert.equal(await setup({ role, handle: '@approved-impostor' }).enforcer(), false);
    assert.equal(await setup({ role, profile: { permissions: [PERMISSIONS.SIDEPANEL_REPORT] } }).enforcer(), false);
  });
}
for (const options of [
  { loggedIn: false }, { loggedIn: 'true' }, { handle: '@approved-impostor' },
  { handle: 'Some text @approved' }, { authorizedHandles: [] }, { injectionError: true },
  { url: 'https://youtube.com.evil.test/' }, { url: 'https://evil.test/?youtube.com' },
  { url: 'https://www.youtube.com/@approved', handle: '@unapproved' },
  { profile: { expiresAt: 1 } }, { profile: { verification: 'unverified' } },
  { profile: { role: 'waiting_approval' } },
  { url: 'https://www.tiktok.com/', handle: '@approved-impostor' }
]) test(`session denied: ${JSON.stringify(options)}`, async () => assert.equal(await setup(options).enforcer(), false));

test('handles normalize exactly on both platforms; stable channel IDs preserve case', async () => {
  assert.equal(await setup({ handle: ' @APPROVED ' }).enforcer(), true);
  assert.equal(await setup({ url: 'https://www.tiktok.com/' }).enforcer(), true);
  const id = `UC${'aB'.repeat(11)}`;
  assert.equal(normalizeSessionAccount(`https://www.youtube.com/channel/${id}`, 'youtube'), id);
  assert.equal(await setup({ handle: '@other', channelId: `https://www.youtube.com/channel/${id}`, authorizedChannelIds: [id] }).enforcer(), true);
  assert.equal(await setup({ handle: '@other', channelId: `https://www.youtube.com/channel/${id}`, authorizedChannelIds: [id.toLowerCase()] }).enforcer(), false);
  assert.equal(await setup({ handle: '@other', managerId: '12345', authorizedStudioManagerIds: ['123'] }).enforcer(), false);
});
