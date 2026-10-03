import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { ApiError } from '../server/api_error.js';
import {
  listCustomers,
  updateCustomer,
  validateCustomerUpdateRequest
} from '../server/customer_management.js';

const FLOSPORTS = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url), 'utf8'));

function updateRequest(change = (config) => { config.product.displayName = 'FloSports Reporter 2'; }) {
  const config = structuredClone(FLOSPORTS);
  config.configVersion = 2;
  change(config);
  return {
    config,
    operator: { email: 'ivan.mcclay@flosports.tv' },
    expectedConfigVersion: 1
  };
}

class UpdateClient {
  constructor({ version = 1, members, failAudit = false } = {}) {
    this.version = version;
    this.members = members || [{
      member_id: 'usr_admin',
      email: 'ivan.mcclay@flosports.tv',
      role: 'admin',
      status: 'active'
    }];
    this.failAudit = failAudit;
    this.calls = [];
    this.released = false;
  }

  async query(sql, parameters = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: normalized, parameters });
    if (normalized.startsWith('SELECT customer_id, active, config_version, config FROM customers')) {
      const config = structuredClone(FLOSPORTS);
      config.configVersion = this.version;
      return { rows: [{
        customer_id: 'flosports',
        active: true,
        config_version: this.version,
        config
      }] };
    }
    if (normalized.startsWith('SELECT member_id, email, role, status FROM customer_memberships')) {
      return { rows: this.members };
    }
    if (normalized.startsWith('INSERT INTO customer_configuration_audit') && this.failAudit) {
      throw new Error('configuration audit failed');
    }
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakePool(client) {
  return { connect: async () => client };
}

test('customer directory returns safe validated summaries', async () => {
  const customers = await listCustomers({
    query: async () => ({ rows: [
      {
        customer_id: 'flosports',
        active: true,
        config_version: 1,
        config: FLOSPORTS,
        active_users: 3,
        active_administrators: 1,
        created_at: new Date('2026-09-01T00:00:00Z'),
        updated_at: new Date('2026-09-16T00:00:00Z')
      },
      {
        customer_id: 'broken',
        active: false,
        config_version: 9,
        config: { unexpected: true },
        active_users: 0,
        active_administrators: 0,
        created_at: new Date('2026-09-01T00:00:00Z'),
        updated_at: new Date('2026-09-02T00:00:00Z')
      }
    ] })
  });

  assert.deepEqual(customers[0], {
    customerId: 'flosports',
    displayName: FLOSPORTS.product.displayName,
    productName: FLOSPORTS.product.productName,
    active: true,
    configVersion: 1,
    configurationValid: true,
    activeUsers: 3,
    activeAdministrators: 1,
    totalUserCap: 50,
    administratorCap: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z'
  });
  assert.equal(customers[1].displayName, 'broken');
  assert.equal(customers[1].configurationValid, false);
  assert.equal(customers[1].totalUserCap, null);
});

test('customer directory search checks names, Wix accounts, allowed domains, and member emails', async () => {
  let statement;
  const customers = await listCustomers({
    query: async (sql, parameters) => {
      statement = { sql, parameters };
      return { rows: [] };
    }
  }, '  ivan.mcclay@flosports.tv  ');
  assert.deepEqual(customers, []);
  assert.deepEqual(statement.parameters, ['ivan.mcclay@flosports.tv']);
  for (const field of ["c.customer_id", "displayName", "productName", "billing_order_links", "b.account_id", "allowedEmailDomains", "customer_memberships member", "member.email"]) {
    assert.ok(statement.sql.includes(field), `missing searchable field: ${field}`);
  }
  assert.match(statement.sql, /lower\(\$1\)/);
});

test('customer updates require the fixed contract and exactly one new version', () => {
  assert.equal(validateCustomerUpdateRequest(updateRequest()).valid, true);

  const skippedVersion = updateRequest();
  skippedVersion.config.configVersion = 4;
  assert.ok(validateCustomerUpdateRequest(skippedVersion).errors.some((error) => error.code === 'invalid_version_increment'));

  const arbitraryField = updateRequest();
  arbitraryField.config.theme.customCss = 'body { display: none }';
  assert.ok(validateCustomerUpdateRequest(arbitraryField).errors.some((error) => error.code === 'unsupported_field'));

  const arbitraryOperatorField = updateRequest();
  arbitraryOperatorField.operator.password = 'not-allowed';
  assert.ok(validateCustomerUpdateRequest(arbitraryOperatorField).errors.some((error) => error.code === 'unsupported_field'));
});

test('customer update writes the config and audit together', async () => {
  const client = new UpdateClient();
  const result = await updateCustomer(fakePool(client), updateRequest(), {
    now: () => new Date('2026-09-16T20:00:00.000Z'),
    randomUUID: () => '11111111-2222-4333-8444-555555555555'
  });
  const statements = client.calls.map((call) => call.sql);
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements[1], 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE customers SET config_version')));
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO customer_configuration_audit')));
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(client.released, true);
  assert.equal(result.auditId, 'audit_11111111222243338444555555555555');
  assert.equal(result.configVersion, 2);
  assert.deepEqual(result.changedFields, ['product.displayName']);

  const audit = client.calls.find((call) => call.sql.startsWith('INSERT INTO customer_configuration_audit'));
  assert.equal(audit.parameters[1], 'flosports');
  assert.equal(audit.parameters[2], 'ivan.mcclay@flosports.tv');
  assert.equal(audit.parameters[3], 1);
  assert.equal(audit.parameters[4], 2);
  assert.match(audit.parameters[6], /^[a-f0-9]{64}$/);
});

test('customer update rejects stale edits and policies that conflict with active members', async () => {
  const stale = new UpdateClient({ version: 2 });
  await assert.rejects(
    updateCustomer(fakePool(stale), updateRequest()),
    (error) => error instanceof ApiError && error.code === 'stale_customer_config'
  );
  assert.equal(stale.calls.at(-1).sql, 'ROLLBACK');

  const members = [
    { member_id: 'usr_admin', email: 'admin@flosports.tv', role: 'admin', status: 'active' },
    { member_id: 'usr_employee', email: 'employee@flosports.tv', role: 'employee', status: 'active' }
  ];
  const capRequest = updateRequest((config) => {
    config.product.displayName = 'Smaller customer';
    config.access.totalUserCap = 1;
    config.access.roleSeatCaps = { employee: 1, manager: 1, admin: 1 };
  });
  const capConflict = new UpdateClient({ members });
  await assert.rejects(
    updateCustomer(fakePool(capConflict), capRequest),
    (error) => error instanceof ApiError
      && error.code === 'invalid_configuration_change'
      && error.details.validationErrors.some((item) => item.code === 'cap_below_utilization')
  );
  assert.equal(capConflict.calls.some((call) => call.sql.startsWith('UPDATE customers')), false);
  assert.equal(capConflict.calls.at(-1).sql, 'ROLLBACK');
});

test('customer update rolls back when its audit cannot be written', async () => {
  const client = new UpdateClient({ failAudit: true });
  await assert.rejects(updateCustomer(fakePool(client), updateRequest()), /configuration audit failed/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.calls.some((call) => call.sql === 'COMMIT'), false);
});
