export const CUSTOMER_DATA_PROTOCOL_VERSION = 1;
export const CUSTOMER_DATA_SETTINGS_PATH = 'config/customer_bootstrap.json';

export const CUSTOMER_EVENT_TYPES = Object.freeze([
  'activity.item_added',
  'event.source_url_updated',
  'report.whitelist_penalty',
  'report.submitted',
  'report.intelligence_generated',
  'rogue.evidence_logged',
  'automation.scan_started',
  'automation.platform_outcome',
  'automation.row_status_changed',
  'automation.scan_completed',
  'platform.report_outcome'
]);

export const CUSTOMER_EVENT_ATTRIBUTE_KEYS = Object.freeze({
  'activity.item_added': ['platform', 'target_url', 'source_event_name', 'vertical'],
  'event.source_url_updated': ['platform', 'target_url', 'source_event_name', 'vertical'],
  'report.whitelist_penalty': ['platform', 'target_url', 'handle', 'source_event_name', 'vertical', 'scout_points'],
  'report.submitted': [
    'platform', 'urls', 'handle', 'source_event_name', 'vertical', 'report_id', 'mode',
    'url_count', 'estimated_views', 'scout_points', 'enforcer_points', 'pdf_url',
    'channel_url', 'content_type'
  ],
  'report.intelligence_generated': ['start_date', 'end_date', 'pdf_url'],
  'rogue.evidence_logged': [
    'target_url', 'domain', 'notes', 'evidence_url', 'network_observation_count',
    'embedded_video_count', 'iframe_count', 'email_count'
  ],
  'automation.scan_started': ['run_id', 'start_row', 'duration_ms'],
  'automation.platform_outcome': ['run_id', 'platform', 'target_url', 'outcome', 'row_index'],
  'automation.row_status_changed': [
    'run_id', 'row_index', 'previous_status', 'new_status', 'resolved_count',
    'active_count', 'enforcer_points'
  ],
  'automation.scan_completed': [
    'run_id', 'outcome', 'checked_count', 'resolved_count', 'active_count',
    'duration_ms', 'reason'
  ],
  'platform.report_outcome': [
    'platform', 'outcome', 'report_id', 'source_event_name', 'vertical', 'url_count', 'reason'
  ]
});

const TEXT_ATTRIBUTE_KEYS = new Set([
  'platform', 'handle', 'source_event_name', 'vertical', 'report_id', 'mode',
  'content_type', 'domain', 'notes', 'run_id', 'outcome', 'previous_status',
  'new_status', 'reason', 'start_date', 'end_date'
]);
const URL_ATTRIBUTE_KEYS = new Set(['target_url', 'pdf_url', 'channel_url', 'evidence_url']);
const INTEGER_ATTRIBUTE_KEYS = new Set([
  'url_count', 'estimated_views', 'scout_points', 'enforcer_points', 'row_index',
  'start_row', 'duration_ms', 'network_observation_count', 'embedded_video_count',
  'iframe_count', 'email_count', 'checked_count', 'resolved_count', 'active_count'
]);
const EVENT_TYPE_SET = new Set(CUSTOMER_EVENT_TYPES);
const CUSTOMER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const METRIC_KEY_PATTERN = /^[^<>\u0000-\u001F\u007F]{1,64}$/;
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u001F\u007F]/;
const MAX_EVENT_RESPONSE_BYTES = 64 * 1024;
const MAX_STATS_RESPONSE_BYTES = 1024 * 1024;

export class CustomerDataApiError extends Error {
  constructor(message, code = 'customer_data_error') {
    super(message);
    this.name = 'CustomerDataApiError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, path) {
  if (!isPlainObject(value)) throw new CustomerDataApiError(`${path} must be an object.`, 'invalid_data');
  const allowed = new Set(keys);
  const supplied = Object.keys(value);
  const extra = supplied.find((key) => !allowed.has(key));
  if (extra) throw new CustomerDataApiError(`${path}.${extra} is not supported.`, 'invalid_data');
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) throw new CustomerDataApiError(`${path}.${missing} is required.`, 'invalid_data');
  return value;
}

function textValue(value, path, { maxLength = 240, required = true } = {}) {
  if (typeof value !== 'string') throw new CustomerDataApiError(`${path} must be plain text.`, 'invalid_data');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (required && !normalized) throw new CustomerDataApiError(`${path} is required.`, 'invalid_data');
  if (normalized.length > maxLength || UNSAFE_TEXT_PATTERN.test(value) || /^[=+]/.test(normalized)) {
    throw new CustomerDataApiError(`${path} contains unsafe or oversized text.`, 'invalid_data');
  }
  return normalized;
}

