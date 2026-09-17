import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOMER_ACCESS_PROFILE_CACHE_KEY,
  PERMISSIONS,
  hasPermission,
  validateCustomerAccessProfile
} from '../utils/access_control.js';
import { NEUTRAL_CUSTOMER_CONFIG } from '../utils/customer_config.js';
import { createCustomerBootstrapService } from '../services/customer_bootstrap_service.js';

const BASE_TIME = 1_800_000_000_000;

function validProfile(overrides = {}) {
  const neutral = NEUTRAL_CUSTOMER_CONFIG;
  return {
    schemaVersion: 1,
    customerId: 'acme-sports',
    userId: 'user_123',
    configVersion: 7,
    email: 'member@example.com',
    name: 'Example Member',
    role: 'manager',
    permissions: [
      PERMISSIONS.SIDEPANEL_REPORT,
      PERMISSIONS.SIDEPANEL_AUTOMATE,
      PERMISSIONS.SETTINGS_CORE_CONNECTIVITY
    ],
    platforms: ['youtube', 'tiktok'],
    theme: {
      productName: neutral.product.productName,
      displayName: 'Acme Rights Center',
      shortName: neutral.product.shortName,
      assistantName: neutral.product.assistantName,
      tagline: neutral.product.tagline,
      logoUrl: 'https://cdn.example.com/acme.png',
      logoAltText: 'Acme Sports',
      assistantImageUrl: 'https://cdn.example.com/acme-assistant.gif',
      easterEggImageUrl: 'https://cdn.example.com/acme-easter-egg.webp',
      colors: { ...neutral.theme.colors }
    },
    legal: {
      ownerName: 'Acme Sports',
      companyName: 'Acme Sports, Inc.',
      reportingEmail: 'rights@example.com',
      secondaryEmail: 'legal@example.com',
      phone: '555 010 1000',
      addressLine1: '100 Main Street',
      city: 'Austin',
      region: 'Texas',
      postalCode: '78701',
      country: 'United States',
      originalWorkUrl: 'https://www.example.com/'
    },
    integrations: {
      driveRootFolderId: 'driveRoot_12345',
      reportSpreadsheetId: 'reportSheet_12345',
      eventSpreadsheetId: 'eventSheet_12345',
      statsDashboardId: 'stats_acme'
    },
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 10 * 60 * 1000,
    ...overrides
  };
}

function fakeStorage(initial = {}) {
  const state = { ...initial };
  return {
    state,
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [key, state[key]]));
    },
    async set(values) {
      Object.assign(state, values);
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete state[key]);
    }
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

function createHarness({ profile = validProfile(), fetchImpl, clock = { value: BASE_TIME }, initialLocal = {} } = {}) {
  const localStorageArea = fakeStorage(initialLocal);
  const syncStorageArea = fakeStorage({
    piracy_folder_id: 'manual-drive',
    piracy_sheet_id: 'manual-report',
    event_sheet_id: 'manual-event'
  });
  const sessionStorageArea = fakeStorage({ tiered_access_session: { email: 'legacy@example.com' } });
  const requests = [];
  const request = fetchImpl || (async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ profile });
  });
  const service = createCustomerBootstrapService({
    getAuthToken: async () => 'google-oauth-token',
    getUserEmail: async () => 'member@example.com',
    fetchImpl: request,
    localStorageArea,
    syncStorageArea,
    sessionStorageArea,
    loadSettings: async () => ({
      schemaVersion: 1,
      bootstrapEndpoint: 'https://api.example.com/v1/extension/bootstrap'
    }),
    extensionMetadata: () => ({ extensionId: 'extension-id', extensionVersion: '3.3.1' }),
    now: () => clock.value
  });
  return { clock, localStorageArea, requests, service, sessionStorageArea, syncStorageArea };
}

