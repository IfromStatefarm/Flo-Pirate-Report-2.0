import test from 'node:test';
import assert from 'node:assert/strict';

import { createThemeAssetService, CUSTOMER_LOGO_CACHE_KEY } from '../services/theme_asset_service.js';
import { buildRuntimeTheme } from '../utils/runtime_theme.js';
import { NEUTRAL_CUSTOMER_CONFIG } from '../utils/customer_config.js';

function fakeStorage(initial = {}) {
  const state = { ...initial };
  return {
    state,
    async get(key) { return { [key]: state[key] }; },
    async set(values) { Object.assign(state, values); },
    async remove(key) { delete state[key]; }
  };
}

test('uses the neutral skin unless a profile is verified and ready', () => {
  const theme = buildRuntimeTheme({ status: 'stale', verification: 'cached' });
  assert.equal(theme.isFallback, true);
  assert.equal(theme.customerId, 'default');
  assert.equal(theme.product.displayName, NEUTRAL_CUSTOMER_CONFIG.product.displayName);
  assert.equal(theme.colors.primary, '#334155');
});

test('projects only approved profile fields into the customer runtime theme', () => {
  const theme = buildRuntimeTheme({
    status: 'ready', verification: 'verified', customerId: 'acme', configVersion: 4,
    theme: {
      productName: 'Acme Reporter', displayName: 'Acme Rights Center', shortName: 'Acme',
      assistantName: 'Acme Assistant', tagline: 'Protect Acme media.',
      logoUrl: 'https://cdn.example.com/logo.png', logoAltText: 'Acme logo',
      colors: { ...NEUTRAL_CUSTOMER_CONFIG.theme.colors, primary: '#123456' }
    },
    legal: { ...NEUTRAL_CUSTOMER_CONFIG.legal, ownerName: 'Acme Media' },
    arbitraryHtml: '<script>alert(1)</script>'
  }, 'data:image/png;base64,AQ==');

  assert.equal(theme.isFallback, false);
  assert.equal(theme.product.displayName, 'Acme Rights Center');
  assert.equal(theme.colors.primary, '#123456');
  assert.equal(theme.legal.ownerName, 'Acme Media');
  assert.equal('arbitraryHtml' in theme, false);
});

test('downloads an approved logo once and reuses the versioned local cache', async () => {
  const storage = fakeStorage();
  let requests = 0;
  const service = createThemeAssetService({
    storageArea: storage,
    fetchImpl: async () => {
      requests += 1;
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-length': '3', 'content-type': 'image/png' }
      });
    }
  });
  const request = { customerId: 'acme', configVersion: 4, logoUrl: 'https://cdn.example.com/logo.png' };
  const first = await service.resolveLogo(request);
  const second = await service.resolveLogo(request);

  assert.match(first, /^data:image\/png;base64,/);
  assert.equal(second, first);
  assert.equal(requests, 1);
  assert.equal(storage.state[CUSTOMER_LOGO_CACHE_KEY].customerId, 'acme');
});

test('rejects SVG and oversized remote logos', async () => {
  const storage = fakeStorage();
  const service = createThemeAssetService({
    storageArea: storage,
    fetchImpl: async () => new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' }), { status: 200 })
  });
  const logo = await service.resolveLogo({ customerId: 'acme', configVersion: 4, logoUrl: 'https://cdn.example.com/logo.svg' });
  assert.equal(logo, '');
  assert.equal(storage.state[CUSTOMER_LOGO_CACHE_KEY], undefined);
});
