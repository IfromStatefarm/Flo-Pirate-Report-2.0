import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PERMISSIONS, hasPermission, hasPlatformAccess, normalizeAccessPlatform } from '../utils/access_control.js';
import { detectPlatformDetails } from '../utils/platforms.js';

const source = (await readFile(new URL('../sidepanel/main.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '');
const start = source.indexOf('if (startBtn) {\n      startBtn.addEventListener');
const end = source.indexOf('// Copy Name Tool', start);
assert.ok(start >= 0 && end > start);

function setup({ url, mode = 'scout', platforms, permissions = [PERMISSIONS.SIDEPANEL_REPORT] }) {
  const platform = detectPlatformDetails(url);
  const messages = [], tabs = [], alerts = [], timers = [], enforcerChecks = [];
  const state = { piracy_cart: [{ url, platform: platform.key }] };
  let click;
  const button = {
    innerText: '', disabled: false, classList: { remove() {} },
    addEventListener(event, handler) { assert.equal(event, 'click'); click = handler; }
  };
  const context = vm.createContext({
    PERMISSIONS, hasPermission, hasPlatformAccess, normalizeAccessPlatform, detectPlatformDetails,
    profile: {
      schemaVersion: 1, customerId: 'customer-a', role: 'employee', status: 'ready',
      verification: 'verified', expiresAt: Date.now() + 60_000,
      permissions, platforms: platforms ?? [platform.key],
      legal: { reportingEmail: 'reporter@example.test' }
    },
    startBtn: button, reporterInput: { value: 'Reporter' },
    verticalSelect: { value: 'Sport' }, eventInput: { value: 'Event' },
    document: { addEventListener() {}, getElementById: () => ({ value: '' }) },
    alert: message => alerts.push(message), setTimeout: fn => timers.push(fn),
    checkEnforcer: async key => { enforcerChecks.push(key); return true; },
    chrome: {
      runtime: { onMessage: { addListener() {} }, sendMessage: message => messages.push(message) },
      storage: {
        sync: { get: async () => ({ report_mode: mode }) },
        local: { get: async () => state, set: async values => Object.assign(state, values) }
      },
      tabs: { create: (options, callback) => { tabs.push(options); callback({ id: 1 }); } }
    }
  });
  // Load the real access/platform helpers and bind the production Start handler
  // without initializing unrelated side-panel UI. Enforcement approval is assumed
  // here so the form requirement itself is exercised.
  vm.runInContext(source, context);
  vm.runInContext('currentAccessProfile = profile; canUseEnforcerMode = checkEnforcer;', context);
  vm.runInContext(source.slice(start, end), context);
  return { click, button, messages, tabs, alerts, timers, state, enforcerChecks };
}

for (const [platform, url] of [
  ['Discord', 'https://discord.com/channels/123/456/789'],
  ['Trovo', 'https://trovo.live/s/example']
]) {
  test(`Scout logs an enabled ${platform} queue without a report form`, async () => {
    assert.equal(detectPlatformDetails(url).reportUrl, null);
    const h = setup({ url });
    await h.click();
    assert.deepEqual(h.alerts, []);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].action, 'processQueue');
    assert.equal(h.messages[0].data.mode, 'scout');
    assert.equal(h.messages[0].data.uploadScreenshots, true);
    assert.equal(h.messages[0].data.reporterName, 'Reporter');
    assert.equal(h.messages[0].data.vertical, 'Sport');
    assert.equal(h.messages[0].data.eventName, 'Event');
    assert.equal(h.state.reporterInfo.email, 'reporter@example.test');
    assert.deepEqual(h.tabs, []);
    assert.deepEqual(h.enforcerChecks, []);
    h.timers.forEach(fn => fn());
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.innerText, 'Save to Log (Scout Mode)');
  });

  test(`Enforcer still requires a report form for ${platform}`, async () => {
    const h = setup({ url, mode: 'enforcer' });
    await h.click();
    assert.equal(h.alerts.length, 1);
    assert.match(h.alerts[0], /Please manually report/);
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.tabs, []);
    assert.deepEqual(h.enforcerChecks, [detectPlatformDetails(url).key]);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.innerText, 'Start Report');
  });

  test(`Scout still rejects unassigned ${platform} queues`, async () => {
    const h = setup({ url, platforms: ['youtube'] });
    await h.click();
    assert.match(h.alerts[0], /not assigned to your account/);
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.tabs, []);
    assert.equal(h.button.disabled, false);
  });
}

test('Scout still requires reporting permission', async () => {
  const h = setup({ url: 'https://discord.com/channels/123/456/789', permissions: [] });
  await h.click();
  assert.match(h.alerts[0], /does not include reporting/);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.tabs, []);
});

test('Enforcer opens an available report form', async () => {
  const url = 'https://www.youtube.com/watch?v=example';
  const h = setup({ url, mode: 'enforcer' });
  await h.click();
  assert.deepEqual(h.alerts, []);
  assert.equal(h.tabs.length, 1);
  assert.equal(h.tabs[0].url, detectPlatformDetails(url).reportUrl);
  assert.deepEqual(h.messages, []);
  assert.equal(h.button.disabled, false);
});
