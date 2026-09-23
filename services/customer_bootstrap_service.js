import {
  CUSTOMER_ACCESS_PROFILE_CACHE_KEY,
  createUnavailableAccessProfile,
  hasPermission,
  hasPlatformAccess,
  normalizeAccessEmail,
  toPublicAccessProfile,
  validateCustomerAccessProfile
} from '../utils/access_control.js';

export const CUSTOMER_BOOTSTRAP_PROTOCOL_VERSION = 1;
export const CUSTOMER_BOOTSTRAP_SETTINGS_PATH = 'config/customer_bootstrap.json';
export const CUSTOMER_BOOTSTRAP_DENIAL_KEY = 'customer_access_denial_v1';

const LEGACY_LOCAL_KEYS = Object.freeze(['tiered_access_profile']);
const LEGACY_SESSION_KEYS = Object.freeze(['tiered_access_session']);
const CUSTOMER_SCOPED_LOCAL_KEYS = Object.freeze([
  'piracy_cart',
  'rogue_target_data',
  'reporterInfo',
  'gamification_stats_cache', 'last_reporter', 'streak_count', 'last_report_date',
  'streak_freezes', 'closer_enabled', 'validated_customer_config_v1', 'report_operation_v1'
]);
const CUSTOMER_SCOPED_SESSION_KEYS = Object.freeze([
  'activeSearchTabId',
  'activeSearchBaseUrl',
  'activeEventDetails'
]);
const MANAGED_CONNECTIVITY_FIELDS = Object.freeze([
  { storageKey: 'piracy_folder_id', integrationKey: 'driveRootFolderId' },
  { storageKey: 'piracy_sheet_id', integrationKey: 'reportSpreadsheetId' },
  { storageKey: 'event_sheet_id', integrationKey: 'eventSpreadsheetId' }
]);

class BootstrapError extends Error {
  constructor(message, status = 'bootstrap_error') {
    super(message);
    this.name = 'BootstrapError';
    this.profileStatus = status;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateEndpoint(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('unsafe');
    return parsed.href;
  } catch {
    throw new BootstrapError(
      'Customer bootstrap is not configured with a credential-free HTTPS endpoint.',
      'configuration_error'
    );
  }
}

function validateSettings(value) {
  if (!isPlainObject(value)) throw new BootstrapError('Customer bootstrap settings are invalid.', 'configuration_error');
  const keys = Object.keys(value);
  const allowedKeys = new Set(['schemaVersion', 'bootstrapEndpoint', 'membershipEndpoint', 'dataEndpoint']);
  if (!keys.includes('schemaVersion') || !keys.includes('bootstrapEndpoint') || keys.some((key) => !allowedKeys.has(key))) {
    throw new BootstrapError('Customer bootstrap settings contain unsupported or missing fields.', 'configuration_error');
  }
  if (Number(value.schemaVersion) !== CUSTOMER_BOOTSTRAP_PROTOCOL_VERSION) {
    throw new BootstrapError('Customer bootstrap settings use an unsupported schema version.', 'configuration_error');
  }
  return validateEndpoint(value.bootstrapEndpoint);
}

function defaultExtensionMetadata() {
  const manifest = chrome.runtime.getManifest();
  return {
    extensionId: chrome.runtime.id,
    extensionVersion: String(manifest.version || '')
  };
}

async function defaultLoadSettings(fetchImpl) {
  const response = await fetchImpl(chrome.runtime.getURL(CUSTOMER_BOOTSTRAP_SETTINGS_PATH), { cache: 'no-store' });
  if (!response.ok) throw new BootstrapError('Customer bootstrap settings could not be loaded.', 'configuration_error');
  return response.json();
}

function assertExactEnvelope(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, 'profile')) {
    throw new BootstrapError('The customer API returned an invalid bootstrap envelope.', 'invalid_profile');
  }
  if (Array.isArray(value.profile) || !isPlainObject(value.profile)) {
    throw new BootstrapError('The customer API must resolve the identity to exactly one customer profile.', 'ambiguous_customer');
  }
  return value.profile;
}

