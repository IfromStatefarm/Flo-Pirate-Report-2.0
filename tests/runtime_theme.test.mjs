import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createThemeAssetService,
  CUSTOMER_ASSISTANT_IMAGE_CACHE_KEY,
  CUSTOMER_EASTER_EGG_IMAGE_CACHE_KEY,
  CUSTOMER_LOGO_CACHE_KEY
} from '../services/theme_asset_service.js';
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
      assistantImageUrl: 'https://cdn.example.com/assistant.gif',
      easterEggImageUrl: 'https://cdn.example.com/easter.webp',
      colors: { ...NEUTRAL_CUSTOMER_CONFIG.theme.colors, primary: '#123456' }
    },
    legal: { ...NEUTRAL_CUSTOMER_CONFIG.legal, ownerName: 'Acme Media' },
    arbitraryHtml: '<script>alert(1)</script>'
  }, {
    logoDataUrl: 'data:image/png;base64,AQ==',
    assistantImageDataUrl: 'data:image/gif;base64,Ag==',
    easterEggImageDataUrl: 'data:image/webp;base64,Aw=='
  });

  assert.equal(theme.isFallback, false);
  assert.equal(theme.product.displayName, 'Acme Rights Center');
  assert.equal(theme.colors.primary, '#123456');
  assert.equal(theme.logoDataUrl, 'data:image/png;base64,AQ==');
  assert.equal(theme.assistantImageDataUrl, 'data:image/gif;base64,Ag==');
  assert.equal(theme.easterEggImageDataUrl, 'data:image/webp;base64,Aw==');
  assert.equal(theme.legal.ownerName, 'Acme Media');
  assert.equal('arbitraryHtml' in theme, false);
});

test('downloads and caches all configured customer theme images independently', async () => {
  const storage = fakeStorage();
  const service = createThemeAssetService({
    storageArea: storage,
    fetchImpl: async (url) => {
      const type = String(url).endsWith('.gif') ? 'image/gif' : String(url).endsWith('.webp') ? 'image/webp' : 'image/png';
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type }), { status: 200 });
    }
  });
  const assets = await service.resolveThemeAssets({
    customerId: 'acme',
    configVersion: 5,
    logoUrl: 'https://cdn.example.com/logo.png',
    assistantImageUrl: 'https://cdn.example.com/assistant.gif',
    easterEggImageUrl: 'https://cdn.example.com/easter.webp'
  });

  assert.match(assets.logoDataUrl, /^data:image\/png;base64,/);
  assert.match(assets.assistantImageDataUrl, /^data:image\/gif;base64,/);
  assert.match(assets.easterEggImageDataUrl, /^data:image\/webp;base64,/);
  assert.equal(storage.state[CUSTOMER_LOGO_CACHE_KEY].configVersion, 5);
  assert.equal(storage.state[CUSTOMER_ASSISTANT_IMAGE_CACHE_KEY].configVersion, 5);
  assert.equal(storage.state[CUSTOMER_EASTER_EGG_IMAGE_CACHE_KEY].configVersion, 5);
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