function integerValue(value, path, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CustomerDataApiError(`${path} must be an integer of at least ${minimum}.`, 'invalid_data');
  }
  return value;
}

function webUrl(value, path, { required = true, httpsOnly = false } = {}) {
  if (!value && !required) return '';
  try {
    const parsed = new URL(String(value || '').trim());
    if ((httpsOnly ? parsed.protocol !== 'https:' : !['http:', 'https:'].includes(parsed.protocol)) ||
      parsed.username || parsed.password || parsed.hash) throw new Error('unsafe');
    return parsed.href;
  } catch {
    throw new CustomerDataApiError(`${path} must be a credential-free web URL.`, 'invalid_data');
  }
}

function validateEndpoint(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('unsafe');
    return parsed.href;
  } catch {
    throw new CustomerDataApiError('Customer data API is not configured with a credential-free HTTPS endpoint.', 'configuration_error');
  }
}

function resolveDataEndpoint(settings) {
  if (!isPlainObject(settings) || Number(settings.schemaVersion) !== CUSTOMER_DATA_PROTOCOL_VERSION) {
    throw new CustomerDataApiError('Customer API settings are invalid.', 'configuration_error');
  }
  const allowed = new Set(['schemaVersion', 'bootstrapEndpoint', 'membershipEndpoint', 'dataEndpoint']);
  if (Object.keys(settings).some((key) => !allowed.has(key))) {
    throw new CustomerDataApiError('Customer API settings contain unsupported fields.', 'configuration_error');
  }
  if (String(settings.dataEndpoint || '').trim()) return validateEndpoint(settings.dataEndpoint);
  const bootstrap = new URL(validateEndpoint(settings.bootstrapEndpoint));
  const segments = bootstrap.pathname.split('/').filter(Boolean);
  if (segments.length === 0) throw new CustomerDataApiError('A customer data endpoint could not be derived.', 'configuration_error');
  segments[segments.length - 1] = 'data';
  bootstrap.pathname = `/${segments.join('/')}`;
  return bootstrap.href;
}

async function defaultLoadSettings(fetchImpl) {
  const response = await fetchImpl(chrome.runtime.getURL(CUSTOMER_DATA_SETTINGS_PATH), { cache: 'no-store' });
  if (!response.ok) throw new CustomerDataApiError('Customer API settings could not be loaded.', 'configuration_error');
  return response.json();
}

function validateProfile(profile) {
  if (profile?.status !== 'ready' || profile?.verification !== 'verified') {
    throw new CustomerDataApiError('A current verified customer profile is required.', 'not_authorized');
  }
  if (!CUSTOMER_ID_PATTERN.test(String(profile.customerId || ''))) {
    throw new CustomerDataApiError('The customer identifier is invalid.', 'not_authorized');
  }
  if (!OPAQUE_ID_PATTERN.test(String(profile.userId || ''))) {
    throw new CustomerDataApiError('The user identifier is invalid.', 'not_authorized');
  }
  return profile;
}

function validateEventAttributes(eventType, candidate) {
  if (!isPlainObject(candidate)) throw new CustomerDataApiError('Event attributes must be an object.', 'invalid_event');
  const allowed = new Set(CUSTOMER_EVENT_ATTRIBUTE_KEYS[eventType]);
  const unsupported = Object.keys(candidate).find((key) => !allowed.has(key));
  if (unsupported) throw new CustomerDataApiError(`attributes.${unsupported} is not supported for ${eventType}.`, 'invalid_event');

  const result = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined || value === null || value === '') continue;
    if (TEXT_ATTRIBUTE_KEYS.has(key)) {
      result[key] = textValue(value, `attributes.${key}`, { maxLength: key === 'notes' ? 2000 : 240 });
    } else if (URL_ATTRIBUTE_KEYS.has(key)) {
      result[key] = webUrl(value, `attributes.${key}`, { httpsOnly: key !== 'target_url' });
    } else if (INTEGER_ATTRIBUTE_KEYS.has(key)) {
      result[key] = integerValue(value, `attributes.${key}`, {
        minimum: ['scout_points', 'enforcer_points'].includes(key) ? -1000000 : 0
      });
    } else if (key === 'urls') {
      if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
        throw new CustomerDataApiError('attributes.urls must contain 1-100 URLs.', 'invalid_event');
      }
      result.urls = value.map((url, index) => webUrl(url, `attributes.urls.${index}`));
    }
  }
  return Object.freeze(result);
}

