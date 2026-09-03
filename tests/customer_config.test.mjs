import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CUSTOMER_CONFIG_SHEET_HEADERS,
  NEUTRAL_CUSTOMER_CONFIG,
  cloneNeutralCustomerConfig,
  resolveCustomerConfig,
  resolveCustomerConfigFromSheetRow,
  validateCustomerConfig
} from '../utils/customer_config.js';
import {
  CUSTOMER_CONFIG_STORAGE_KEY,
  createCustomerConfigService
} from '../services/customer_config_service.js';

function validCandidate() {
  const config = cloneNeutralCustomerConfig();
  config.customerId = 'acme-sports';
  config.configVersion = 7;
  config.product = {
    productName: 'Acme Rights Reporter',
    displayName: 'Acme Enforcement Center',
    shortName: 'Acme Reporter',
    assistantName: 'Acme Assistant',
    tagline: 'Protect Acme broadcasts and document outcomes.'
  };
  config.theme.logoUrl = 'https://cdn.example.com/acme-logo.png';
  config.theme.logoAltText = 'Acme Sports';
  config.legal = {
    ownerName: 'Acme Sports',
    companyName: 'Acme Sports, Inc.',
    reportingEmail: 'RIGHTS@EXAMPLE.COM',
    secondaryEmail: 'legal@example.com',
    phone: '+1 555 010 1000',
    originalWorkUrl: 'https://www.example.com/'
  };
  config.access = {
    allowedEmailDomains: ['@Example.com'],
    totalUserCap: 100,
    enabledRoles: ['employee', 'manager', 'admin'],
    roleSeatCaps: { employee: 80, manager: 15, admin: 5 }
  };
  config.capabilities = {
    enabledPlatforms: ['youtube', 'tiktok'],
    enabledFeatures: ['report', 'scoreboard', 'intel']
  };
  config.destinations = {
    driveRootFolderId: 'driveRoot_12345',
    reportSpreadsheetId: 'reportSheet_12345',
    eventSpreadsheetId: 'eventSheet_12345'
  };
  config.stats.dashboardId = 'stats_acme';
  return config;
}

function rowFor(candidate) {
  const values = {
    'Schema Version': candidate.schemaVersion,
    'Customer ID': candidate.customerId,
    'Configuration Version': candidate.configVersion,
    'Product Name': candidate.product.productName,
    'Display Name': candidate.product.displayName,
    'Short Name': candidate.product.shortName,
    'Assistant Name': candidate.product.assistantName,
    Tagline: candidate.product.tagline,
    'Logo URL': candidate.theme.logoUrl,
    'Logo Alt Text': candidate.theme.logoAltText,
    'Theme Primary': candidate.theme.colors.primary,
    'Theme Primary Hover': candidate.theme.colors.primaryHover,
    'Theme Accent': candidate.theme.colors.accent,
    'Theme On Primary': candidate.theme.colors.onPrimary,
    'Theme Background': candidate.theme.colors.background,
    'Theme Surface': candidate.theme.colors.surface,
    'Theme Text': candidate.theme.colors.text,
    'Theme Muted': candidate.theme.colors.muted,
    'Theme Border': candidate.theme.colors.border,
    'Theme Success': candidate.theme.colors.success,
    'Theme Warning': candidate.theme.colors.warning,
    'Theme Danger': candidate.theme.colors.danger,
    'Legal Owner Name': candidate.legal.ownerName,
    'Legal Company Name': candidate.legal.companyName,
    'Reporting Email': candidate.legal.reportingEmail,
    'Secondary Email': candidate.legal.secondaryEmail,
    'Reporting Phone': candidate.legal.phone,
    'Original Work URL': candidate.legal.originalWorkUrl,
    'Allowed Email Domains': candidate.access.allowedEmailDomains.join(','),
    'Enabled Platforms': candidate.capabilities.enabledPlatforms.join(','),
    'Enabled Features': candidate.capabilities.enabledFeatures.join(','),
    'Total User Cap': candidate.access.totalUserCap,
    'Enabled Roles': candidate.access.enabledRoles.join(','),
    'Employee Seat Cap': candidate.access.roleSeatCaps.employee,
    'Manager Seat Cap': candidate.access.roleSeatCaps.manager,
    'Admin Seat Cap': candidate.access.roleSeatCaps.admin,
    'Drive Root Folder ID': candidate.destinations.driveRootFolderId,
    'Report Spreadsheet ID': candidate.destinations.reportSpreadsheetId,
    'Event Spreadsheet ID': candidate.destinations.eventSpreadsheetId,
    'Stats Dashboard ID': candidate.stats.dashboardId
  };
  return CUSTOMER_CONFIG_SHEET_HEADERS.map((header) => values[header]);
}

