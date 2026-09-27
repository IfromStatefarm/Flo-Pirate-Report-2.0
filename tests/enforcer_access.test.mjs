import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PERMISSIONS, hasPermission } from '../utils/access_control.js';

// Run the shipped side panel without firing its DOM initialization. Keep the real
// permission resolver and injected session inspection; mock only browser APIs.
const source = (await readFile(new URL('../sidepanel/main.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');

function setup({ role = 'employee', profile = {}, tabs = [{ id: 1, url: 'https://www.youtube.com/' }],
  loggedIn = true, handle = '@unapproved', authorizedHandles = ['@approved'], injectionError = false } = {}) {
  const inspectedTabs = [];
  let queries = 0;
  const context = vm.createContext({
    PERMISSIONS, hasPermission,
    profile: {
      schemaVersion: 1, customerId: 'customer-a', status: 'ready', verification: 'verified',
      role, permissions: [PERMISSIONS.SIDEPANEL_REPORT], expiresAt: Date.now() + 60_000,
      ...profile
    },
    config: { platform_selectors: { youtube: { session: { authorized_handles: authorizedHandles } } } },
    window: { location: { href: 'https://www.youtube.com/' }, ytcfg: { get: key => key === 'LOGGED_IN' ? loggedIn : undefined } },
    document: {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: selector => selector.includes('channel-handle') ? [{ textContent: handle }] : []
    },
    console: { warn() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      tabs: { query: async () => { queries += 1; return tabs; } },
      scripting: { executeScript: async ({ target, func, args }) => {
        inspectedTabs.push(target.tabId);
        if (injectionError) throw new Error('Cannot inspect this tab');
        return [{ result: await func(...args) }];
      } }
    }
  });
  vm.runInContext(source, context, { filename: 'sidepanel/main.js' });
  vm.runInContext('currentAccessProfile = profile; configData = config;', context);
  return {
    enforcer: () => context.canUseEnforcerMode(),
    scout: () => context.canUseScoutMode(),
    inspectedTabs,
    get queries() { return queries; }
  };
}

for (const role of ['employee', 'manager', 'admin']) {
  test(`${role} reporting permission requires an approved session for enforcer mode`, async () => {
    const denied = setup({ role });
    assert.equal(denied.scout(), true);
    assert.equal(await denied.enforcer(), false);
    assert.deepEqual(denied.inspectedTabs, [1]);

    const approved = setup({ role, handle: '@approved' });
    assert.equal(await approved.enforcer(), true);
    assert.deepEqual(approved.inspectedTabs, [1]);
  });
}

for (const [name, options] of [
  ['no open platform tab', { tabs: [] }],
  ['signed-out account', { loggedIn: false, handle: '@approved' }],
  ['empty account allowlist', { authorizedHandles: [], handle: '@approved' }],
  ['session inspection failure', { injectionError: true }],
  ['approved channel URL with an unapproved account', { tabs: [{ id: 1, url: 'https://www.youtube.com/@approved' }] }]
]) {
  test(`reporting permission cannot bypass ${name}`, async () => {
    assert.equal(await setup(options).enforcer(), false);
  });
}

for (const [name, profile] of [
  ['missing reporting permission', { permissions: [] }],
  ['pending role', { role: 'waiting_approval' }],
  ['expired profile', { expiresAt: 1 }],
  ['unverified profile', { verification: 'unverified' }]
]) {
  test(`an approved platform account cannot bypass ${name}`, async () => {
    const fixture = setup({ profile, handle: '@approved' });
    assert.equal(fixture.scout(), false);
    assert.equal(await fixture.enforcer(), false);
    assert.equal(fixture.queries, 0);
    assert.deepEqual(fixture.inspectedTabs, []);
  });
}
