import { CUSTOMER_COLOR_TOKENS } from './customer_config.js';
import { PLATFORM_CATALOG } from './platform_catalog.js';

export const CUSTOMER_ACCESS_PROFILE_SCHEMA_VERSION = 1;
export const CUSTOMER_ACCESS_PROFILE_CACHE_KEY = 'customer_access_profile_v1';
export const CUSTOMER_ACCESS_PROFILE_MAX_TTL_MS = 15 * 60 * 1000;
export const CUSTOMER_ACCESS_PROFILE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const ACCESS_ROLES = Object.freeze({
  WAITING_APPROVAL: 'waiting_approval',
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  ADMIN: 'admin'
});

export const ACCESS_ROLE_OPTIONS = Object.freeze([
  ACCESS_ROLES.WAITING_APPROVAL,
  ACCESS_ROLES.EMPLOYEE,
  ACCESS_ROLES.MANAGER,
  ACCESS_ROLES.ADMIN
]);

export const ACCESS_ROLE_SHEET_VALUES = Object.freeze({
  [ACCESS_ROLES.EMPLOYEE]: 'Employee',
  [ACCESS_ROLES.ADMIN]: 'Admin',
  [ACCESS_ROLES.MANAGER]: 'Manager',
  [ACCESS_ROLES.WAITING_APPROVAL]: 'Waiting_Approval'
});

export const PERMISSIONS = Object.freeze({
  SIDEPANEL_REPORT: 'sidepanel.report',
  SIDEPANEL_SCOREBOARD: 'sidepanel.scoreboard',
  SIDEPANEL_AUTOMATE: 'sidepanel.automate',
  SIDEPANEL_INTEL: 'sidepanel.intel',
  SIDEPANEL_REPAIR: 'sidepanel.repair',
  SETTINGS_CORE_CONNECTIVITY: 'settings.coreConnectivity',
  SETTINGS_OPEN_LOCKER: 'settings.openLocker',
  SETTINGS_FEEDBACK_COMMS: 'settings.feedbackComms',
  SETTINGS_INTELLIGENCE_TOOLS: 'settings.intelligenceTools',
  SETTINGS_BRIEFING_STATS: 'settings.briefingStats',
  SETTINGS_BRIEFING_CONTENT: 'settings.briefingContent',
  SETTINGS_SELECTOR_PATHS: 'settings.selectorPaths',
  SETTINGS_ADMIN_ACCESS: 'settings.adminAccess'
});

const EMPLOYEE_PERMISSIONS = Object.freeze([
  PERMISSIONS.SIDEPANEL_REPORT,
  PERMISSIONS.SIDEPANEL_SCOREBOARD,
  PERMISSIONS.SETTINGS_CORE_CONNECTIVITY,
  PERMISSIONS.SETTINGS_FEEDBACK_COMMS
]);

const MANAGER_PERMISSIONS = Object.freeze([
  ...EMPLOYEE_PERMISSIONS,
  PERMISSIONS.SIDEPANEL_AUTOMATE,
  PERMISSIONS.SIDEPANEL_INTEL,
  PERMISSIONS.SETTINGS_OPEN_LOCKER,
  PERMISSIONS.SETTINGS_INTELLIGENCE_TOOLS,
  PERMISSIONS.SETTINGS_BRIEFING_STATS,
  PERMISSIONS.SETTINGS_BRIEFING_CONTENT
]);

export const ROLE_PERMISSIONS = Object.freeze({
  [ACCESS_ROLES.WAITING_APPROVAL]: Object.freeze([]),
  [ACCESS_ROLES.EMPLOYEE]: EMPLOYEE_PERMISSIONS,
  [ACCESS_ROLES.MANAGER]: MANAGER_PERMISSIONS,
  [ACCESS_ROLES.ADMIN]: Object.freeze([
    ...MANAGER_PERMISSIONS,
    PERMISSIONS.SIDEPANEL_REPAIR,
    PERMISSIONS.SETTINGS_SELECTOR_PATHS,
    PERMISSIONS.SETTINGS_ADMIN_ACCESS
  ])
});

