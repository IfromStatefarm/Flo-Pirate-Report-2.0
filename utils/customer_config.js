import { PLATFORM_CATALOG } from './platform_catalog.js';

export const CUSTOMER_CONFIG_SCHEMA_VERSION = 1;

export const CUSTOMER_FEATURES = Object.freeze([
  'report',
  'scoreboard',
  'automate',
  'intel',
  'repair',
  'feedback',
  'gamification',
  'briefing',
  'selector_editor'
]);

export const CUSTOMER_ROLES = Object.freeze(['employee', 'manager', 'admin']);

export const CUSTOMER_COLOR_TOKENS = Object.freeze([
  'primary',
  'primaryHover',
  'accent',
  'onPrimary',
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'success',
  'warning',
  'danger'
]);

export const CUSTOMER_CONFIG_SHEET_HEADERS = Object.freeze([
  'Schema Version',
  'Customer ID',
  'Configuration Version',
  'Product Name',
  'Display Name',
  'Short Name',
  'Assistant Name',
  'Tagline',
  'Logo URL',
  'Logo Alt Text',
  'Theme Primary',
  'Theme Primary Hover',
  'Theme Accent',
  'Theme On Primary',
  'Theme Background',
  'Theme Surface',
  'Theme Text',
  'Theme Muted',
  'Theme Border',
  'Theme Success',
  'Theme Warning',
  'Theme Danger',
  'Legal Owner Name',
  'Legal Company Name',
  'Reporting Email',
  'Secondary Email',
  'Reporting Phone',
  'Original Work URL',
  'Allowed Email Domains',
  'Enabled Platforms',
  'Enabled Features',
  'Total User Cap',
  'Enabled Roles',
  'Employee Seat Cap',
  'Manager Seat Cap',
  'Admin Seat Cap',
  'Drive Root Folder ID',
  'Report Spreadsheet ID',
  'Event Spreadsheet ID',
  'Stats Dashboard ID'
]);

const PLATFORM_KEYS = new Set(PLATFORM_CATALOG.map(({ key }) => key));
const FEATURE_KEYS = new Set(CUSTOMER_FEATURES);
const ROLE_KEYS = new Set(CUSTOMER_ROLES);
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const CUSTOMER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const GOOGLE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{10,256}$/;
const DASHBOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u001F\u007F]/;

const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'customerId',
  'configVersion',
  'product',
  'theme',
  'legal',
  'access',
  'capabilities',
  'destinations',
  'stats'
]);

const OBJECT_KEYS = Object.freeze({
  product: Object.freeze(['productName', 'displayName', 'shortName', 'assistantName', 'tagline']),
  theme: Object.freeze(['logoUrl', 'logoAltText', 'colors']),
  legal: Object.freeze(['ownerName', 'companyName', 'reportingEmail', 'secondaryEmail', 'phone', 'originalWorkUrl']),
  access: Object.freeze(['allowedEmailDomains', 'totalUserCap', 'enabledRoles', 'roleSeatCaps']),
  capabilities: Object.freeze(['enabledPlatforms', 'enabledFeatures']),
  destinations: Object.freeze(['driveRootFolderId', 'reportSpreadsheetId', 'eventSpreadsheetId']),
  stats: Object.freeze(['dashboardId'])
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const NEUTRAL_CUSTOMER_CONFIG = deepFreeze({
  schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
  customerId: 'default',
  configVersion: 1,
  product: {
    productName: 'Rights Reporter',
    displayName: 'Rights Reporter',
    shortName: 'Reporter',
    assistantName: 'Reporting Assistant',
    tagline: 'Capture evidence, manage reports, and track outcomes.'
  },
  theme: {
    logoUrl: '',
    logoAltText: 'Rights Reporter',
    colors: {
      primary: '#334155',
      primaryHover: '#1F2937',
      accent: '#2563EB',
      onPrimary: '#FFFFFF',
      background: '#F8FAFC',
      surface: '#FFFFFF',
      text: '#111827',
      muted: '#64748B',
      border: '#E5E7EB',
      success: '#166534',
      warning: '#B45309',
      danger: '#B91C1C'
    }
  },
  legal: {
    ownerName: '',
    companyName: '',
    reportingEmail: '',
    secondaryEmail: '',
    phone: '',
    originalWorkUrl: ''
  },
  access: {
    allowedEmailDomains: [],
    totalUserCap: 0,
    enabledRoles: [],
    roleSeatCaps: {
      employee: 0,
      manager: 0,
      admin: 0
    }
  },
  capabilities: {
    enabledPlatforms: [],
    enabledFeatures: []
  },
  destinations: {
    driveRootFolderId: '',
    reportSpreadsheetId: '',
    eventSpreadsheetId: ''
  },
  stats: {
    dashboardId: ''
  }
});

function addError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    addError(errors, path, 'unsupported_field', 'Contains one or more unsupported fields.');
  }
  allowedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addError(errors, `${path}.${key}`, 'missing_field', 'Required field is missing.');
    }
  });
}