test('validates one fixed short-lived profile and rejects unsupported fields', () => {
  const accepted = validateCustomerAccessProfile(validProfile(), {
    expectedEmail: 'member@example.com',
    now: BASE_TIME
  });
  assert.equal(accepted.valid, true);

  const candidate = validProfile({ customers: ['acme-sports', 'other'] });
  const rejected = validateCustomerAccessProfile(candidate, {
    expectedEmail: 'member@example.com',
    now: BASE_TIME
  });
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(({ code }) => code === 'unsupported_field'));

  const missingUserId = validProfile();
  delete missingUserId.userId;
  const missingUserResult = validateCustomerAccessProfile(missingUserId, {
    expectedEmail: 'member@example.com',
    now: BASE_TIME
  });
  assert.equal(missingUserResult.valid, false);
  assert.ok(missingUserResult.errors.some(({ code }) => code === 'invalid_user_id'));
});

test('role matrix is a ceiling on API-supplied permissions', () => {
  const candidate = validProfile({
    role: 'employee',
    permissions: [PERMISSIONS.SIDEPANEL_AUTOMATE]
  });
  const result = validateCustomerAccessProfile(candidate, {
    expectedEmail: candidate.email,
    now: BASE_TIME
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === 'permission_exceeds_role'));
});

test('bootstrap sends the Google token, stores only the validated profile, and migrates legacy session state', async () => {
  const harness = createHarness();
  const profile = await harness.service.bootstrap();

  assert.equal(profile.status, 'ready');
  assert.equal(profile.verification, 'verified');
  assert.equal(profile.customerId, 'acme-sports');
  assert.equal(hasPermission(profile, PERMISSIONS.SIDEPANEL_AUTOMATE), true);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].options.headers.Authorization, 'Bearer google-oauth-token');
  assert.deepEqual(JSON.parse(harness.requests[0].options.body), {
    protocolVersion: 1,
    identity: { email: 'member@example.com' },
    extension: { id: 'extension-id', version: '3.3.1' }
  });
  assert.equal(harness.localStorageArea.state[CUSTOMER_ACCESS_PROFILE_CACHE_KEY].customerId, 'acme-sports');
  assert.equal(harness.sessionStorageArea.state.tiered_access_session, undefined);
  assert.equal(harness.syncStorageArea.state.piracy_folder_id, 'driveRoot_12345');
});

test('an unexpired last-known-good profile serves without another API request', async () => {
  const harness = createHarness();
  await harness.service.bootstrap();
  const cached = await harness.service.getCurrentProfile();
  assert.equal(cached.status, 'ready');
  assert.equal(harness.requests.length, 1);
});

test('clears customer-scoped local activity when the verified customer or user changes', async () => {
  let customerId = 'acme-sports';
  const harness = createHarness({
    fetchImpl: async () => jsonResponse({ profile: validProfile({ customerId }) })
  });

  await harness.service.bootstrap();
  await harness.localStorageArea.set({ piracy_cart: [{ url: 'https://example.com/private' }] });
  customerId = 'other-customer';
  await harness.service.bootstrap();

  assert.equal(harness.localStorageArea.state.piracy_cart, undefined);
  assert.equal(harness.localStorageArea.state[CUSTOMER_ACCESS_PROFILE_CACHE_KEY].customerId, 'other-customer');
});

test('expired last-known-good profile remains displayable but cannot authorize protected work', async () => {
  const clock = { value: BASE_TIME };
  let online = true;
  const harness = createHarness({
    clock,
    fetchImpl: async () => {
      if (!online) throw new Error('offline');
      return jsonResponse({ profile: validProfile() });
    }
  });
  await harness.service.bootstrap();
  clock.value = BASE_TIME + 11 * 60 * 1000;
  online = false;

  const stale = await harness.service.getCurrentProfile({ forceRefresh: true });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.customerId, 'acme-sports');
  assert.equal(hasPermission(stale, PERMISSIONS.SIDEPANEL_REPORT), false);
  await assert.rejects(
    harness.service.requirePermission(PERMISSIONS.SIDEPANEL_REPORT),
    /Access denied: The cached customer profile is expired/
  );
});

