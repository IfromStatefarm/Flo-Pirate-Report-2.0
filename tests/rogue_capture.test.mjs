import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertMessageSender } from '../utils/message_policy.js';
import { PERMISSIONS, normalizeAccessPlatform } from '../utils/access_control.js';
import { detectPlatformDetails } from '../utils/platforms.js';
import { createRogueWorkflow } from '../background/services/rogue_workflow.js';

const background = await readFile(new URL('../background/main.js', import.meta.url), 'utf8');
const sidepanel = await readFile(new URL('../sidepanel/main.js', import.meta.url), 'utf8');
const tab = { id: 7, windowId: 3, active: true, url: 'https://example.test/live' };
const data = { url: tab.url, title: 'Live', iframes: [], videos: [], emails: [] };
const sender = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
const request = { action: 'captureRogueFromSidepanel', tabId: tab.id, data };

function worker({ selected = tab, active = selected, capture, denyPermission = false, denyPlatform = false } = {}) {
  let listener;
  const captures = [], permissions = [], platforms = [], reads = [];
  const chrome = {
    runtime: { id: sender.id, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: {
      async get(id) { reads.push(id); if (!selected) throw Error('Tab closed'); return selected; },
      async query(query) { assert.equal(query.windowId, selected.windowId); return active ? [active] : []; }
    }
  };
  const context = vm.createContext({
    chrome, URL, PERMISSIONS, normalizeAccessPlatform, detectPlatformDetails, assertMessageSender,
    ACCESS_CONTEXT: Symbol('accessContext'), console: { error() {} },
    accessRegistry: {
      async requirePermission(permission) { permissions.push(permission); if (denyPermission) throw Error('Permission denied'); return {}; },
      async requirePlatform(_profile, platform) { platforms.push(platform); if (denyPlatform) throw Error('Platform denied'); }
    },
    rogueWorkflow: { async capture(...args) { captures.push(args); return capture ? capture(...args) : { success: true }; } }
  });
  // Exercise the production authorization, handlers and router without starting
  // unrelated browser listeners and customer services.
  vm.runInContext(background.slice(background.indexOf('const ACTION_ACCESS_POLICIES'), background.indexOf('const sheetScanner =')), context);
  vm.runInContext(background.slice(background.indexOf('function createActionHandlers()'), background.indexOf('setupBrowserEventListeners();')), context);
  vm.runInContext('registerMessageRouter();', context);
  return { chrome, captures, permissions, platforms, reads,
    send: (message = request, source = sender) => new Promise(resolve => listener({ ...message }, source, resolve)) };
}

test('side-panel capture resolves the selected tab and persists scoped evidence before success', async t => {
  const scope = { customerId: 'customer-a', userId: 'user-a' };
  const state = {};
  const h = worker({ capture: (...args) => workflow.capture(...args) });
  const previous = globalThis.chrome;
  t.after(() => { globalThis.chrome = previous; });
  globalThis.chrome = { ...h.chrome,
    tabs: { ...h.chrome.tabs, captureVisibleTab: async windowId => { assert.equal(windowId, tab.windowId); return 'image'; } },
    storage: { local: { set: async value => Object.assign(state, value) } },
    webRequest: { onBeforeRequest: { addListener() {} }, onResponseStarted: { addListener() {} } }
  };
  const workflow = createRogueWorkflow({ getCustomerProfile: async () => scope });
  assert.equal((await h.send()).success, true);
  assert.deepEqual(h.captures[0], [data, tab]);
  assert.deepEqual(h.permissions, [PERMISSIONS.SIDEPANEL_REPORT]);
  assert.deepEqual(h.platforms, ['other']);
  assert.deepEqual(state.rogue_target_data, { ...data, ...scope, networkTraffic: [], screenshot: 'image' });
});

test('worker rejects invalid, closed, inactive, navigated and non-web selections', async () => {
  for (const tabId of [undefined, null, '7', -1, 1.5]) {
    const h = worker();
    assert.equal((await h.send({ ...request, tabId })).success, false);
    assert.equal(h.reads.length, 0);
    assert.equal(h.captures.length, 0);
  }
  for (const options of [
    { selected: null }, { selected: { ...tab, active: false } },
    { selected: { ...tab, url: 'https://example.test/changed' } },
    { selected: { ...tab, pendingUrl: 'https://example.test/next' } },
    { selected: { ...tab, windowId: undefined } },
    { selected: { ...tab, url: 'chrome://settings/' } },
    { active: null }, { active: { ...tab, id: 8 } },
    { active: { ...tab, url: 'https://example.test/changed' } }
  ]) {
    const h = worker(options);
    assert.equal((await h.send()).success, false);
    assert.equal(h.captures.length, 0);
  }
});

test('dedicated capture preserves permission and platform authorization and propagates workflow failure', async () => {
  for (const options of [{ denyPermission: true }, { denyPlatform: true }]) {
    const h = worker(options);
    assert.equal((await h.send()).success, false);
    assert.equal(h.captures.length, 0);
  }
  const h = worker({ capture: async () => { throw Error('Storage unavailable'); } });
  const response = await h.send();
  assert.equal(response.success, false);
  assert.equal(response.error, 'Storage unavailable');
});

test('content scripts cannot use the extension capture action or bypass source-tab checks', async () => {
  const contentSender = { id: sender.id, url: tab.url, tab, frameId: 0 };
  const h = worker();
  for (const source of [contentSender, { ...sender, id: 'foreign' }, { ...sender, url: 'chrome-extension://extension-id/unknown.html' }]) {
    assert.equal((await h.send(request, source)).success, false);
  }
  const contentRequest = { action: 'initRogueTakedown', data, tabId: 999 };
  assert.equal((await h.send(contentRequest, contentSender)).success, true);
  assert.equal(h.captures[0][1], tab);
  for (const source of [{ ...contentSender, frameId: 1 }, { ...contentSender, url: 'https://embed.test/' }]) {
    assert.equal((await h.send(contentRequest, source)).success, false);
  }
  assert.equal((await h.send({ ...contentRequest, data: { url: 'https://other.test/' } }, contentSender)).success, false);
  assert.equal(h.captures.length, 1);
});

function panel(sendMessage) {
  const button = { innerText: 'Capture', disabled: false }, status = { innerText: '' }, timers = [], messages = [];
  const context = vm.createContext({
    URL, currentAccessProfile: null, nukeStatus: status, console: { error() {} },
    setTimeout: fn => timers.push(fn),
    chrome: { tabs: { query: async () => [tab] },
      scripting: { executeScript: async ({ target }) => { assert.equal(target.tabId, tab.id); return [{ result: data }]; } },
      runtime: { sendMessage: async message => { messages.push(message); return sendMessage(message); } }
    }
  });
  const start = sidepanel.indexOf('const handleNukeClick =');
  const end = sidepanel.indexOf('// Attach the same handler', start);
  const click = vm.runInContext(`${sidepanel.slice(start, end)}\nhandleNukeClick;`, context);
  return { button, status, timers, messages, click: () => click(button) };
}

test('side panel waits for worker success and sends the selected tab ID', async () => {
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const h = panel(() => response);
  const pending = h.click();
  assert.equal(h.status.innerText, 'Working...');
  assert.equal(h.button.disabled, true);
  resolve({ success: true });
  await pending;
  assert.equal(h.messages[0].action, request.action);
  assert.equal(h.messages[0].tabId, tab.id);
  assert.equal(h.status.innerText, 'Data captured! See Rogue Walkthrough.');
  assert.equal(h.button.disabled, false);
});

test('side panel never announces success for rejected, missing, or transport-error responses', async () => {
  for (const send of [
    async () => ({ success: false, error: 'Selected tab changed' }),
    async () => undefined,
    async () => ({}),
    async () => { throw Error('Message port closed'); }
  ]) {
    const h = panel(send);
    await h.click();
    assert.doesNotMatch(h.status.innerText, /Data captured/);
    assert.match(h.status.innerText, /Selected tab changed|Capture failed|Message port closed/);
    h.timers.forEach(fn => fn());
    assert.equal(h.button.innerText, 'Capture');
    assert.equal(h.button.disabled, false);
  }
});
