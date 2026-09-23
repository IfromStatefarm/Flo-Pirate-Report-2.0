import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import vm from 'node:vm';
import { startCustomerSetupServer, sessionCookie } from './seller_test_helpers.mjs';

const FLOSPORTS = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url), 'utf8'));

function request(url, { host, origin, cookie, body, path = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (host) headers.host = host;
    if (origin) headers.origin = origin;
    headers.cookie = `${sessionCookie(url)}; ${cookie || ''}`;
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    const req = http.request(new URL(path, url), { method: body ? 'POST' : 'GET', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function updateForm(config, csrf) {
  const form = new URLSearchParams({
    csrf,
    expectedConfigVersion: '1',
    'operator.email': 'ivan.mcclay@flosports.tv',
    customerId: config.customerId,
    configVersion: String(config.configVersion),
    'product.productName': config.product.productName,
    'product.displayName': config.product.displayName,
    'product.shortName': config.product.shortName,
    'product.assistantName': config.product.assistantName,
    'product.tagline': config.product.tagline,
    'theme.logoUrl': config.theme.logoUrl,
    'theme.logoAltText': config.theme.logoAltText,
    'theme.assistantImageUrl': config.theme.assistantImageUrl,
    'theme.easterEggImageUrl': config.theme.easterEggImageUrl,
    'legal.ownerName': config.legal.ownerName,
    'legal.companyName': config.legal.companyName,
    'legal.reportingEmail': config.legal.reportingEmail,
    'legal.secondaryEmail': config.legal.secondaryEmail,
    'legal.phone': config.legal.phone,
    'legal.addressLine1': config.legal.addressLine1,
    'legal.city': config.legal.city,
    'legal.region': config.legal.region,
    'legal.postalCode': config.legal.postalCode,
    'legal.country': config.legal.country,
    'legal.originalWorkUrl': config.legal.originalWorkUrl,
    'access.allowedEmailDomains': config.access.allowedEmailDomains.join('\n'),
    'access.totalUserCap': String(config.access.totalUserCap),
    'access.employeeCap': String(config.access.roleSeatCaps.employee),
    'access.managerCap': String(config.access.roleSeatCaps.manager),
    'access.adminCap': String(config.access.roleSeatCaps.admin),
    'destinations.driveRootFolderId': config.destinations.driveRootFolderId,
    'destinations.reportSpreadsheetId': config.destinations.reportSpreadsheetId,
    'destinations.eventSpreadsheetId': config.destinations.eventSpreadsheetId,
    'stats.dashboardId': config.stats.dashboardId
  });
  for (const [token, color] of Object.entries(config.theme.colors)) form.set(`theme.${token}`, color);
  for (const role of config.access.enabledRoles) form.append('access.enabledRoles', role);
  for (const feature of config.capabilities.enabledFeatures) form.append('capabilities.enabledFeatures', feature);
  for (const platform of config.capabilities.enabledPlatforms) form.append('capabilities.enabledPlatforms', platform);
  return form.toString();
}

test('local setup accepts both local addresses and rejects foreign origins, hosts, and missing CSRF', async (t) => {
  const server = await startCustomerSetupServer({ port: 0, provision: () => assert.fail('must not provision') });
  t.after(() => server.close());
  const port = new URL(server.url).port;
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
    const page = await request(server.url, { host });
    assert.equal(page.status, 200);
    assert.equal(page.headers['referrer-policy'], 'same-origin');
    const cookie = page.headers['set-cookie'][0].split(';')[0];
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)[1];
    const options = { host, origin: `http://${host}`, cookie, body: `csrf=${csrf}`, path: '/review' };
    const valid = await request(server.url, options);
    assert.equal(valid.status, 400); // Reaches field validation, rather than origin rejection.
    assert.match(valid.text, /Please correct these fields/);
    for (const path of ['/review', '/provision']) {
      assert.equal((await request(server.url, { ...options, path, origin: 'https://evil.example' })).status, 403);
      assert.equal((await request(server.url, { ...options, path, origin: 'null' })).status, 403);
      assert.equal((await request(server.url, { ...options, path, cookie: '' })).status, 403);
      assert.equal((await request(server.url, { ...options, path, body: 'csrf=incorrect' })).status, 403);
      assert.equal((await request(server.url, { ...options, path, origin: `http://${host === `localhost:${port}` ? '127.0.0.1' : 'localhost'}:${port}` })).status, 403);
    }
  }
  assert.equal((await request(server.url, { host: `evil.example:${port}` })).status, 403);
  assert.equal((await request(server.url, { host: 'localhost:1' })).status, 403);
});

test('theme swatches render and synchronize valid hex input and picker changes', async (t) => {
  const server = await startCustomerSetupServer({ port: 0 });
  t.after(() => server.close());
  const page = await request(server.url);
  assert.match(page.text, /name="theme\.logoUrl"/);
  assert.match(page.text, /name="theme\.assistantImageUrl"/);
  assert.match(page.text, /name="theme\.easterEggImageUrl"/);
  assert.match(page.text, /data-image-preview="logo"/);
  assert.match(page.text, /data-image-preview="assistant"/);
  assert.match(page.text, /data-image-preview="easterEgg"/);
  assert.match(page.text, /id="image-preview-modal"/);
  assert.match(page.text, /id="customer-live-preview"/);
  assert.match(page.text, /data-live-preview-view="sidepanel"/);
  assert.match(page.text, /data-live-preview-view="settings"/);
  assert.match(page.text, /data-open-live-settings/);
  assert.match(page.text, /data-close-live-settings/);
  assert.match(page.text, /Live extension preview/);
  assert.match(page.text, /Preview placement/);
  assert.match(page.text, /Primary brand/);
  assert.match(page.text, /Appears in: primary buttons, active tabs, headings/);
  assert.match(page.text, /Side panel: main header title/);
  assert.match(page.text, /Settings page Box 2 and Side panel Report Setup/);
  assert.match(page.text, /Shows the Side panel Intelligence tab/);
  assert.match(page.text, /type="color" value="#[0-9a-fA-F]{6}"/);
  assert.match(page.text, /script src="\/colors.js" defer/);
  assert.match(page.text, /script src="\/preview.js" defer/);
  assert.match(page.text, /script src="\/customer-preview.js" defer/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.match(page.headers['content-security-policy'], /img-src 'self' https:/);
  const script = await request(server.url, { path: '/colors.js' });
  assert.equal(script.status, 200);
  const textEvents = {}, pickerEvents = {};
  const text = { value: '#abcdef', addEventListener: (event, fn) => { textEvents[event] = fn; } };
  const picker = { value: '#000000', addEventListener: (event, fn) => { pickerEvents[event] = fn; } };
  vm.runInNewContext(script.text, { document: { querySelectorAll: () => [{ querySelector: (selector) => selector.includes('text') ? text : picker }] } });
  textEvents.input();
  assert.equal(picker.value, '#abcdef');
  text.value = '#12';
  textEvents.input();
  assert.equal(picker.value, '#abcdef');
  assert.equal(text.value, '#12');
  picker.value = '#123456';
  pickerEvents.input();
  assert.equal(text.value, '#123456');

  const previewScript = await request(server.url, { path: '/preview.js' });
  assert.equal(previewScript.status, 200);
  assert.match(previewScript.text, /safeHttpsUrl/);
  assert.match(previewScript.text, /data-image-preview/);
  assert.match(previewScript.text, /Preview requires a credential-free HTTPS image URL/);

  const customerPreviewScript = await request(server.url, { path: '/customer-preview.js' });
  assert.equal(customerPreviewScript.status, 200);
  assert.match(customerPreviewScript.text, /data-customer-config-form/);
  assert.match(customerPreviewScript.text, /safeHttpsUrl/);
  assert.match(customerPreviewScript.text, /data-open-live-settings/);
  assert.match(customerPreviewScript.text, /form\.addEventListener\('input', syncPreview\)/);
});

test('customer directory opens an existing profile and saves a reviewed update', async (t) => {
  let updated = null;
  const editableConfig = structuredClone(FLOSPORTS);
  editableConfig.configVersion = 2;
  editableConfig.product.displayName = 'FloSports Reporter Updated';
  const server = await startCustomerSetupServer({
    pool: {},
    port: 0,
    operatorEmail: 'ivan.mcclay@flosports.tv',
    list: async () => [{
      customerId: 'flosports',
      displayName: 'FloSports Reporter',
      productName: 'FloSports Pirate Reporter',
      active: true,
      configVersion: 1,
      configurationValid: true,
      activeUsers: 3,
      activeAdministrators: 1,
      totalUserCap: 50,
      administratorCap: 2,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z'
    }],
    load: async (_pool, customerId) => {
      assert.equal(customerId, 'flosports');
      return { customerId, configVersion: 1, config: FLOSPORTS };
    },
    update: async (_pool, request) => {
      updated = request;
      return {
        auditId: 'audit_customer_update',
        customerId: request.config.customerId,
        displayName: request.config.product.displayName,
        configVersion: request.config.configVersion,
        changedFields: ['product.displayName'],
        utilization: {
          activeUsers: { used: 3, limit: request.config.access.totalUserCap },
          administrators: { used: 1, limit: request.config.access.roleSeatCaps.admin }
        }
      };
    }
  });
  t.after(() => server.close());

  const directory = await request(server.url, { path: '/customers' });
  assert.equal(directory.status, 200);
  assert.match(directory.text, /FloSports Reporter/);
  assert.match(directory.text, /3\s*\/\s*50/);
  assert.match(directory.text, /href="\/customers\/flosports\/edit"/);

  const edit = await request(server.url, { path: '/customers/flosports/edit' });
  assert.equal(edit.status, 200);
  assert.match(edit.text, /Editing an existing customer/);
  assert.match(edit.text, /name="customerId"[^>]*readonly/);
  assert.match(edit.text, /name="configVersion"[^>]*value="2"[^>]*readonly/);
  const cookie = edit.headers['set-cookie'][0].split(';')[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(edit.text)[1];

  const review = await request(server.url, {
    path: '/customers/flosports/review',
    host: new URL(server.url).host,
    origin: new URL(server.url).origin,
    cookie,
    body: updateForm(editableConfig, csrf)
  });
  assert.equal(review.status, 200);
  assert.match(review.text, /Save customer changes/);
  assert.match(review.text, /1 → 2/);
  const confirmationToken = /name="confirmationToken" value="([^"]+)"/.exec(review.text)[1];
  assert.equal(updated, null);

  const saved = await request(server.url, {
    path: '/customers/flosports/update',
    host: new URL(server.url).host,
    origin: new URL(server.url).origin,
    cookie,
    body: new URLSearchParams({ csrf, confirmationToken }).toString()
  });
  assert.equal(saved.status, 200);
  assert.equal(updated.config.product.displayName, 'FloSports Reporter Updated');
  assert.equal(updated.expectedConfigVersion, 1);
  assert.match(saved.text, /Customer updated successfully/);
  assert.match(saved.text, /audit_customer_update/);
});