test('a transient refresh failure may use an unexpired verified profile until its server expiry', async () => {
  let online = true;
  const harness = createHarness({
    fetchImpl: async () => {
      if (!online) throw new Error('offline');
      return jsonResponse({ profile: validProfile() });
    }
  });
  await harness.service.bootstrap();
  online = false;
  const stillVerified = await harness.service.getCurrentProfile({ forceRefresh: true });
  assert.equal(stillVerified.status, 'ready');
  assert.equal(hasPermission(stillVerified, PERMISSIONS.SIDEPANEL_REPORT), true);
});

test('an authoritative membership denial blocks a previously cached profile', async () => {
  let denied = false;
  const harness = createHarness({
    fetchImpl: async () => denied
      ? jsonResponse({ error: 'not a member' }, 403)
      : jsonResponse({ profile: validProfile() })
  });
  await harness.service.bootstrap();
  denied = true;
  const revoked = await harness.service.getCurrentProfile({ forceRefresh: true });
  assert.equal(revoked.status, 'not_a_member');
  assert.equal(hasPermission(revoked, PERMISSIONS.SIDEPANEL_REPORT), false);

  const subsequent = await harness.service.getCurrentProfile();
  assert.equal(subsequent.status, 'not_a_member');
  await assert.rejects(harness.service.requirePermission(PERMISSIONS.SIDEPANEL_REPORT), /Access denied/);
});

test('ambiguous membership and identity mismatch fail closed', async () => {
  const ambiguous = createHarness({
    fetchImpl: async () => jsonResponse({ profile: [validProfile(), validProfile({ customerId: 'other' })] })
  });
  const ambiguousProfile = await ambiguous.service.bootstrap();
  assert.equal(ambiguousProfile.status, 'ambiguous_customer');
  assert.equal(hasPermission(ambiguousProfile, PERMISSIONS.SIDEPANEL_REPORT), false);

  const mismatch = createHarness({ profile: validProfile({ email: 'other@example.com' }) });
  const mismatchProfile = await mismatch.service.bootstrap();
  assert.equal(mismatchProfile.status, 'invalid_profile');
  assert.equal(hasPermission(mismatchProfile, PERMISSIONS.SIDEPANEL_REPORT), false);
});

test('unconfigured or non-HTTPS bootstrap endpoint fails closed before sending the OAuth token', async () => {
  let requestCount = 0;
  const service = createCustomerBootstrapService({
    getAuthToken: async () => 'google-oauth-token',
    getUserEmail: async () => 'member@example.com',
    fetchImpl: async () => {
      requestCount += 1;
      return jsonResponse({ profile: validProfile() });
    },
    localStorageArea: fakeStorage(),
    syncStorageArea: fakeStorage(),
    sessionStorageArea: fakeStorage(),
    loadSettings: async () => ({ schemaVersion: 1, bootstrapEndpoint: 'http://unsafe.example.com/bootstrap' }),
    extensionMetadata: () => ({ extensionId: 'id', extensionVersion: '1' }),
    now: () => BASE_TIME
  });
  const profile = await service.bootstrap();
  assert.equal(profile.status, 'configuration_error');
  assert.equal(requestCount, 0);
});

test('a cached profile cannot authorize when there is no active Google identity', async () => {
  const localStorageArea = fakeStorage({
    [CUSTOMER_ACCESS_PROFILE_CACHE_KEY]: validProfile()
  });
  let requestCount = 0;
  const service = createCustomerBootstrapService({
    getAuthToken: async () => 'google-oauth-token',
    getUserEmail: async () => null,
    fetchImpl: async () => {
      requestCount += 1;
      return jsonResponse({ profile: validProfile() });
    },
    localStorageArea,
    syncStorageArea: fakeStorage(),
    sessionStorageArea: fakeStorage(),
    loadSettings: async () => ({
      schemaVersion: 1,
      bootstrapEndpoint: 'https://api.example.com/v1/extension/bootstrap'
    }),
    extensionMetadata: () => ({ extensionId: 'id', extensionVersion: '1' }),
    now: () => BASE_TIME
  });

  const profile = await service.getCurrentProfile();
  assert.equal(profile.status, 'logged_out');
  assert.equal(hasPermission(profile, PERMISSIONS.SIDEPANEL_REPORT), false);
  assert.equal(requestCount, 0);
});