function statusForHttp(responseStatus) {
  if (responseStatus === 401) return 'identity_error';
  if (responseStatus === 403 || responseStatus === 404) return 'not_a_member';
  if (responseStatus === 409) return 'ambiguous_customer';
  return 'bootstrap_error';
}

function messageForHttp(responseStatus) {
  if (responseStatus === 401) return 'Google identity could not be verified by the customer API.';
  if (responseStatus === 403 || responseStatus === 404) return 'This Google account is not an approved member of an active customer.';
  if (responseStatus === 409) return 'This Google account resolves to more than one active customer.';
  return `Customer bootstrap failed (${responseStatus}).`;
}

export function createCustomerBootstrapService({
  getAuthToken,
  getUserEmail,
  fetchImpl = fetch,
  localStorageArea = chrome.storage.local,
  syncStorageArea = chrome.storage.sync,
  sessionStorageArea = chrome.storage.session,
  loadSettings = () => defaultLoadSettings(fetchImpl),
  extensionMetadata = defaultExtensionMetadata,
  onScopeChange = async () => {},
  now = () => Date.now()
}) {
  let inMemoryProfile = null;
  let inFlightProfilePromise = null;
  let endpointPromise = null;
  let generation = 0;

  async function getEndpoint() {
    if (!endpointPromise) {
      endpointPromise = Promise.resolve(loadSettings())
        .then(validateSettings)
        .catch((error) => {
          endpointPromise = null;
          throw error;
        });
    }
    return endpointPromise;
  }

  async function syncManagedConnectivity(profile) {
    const integrations = profile?.integrations || {};
    const storageKeys = MANAGED_CONNECTIVITY_FIELDS.flatMap(({ storageKey }) => [
      storageKey,
      `manual_${storageKey}`,
      `managed_${storageKey}_active`
    ]);
    const stored = await syncStorageArea.get(storageKeys);
    const updates = {};
    MANAGED_CONNECTIVITY_FIELDS.forEach(({ storageKey, integrationKey }) => {
      const managedId = String(integrations[integrationKey] || '').trim();
      const manualKey = `manual_${storageKey}`;
      const activeKey = `managed_${storageKey}_active`;
      if (!stored[activeKey]) updates[manualKey] = String(stored[storageKey] || '').trim();
      updates[storageKey] = managedId;
      updates[activeKey] = true;
      updates[`managed_${storageKey}_label`] = '';
    });
    await syncStorageArea.set(updates);
  }

  async function restoreManualConnectivity() {
    const storageKeys = MANAGED_CONNECTIVITY_FIELDS.flatMap(({ storageKey }) => [
      storageKey,
      `manual_${storageKey}`,
      `managed_${storageKey}_active`
    ]);
    const stored = await syncStorageArea.get(storageKeys);
    const updates = {};
    MANAGED_CONNECTIVITY_FIELDS.forEach(({ storageKey }) => {
      if (stored[`managed_${storageKey}_active`] === true) {
        updates[storageKey] = String(stored[`manual_${storageKey}`] || '').trim();
      }
      updates[`managed_${storageKey}_active`] = false;
      updates[`managed_${storageKey}_label`] = '';
    });
    await syncStorageArea.set(updates);
  }

  async function readCachedProfile(expectedEmail) {
    const cached = inMemoryProfile || (await localStorageArea.get(CUSTOMER_ACCESS_PROFILE_CACHE_KEY))?.[CUSTOMER_ACCESS_PROFILE_CACHE_KEY];
    if (!cached) return null;
    const result = validateCustomerAccessProfile(cached, {
      expectedEmail,
      now: now(),
      allowExpired: true
    });
    if (!result.valid) {
      inMemoryProfile = null;
      await localStorageArea.remove(CUSTOMER_ACCESS_PROFILE_CACHE_KEY);
      return null;
    }
    inMemoryProfile = result.profile;
    return result.profile;
  }

  async function readDenial(expectedEmail) {
    const stored = await localStorageArea.get(CUSTOMER_BOOTSTRAP_DENIAL_KEY);
    const denial = stored?.[CUSTOMER_BOOTSTRAP_DENIAL_KEY];
    if (!isPlainObject(denial) || normalizeAccessEmail(denial.email) !== expectedEmail) return null;
    return {
      email: expectedEmail,
      status: String(denial.status || 'bootstrap_error'),
      message: String(denial.message || 'Customer access was denied by the API.')
    };
  }

  async function storeDenial(email, error) {
    await localStorageArea.set({
      [CUSTOMER_BOOTSTRAP_DENIAL_KEY]: {
        email,
        status: error.profileStatus,
        message: error.message,
        deniedAt: now()
      }
    });
  }

  async function storeVerifiedProfile(profile) {
    const previous = inMemoryProfile ||
      (await localStorageArea.get(CUSTOMER_ACCESS_PROFILE_CACHE_KEY))?.[CUSTOMER_ACCESS_PROFILE_CACHE_KEY];
    const scopeChanged = !previous ||
      previous.customerId !== profile.customerId || previous.userId !== profile.userId;
    if (scopeChanged) await onScopeChange();
    inMemoryProfile = profile;
    const writes = [
      localStorageArea.set({ [CUSTOMER_ACCESS_PROFILE_CACHE_KEY]: profile }),
      localStorageArea.remove(CUSTOMER_BOOTSTRAP_DENIAL_KEY),
      localStorageArea.remove(LEGACY_LOCAL_KEYS),
      sessionStorageArea.remove(LEGACY_SESSION_KEYS),
      syncManagedConnectivity(profile)
    ];
    if (scopeChanged) {
      writes.push(
        localStorageArea.remove(CUSTOMER_SCOPED_LOCAL_KEYS),
        sessionStorageArea.remove(CUSTOMER_SCOPED_SESSION_KEYS)
      );
    }
    await Promise.all(writes);
    return toPublicAccessProfile(profile, { loadedAt: now() });
  }

  async function requestBootstrap(token, email) {
    const endpoint = await getEndpoint();
    const metadata = extensionMetadata();
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        protocolVersion: CUSTOMER_BOOTSTRAP_PROTOCOL_VERSION,
        identity: { email },
        extension: {
          id: String(metadata.extensionId || ''),
          version: String(metadata.extensionVersion || '')
        }
      }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new BootstrapError(messageForHttp(response.status), statusForHttp(response.status));
    const responseText = await response.text();
    if (!responseText || responseText.length > 128 * 1024) {
      throw new BootstrapError('The customer API returned an empty or oversized profile.', 'invalid_profile');
    }
    let envelope;
    try {
      envelope = JSON.parse(responseText);
    } catch {
      throw new BootstrapError('The customer API returned invalid JSON.', 'invalid_profile');
    }
    const candidate = assertExactEnvelope(envelope);
    const result = validateCustomerAccessProfile(candidate, { expectedEmail: email, now: now() });
    if (!result.valid) {
      const reason = result.errors.map(({ path, code }) => `${path}:${code}`).join(', ');
      throw new BootstrapError(`The customer API returned an invalid profile (${reason}).`, 'invalid_profile');
    }
    return result.profile;
  }

  async function loadCurrentProfile({ forceRefresh = false } = {}) {
    const startedGeneration = generation;
    let email = normalizeAccessEmail(await getUserEmail());
    let cached = email ? await readCachedProfile(email) : null;
    const denial = email ? await readDenial(email) : null;
    if (!forceRefresh && denial) {
      return createUnavailableAccessProfile(denial.status, {
        email,
        message: denial.message,
        cachedProfile: cached ? toPublicAccessProfile(cached, { loadedAt: now() }) : null
      });
    }
    if (!forceRefresh && email && cached && cached.expiresAt > now()) {
      return toPublicAccessProfile(cached, { loadedAt: now() });
    }
    try {
      const token = await getAuthToken();
      email = normalizeAccessEmail(await getUserEmail()) || email;
      if (!email) throw new BootstrapError('Sign in with Google before loading customer access.', 'logged_out');
      cached = await readCachedProfile(email);
      const profile = await requestBootstrap(token, email);
      if (startedGeneration !== generation || normalizeAccessEmail(await getUserEmail()) !== email) {
        return createUnavailableAccessProfile('logged_out', { message: 'The account changed during sign-in. Sign in again.' });
      }
      return storeVerifiedProfile(profile);
    } catch (error) {
      if (startedGeneration !== generation) return createUnavailableAccessProfile('logged_out');
      const status = error?.profileStatus || (email ? 'bootstrap_error' : 'logged_out');
      const message = error?.message || 'Customer access could not be verified.';
      const authoritativeDenial = ['identity_error', 'not_a_member', 'ambiguous_customer'].includes(status);
      if (email && authoritativeDenial) { await onScopeChange(); await storeDenial(email, error); }
      if (cached && cached.expiresAt > now() && !authoritativeDenial) {
        return toPublicAccessProfile(cached, { loadedAt: now() });
      }
      return createUnavailableAccessProfile(cached && !authoritativeDenial ? 'stale' : status, {
        email,
        message,
        cachedProfile: cached ? toPublicAccessProfile(cached, { loadedAt: now() }) : null
      });
    }
  }

  function getCurrentProfile(options = {}) {
    if (inFlightProfilePromise) {
      if (options.forceRefresh) return inFlightProfilePromise.then(() => getCurrentProfile(options));
      return inFlightProfilePromise;
    }
    inFlightProfilePromise = loadCurrentProfile(options).finally(() => {
      inFlightProfilePromise = null;
    });
    return inFlightProfilePromise;
  }

  async function getDisplayProfile() {
    const email = normalizeAccessEmail(await getUserEmail());
    if (!email) return createUnavailableAccessProfile('logged_out');
    const cached = await readCachedProfile(email);
    const denial = await readDenial(email);
    if (denial) {
      return createUnavailableAccessProfile(denial.status, {
        email,
        message: denial.message,
        cachedProfile: cached ? toPublicAccessProfile(cached, { loadedAt: now() }) : null
      });
    }
    if (!cached) return createUnavailableAccessProfile('logged_out', { email });
    if (cached.expiresAt <= now()) {
      return createUnavailableAccessProfile('stale', {
        email,
        message: 'The cached customer profile has expired.',
        cachedProfile: toPublicAccessProfile(cached, { loadedAt: now() })
      });
    }
    return toPublicAccessProfile(cached, { loadedAt: now() });
  }

  async function requirePermission(permission) {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile, permission)) {
      const detail = profile.status === 'stale'
        ? 'The cached customer profile is expired and the customer API could not be reached.'
        : profile.message || 'The verified customer profile does not grant this permission.';
      throw new Error(`Access denied: ${detail}`);
    }
    return profile;
  }

  async function requirePlatform(profile, platform) {
    if (!hasPlatformAccess(profile, platform)) {
      throw new Error(`Access denied: ${platform || 'This platform'} is not assigned to the verified customer profile.`);
    }
    return profile;
  }

  async function clearProfileCache() {
    inMemoryProfile = null;
    await localStorageArea.remove([CUSTOMER_ACCESS_PROFILE_CACHE_KEY, CUSTOMER_BOOTSTRAP_DENIAL_KEY]);
  }

  async function logout() {
    generation += 1;
    await onScopeChange();
    inMemoryProfile = null;
    inFlightProfilePromise = null;
    await Promise.all([
      localStorageArea.remove([
        CUSTOMER_ACCESS_PROFILE_CACHE_KEY,
        CUSTOMER_BOOTSTRAP_DENIAL_KEY,
        ...LEGACY_LOCAL_KEYS,
        ...CUSTOMER_SCOPED_LOCAL_KEYS
      ]),
      sessionStorageArea.remove([...LEGACY_SESSION_KEYS, ...CUSTOMER_SCOPED_SESSION_KEYS]),
      restoreManualConnectivity()
    ]);
    return { success: true };
  }

  async function listUsers() {
    throw new Error('Membership administration has moved to the customer API and is not available through workbook rows.');
  }

  async function updateUser() {
    throw new Error('Membership administration has moved to the customer API and is not available through workbook rows.');
  }

  return {
    bootstrap: () => getCurrentProfile({ forceRefresh: true }),
    clearProfileCache,
    getDisplayProfile,
    getCurrentProfile,
    listUsers,
    logout,
    requirePermission,
    requirePlatform,
    updateUser
  };
}