export function buildCustomerEvent(profileCandidate, eventType, attributes, {
  eventId = crypto.randomUUID(),
  occurredAt = Date.now()
} = {}) {
  const profile = validateProfile(profileCandidate);
  if (!EVENT_TYPE_SET.has(eventType)) throw new CustomerDataApiError('The event type is unsupported.', 'invalid_event');
  if (!OPAQUE_ID_PATTERN.test(eventId)) throw new CustomerDataApiError('The event identifier is invalid.', 'invalid_event');
  return Object.freeze({
    event_id: eventId,
    customer_id: profile.customerId,
    user_id: profile.userId,
    event_type: eventType,
    occurred_at: integerValue(occurredAt, 'occurred_at', { minimum: 1 }),
    attributes: validateEventAttributes(eventType, attributes)
  });
}

async function parseJsonResponse(response, maxBytes) {
  const body = await response.text();
  if (!body || body.length > maxBytes) throw new CustomerDataApiError('Customer data API returned an empty or oversized response.', 'invalid_response');
  try {
    return JSON.parse(body);
  } catch {
    throw new CustomerDataApiError('Customer data API returned invalid JSON.', 'invalid_response');
  }
}

function validateScope(value, profile, path = 'response') {
  if (value.customer_id !== profile.customerId || value.user_id !== profile.userId) {
    throw new CustomerDataApiError(`${path} is outside the verified customer or user scope.`, 'scope_mismatch');
  }
}

function validateEventResponse(value, profile, event) {
  const response = exactObject(
    value,
    ['protocol_version', 'event_id', 'customer_id', 'user_id', 'accepted_at'],
    'response'
  );
  if (response.protocol_version !== CUSTOMER_DATA_PROTOCOL_VERSION) throw new CustomerDataApiError('Unsupported customer data protocol.', 'invalid_response');
  validateScope(response, profile);
  if (response.event_id !== event.event_id) throw new CustomerDataApiError('The accepted event does not match the submitted event.', 'invalid_response');
  integerValue(response.accepted_at, 'response.accepted_at', { minimum: 1 });
  return Object.freeze({ ...response });
}

function sanitizeMetricValue(value, path = 'data', depth = 0) {
  if (depth > 6) throw new CustomerDataApiError(`${path} is nested too deeply.`, 'invalid_response');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CustomerDataApiError(`${path} contains a non-finite number.`, 'invalid_response');
    return value;
  }
  if (typeof value === 'string') return textValue(value, path, { required: false, maxLength: 500 });
  if (Array.isArray(value)) {
    if (value.length > 2000) throw new CustomerDataApiError(`${path} is too large.`, 'invalid_response');
    return Object.freeze(value.map((item, index) => sanitizeMetricValue(item, `${path}.${index}`, depth + 1)));
  }
  if (!isPlainObject(value)) throw new CustomerDataApiError(`${path} contains an unsupported value.`, 'invalid_response');
  const entries = Object.entries(value);
  if (entries.length > 250) throw new CustomerDataApiError(`${path} has too many fields.`, 'invalid_response');
  const output = {};
  for (const [key, item] of entries) {
    if (!METRIC_KEY_PATTERN.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new CustomerDataApiError(`${path}.${key} is not a permitted metric field.`, 'invalid_response');
    }
    output[key] = sanitizeMetricValue(item, `${path}.${key}`, depth + 1);
  }
  return Object.freeze(output);
}

function validateStatisticsQuery(kind, query, profile) {
  const dashboardId = String(profile.integrations?.statsDashboardId || '').trim();
  if (!OPAQUE_ID_PATTERN.test(dashboardId)) throw new CustomerDataApiError('The customer statistics dashboard is not configured.', 'configuration_error');
  if (kind === 'scoreboard') {
    exactObject(query, ['period'], 'query');
    if (query.period !== 'current_month') throw new CustomerDataApiError('The scoreboard period is unsupported.', 'invalid_query');
    return { dashboard_id: dashboardId, period: 'current_month' };
  }
  if (kind === 'intelligence') {
    exactObject(query, ['start_date', 'end_date', 'platforms'], 'query');
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(query.start_date) || !datePattern.test(query.end_date)) {
      throw new CustomerDataApiError('Statistics dates must use YYYY-MM-DD.', 'invalid_query');
    }
    if (!Array.isArray(query.platforms) || query.platforms.length > 100) {
      throw new CustomerDataApiError('Statistics platforms must be a bounded list.', 'invalid_query');
    }
    return {
      dashboard_id: dashboardId,
      start_date: query.start_date,
      end_date: query.end_date,
      platforms: query.platforms.map((platform, index) => textValue(platform, `query.platforms.${index}`, { maxLength: 64 }))
    };
  }
  throw new CustomerDataApiError('The statistics query type is unsupported.', 'invalid_query');
}