function readPlainText(value, path, errors, {
  required = true,
  maxLength = 160,
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
    addError(errors, path, 'unsafe_text', 'HTML, control characters, and formula-like text are not allowed.');
  }
  return normalized.slice(0, maxLength);
}

function readPositiveVersion(value, path, errors) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    addError(errors, path, 'invalid_version', 'Expected a positive integer.');
    return 1;
  }
  return number;
}

function readCap(value, path, errors, { allowZero = false } = {}) {
  const number = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(number) || number < minimum || number > 100000) {
    addError(errors, path, 'invalid_cap', `Expected an integer from ${minimum} to 100000.`);
    return minimum;
  }
  return number;
}

function readHttpsUrl(value, path, errors, { required = false } = {}) {
  const normalized = readPlainText(value, path, errors, { required, maxLength: 2048 });
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      addError(errors, path, 'invalid_url', 'Only credential-free HTTPS URLs are allowed.');
      return '';
    }
    return parsed.href;
  } catch {
    addError(errors, path, 'invalid_url', 'Expected a valid HTTPS URL.');
    return '';
  }
}

function readEmail(value, path, errors, { required = true } = {}) {
  const normalized = readPlainText(value, path, errors, { required, maxLength: 254 }).toLowerCase();
  if (normalized && !EMAIL_PATTERN.test(normalized)) {
    addError(errors, path, 'invalid_email', 'Expected a valid email address.');
    return '';
  }
  return normalized;
}

function readStringArray(value, path, errors, { normalize, isAllowed, maxItems = 100 } = {}) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'invalid_type', 'Expected a list.');
    return [];
  }
  if (value.length > maxItems) addError(errors, path, 'too_many_items', `At most ${maxItems} values are allowed.`);

  const output = [];
  value.slice(0, maxItems).forEach((item) => {
    if (typeof item !== 'string') {
      addError(errors, path, 'invalid_item', 'Every list value must be plain text.');
      return;
    }
    const normalized = normalize(item);
    if (!normalized || !isAllowed(normalized)) {
      addError(errors, path, 'unsupported_value', 'Contains an unsupported value.');
      return;
    }
    if (!output.includes(normalized)) output.push(normalized);
  });
  return output;
}

function readResourceId(value, path, errors) {
  const normalized = readPlainText(value, path, errors, { maxLength: 256 });
  if (normalized && !GOOGLE_RESOURCE_ID_PATTERN.test(normalized)) {
    addError(errors, path, 'invalid_resource_id', 'Expected a Google Drive or Sheets resource ID.');
    return '';
  }
  return normalized;
}

function validateProduct(value, errors) {
  const product = requireObject(value, 'product', errors);
  checkExactKeys(product, OBJECT_KEYS.product, 'product', errors);
  return {
    productName: readPlainText(product.productName, 'product.productName', errors, { maxLength: 80 }),
    displayName: readPlainText(product.displayName, 'product.displayName', errors, { maxLength: 100 }),
    shortName: readPlainText(product.shortName, 'product.shortName', errors, { maxLength: 24 }),
    assistantName: readPlainText(product.assistantName, 'product.assistantName', errors, { maxLength: 60 }),
    tagline: readPlainText(product.tagline, 'product.tagline', errors, { maxLength: 180 })
  };
}

