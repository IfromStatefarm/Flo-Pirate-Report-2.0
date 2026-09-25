import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { ApiError } from '../server/api_error.js';
import { enforceMembershipPolicy } from '../server/postgres_repository.js';
import { validateCustomerAccessProfile } from '../utils/access_control.js';

const CUSTOMER = JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 8, 4, 18, 0, 0);
const EXTENSION_ID = 'akgajganockbkkegachkcamnfnbpccnh';
const IDENTITY = Object.freeze({ subject: 'google-subject-1', email: 'ivan.mcclay@flosports.tv' });

function request() {
  return new Request('https://api.example.test/v1/extension/bootstrap', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' }
  });
}

function bootstrapBody(overrides = {}) {
  return {
    protocolVersion: 1,
    identity: { email: IDENTITY.email },
    extension: { id: EXTENSION_ID, version: '3.3.1' },
    ...overrides
  };
}

function resolution(role = 'manager', customerConfig = CUSTOMER) {
  return {
    count: 1,
    entitlementExpiresAt: NOW + 24 * 60 * 60 * 1000,
    customerConfig,
    member: {
      memberId: 'usr_9ffedc9ed3536dd81453fa16',
      email: IDENTITY.email,
      name: 'Ivan McClay',
      role,
      platforms: customerConfig.capabilities.enabledPlatforms
    }
  };
}

function actor(role = 'manager', customerConfig = CUSTOMER) {
  return {
    customerId: customerConfig.customerId,
    memberId: 'usr_9ffedc9ed3536dd81453fa16',
    email: IDENTITY.email,
    name: 'Ivan McClay',
    role,
    platforms: customerConfig.capabilities.enabledPlatforms,
    configVersion: customerConfig.configVersion,
    customerConfig
  };
}

function harness({ customerConfig = CUSTOMER, role = 'manager', count = 1 } = {}) {
  const calls = { events: [], queries: [] };
  const currentActor = actor(role, customerConfig);
  const repository = {
    async resolveActiveMembership() {
      return count === 1 ? resolution(role, customerConfig) : { count };
    },
    async requireActiveMember() {
      return currentActor;
    },
    async requireMemberPermission() {
      if (role !== 'admin') throw new ApiError(403, 'not_authorized', 'Administrator required.');
      return currentActor;
    },
    async listMembers() {
      return { protocolVersion: 1, customerId: customerConfig.customerId };
    },
    async mutateMembership() {
      return { protocolVersion: 1, customerId: customerConfig.customerId };
    },
    async recordEvent(_actor, event) {
      calls.events.push(event);
      return { event_id: event.event_id };
    },
    async queryStatistics(_actor, kind, query) {
      calls.queries.push({ kind, query });
      return { query_type: kind };
    }
  };
  const service = createCustomerApiService({
    repository,
    verifyIdentity: async () => IDENTITY,
    now: () => NOW,
    allowedExtensionIds: new Set([EXTENSION_ID])
  });
  return { calls, service };
}

test('bootstrap returns a short-lived, client-valid customer profile', async () => {
  const { service } = harness();
  const response = await service.bootstrap(request(), bootstrapBody());
  const result = validateCustomerAccessProfile(response.profile, { expectedEmail: IDENTITY.email, now: NOW });

  assert.equal(result.valid, true);
  assert.equal(response.profile.customerId, 'flosports');
  assert.equal(response.profile.expiresAt - response.profile.issuedAt, 10 * 60 * 1000);
  assert.ok(response.profile.permissions.includes('sidepanel.report'));
  assert.ok(response.profile.permissions.includes('sidepanel.automate'));
});

test('bootstrap rejects an unapproved extension build and ambiguous membership', async () => {
  const { service } = harness();
  await assert.rejects(
    service.bootstrap(request(), bootstrapBody({ extension: { id: 'not-approved', version: '3.3.1' } })),
    (error) => error instanceof ApiError && error.code === 'extension_not_allowed' && error.status === 403
  );

  const ambiguous = harness({ count: 2 }).service;
  await assert.rejects(
    ambiguous.bootstrap(request(), bootstrapBody()),
    (error) => error instanceof ApiError && error.code === 'ambiguous_customer' && error.status === 409
  );
});