function fakeStorage() {
  const state = {};
  return {
    state,
    async get(key) {
      return { [key]: state[key] };
    },
    async set(values) {
      Object.assign(state, values);
    },
    async remove(key) {
      delete state[key];
    }
  };
}

test('accepts and canonicalizes the fixed customer configuration contract', () => {
  const result = validateCustomerConfig(validCandidate());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.config.customerId, 'acme-sports');
  assert.equal(result.config.legal.reportingEmail, 'rights@example.com');
  assert.deepEqual(result.config.access.allowedEmailDomains, ['example.com']);
  assert.equal(result.config.theme.colors.primary, '#334155');
  assert.equal(Object.isFrozen(result.config), true);
});

test('documented neutral fallback mirrors the runtime constant', () => {
  const documented = JSON.parse(readFileSync(
    new URL('../docs/white-label/neutral-fallback.theme.json', import.meta.url),
    'utf8'
  ));
  assert.deepEqual(documented, cloneNeutralCustomerConfig());
});

test('rejects unsupported top-level and nested fields', () => {
  const candidate = validCandidate();
  candidate.customCss = 'body { display: none }';
  candidate.theme.javascript = 'alert(1)';

  const result = resolveCustomerConfig(candidate);
  assert.equal(result.usedFallback, true);
  assert.equal(result.config, NEUTRAL_CUSTOMER_CONFIG);
  assert.ok(result.errors.some(({ code }) => code === 'unsupported_field'));
  assert.equal('customCss' in result.config, false);
  assert.equal('javascript' in result.config.theme, false);
});

test('rejects markup, unsafe logo protocols, and invalid colors', () => {
  const candidate = validCandidate();
  candidate.product.displayName = '<img src=x onerror=alert(1)>';
  candidate.theme.logoUrl = 'javascript:alert(1)';
  candidate.theme.colors.primary = 'red; background:url(javascript:alert(1))';

  const result = resolveCustomerConfig(candidate);
  assert.equal(result.usedFallback, true);
  assert.ok(result.errors.some(({ code }) => code === 'unsafe_text'));
  assert.ok(result.errors.some(({ code }) => code === 'invalid_url'));
  assert.ok(result.errors.some(({ code }) => code === 'invalid_color'));
});

test('rejects unknown platforms, features, roles, and invalid seat caps', () => {
  const candidate = validCandidate();
  candidate.capabilities.enabledPlatforms.push('made-up-platform');
  candidate.capabilities.enabledFeatures.push('run_remote_code');
  candidate.access.enabledRoles.push('super_admin');
  candidate.access.roleSeatCaps.admin = 101;

  const result = resolveCustomerConfig(candidate);
  assert.equal(result.usedFallback, true);
  assert.ok(result.errors.some(({ code }) => code === 'unsupported_value'));
  assert.ok(result.errors.some(({ code }) => code === 'cap_exceeds_total'));
});

test('parses the exact spreadsheet header contract', () => {
  const candidate = validCandidate();
  const result = resolveCustomerConfigFromSheetRow(
    [...CUSTOMER_CONFIG_SHEET_HEADERS],
    rowFor(candidate)
  );

  assert.equal(result.usedFallback, false);
  assert.equal(result.source, 'customer-sheet');
  assert.equal(result.config.customerId, candidate.customerId);
  assert.deepEqual(result.config.capabilities.enabledPlatforms, ['youtube', 'tiktok']);
});

test('rejects spreadsheet columns outside the fixed contract', () => {
  const candidate = validCandidate();
  const headers = [...CUSTOMER_CONFIG_SHEET_HEADERS, 'Custom CSS'];
  const row = [...rowFor(candidate), 'body { color: red }'];
  const result = resolveCustomerConfigFromSheetRow(headers, row);

  assert.equal(result.usedFallback, true);
  assert.equal(result.config, NEUTRAL_CUSTOMER_CONFIG);
  assert.ok(result.errors.some(({ code }) => code === 'unsupported_header'));
});

test('service stores only validated canonical configuration and clears invalid candidates', async () => {
  const storage = fakeStorage();
  const service = createCustomerConfigService({ storageArea: storage });

  const stored = await service.storeCandidate(validCandidate());
  assert.equal(stored.usedFallback, false);
  assert.equal(storage.state[CUSTOMER_CONFIG_STORAGE_KEY].customerId, 'acme-sports');
  assert.equal('customCss' in storage.state[CUSTOMER_CONFIG_STORAGE_KEY], false);

  const invalid = validCandidate();
  invalid.theme.colors.primary = 'not-a-color';
  const rejected = await service.storeCandidate(invalid);
  assert.equal(rejected.usedFallback, true);
  assert.equal(storage.state[CUSTOMER_CONFIG_STORAGE_KEY], undefined);

  const current = await service.getCurrentConfig();
  assert.equal(current.usedFallback, true);
  assert.equal(current.config.product.productName, 'Rights Reporter');
});