function validateTheme(value, errors) {
  const theme = requireObject(value, 'theme', errors);
  checkExactKeys(theme, OBJECT_KEYS.theme, 'theme', errors);
  const colors = requireObject(theme.colors, 'theme.colors', errors);
  checkExactKeys(colors, CUSTOMER_COLOR_TOKENS, 'theme.colors', errors);

  const normalizedColors = {};
  CUSTOMER_COLOR_TOKENS.forEach((token) => {
    const color = typeof colors[token] === 'string' ? colors[token].trim().toUpperCase() : '';
    if (!HEX_COLOR_PATTERN.test(color)) {
      addError(errors, `theme.colors.${token}`, 'invalid_color', 'Expected a six-digit hexadecimal color.');
    }
    normalizedColors[token] = HEX_COLOR_PATTERN.test(color)
      ? color
      : NEUTRAL_CUSTOMER_CONFIG.theme.colors[token];
  });

  return {
    logoUrl: readHttpsUrl(theme.logoUrl, 'theme.logoUrl', errors),
    logoAltText: readPlainText(theme.logoAltText, 'theme.logoAltText', errors, { maxLength: 120 }),
    colors: normalizedColors
  };
}

function validateLegal(value, errors) {
  const legal = requireObject(value, 'legal', errors);
  checkExactKeys(legal, OBJECT_KEYS.legal, 'legal', errors);
  return {
    ownerName: readPlainText(legal.ownerName, 'legal.ownerName', errors, { maxLength: 120 }),
    companyName: readPlainText(legal.companyName, 'legal.companyName', errors, { required: false, maxLength: 160 }),
    reportingEmail: readEmail(legal.reportingEmail, 'legal.reportingEmail', errors),
    secondaryEmail: readEmail(legal.secondaryEmail, 'legal.secondaryEmail', errors, { required: false }),
    phone: readPlainText(legal.phone, 'legal.phone', errors, {
      required: false,
      maxLength: 40,
      allowFormulaPrefix: true
    }),
    originalWorkUrl: readHttpsUrl(legal.originalWorkUrl, 'legal.originalWorkUrl', errors, { required: true })
  };
}

function validateAccess(value, errors) {
  const access = requireObject(value, 'access', errors);
  checkExactKeys(access, OBJECT_KEYS.access, 'access', errors);
  const totalUserCap = readCap(access.totalUserCap, 'access.totalUserCap', errors);
  const allowedEmailDomains = readStringArray(access.allowedEmailDomains, 'access.allowedEmailDomains', errors, {
    normalize: (item) => item.trim().toLowerCase().replace(/^@/, ''),
    isAllowed: (item) => DOMAIN_PATTERN.test(item),
    maxItems: 50
  });
  if (allowedEmailDomains.length === 0) {
    addError(errors, 'access.allowedEmailDomains', 'required', 'At least one allowed email domain is required.');
  }

  const enabledRoles = readStringArray(access.enabledRoles, 'access.enabledRoles', errors, {
    normalize: (item) => item.trim().toLowerCase().replace(/[\s-]+/g, '_'),
    isAllowed: (item) => ROLE_KEYS.has(item),
    maxItems: CUSTOMER_ROLES.length
  });
  if (!enabledRoles.includes('admin')) {
    addError(errors, 'access.enabledRoles', 'admin_required', 'The admin role must be enabled.');
  }

  const caps = requireObject(access.roleSeatCaps, 'access.roleSeatCaps', errors);
  checkExactKeys(caps, CUSTOMER_ROLES, 'access.roleSeatCaps', errors);
  const roleSeatCaps = {};
  CUSTOMER_ROLES.forEach((role) => {
    const enabled = enabledRoles.includes(role);
    const cap = readCap(caps[role], `access.roleSeatCaps.${role}`, errors, { allowZero: !enabled });
    if (!enabled && cap !== 0) {
      addError(errors, `access.roleSeatCaps.${role}`, 'disabled_role_cap', 'A disabled role must have a seat cap of zero.');
    }
    if (enabled && cap < 1) {
      addError(errors, `access.roleSeatCaps.${role}`, 'enabled_role_cap', 'An enabled role needs at least one seat.');
    }
    if (cap > totalUserCap) {
      addError(errors, `access.roleSeatCaps.${role}`, 'cap_exceeds_total', 'A role seat cap cannot exceed the total user cap.');
    }
    roleSeatCaps[role] = cap;
  });

  return { allowedEmailDomains, totalUserCap, enabledRoles, roleSeatCaps };
}

