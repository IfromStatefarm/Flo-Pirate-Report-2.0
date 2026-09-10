import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { ApiError } from '../server/api_error.js';
import {
  customerMemberId,
  provisionCustomer,
  validateCustomerProvisioningRequest
} from '../server/customer_provisioning.js';
import { startCustomerSetupServer } from '../server/customer_setup_web.js';

const FLOSPORTS = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url), 'utf8'));

function setupRequest() {
  const config = structuredClone(FLOSPORTS);
  config.customerId = 'acme-sports';
  config.product.productName = 'Acme Rights Reporter';
  config.product.displayName = 'Acme Reporter';
  config.product.shortName = 'Acme';
  config.product.assistantName = 'Acme Reporting Assistant';
  config.theme.logoAltText = 'Acme Reporter';
  config.legal.ownerName = 'Acme Sports';
  config.legal.companyName = 'Acme Sports, Inc.';
  config.legal.reportingEmail = 'copyright@acme.example';
  config.legal.secondaryEmail = '';
  config.legal.originalWorkUrl = 'https://acme.example/';
  config.access.allowedEmailDomains = ['acme.example'];
  config.stats.dashboardId = 'stats_acme_sports';
  return {
    config,
    initialAdministrator: { email: 'admin@acme.example', name: 'Acme Administrator' },
    operator: { email: 'owner@example.com' }
  };
}

class FakeClient {
  constructor({ existingCustomer = false, existingMembership = false, failAudit = false } = {}) {
    this.existingCustomer = existingCustomer;
    this.existingMembership = existingMembership;
    this.failAudit = failAudit;
    this.calls = [];
    this.released = false;
  }