test('data endpoint rejects cross-customer events and unsupported event fields', async () => {
  const { calls, service } = harness();
  const baseEvent = {
    event_id: 'evt_1',
    customer_id: 'other_customer',
    user_id: 'usr_9ffedc9ed3536dd81453fa16',
    event_type: 'report.submitted',
    occurred_at: NOW,
    attributes: { platform: 'youtube', url_count: 1 }
  };
  await assert.rejects(
    service.data(request(), { protocol_version: 1, operation: 'record_event', event: baseEvent }),
    (error) => error instanceof ApiError && error.code === 'scope_mismatch'
  );
  await assert.rejects(
    service.data(request(), {
      protocol_version: 1,
      operation: 'record_event',
      event: { ...baseEvent, customer_id: 'flosports', attributes: { platform: 'youtube', arbitrary_html: '<b>bad</b>' } }
    }),
    (error) => error instanceof ApiError && error.code === 'invalid_event'
  );
  assert.equal(calls.events.length, 0);
});

test('server permissions follow enabled customer features', async () => {
  const customerConfig = structuredClone(CUSTOMER);
  customerConfig.capabilities.enabledFeatures = ['report'];
  const { calls, service } = harness({ customerConfig });
  await assert.rejects(
    service.data(request(), {
      protocol_version: 1,
      operation: 'record_event',
      event: {
        event_id: 'evt_automation',
        customer_id: 'flosports',
        user_id: 'usr_9ffedc9ed3536dd81453fa16',
        event_type: 'automation.scan_started',
        occurred_at: NOW,
        attributes: { run_id: 'run_1', start_row: 1, duration_ms: 100 }
      }
    }),
    (error) => error instanceof ApiError && error.code === 'not_authorized'
  );
  assert.equal(calls.events.length, 0);
});

test('statistics queries require the exact bounded contract', async () => {
  const { calls, service } = harness();
  await assert.rejects(
    service.data(request(), {
      protocol_version: 1,
      operation: 'query_statistics',
      customer_id: 'flosports',
      user_id: 'usr_9ffedc9ed3536dd81453fa16',
      query_type: 'intelligence',
      query: {
        dashboard_id: 'stats_flosports',
        start_date: '2026-09-30',
        end_date: '2026-09-01',
        platforms: []
      }
    }),
    (error) => error instanceof ApiError && error.code === 'invalid_query'
  );
  assert.equal(calls.queries.length, 0);
});

test('membership policy enforces total, role, domain, and final-admin limits', () => {
  const admin = { member_id: 'admin_1', email: 'admin@flosports.tv', role: 'admin', status: 'active' };
  const employee = { member_id: 'employee_1', email: 'employee@flosports.tv', role: 'employee', status: 'active' };
  const pending = { member_id: 'pending_1', email: 'pending@flosports.tv', role: 'waiting_approval', status: 'pending' };
  const currentUtilization = {
    activeUsers: { used: 2, limit: 50 },
    roles: {
      employee: { used: 1, limit: 43, enabled: true },
      manager: { used: 0, limit: 5, enabled: true },
      admin: { used: 1, limit: 2, enabled: true }
    }
  };

  const totalCapConfig = structuredClone(CUSTOMER);
  totalCapConfig.access.totalUserCap = 2;
  assert.throws(
    () => enforceMembershipPolicy([admin, employee, pending], pending, { action: 'approve', role: 'employee' }, totalCapConfig, currentUtilization),
    (error) => error.code === 'total_user_cap_exceeded' && error.details.utilization === currentUtilization
  );

  const roleCapConfig = structuredClone(CUSTOMER);
  roleCapConfig.access.roleSeatCaps.employee = 1;
  assert.throws(
    () => enforceMembershipPolicy([admin, employee, pending], pending, { action: 'approve', role: 'employee' }, roleCapConfig, currentUtilization),
    (error) => error.code === 'role_seat_cap_exceeded'
  );

  assert.throws(
    () => enforceMembershipPolicy([admin, employee], admin, { action: 'change_role', role: 'employee' }, CUSTOMER, currentUtilization),
    (error) => error.code === 'final_admin_required'
  );

  const outsideDomain = { ...pending, email: 'pending@example.com' };
  assert.throws(
    () => enforceMembershipPolicy([admin, employee, outsideDomain], outsideDomain, { action: 'approve', role: 'manager' }, CUSTOMER, currentUtilization),
    (error) => error.code === 'domain_not_allowed'
  );
});