function validateCapabilities(value, errors) {
  const capabilities = requireObject(value, 'capabilities', errors);
  checkExactKeys(capabilities, OBJECT_KEYS.capabilities, 'capabilities', errors);
  const enabledPlatforms = readStringArray(capabilities.enabledPlatforms, 'capabilities.enabledPlatforms', errors, {
    normalize: (item) => item.trim().toLowerCase(),
    isAllowed: (item) => PLATFORM_KEYS.has(item),
    maxItems: PLATFORM_KEYS.size
  });
  const enabledFeatures = readStringArray(capabilities.enabledFeatures, 'capabilities.enabledFeatures', errors, {
    normalize: (item) => item.trim().toLowerCase().replace(/[\s-]+/g, '_'),
    isAllowed: (item) => FEATURE_KEYS.has(item),
    maxItems: CUSTOMER_FEATURES.length
  });
  if (enabledFeatures.length === 0) {
    addError(errors, 'capabilities.enabledFeatures', 'required', 'At least one feature must be enabled.');
  }
  if (enabledFeatures.includes('report') && enabledPlatforms.length === 0) {
    addError(errors, 'capabilities.enabledPlatforms', 'platform_required', 'Reporting requires at least one enabled platform.');
  }
  return { enabledPlatforms, enabledFeatures };
}

function validateDestinations(value, errors) {
  const destinations = requireObject(value, 'destinations', errors);
  checkExactKeys(destinations, OBJECT_KEYS.destinations, 'destinations', errors);
  return {
    driveRootFolderId: readResourceId(destinations.driveRootFolderId, 'destinations.driveRootFolderId', errors),
    reportSpreadsheetId: readResourceId(destinations.reportSpreadsheetId, 'destinations.reportSpreadsheetId', errors),
    eventSpreadsheetId: readResourceId(destinations.eventSpreadsheetId, 'destinations.eventSpreadsheetId', errors)
  };
}

function validateStats(value, errors) {
  const stats = requireObject(value, 'stats', errors);
  checkExactKeys(stats, OBJECT_KEYS.stats, 'stats', errors);
  const dashboardId = readPlainText(stats.dashboardId, 'stats.dashboardId', errors, { maxLength: 128 });
  if (dashboardId && !DASHBOARD_ID_PATTERN.test(dashboardId)) {
    addError(errors, 'stats.dashboardId', 'invalid_dashboard_id', 'Use only letters, numbers, underscores, and hyphens.');
    return { dashboardId: '' };
  }
  return { dashboardId };
}

export function validateCustomerConfig(candidate) {
  const errors = [];
  const input = requireObject(candidate, 'config', errors);
  checkExactKeys(input, TOP_LEVEL_KEYS, 'config', errors);

  const schemaVersion = Number(input.schemaVersion);
  if (schemaVersion !== CUSTOMER_CONFIG_SCHEMA_VERSION) {
    addError(errors, 'schemaVersion', 'unsupported_schema', `Expected schema version ${CUSTOMER_CONFIG_SCHEMA_VERSION}.`);
  }

  const customerId = typeof input.customerId === 'string' ? input.customerId.trim().toLowerCase() : '';
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    addError(errors, 'customerId', 'invalid_customer_id', 'Use 1-64 lowercase letters, numbers, underscores, or hyphens.');
  }

  const config = {
    schemaVersion: CUSTOMER_CONFIG_SCHEMA_VERSION,
    customerId,
    configVersion: readPositiveVersion(input.configVersion, 'configVersion', errors),
    product: validateProduct(input.product, errors),
    theme: validateTheme(input.theme, errors),
    legal: validateLegal(input.legal, errors),
    access: validateAccess(input.access, errors),
    capabilities: validateCapabilities(input.capabilities, errors),
    destinations: validateDestinations(input.destinations, errors),
    stats: validateStats(input.stats, errors)
  };

  return {
    valid: errors.length === 0,
    config: errors.length === 0 ? deepFreeze(config) : null,
    errors: deepFreeze(errors)
  };
}