const PROFILE_KEYS = Object.freeze([
  'schemaVersion', 'customerId', 'userId', 'configVersion', 'email', 'name', 'role',
  'permissions', 'platforms', 'theme', 'legal', 'integrations', 'issuedAt', 'expiresAt'
]);
const THEME_KEYS = Object.freeze([
  'productName', 'displayName', 'shortName', 'assistantName', 'tagline',
  'logoUrl', 'logoAltText', 'colors'
]);
const INTEGRATION_KEYS = Object.freeze([
  'driveRootFolderId', 'reportSpreadsheetId', 'eventSpreadsheetId', 'statsDashboardId'
]);
const LEGAL_KEYS = Object.freeze([
  'ownerName', 'companyName', 'reportingEmail', 'secondaryEmail', 'phone',
  'addressLine1', 'city', 'region', 'postalCode', 'country', 'originalWorkUrl'
]);
const PLATFORM_KEY_ALIASES = new Map();
const PLATFORM_KEYS = new Set();
const PERMISSION_KEYS = new Set(Object.values(PERMISSIONS));
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const CUSTOMER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const GOOGLE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{10,256}$/;
const DASHBOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u001F\u007F]/;

PLATFORM_CATALOG.forEach((entry) => {
  PLATFORM_KEYS.add(entry.key);
  PLATFORM_KEY_ALIASES.set(entry.key, entry.key);
  PLATFORM_KEY_ALIASES.set(entry.label.toLowerCase(), entry.key);
});
PLATFORM_KEY_ALIASES.set('x', 'twitter');
PLATFORM_KEY_ALIASES.set('x / twitter', 'twitter');
PLATFORM_KEY_ALIASES.set('other', 'other');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function requireObject(value, path, errors) {
  if (!isPlainObject(value)) {
    addError(errors, path, 'invalid_type', 'Expected an object with fixed fields.');
    return {};
  }
  return value;
}

function checkExactKeys(value, allowedKeys, path, errors) {
  const allowed = new Set(allowedKeys);
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, 'unsupported_field', 'Unsupported field.');
  });
  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addError(errors, `${path}.${key}`, 'missing_field', 'Required field is missing.');
    }
  });
}

function readText(value, path, errors, {
  maxLength = 160,
  required = true,
  allowFormulaPrefix = false
} = {}) {
  if (typeof value !== 'string') {
    addError(errors, path, 'invalid_type', 'Expected plain text.');
    return '';
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (required && !normalized) addError(errors, path, 'required', 'A value is required.');
  if (normalized.length > maxLength) addError(errors, path, 'too_long', `Must be ${maxLength} characters or fewer.`);
  if (UNSAFE_TEXT_PATTERN.test(value) || (!allowFormulaPrefix && /^[=+]/.test(normalized))) {
    addError(errors, path, 'unsafe_text', 'Markup, control characters, and formula-like text are not allowed.');
  }
  return normalized.slice(0, maxLength);
}

function readHttpsUrl(value, path, errors, { required = false } = {}) {
  const normalized = readText(value, path, errors, { maxLength: 2048, required });
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe');
    return parsed.href;
  } catch {
    addError(errors, path, 'invalid_url', 'Expected a credential-free HTTPS URL.');
    return '';
  }
}

function readPositiveInteger(value, path, errors) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    addError(errors, path, 'invalid_integer', 'Expected a positive integer.');
    return 1;
  }
  return number;
}

function readExactStringArray(value, path, errors, allowedValues, normalize = (item) => item) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'invalid_type', 'Expected a list.');
    return [];
  }
  const output = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      addError(errors, `${path}.${index}`, 'invalid_type', 'Expected plain text.');
      return;
    }
    const normalized = normalize(item);
    if (!allowedValues.has(normalized)) {
      addError(errors, `${path}.${index}`, 'unsupported_value', 'Unsupported value.');
      return;
    }
    if (output.includes(normalized)) {
      addError(errors, `${path}.${index}`, 'duplicate_value', 'Duplicate values are not allowed.');
      return;
    }
    output.push(normalized);
  });
  return output;
}

