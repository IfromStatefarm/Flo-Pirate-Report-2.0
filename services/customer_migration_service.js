export const CUSTOMER_MIGRATION_SCHEMA_VERSION = 1;
export const CUSTOMER_MIGRATION_SETTINGS_PATH = 'config/customer_migration.json';
export const CUSTOMER_MIGRATION_PARITY_KEY = 'customer_migration_parity_v1';

const READ_MODES = new Set(['off', 'compare']);
const WRITE_MODES = new Set(['customer_api']);
const READ_KINDS = new Set(['scoreboard', 'intelligence']);
const CUSTOMER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_HISTORY_LIMIT = 500;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(`${label} contains unsupported fields.`);
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`${label} is missing a required field.`);
  return value;
}

export function validateCustomerMigrationSettings(candidate) {
  const value = exactKeys(candidate, [
    'schemaVersion', 'customerId', 'readMode', 'writeMode', 'requiredReadKinds',
    'requiredConsecutiveMatches', 'maxHistory'
  ], 'Customer migration settings');
  if (value.schemaVersion !== CUSTOMER_MIGRATION_SCHEMA_VERSION) throw new Error('Unsupported customer migration schema.');
  if (!CUSTOMER_ID_PATTERN.test(value.customerId)) throw new Error('Customer migration ID is invalid.');
  if (!READ_MODES.has(value.readMode)) throw new Error('Customer migration read mode is invalid.');
  if (!WRITE_MODES.has(value.writeMode)) throw new Error('Customer migration writes must use the customer API.');
  if (!Array.isArray(value.requiredReadKinds) || value.requiredReadKinds.length === 0) {
    throw new Error('Customer migration requires at least one read kind.');
  }
  const requiredReadKinds = [...new Set(value.requiredReadKinds)];
  if (requiredReadKinds.length !== value.requiredReadKinds.length || requiredReadKinds.some((kind) => !READ_KINDS.has(kind))) {
    throw new Error('Customer migration read kinds are invalid.');
  }
  if (!Number.isSafeInteger(value.requiredConsecutiveMatches) || value.requiredConsecutiveMatches < 1 || value.requiredConsecutiveMatches > 1000) {
    throw new Error('Customer migration parity threshold is invalid.');
  }
  if (!Number.isSafeInteger(value.maxHistory) || value.maxHistory < requiredReadKinds.length || value.maxHistory > MAX_HISTORY_LIMIT) {
    throw new Error('Customer migration history limit is invalid.');
  }
  return Object.freeze({ ...value, requiredReadKinds: Object.freeze(requiredReadKinds) });
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !['generatedAt', 'generated_at', 'lastUpdated', 'fetchedAt', '_provenance'].includes(key))
      .sort()
      .map((key) => [key, normalizeComparable(value[key])])
  );
}

async function digest(value) {
  const input = new TextEncoder().encode(JSON.stringify(normalizeComparable(value)));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mismatchPaths(left, right, path = '$', output = []) {
  if (output.length >= 25) return output;
  if (Object.is(left, right)) return output;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) output.push(path);
    const max = Math.min(Array.isArray(left) ? left.length : 0, Array.isArray(right) ? right.length : 0);
    for (let index = 0; index < max && output.length < 25; index += 1) {
      mismatchPaths(left[index], right[index], `${path}[${index}]`, output);
    }
    return output;
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      output.push(path);
      return output;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    keys.forEach((key) => mismatchPaths(left[key], right[key], `${path}.${key}`, output));
    return output;
  }
  output.push(path);
  return output;
}

function consecutiveMatches(history, kind) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.readKind !== kind) continue;
    if (!entry.matched) break;
    count += 1;
  }
  return count;
}

async function defaultLoadSettings(fetchImpl) {
  const response = await fetchImpl(chrome.runtime.getURL(CUSTOMER_MIGRATION_SETTINGS_PATH), { cache: 'no-store' });
  if (!response.ok) throw new Error('Customer migration settings could not be loaded.');
  return response.json();
}