export function resolveCustomerConfig(candidate, source = 'customer') {
  if (candidate == null) {
    return {
      config: NEUTRAL_CUSTOMER_CONFIG,
      source: 'neutral-fallback',
      usedFallback: true,
      errors: []
    };
  }

  const result = validateCustomerConfig(candidate);
  if (result.valid) {
    return {
      config: result.config,
      source,
      usedFallback: false,
      errors: []
    };
  }

  return {
    config: NEUTRAL_CUSTOMER_CONFIG,
    source: 'neutral-fallback',
    usedFallback: true,
    errors: result.errors
  };
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function splitSheetList(value) {
  return String(value || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function customerConfigCandidateFromSheetRow(headers, row) {
  const errors = [];
  if (!Array.isArray(headers) || !Array.isArray(row)) {
    return {
      candidate: null,
      errors: [{ path: 'sheet', code: 'invalid_type', message: 'Headers and row must both be lists.' }]
    };
  }

  const expectedHeaders = new Map(CUSTOMER_CONFIG_SHEET_HEADERS.map((header) => [normalizeHeader(header), header]));
  const indexes = new Map();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!expectedHeaders.has(normalized)) {
      addError(errors, 'sheet.headers', 'unsupported_header', 'The customer configuration sheet contains an unsupported header.');
      return;
    }
    if (indexes.has(normalized)) {
      addError(errors, 'sheet.headers', 'duplicate_header', 'The customer configuration sheet contains a duplicate header.');
      return;
    }
    indexes.set(normalized, index);
  });

  CUSTOMER_CONFIG_SHEET_HEADERS.forEach((header) => {
    if (!indexes.has(normalizeHeader(header))) {
      addError(errors, 'sheet.headers', 'missing_header', 'The customer configuration sheet is missing one or more required headers.');
    }
  });
  if (row.length > headers.length) {
    addError(errors, 'sheet.row', 'unexpected_cell', 'The customer configuration row has cells beyond the fixed header contract.');
  }
  if (errors.length > 0) return { candidate: null, errors: deepFreeze(errors) };

  const cell = (header) => row[indexes.get(normalizeHeader(header))] ?? '';
  const candidate = {
    schemaVersion: Number(cell('Schema Version')),
    customerId: String(cell('Customer ID')),
    configVersion: Number(cell('Configuration Version')),
    product: {
      productName: String(cell('Product Name')),
      displayName: String(cell('Display Name')),
      shortName: String(cell('Short Name')),
      assistantName: String(cell('Assistant Name')),
      tagline: String(cell('Tagline'))
    },
    theme: {
      logoUrl: String(cell('Logo URL')),
      logoAltText: String(cell('Logo Alt Text')),
      colors: {
        primary: String(cell('Theme Primary')),
        primaryHover: String(cell('Theme Primary Hover')),
        accent: String(cell('Theme Accent')),
        onPrimary: String(cell('Theme On Primary')),
        background: String(cell('Theme Background')),
        surface: String(cell('Theme Surface')),
        text: String(cell('Theme Text')),
        muted: String(cell('Theme Muted')),
        border: String(cell('Theme Border')),
        success: String(cell('Theme Success')),
        warning: String(cell('Theme Warning')),
        danger: String(cell('Theme Danger'))
      }
    },
    legal: {
      ownerName: String(cell('Legal Owner Name')),
      companyName: String(cell('Legal Company Name')),
      reportingEmail: String(cell('Reporting Email')),
      secondaryEmail: String(cell('Secondary Email')),
      phone: String(cell('Reporting Phone')),
      originalWorkUrl: String(cell('Original Work URL'))
    },
    access: {
      allowedEmailDomains: splitSheetList(cell('Allowed Email Domains')),
      totalUserCap: Number(cell('Total User Cap')),
      enabledRoles: splitSheetList(cell('Enabled Roles')),
      roleSeatCaps: {
        employee: Number(cell('Employee Seat Cap')),
        manager: Number(cell('Manager Seat Cap')),
        admin: Number(cell('Admin Seat Cap'))
      }
    },
    capabilities: {
      enabledPlatforms: splitSheetList(cell('Enabled Platforms')),
      enabledFeatures: splitSheetList(cell('Enabled Features'))
    },
    destinations: {
      driveRootFolderId: String(cell('Drive Root Folder ID')),
      reportSpreadsheetId: String(cell('Report Spreadsheet ID')),
      eventSpreadsheetId: String(cell('Event Spreadsheet ID'))
    },
    stats: {
      dashboardId: String(cell('Stats Dashboard ID'))
    }
  };

  return { candidate, errors: [] };
}

export function resolveCustomerConfigFromSheetRow(headers, row) {
  const parsed = customerConfigCandidateFromSheetRow(headers, row);
  if (!parsed.candidate) {
    return {
      config: NEUTRAL_CUSTOMER_CONFIG,
      source: 'neutral-fallback',
      usedFallback: true,
      errors: parsed.errors
    };
  }
  return resolveCustomerConfig(parsed.candidate, 'customer-sheet');
}

export function cloneNeutralCustomerConfig() {
  return clone(NEUTRAL_CUSTOMER_CONFIG);
}