function validateTheme(value, errors) {
  const theme = requireObject(value, 'theme', errors);
  checkExactKeys(theme, THEME_KEYS, 'theme', errors);
  const colors = requireObject(theme.colors, 'theme.colors', errors);
  checkExactKeys(colors, CUSTOMER_COLOR_TOKENS, 'theme.colors', errors);
  const normalizedColors = {};
  CUSTOMER_COLOR_TOKENS.forEach((token) => {
    const color = typeof colors[token] === 'string' ? colors[token].trim().toUpperCase() : '';
    if (!HEX_COLOR_PATTERN.test(color)) {
      addError(errors, `theme.colors.${token}`, 'invalid_color', 'Expected a six-digit hexadecimal color.');
    }
    normalizedColors[token] = color;
  });
  return {
    productName: readText(theme.productName, 'theme.productName', errors, { maxLength: 80 }),
    displayName: readText(theme.displayName, 'theme.displayName', errors, { maxLength: 100 }),
    shortName: readText(theme.shortName, 'theme.shortName', errors, { maxLength: 24 }),
    assistantName: readText(theme.assistantName, 'theme.assistantName', errors, { maxLength: 60 }),
    tagline: readText(theme.tagline, 'theme.tagline', errors, { maxLength: 180 }),
    logoUrl: readHttpsUrl(theme.logoUrl, 'theme.logoUrl', errors),
    logoAltText: readText(theme.logoAltText, 'theme.logoAltText', errors, { maxLength: 120 }),
    colors: normalizedColors
  };
}

function validateIntegrations(value, errors) {
  const integrations = requireObject(value, 'integrations', errors);
  checkExactKeys(integrations, INTEGRATION_KEYS, 'integrations', errors);
  const output = {};
  INTEGRATION_KEYS.forEach((key) => {
    const id = readText(integrations[key], `integrations.${key}`, errors, { maxLength: 256 });
    const pattern = key === 'statsDashboardId' ? DASHBOARD_ID_PATTERN : GOOGLE_RESOURCE_ID_PATTERN;
    if (id && !pattern.test(id)) {
      addError(errors, `integrations.${key}`, 'invalid_identifier', 'Use only letters, numbers, underscores, and hyphens.');
    }
    output[key] = id;
  });
  return output;
}

function validateLegal(value, errors) {
  const legal = requireObject(value, 'legal', errors);
  checkExactKeys(legal, LEGAL_KEYS, 'legal', errors);
  const reportingEmail = normalizeAccessEmail(legal.reportingEmail);
  const secondaryEmail = normalizeAccessEmail(legal.secondaryEmail);
  if (!EMAIL_PATTERN.test(reportingEmail)) addError(errors, 'legal.reportingEmail', 'invalid_email', 'Expected a valid reporting email.');
  if (secondaryEmail && !EMAIL_PATTERN.test(secondaryEmail)) addError(errors, 'legal.secondaryEmail', 'invalid_email', 'Expected a valid secondary email.');
  return {
    ownerName: readText(legal.ownerName, 'legal.ownerName', errors, { maxLength: 120 }),
    companyName: readText(legal.companyName, 'legal.companyName', errors, { maxLength: 160 }),
    reportingEmail,
    secondaryEmail,
    phone: readText(legal.phone, 'legal.phone', errors, {
      maxLength: 40,
      required: false,
      allowFormulaPrefix: true
    }),
    addressLine1: readText(legal.addressLine1, 'legal.addressLine1', errors, { required: false, maxLength: 160 }),
    city: readText(legal.city, 'legal.city', errors, { required: false, maxLength: 80 }),
    region: readText(legal.region, 'legal.region', errors, { required: false, maxLength: 80 }),
    postalCode: readText(legal.postalCode, 'legal.postalCode', errors, { required: false, maxLength: 24 }),
    country: readText(legal.country, 'legal.country', errors, { required: false, maxLength: 80 }),
    originalWorkUrl: readHttpsUrl(legal.originalWorkUrl, 'legal.originalWorkUrl', errors, { required: true })
  };
}

