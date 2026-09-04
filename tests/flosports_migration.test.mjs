import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateMembershipMigration } from '../migrations/validate_membership_migration.js';
import {
  CUSTOMER_CONFIG_SHEET_HEADERS,
  customerConfigToSheetRow,
  resolveCustomerConfigFromSheetRow,
  validateCustomerConfig
} from '../utils/customer_config.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('FloSports customer fixture and fixed spreadsheet row pass the customer contract', () => {
  const customer = readJson('../migrations/flosports/customer.json');
  const sheetFixture = readJson('../migrations/flosports/customer-sheet-row.json');
  const validation = validateCustomerConfig(customer);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.deepEqual(sheetFixture.headers, CUSTOMER_CONFIG_SHEET_HEADERS);
  assert.deepEqual(sheetFixture.row, customerConfigToSheetRow(customer));
  const roundTrip = resolveCustomerConfigFromSheetRow(sheetFixture.headers, sheetFixture.row);
  assert.equal(roundTrip.usedFallback, false);
  assert.deepEqual(roundTrip.config, validation.config);
});

test('legacy memberships import without passwords and retain a guarded cutover', () => {
  const customer = readJson('../migrations/flosports/customer.json');
  const memberships = readJson('../migrations/flosports/memberships.json');
  const result = validateMembershipMigration(memberships, customer);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.normalized.memberships.length, 2);
  assert.equal(result.utilization.activeUsers, 1);
  assert.equal(result.utilization.roles.manager, 1);
  assert.equal(result.utilization.roles.admin, 0);
  assert.equal(result.normalized.memberships.every((member) => member.platforms.length === customer.capabilities.enabledPlatforms.length), true);
  assert.equal(JSON.stringify(result.normalized).toLowerCase().includes('password'), false);
  assert.equal(result.cutoverReady, false);
  assert.match(result.cutoverBlockers[0], /administrator/i);
  assert.equal(result.warnings.length, 1);
});

test('FloSports logo migration asset is pinned to the inventoried PNG', () => {
  const manifest = readJson('../migrations/flosports/asset-manifest.json');
  const logo = readFileSync(new URL('../FloReporter_logo.png', import.meta.url));
  const digest = crypto.createHash('sha256').update(logo).digest('hex');
  assert.equal(manifest.assets[0].sha256, digest);
  assert.equal(manifest.assets[0].mimeType, 'image/png');
});