export function createCustomerMigrationService({
  customerDataService,
  fetchImpl = fetch,
  loadSettings = () => defaultLoadSettings(fetchImpl),
  storageArea = chrome.storage.local,
  now = () => Date.now()
}) {
  let settingsPromise = null;

  async function getSettings() {
    if (!settingsPromise) {
      settingsPromise = Promise.resolve(loadSettings()).then(validateCustomerMigrationSettings).catch((error) => {
        settingsPromise = null;
        throw error;
      });
    }
    return settingsPromise;
  }

  async function readHistory(customerId) {
    const stored = await storageArea.get(CUSTOMER_MIGRATION_PARITY_KEY);
    const envelope = stored?.[CUSTOMER_MIGRATION_PARITY_KEY];
    if (!isPlainObject(envelope) || envelope.customerId !== customerId || !Array.isArray(envelope.history)) return [];
    return envelope.history;
  }

  async function saveResult(settings, result) {
    const history = [...await readHistory(settings.customerId), result].slice(-settings.maxHistory);
    await storageArea.set({
      [CUSTOMER_MIGRATION_PARITY_KEY]: {
        schemaVersion: CUSTOMER_MIGRATION_SCHEMA_VERSION,
        customerId: settings.customerId,
        history
      }
    });
    return history;
  }

  async function compareStatistics(profile, readKind, query, customerResult) {
    const settings = await getSettings();
    if (settings.readMode !== 'compare' || profile?.customerId !== settings.customerId || !READ_KINDS.has(readKind)) {
      return { compared: false, matched: false };
    }

    let result;
    try {
      const legacyResult = await customerDataService.queryLegacyStatistics(profile, readKind, query);
      if(customerResult?.data?._provenance?.source!=='customer_events' || legacyResult?.data?._provenance?.source!=='google_sheets') throw Object.assign(new Error('Independent source provenance is required.'),{code:'independent_source_required'});
      const customerValue = normalizeComparable(customerResult?.data);
      const legacyValue = normalizeComparable(legacyResult?.data);
      const [customerDigest, legacyDigest] = await Promise.all([digest(customerValue), digest(legacyValue)]);
      const differences = mismatchPaths(customerValue, legacyValue);
      result = {
        readKind,
        comparedAt: now(),
        matched: customerDigest === legacyDigest,
        customerDigest,
        legacyDigest,
        mismatchPaths: differences,
        errorCode: ''
      };
    } catch (error) {
      result = {
        readKind,
        comparedAt: now(),
        matched: false,
        customerDigest: '',
        legacyDigest: '',
        mismatchPaths: [],
        errorCode: String(error?.code || 'legacy_read_failed').slice(0, 64)
      };
    }
    const history = await saveResult(settings, result);
    return { compared: true, matched: result.matched, result, history };
  }

  async function getStatus(profile) {
    const settings = await getSettings();
    if (profile?.customerId !== settings.customerId) throw new Error('Migration status is outside the verified customer scope.');
    const history = await readHistory(settings.customerId);
    const consecutive = Object.fromEntries(
      settings.requiredReadKinds.map((kind) => [kind, consecutiveMatches(history, kind)])
    );
    const parityConfirmed = settings.requiredReadKinds.every(
      (kind) => consecutive[kind] >= settings.requiredConsecutiveMatches
    );
    return Object.freeze({
      customerId: settings.customerId,
      readMode: settings.readMode,
      writeMode: settings.writeMode,
      requiredReadKinds: [...settings.requiredReadKinds],
      requiredConsecutiveMatches: settings.requiredConsecutiveMatches,
      consecutiveMatches: consecutive,
      parityConfirmed,
      legacyFallbackRemovalAllowed: parityConfirmed && settings.readMode === 'off'
    });
  }

  return { compareStatistics, getSettings, getStatus };
}