export function normalizeAccessEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeAccessUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeAccessMiddleName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeAccessRole(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ACCESS_ROLE_OPTIONS.includes(normalized) ? normalized : ACCESS_ROLES.WAITING_APPROVAL;
}

export function formatAccessRole(role) {
  return ACCESS_ROLE_SHEET_VALUES[normalizeAccessRole(role)];
}

export function normalizeAccessPlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'all' || normalized === '*') return 'all';
  return PLATFORM_KEY_ALIASES.get(normalized) || '';
}

export function normalizeAccessPlatforms(value) {
  const rawValues = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/);
  const normalized = rawValues.map(normalizeAccessPlatform).filter(Boolean);
  if (normalized.includes('all')) return ['all'];
  return [...new Set(normalized)].sort();
}

export function getPermissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[normalizeAccessRole(role)] || [])];
}

export function validateCustomerAccessProfile(candidate, {
  expectedEmail = '',
  now = Date.now(),
  allowExpired = false
} = {}) {
  const errors = [];
  const input = requireObject(candidate, 'profile', errors);
  checkExactKeys(input, PROFILE_KEYS, 'profile', errors);
  if (Number(input.schemaVersion) !== CUSTOMER_ACCESS_PROFILE_SCHEMA_VERSION) {
    addError(errors, 'schemaVersion', 'unsupported_schema', `Expected schema version ${CUSTOMER_ACCESS_PROFILE_SCHEMA_VERSION}.`);
  }
  const customerId = typeof input.customerId === 'string' ? input.customerId.trim().toLowerCase() : '';
  if (!CUSTOMER_ID_PATTERN.test(customerId)) addError(errors, 'customerId', 'invalid_customer_id', 'Expected a lowercase customer slug.');
  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  if (!USER_ID_PATTERN.test(userId)) addError(errors, 'userId', 'invalid_user_id', 'Expected a stable opaque user identifier.');
  const email = normalizeAccessEmail(input.email);
  if (!EMAIL_PATTERN.test(email)) addError(errors, 'email', 'invalid_email', 'Expected a valid member email.');
  if (expectedEmail && email !== normalizeAccessEmail(expectedEmail)) {
    addError(errors, 'email', 'identity_mismatch', 'The profile does not match the verified Google identity.');
  }
  const suppliedRole = String(input.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const role = normalizeAccessRole(suppliedRole);
  if (![ACCESS_ROLES.EMPLOYEE, ACCESS_ROLES.MANAGER, ACCESS_ROLES.ADMIN].includes(suppliedRole)) {
    addError(errors, 'role', 'invalid_role', 'Expected an approved customer role.');
  }
  const permissions = readExactStringArray(input.permissions, 'permissions', errors, PERMISSION_KEYS, (item) => item.trim());
  const rolePermissions = new Set(ROLE_PERMISSIONS[role] || []);
  permissions.forEach((permission) => {
    if (!rolePermissions.has(permission)) addError(errors, 'permissions', 'permission_exceeds_role', 'A permission exceeds the retained role matrix.');
  });
  const platforms = readExactStringArray(input.platforms, 'platforms', errors, PLATFORM_KEYS, (item) => item.trim().toLowerCase());
  const issuedAt = Number(input.issuedAt);
  const expiresAt = Number(input.expiresAt);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + CUSTOMER_ACCESS_PROFILE_CLOCK_SKEW_MS) {
    addError(errors, 'issuedAt', 'invalid_timestamp', 'Invalid profile issue time.');
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
    addError(errors, 'expiresAt', 'invalid_timestamp', 'Invalid profile expiry time.');
  } else if (expiresAt - issuedAt > CUSTOMER_ACCESS_PROFILE_MAX_TTL_MS) {
    addError(errors, 'expiresAt', 'ttl_too_long', 'The profile lifetime exceeds fifteen minutes.');
  } else if (!allowExpired && expiresAt <= now) {
    addError(errors, 'expiresAt', 'expired', 'The profile has expired.');
  }
  const profile = {
    schemaVersion: CUSTOMER_ACCESS_PROFILE_SCHEMA_VERSION,
    customerId,
    userId,
    configVersion: readPositiveInteger(input.configVersion, 'configVersion', errors),
    email,
    name: readText(input.name, 'name', errors, { maxLength: 120 }),
    role,
    permissions,
    platforms,
    theme: validateTheme(input.theme, errors),
    legal: validateLegal(input.legal, errors),
    integrations: validateIntegrations(input.integrations, errors),
    issuedAt,
    expiresAt
  };
  return {
    valid: errors.length === 0,
    profile: errors.length === 0 ? deepFreeze(profile) : null,
    errors: deepFreeze(errors)
  };
}

