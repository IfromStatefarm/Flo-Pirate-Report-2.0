import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const original = await readFile(new URL('../content_autofill.js', import.meta.url), 'utf8');
const source = original.replace('    init();', `
    globalThis.probe = { bindWizardData, getAutofillAccess, createYouTubeOverlay, createTikTokOverlay,
      createInstagramOverlay, createTwitterOverlay, createTwitchOverlay,
      createStandardOverlay, createLauncherTab, setData: value => { lastReportData = value; } };
    runYtStep2 = async data => writes.push(data);
    runStep2 = async data => writes.push(data);
    runIgStep2 = async data => writes.push(data);
    runTwitterStep2 = async data => writes.push(data);
    runTwitchStep2 = async data => writes.push(data);
  `);

const platforms = [
  ['YouTube', 'https://www.youtube.com/copyright_complaint_form', 'createYouTubeOverlay', 'flo-yt-btn-step2', 'flo-upload-overlay'],
  ['TikTok', 'https://www.tiktok.com/legal/report', 'createTikTokOverlay', 'flo-btn-step2', 'flo-upload-overlay'],
  ['Instagram', 'https://help.instagram.com/contact/552695131608132', 'createInstagramOverlay', 'flo-ig-btn-step2', 'flo-instagram-overlay'],
  ['X', 'https://help.x.com/forms/dmca', 'createTwitterOverlay', 'flo-x-btn-step2', 'flo-twitter-overlay'],
  ['Twitch', 'https://www.twitch.tv/copyright-claims', 'createTwitchOverlay', 'flo-twitch-btn-step2', 'flo-twitch-overlay'],
  ['Facebook', 'https://www.facebook.com/help/contact/123', 'createStandardOverlay', 'flo-log-btn', 'flo-upload-overlay']
];

function fixture([platform, url, create, buttonId, overlayId]) {
  const nodes = new Map(), writes = [], checks = [];
  let changed, tick;
  let profile = { customerId: 'customer-a', userId: 'member-a', role: 'manager',
    status: 'ready', verification: 'verified', permissions: ['sidepanel.report', 'sidepanel.enforce'], platforms: [platform.toLowerCase()] };
  const storage = { customer_access_profile_v1: profile, customer_operation_session_v1: 'session-a',
    reporterInfo: { name: 'Reporter A', email: 'a@example.test' },
    piracy_cart: [{ platform, url: 'https://www.youtube.com/watch?v=example' }] };
  function element(id = '') {
    const node = { id, style: {}, handlers: {}, attached: false, children: [],
      addEventListener(event, handler) { this.handlers[event] = handler; },
      getBoundingClientRect() { return { width: 100, height: 100, right: 100, left: 0, top: 0 }; },
      querySelector(selector) { return nodes.get(selector.slice(1)) || null; },
      remove() { this.attached = false; this.children.forEach(child => { child.attached = false; }); },
      set innerHTML(html) {
        this.children = [...html.matchAll(/id="([^"]+)"/g)].map(match => element(match[1]));
      }
    };
    if (id) nodes.set(id, node);
    return node;
  }
  const body = { appendChild(node) {
    nodes.set(node.id, node);
    node.attached = true;
    node.children.forEach(child => { child.attached = true; });
  } };
  const document = { body, getElementById(id) { const node = nodes.get(id); return node?.attached ? node : null; },
    createElement() { return element(); }, addEventListener() {} };
  const context = vm.createContext({
    writes, URL, console: { log() {}, warn() {} }, document,
    window: { location: { href: url, hostname: new URL(url).hostname }, innerWidth: 1000 },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    setInterval(callback) { tick = callback; }, setTimeout(callback) { callback(); },
    chrome: {
      storage: { onChanged: { addListener(listener) { changed = listener; } },
        local: { async get(keys) {
          const selected = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(selected.map(key => [key, storage[key]]));
        } } },
      runtime: { onMessage: { addListener() {} }, async sendMessage(message) {
        checks.push(message);
        if (message.action !== 'checkAccess') return { success: true };
        return { success: true, allowed: profile.status === 'ready' &&
          profile.permissions.includes(message.permission), profile };
      } }
    }
  });
  vm.runInContext(source, context);
  const data = { fullName: 'Reporter A', email: 'a@example.test', platform,
    urls: [], cart: [], eventName: 'A event' };
  return {
    data, writes, checks, storage, document, get profile() { return profile; },
    setProfile(value) { profile = value; storage.customer_access_profile_v1 = value; },
    emit(changes) { changed(changes, 'local'); },
    async tick() { await tick(); },
    async start() {
      assert.equal(await context.probe.bindWizardData(data, profile), true);
      context.probe.setData(data);
      context.probe[create](data);
      assert.ok(document.getElementById(overlayId));
    },
    async click() { await document.getElementById(buttonId)?.handlers.click(); },
    capturedClick() { return nodes.get(buttonId)?.handlers.click; },
    overlayId,
    probe: context.probe
  };
}

for (const entry of platforms) {
  for (const change of ['logout', 'switch', 'suspension', 'demotion']) {
    test(`${entry[0]} wizard blocks stale Step 2 after ${change}`, async () => {
      const h = fixture(entry);
      await h.start();
      const click = h.capturedClick();
      const checksBefore = h.checks.length;
      if (change === 'logout' || change === 'switch') {
        const nextProfile = change === 'switch'
          ? { ...h.profile, customerId: 'customer-b', userId: 'member-b' } : undefined;
        h.setProfile(nextProfile);
        h.storage.customer_operation_session_v1 = 'session-b';
        delete h.storage.reporterInfo;
        delete h.storage.piracy_cart;
        h.emit({ customer_operation_session_v1: { oldValue: 'session-a', newValue: 'session-b' },
          customer_access_profile_v1: { oldValue: h.profile, newValue: nextProfile },
          reporterInfo: { oldValue: { name: 'Reporter A' } }, piracy_cart: { oldValue: [{}] } });
      } else {
        h.setProfile(change === 'suspension'
          ? { ...h.profile, status: 'not_a_member', permissions: [] }
          : { ...h.profile, role: 'employee', permissions: ['sidepanel.report'] });
      }
      await click();
      assert.equal(h.writes.length, 0);
      assert.equal(h.document.getElementById(h.overlayId), null);
      if (change === 'suspension' || change === 'demotion') assert.ok(h.checks.length > checksBefore);
    });
  }
}

test('TikTok SPA timer cannot restore a launcher after logout', async () => {
  const h = fixture(platforms[1]);
  await h.start();
  h.emit({ customer_operation_session_v1: { oldValue: 'session-a', newValue: 'session-b' } });
  await h.tick();
  assert.equal(h.document.getElementById('flo-wiz-launcher'), null);
});

test('report-only employee cannot bind a non-Rumble wizard', async () => {
  const h = fixture(platforms[0]);
  h.setProfile({ ...h.profile, role: 'employee', permissions: ['sidepanel.report'] });
  assert.equal(await h.probe.bindWizardData(h.data, h.profile), false);
  assert.equal(await h.probe.getAutofillAccess('YouTube'), null);
  assert.equal(h.checks.at(-1).permission, 'sidepanel.enforce');
});

test('wizard binding rejects reporter data cleared before the scope is attached', async () => {
  const h = fixture(platforms[0]);
  h.data.cart = h.storage.piracy_cart;
  delete h.storage.reporterInfo;
  assert.equal(await h.probe.bindWizardData(h.data, h.profile, true), false);
});