function validateStatisticsResponse(value, profile, kind, dashboardId) {
  const response = exactObject(
    value,
    ['protocol_version', 'customer_id', 'user_id', 'dashboard_id', 'query_type', 'generated_at', 'data'],
    'response'
  );
  if (response.protocol_version !== CUSTOMER_DATA_PROTOCOL_VERSION || response.query_type !== kind) {
    throw new CustomerDataApiError('The statistics response protocol or query type is invalid.', 'invalid_response');
  }
  validateScope(response, profile);
  if (response.dashboard_id !== dashboardId) throw new CustomerDataApiError('The statistics response dashboard is outside the verified scope.', 'scope_mismatch');
  integerValue(response.generated_at, 'response.generated_at', { minimum: 1 });
  return Object.freeze({
    customerId: response.customer_id,
    userId: response.user_id,
    dashboardId: response.dashboard_id,
    generatedAt: response.generated_at,
    data: sanitizeMetricValue(response.data)
  });
}

export function createCustomerDataService({
  getAuthToken,
  fetchImpl = fetch,
  loadSettings = () => defaultLoadSettings(fetchImpl)
}) {
  let endpointPromise = null;

  async function getEndpoint() {
    if (!endpointPromise) {
      endpointPromise = Promise.resolve(loadSettings()).then(resolveDataEndpoint).catch((error) => {
        endpointPromise = null;
        throw error;
      });
    }
    return endpointPromise;
  }

  async function send(profileCandidate, body, maxBytes) {
    const profile = validateProfile(profileCandidate);
    const [endpoint, token] = await Promise.all([getEndpoint(), getAuthToken()]);
    if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) {
      throw new CustomerDataApiError('The Google identity token is unavailable.', 'identity_error');
    }
    const requestOptions = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    };
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetchImpl(endpoint, requestOptions);
      } catch (error) {
        if (attempt === 2) throw new CustomerDataApiError('Customer data API could not be reached.', 'network_error');
        await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** attempt)));
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** attempt)));
        continue;
      }
      break;
    }
    const parsed = await parseJsonResponse(response, maxBytes);
    if (!response.ok) {
      const code = typeof parsed?.error?.code === 'string' ? parsed.error.code : 'customer_data_error';
      throw new CustomerDataApiError('The customer data API rejected the request.', code);
    }
    return { parsed, profile };
  }

  async function recordEvent(profileCandidate, eventType, attributes, options) {
    const event = buildCustomerEvent(profileCandidate, eventType, attributes, options);
    const { parsed, profile } = await send(
      profileCandidate,
      { protocol_version: CUSTOMER_DATA_PROTOCOL_VERSION, operation: 'record_event', event },
      MAX_EVENT_RESPONSE_BYTES
    );
    return validateEventResponse(parsed, profile, event);
  }

  async function queryStatistics(profileCandidate, kind, candidateQuery) {
    const profile = validateProfile(profileCandidate);
    const query = validateStatisticsQuery(kind, candidateQuery, profile);
    const { parsed } = await send(
      profile,
      {
        protocol_version: CUSTOMER_DATA_PROTOCOL_VERSION,
        operation: 'query_statistics',
        customer_id: profile.customerId,
        user_id: profile.userId,
        query_type: kind,
        query
      },
      MAX_STATS_RESPONSE_BYTES
    );
    return validateStatisticsResponse(parsed, profile, kind, query.dashboard_id);
  }

  async function queryLegacyStatistics(profileCandidate, kind, candidateQuery) {
    const profile = validateProfile(profileCandidate);
    const query = validateStatisticsQuery(kind, candidateQuery, profile);
    const { parsed } = await send(
      profile,
      {
        protocol_version: CUSTOMER_DATA_PROTOCOL_VERSION,
        operation: 'query_legacy_statistics',
        customer_id: profile.customerId,
        user_id: profile.userId,
        query_type: kind,
        query
      },
      MAX_STATS_RESPONSE_BYTES
    );
    return validateStatisticsResponse(parsed, profile, kind, query.dashboard_id);
  }

  return { queryLegacyStatistics, queryStatistics, recordEvent };
}