export function toPublicAccessProfile(profile, { status = 'ready', verification = 'verified', loadedAt = Date.now() } = {}) {
  if (!profile) return null;
  const integrations = profile.integrations || {};
  return deepFreeze({
    ...profile,
    status,
    verification,
    loadedAt,
    managedConfig: {
      driveRootId: String(integrations.driveRootFolderId || ''),
      driveRootLabel: '',
      reportSheetId: String(integrations.reportSpreadsheetId || ''),
      reportSheetLabel: '',
      eventSheetId: String(integrations.eventSpreadsheetId || ''),
      eventSheetLabel: ''
    }
  });
}

export function createUnavailableAccessProfile(status, { email = '', message = '', cachedProfile = null } = {}) {
  if (cachedProfile) {
    return deepFreeze({
      ...cachedProfile,
      status,
      verification: 'stale',
      message: String(message || ''),
      loadedAt: Date.now()
    });
  }
  return deepFreeze({
    schemaVersion: CUSTOMER_ACCESS_PROFILE_SCHEMA_VERSION,
    customerId: '',
    configVersion: 0,
    email: normalizeAccessEmail(email),
    name: '',
    role: ACCESS_ROLES.WAITING_APPROVAL,
    permissions: [],
    platforms: [],
    theme: null,
    legal: null,
    integrations: null,
    managedConfig: {},
    issuedAt: 0,
    expiresAt: 0,
    status,
    verification: 'unverified',
    message: String(message || ''),
    loadedAt: Date.now()
  });
}

export function isVerifiedAccessProfile(profile, now = Date.now()) {
  return Boolean(
    profile &&
    profile.schemaVersion === CUSTOMER_ACCESS_PROFILE_SCHEMA_VERSION &&
    CUSTOMER_ID_PATTERN.test(String(profile.customerId || '')) &&
    profile.status === 'ready' &&
    profile.verification === 'verified' &&
    Number(profile.expiresAt) > now
  );
}

export function hasPermission(profile, permission) {
  if (!isVerifiedAccessProfile(profile)) return false;
  const rolePermissions = ROLE_PERMISSIONS[normalizeAccessRole(profile.role)] || [];
  return rolePermissions.includes(permission) && Array.isArray(profile.permissions) && profile.permissions.includes(permission);
}

export function hasPlatformAccess(profile, platform) {
  if (!isVerifiedAccessProfile(profile)) return false;
  const requestedPlatform = normalizeAccessPlatform(platform);
  if (!requestedPlatform || requestedPlatform === 'all') return false;
  return normalizeAccessPlatforms(profile.platforms).includes(requestedPlatform);
}

export function roleLabel(role) {
  return formatAccessRole(role);
}

export function isSafeSheetText(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && !/^[=+@]/.test(normalized);
}
