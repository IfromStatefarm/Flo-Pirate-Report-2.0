import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOMER_MIGRATION_PARITY_KEY,
  createCustomerMigrationService,
  validateCustomerMigrationSettings
} from '../services/customer_migration_service.js';

const PROFILE = Object.freeze({
  customerId: 'flosports',
  userId: 'user_123',
  status: 'ready',
  verification: 'verified'
});

function fakeStorage() {
  const state = {};
  return {
    state,
    async get(key) { return { [key]: state[key] }; },
    async set(values) { Object.assign(state, values); }
  };
}

function settings(overrides = {}) {
  return {
    schemaVersion: 1,
    customerId: 'flosports',
    readMode: 'compare',
    writeMode: 'customer_api',
    requiredReadKinds: ['scoreboard', 'intelligence'],
    requiredConsecutiveMatches: 2,
    maxHistory: 20,
    ...overrides
  };
}

test('migration settings force all writes through the customer API', () => {
  assert.equal(validateCustomerMigrationSettings(settings()).writeMode, 'customer_api');
  assert.throws(() => validateCustomerMigrationSettings(settings({ writeMode: 'legacy_sheet' })), /customer API/);
  assert.throws(() => validateCustomerMigrationSettings({ ...settings(), arbitrary: true }), /unsupported/);
});

test('comparison mode stores digests and paths without raw customer data', async () => {
  const storageArea = fakeStorage();
  const customerDataService = {
    async queryLegacyStatistics() {
      return { data: { _provenance: {source:'google_sheets'}, totals: { reports: 12 }, people: ['Sensitive Name'] } };
    }
  };
  const service = createCustomerMigrationService({
    customerDataService,
    storageArea,
    loadSettings: async () => settings(),
    now: () => 1_800_000_000_000
  });

  const result = await service.compareStatistics(
    PROFILE,
    'scoreboard',
    { period: 'current_month' },
    { data: { _provenance:{source:'customer_events'}, people: ['Sensitive Name'], totals: { reports: 13 } } }
  );

  assert.equal(result.compared, true);
  assert.equal(result.matched, false);
  assert.deepEqual(result.result.mismatchPaths, ['$.totals.reports']);
  const serialized = JSON.stringify(storageArea.state[CUSTOMER_MIGRATION_PARITY_KEY]);
  assert.equal(serialized.includes('Sensitive Name'), false);
  assert.equal(serialized.includes('reports'), true);
});

test('fallback removal remains blocked until parity passes and comparison is turned off', async () => {
  const storageArea = fakeStorage();
  const customerDataService = { async queryLegacyStatistics() { return { data: { _provenance:{source:'google_sheets'}, total: 1 } }; } };
  const service = createCustomerMigrationService({
    customerDataService,
    storageArea,
    loadSettings: async () => settings(),
    now: () => 1_800_000_000_000
  });

  for (const readKind of ['scoreboard', 'intelligence']) {
    for (let index = 0; index < 2; index += 1) {
      await service.compareStatistics(PROFILE, readKind, readKind === 'scoreboard'
        ? { period: 'current_month' }
        : { start_date: '2026-09-01', end_date: '2026-09-30', platforms: [] }, { data: { _provenance:{source:'customer_events'}, total: 1 } });
    }
  }
  const status = await service.getStatus(PROFILE);
  assert.equal(status.parityConfirmed, true);
  assert.equal(status.legacyFallbackRemovalAllowed, false);
});

test('identical values from the same or an unspecified source never prove parity',async()=>{
  for(const source of [undefined,'customer_events']) {
    const data={total:1,...(source?{_provenance:{source}}:{})};
    const service=createCustomerMigrationService({customerDataService:{queryLegacyStatistics:async()=>({data})},storageArea:fakeStorage(),loadSettings:async()=>settings()});
    const result=await service.compareStatistics(PROFILE,'scoreboard',{}, {data:{total:1,_provenance:{source:'customer_events'}}});
    assert.equal(result.matched,false);assert.equal(result.result.errorCode,'independent_source_required');
  }
});