  async query(sql, parameters = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: normalized, parameters });
    if (normalized.startsWith('SELECT customer_id FROM customers')) {
      return { rows: this.existingCustomer ? [{ customer_id: 'acme-sports' }] : [] };
    }
    if (normalized.startsWith('SELECT customer_id, status FROM customer_memberships')) {
      return { rows: this.existingMembership ? [{ customer_id: 'other', status: 'active' }] : [] };
    }
    if (normalized.startsWith('INSERT INTO customer_provisioning_audit') && this.failAudit) {
      throw new Error('audit write failed');
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

test('customer setup validates the fixed config and initial administrator domain', () => {
  const request = setupRequest();
  const valid = validateCustomerProvisioningRequest(request);
  assert.equal(valid.valid, true);
  assert.equal(valid.request.initialAdministrator.email, 'admin@acme.example');
  assert.match(customerMemberId('acme-sports', 'admin@acme.example'), /^usr_[a-f0-9]{24}$/);
  assert.equal(
    customerMemberId('acme-sports', 'ADMIN@ACME.EXAMPLE'),
    customerMemberId('acme-sports', 'admin@acme.example')
  );

  const outsideDomain = setupRequest();
  outsideDomain.initialAdministrator.email = 'admin@outside.example';
  const invalidDomain = validateCustomerProvisioningRequest(outsideDomain);
  assert.equal(invalidDomain.valid, false);
  assert.ok(invalidDomain.errors.some((error) => error.code === 'domain_not_allowed'));

  const arbitraryField = setupRequest();
  arbitraryField.config.theme.customCss = 'body { display: none }';
  const invalidField = validateCustomerProvisioningRequest(arbitraryField);
  assert.equal(invalidField.valid, false);
  assert.ok(invalidField.errors.some((error) => error.code === 'unsupported_field'));
});

test('provisioning creates customer, first administrator, and audit before committing', async () => {
  const client = new FakeClient();
  const result = await provisionCustomer(fakePool(client), setupRequest(), {
    now: () => new Date('2026-09-10T14:00:00.000Z'),
    randomUUID: () => '11111111-2222-4333-8444-555555555555'
  });

  const statements = client.calls.map((call) => call.sql);
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements[1], 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO customers')));
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO customer_memberships')));
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO customer_provisioning_audit')));
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(client.released, true);
  assert.equal(result.customerId, 'acme-sports');
  assert.equal(result.administratorEmail, 'admin@acme.example');
  assert.equal(result.auditId, 'audit_11111111222243338444555555555555');
  assert.deepEqual(result.utilization.administrators, { used: 1, limit: 2 });

  const auditCall = client.calls.find((call) => call.sql.startsWith('INSERT INTO customer_provisioning_audit'));
  assert.equal(auditCall.parameters[1], 'acme-sports');
  assert.equal(auditCall.parameters[2], 'owner@example.com');
  assert.match(auditCall.parameters[6], /^[a-f0-9]{64}$/);
});

test('a failed audit rolls back the entire provisioning transaction', async () => {
  const client = new FakeClient({ failAudit: true });
  await assert.rejects(provisionCustomer(fakePool(client), setupRequest()), /audit write failed/);
  const statements = client.calls.map((call) => call.sql);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(client.released, true);
});

test('an existing customer or administrator is rejected without partial writes', async () => {
  const existingCustomer = new FakeClient({ existingCustomer: true });
  await assert.rejects(
    provisionCustomer(fakePool(existingCustomer), setupRequest()),
    (error) => error instanceof ApiError && error.code === 'customer_exists'
  );
  assert.equal(existingCustomer.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(existingCustomer.calls.some((call) => call.sql.startsWith('INSERT INTO customers')), false);

  const existingAdministrator = new FakeClient({ existingMembership: true });
  await assert.rejects(
    provisionCustomer(fakePool(existingAdministrator), setupRequest()),
    (error) => error instanceof ApiError && error.code === 'administrator_already_assigned'
  );
  assert.equal(existingAdministrator.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(existingAdministrator.calls.some((call) => call.sql.startsWith('INSERT INTO customers')), false);
});

function requestToForm(request, csrf) {
  const { config, initialAdministrator, operator } = request;
  const form = new URLSearchParams({
    csrf,
    'operator.email': operator.email,
    'initialAdministrator.name': initialAdministrator.name,
    'initialAdministrator.email': initialAdministrator.email,
    customerId: config.customerId,
    configVersion: String(config.configVersion),
    'product.productName': config.product.productName,
    'product.displayName': config.product.displayName,
    'product.shortName': config.product.shortName,
    'product.assistantName': config.product.assistantName,
    'product.tagline': config.product.tagline,
    'theme.logoUrl': config.theme.logoUrl,
    'theme.logoAltText': config.theme.logoAltText,
    'legal.ownerName': config.legal.ownerName,
    'legal.companyName': config.legal.companyName,
    'legal.reportingEmail': config.legal.reportingEmail,
    'legal.secondaryEmail': config.legal.secondaryEmail,
    'legal.phone': config.legal.phone,
    'legal.addressLine1': config.legal.addressLine1,
    'legal.city': config.legal.city,
    'legal.region': config.legal.region,
    'legal.postalCode': config.legal.postalCode,
    'legal.country': config.legal.country,
    'legal.originalWorkUrl': config.legal.originalWorkUrl,
    'access.allowedEmailDomains': config.access.allowedEmailDomains.join('\n'),
    'access.totalUserCap': String(config.access.totalUserCap),
    'access.employeeCap': String(config.access.roleSeatCaps.employee),
    'access.managerCap': String(config.access.roleSeatCaps.manager),
    'access.adminCap': String(config.access.roleSeatCaps.admin),
    'destinations.driveRootFolderId': config.destinations.driveRootFolderId,
    'destinations.reportSpreadsheetId': config.destinations.reportSpreadsheetId,
    'destinations.eventSpreadsheetId': config.destinations.eventSpreadsheetId,
    'stats.dashboardId': config.stats.dashboardId
  });
  for (const [token, color] of Object.entries(config.theme.colors)) form.set(`theme.${token}`, color);
  for (const role of config.access.enabledRoles) form.append('access.enabledRoles', role);
  for (const feature of config.capabilities.enabledFeatures) form.append('capabilities.enabledFeatures', feature);
  for (const platform of config.capabilities.enabledPlatforms) form.append('capabilities.enabledPlatforms', platform);
  return form;
}

test('the setup UI binds locally, requires CSRF, reviews, then provisions once', async (t) => {
  let provisioned = null;
  let server;
  try {
    server = await startCustomerSetupServer({
      pool: {},
      port: 0,
      operatorEmail: 'owner@example.com',
      provision: async (_pool, request) => {
        provisioned = request;
        return {
          auditId: 'audit_web_test',
          customerId: request.config.customerId,
          administratorEmail: request.initialAdministrator.email,
          utilization: {
            activeUsers: { used: 1, limit: request.config.access.totalUserCap },
            administrators: { used: 1, limit: request.config.access.roleSeatCaps.admin }
          }
        };
      }
    });
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('This sandbox does not permit binding a loopback test server.');
      return;
    }
    throw error;
  }
  t.after(() => server.close());

  const landing = await fetch(server.url);
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('content-security-policy'), /default-src 'none'/);
  const cookie = landing.headers.get('set-cookie');
  const html = await landing.text();
  const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
  assert.ok(csrf);
  assert.ok(cookie?.includes(`customer_setup_csrf=${csrf}`));
  assert.equal(html.includes('DATABASE_URL'), false);

  const crossOrigin = await fetch(new URL('/review', server.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Origin: 'https://attacker.example'
    },
    body: new URLSearchParams({ csrf })
  });
  assert.equal(crossOrigin.status, 403);

  const review = await fetch(new URL('/review', server.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Origin: new URL(server.url).origin
    },
    body: requestToForm(setupRequest(), csrf)
  });
  assert.equal(review.status, 200);
  const reviewHtml = await review.text();
  const confirmationToken = reviewHtml.match(/name="confirmationToken" value="([a-f0-9]+)"/)?.[1];
  assert.ok(confirmationToken);
  assert.equal(provisioned, null);

  const confirmed = await fetch(new URL('/provision', server.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Origin: new URL(server.url).origin
    },
    body: new URLSearchParams({ csrf, confirmationToken })
  });
  assert.equal(confirmed.status, 201);
  assert.equal(provisioned.config.customerId, 'acme-sports');
  assert.match(await confirmed.text(), /Customer created successfully/);

  const repeated = await fetch(new URL('/provision', server.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Origin: new URL(server.url).origin
    },
    body: new URLSearchParams({ csrf, confirmationToken })
  });
  assert.equal(repeated.status, 409);
});
