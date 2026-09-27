import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { buildRuntimeTheme } from '../utils/runtime_theme.js';
import { NEUTRAL_CUSTOMER_CONFIG } from '../utils/customer_config.js';

const loaderSource = await readFile(new URL('../utils/theme_loader.js', import.meta.url), 'utf8');
const customerTheme = buildRuntimeTheme({
  status: 'ready', verification: 'verified', customerId: 'private-customer', configVersion: 1,
  theme: {
    ...NEUTRAL_CUSTOMER_CONFIG.product,
    ...NEUTRAL_CUSTOMER_CONFIG.theme,
    displayName: 'Example Reporter', assistantName: 'Example Assistant'
  },
  legal: {
    ownerName: 'Private Owner', companyName: 'Private Company',
    reportingEmail: 'private-reporter@example.invalid', secondaryEmail: 'private-secondary@example.invalid',
    phone: '+1-555-1234', addressLine1: '123 Private Street', city: 'Private City',
    region: 'Private Region', postalCode: '12345', country: 'Private Country',
    originalWorkUrl: 'https://private-work.example.invalid/'
  }
}, { logoDataUrl: 'data:image/png;base64,AQ==', assistantImageDataUrl: 'data:image/png;base64,Ag==' });

function element(dataset = {}) {
  return {
    dataset, textContent: 'page-owned text', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

async function loadThemeLoader(url = 'https://www.youtube.com/watch?v=hostile') {
  const textElements = [
    'reportingEmail', 'secondaryEmail', 'reportingPhone', 'legalOwnerName',
    'legalCompanyName', 'originalWorkUrl', 'displayName', 'assistantName'
  ].map((themeText) => element({ themeText }));
  const imageElements = [element(), element(), element()];
  const selectors = {
    '[data-theme-text]': textElements,
    '[data-theme-logo]': [imageElements[0]],
    '[data-theme-assistant]': [imageElements[1]],
    '[data-theme-easter-egg]': [imageElements[2]]
  };
  const style = {};
  const queries = [];
  const events = [];
  const storageListeners = [];
  const document = {
    location: new URL(url),
    documentElement: { dataset: {}, style: { setProperty(key, value) { style[key] = value; } } },
    querySelectorAll(selector) { queries.push(selector); return selectors[selector] || []; }
  };
  let response = { success: true, theme: customerTheme };
  const context = vm.createContext({
    document, console, setTimeout, clearTimeout,
    dispatchEvent(event) { events.push(event); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    chrome: {
      runtime: {
        id: 'our-extension', getURL: (path) => `chrome-extension://our-extension/${path}`,
        async sendMessage(request) {
          assert.equal(request.action, 'getRuntimeTheme');
          return response;
        }
      },
      storage: { onChanged: { addListener(listener) { storageListeners.push(listener); } } }
    }
  });
  vm.runInContext(loaderSource, context);
  const api = context.RightsReporterTheme;
  await api.loadTheme();
  return {
    api, document, textElements, imageElements, style, queries, events, context, storageListeners,
    setResponse(value) { response = value; }
  };
}

test('hostile page theme attributes cannot extract contacts or customer identity', async () => {
  const fixture = await loadThemeLoader();
  const { api, document, textElements, imageElements, style, queries, events } = fixture;
  assert.deepEqual(queries, [], 'never scan host-owned markup');
  assert.ok(textElements.every((node) => node.textContent === 'page-owned text'));
  assert.ok(imageElements.every((node) => Object.keys(node.attributes).length === 0));
  assert.deepEqual(document.documentElement.dataset, {});
  assert.deepEqual(events, [], 'never broadcast the full theme into DOM events');
  for (const secret of [customerTheme.customerId, ...Object.values(customerTheme.legal)]) {
    assert.ok(!JSON.stringify(style).includes(secret));
  }
  // Existing overlay colors and explicit reporting consumers still work.
  assert.equal(style['--brand-primary'], customerTheme.colors.primary);
  assert.equal(api.value('assistantName'), 'Example Assistant');
  assert.equal(api.value('reportingEmail'), '');
  assert.equal(api.getTheme().legal.reportingEmail, customerTheme.legal.reportingEmail);

  fixture.storageListeners[0]({ customer_access_profile_v1: {} }, 'local');
  await api.loadTheme();
  assert.deepEqual(queries, []);
  assert.deepEqual(events, []);
  assert.deepEqual(document.documentElement.dataset, {});
});

test('only our own extension documents receive automatic theme markup', async () => {
  for (const url of [
    'https://our-extension/options.html',
    'chrome-extension://another-extension/options.html',
    'about:blank'
  ]) {
    const fixture = await loadThemeLoader(url);
    assert.deepEqual(fixture.queries, [], url);
    assert.deepEqual(fixture.document.documentElement.dataset, {}, url);
  }
  const fixture = await loadThemeLoader('chrome-extension://our-extension/options.html');
  assert.equal(fixture.textElements.find((node) => node.dataset.themeText === 'displayName').textContent, 'Example Reporter');
  assert.equal(fixture.imageElements[0].attributes.src, customerTheme.logoDataUrl);
  assert.equal(fixture.imageElements[1].attributes.src, customerTheme.assistantImageDataUrl);
  assert.equal(fixture.document.documentElement.dataset.customerId, customerTheme.customerId);
  assert.equal(fixture.textElements[0].textContent, '', 'contacts are not template text tokens');
  assert.deepEqual(fixture.events, []);

  const foreignRoot = { ownerDocument: {}, querySelectorAll() { assert.fail('foreign root scanned'); } };
  fixture.api.applyTheme(customerTheme, foreignRoot);
});

test('private subscriptions update reporting consumers and reset contacts on fallback', async () => {
  const fixture = await loadThemeLoader();
  const updates = [];
  const unsubscribe = fixture.api.subscribe((theme) => updates.push(theme));
  fixture.api.applyTheme(customerTheme);
  assert.equal(updates[0].legal.phone, customerTheme.legal.phone);
  assert.equal(fixture.api.getTheme(), updates[0]);

  fixture.setResponse({ success: false });
  await fixture.api.loadTheme();
  assert.equal(updates.at(-1).isFallback, true);
  assert.equal(updates.at(-1).legal.reportingEmail, '');
  assert.equal(fixture.style['--brand-primary'], '#334155');
  assert.deepEqual(fixture.events, []);

  unsubscribe();
  fixture.api.applyTheme(customerTheme);
  assert.equal(updates.length, 2);
});

test('reinjection retains private subscribers and does not register duplicate storage listeners', async () => {
  const fixture = await loadThemeLoader();
  const updates = [];
  fixture.api.subscribe((theme) => updates.push(theme));
  vm.runInContext(loaderSource, fixture.context);
  await fixture.api.loadTheme();
  assert.equal(fixture.context.RightsReporterTheme, fixture.api);
  assert.equal(updates.length, 1);
  assert.equal(fixture.storageListeners.length, 1);
  assert.deepEqual(fixture.events, []);
});
