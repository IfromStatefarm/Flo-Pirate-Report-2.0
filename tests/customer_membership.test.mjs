import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MembershipApiError,
  createCustomerMembershipService,
  validateMembershipMutation
} from '../services/customer_membership_service.js';

const ENDPOINT = 'https://api.example.com/v1/extension/memberships';

const ACTOR = Object.freeze({
  schemaVersion: 1,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 600000,
  permissions: ['settings.adminAccess'],
  status: 'ready',
  verification: 'verified',
  customerId: 'acme-sports',
  email: 'admin@acme.example',
  role: 'admin'
});

test('membership client rejects expired and permission-stripped Admin profiles before sending', async () => {
  const service = createService(() => assert.fail('Unauthorized request reached the network'));
  for (const profile of [{ ...ACTOR, expiresAt: Date.now() }, { ...ACTOR, permissions: [] }]) {
    await assert.rejects(service.listMembers(profile), { code: 'not_authorized' });
  }
});

const UTILIZATION = Object.freeze({
  activeUsers: { used: 37, limit: 50 },
  roles: {
    employee: { used: 30, limit: 42, enabled: true },
    manager: { used: 5, limit: 6, enabled: true },
    admin: { used: 2, limit: 2, enabled: true }
  }
});

function member(overrides = {}) {
  return {
    memberId: 'member_123',
    email: 'person@acme.example',
    name: 'Example Person',
    role: 'employee',
    status: 'active',
    version: 4,
    ...overrides
  };
}

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createService(fetchImpl, settings = { schemaVersion: 1, bootstrapEndpoint: 'https://api.example.com/v1/extension/bootstrap' }) {
  return createCustomerMembershipService({
    getAuthToken: async () => 'verified-google-token',
    fetchImpl,
    loadSettings: async () => settings
  });
}

test('lists only the acting customer members and returns authoritative utilization', async () => {
  let request;
  const service = createService(async (url, options) => {
    request = { url, options };
    return responseJson({
      protocolVersion: 1,
      customerId: ACTOR.customerId,
      configVersion: 8,
      members: [member()],
      utilization: UTILIZATION
    });
  });

  const result = await service.listMembers(ACTOR, 'person');
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, ENDPOINT);
  assert.equal(request.options.headers.Authorization, 'Bearer verified-google-token');
  assert.deepEqual(body, { protocolVersion: 1, operation: 'list_members', query: 'person' });
  assert.equal(Object.hasOwn(body, 'customerId'), false);
  assert.equal(result.utilization.activeUsers.used, 37);
  assert.equal(result.utilization.roles.admin.limit, 2);
  assert.equal(result.members[0].memberId, 'member_123');
});

test('sends fixed-field mutations without a client-controlled customer id', async () => {
  let body;
  const mutation = { action: 'change_role', memberId: 'member_123', expectedVersion: 4, role: 'manager' };
  const service = createService(async (_url, options) => {
    body = JSON.parse(options.body);
    return responseJson({
      protocolVersion: 1,
      customerId: ACTOR.customerId,
      configVersion: 9,
      member: member({ role: 'manager', version: 5 }),
      utilization: {
        ...UTILIZATION,
        roles: {
          ...UTILIZATION.roles,
          employee: { used: 29, limit: 42, enabled: true },
          manager: { used: 6, limit: 6, enabled: true }
        }
      },
      audit: {
        auditId: 'audit_456',
        action: 'change_role',
        actorEmail: ACTOR.email,
        targetMemberId: 'member_123',
        occurredAt: 1788462000000
      }
    });
  });

  const result = await service.mutateMember(ACTOR, mutation);

  assert.deepEqual(body, { protocolVersion: 1, operation: 'mutate_membership', mutation });
  assert.equal(JSON.stringify(body).includes('customerId'), false);
  assert.equal(result.member.role, 'manager');
  assert.equal(result.audit.auditId, 'audit_456');
  assert.equal(result.utilization.roles.manager.used, 6);
});

test('rejects customer reassignment and arbitrary mutation fields before network access', () => {
  assert.throws(
    () => validateMembershipMutation({
      action: 'activate',
      memberId: 'member_123',
      expectedVersion: 4,
      role: 'employee',
      customerId: 'another-customer'
    }),
    /customerId is not supported/
  );
});

test('rejects a membership response for a different customer', async () => {
  const service = createService(async () => responseJson({
    protocolVersion: 1,
    customerId: 'another-customer',
    configVersion: 8,
    members: [],
    utilization: UTILIZATION
  }));

  await assert.rejects(
    () => service.listMembers(ACTOR),
    (error) => error instanceof MembershipApiError && error.code === 'cross_customer_forbidden'
  );
});

test('rejects non-administrators before token or network access', async () => {
  let networkCalls = 0;
  let tokenCalls = 0;
  const service = createCustomerMembershipService({
    getAuthToken: async () => {
      tokenCalls += 1;
      return 'token';
    },
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error('should not run');
    },
    loadSettings: async () => ({ schemaVersion: 1, membershipEndpoint: ENDPOINT, bootstrapEndpoint: '' })
  });

  await assert.rejects(
    () => service.listMembers({ ...ACTOR, role: 'manager' }),
    (error) => error instanceof MembershipApiError && error.code === 'not_authorized'
  );
  assert.equal(tokenCalls, 0);
  assert.equal(networkCalls, 0);
});

test('surfaces authoritative cap and final-administrator failures with refreshed totals', async (t) => {
  for (const code of ['total_user_cap_exceeded', 'role_seat_cap_exceeded', 'final_admin_required']) {
    await t.test(code, async () => {
      const service = createService(async () => responseJson({
        error: { code, message: 'Server detail is not trusted UI copy.', utilization: UTILIZATION }
      }, 409));

      await assert.rejects(
        () => service.mutateMember(ACTOR, {
          action: 'disable',
          memberId: 'member_123',
          expectedVersion: 4
        }),
        (error) => error instanceof MembershipApiError &&
          error.code === code &&
          error.utilization?.activeUsers.used === 37
      );
    });
  }
});

test('rejects mutation success responses without a matching audit record', async () => {
  const service = createService(async () => responseJson({
    protocolVersion: 1,
    customerId: ACTOR.customerId,
    configVersion: 9,
    member: member({ status: 'disabled', version: 5 }),
    utilization: UTILIZATION,
    audit: {
      auditId: 'audit_789',
      action: 'disable',
      actorEmail: 'different-admin@acme.example',
      targetMemberId: 'member_123',
      occurredAt: 1788462000000
    }
  }));

  await assert.rejects(
    () => service.mutateMember(ACTOR, {
      action: 'disable',
      memberId: 'member_123',
      expectedVersion: 4
    }),
    /audit record does not match the acting administrator/
  );
});

test('requires approval to return the activated role and status', async () => {
  const service = createService(async () => responseJson({
    protocolVersion: 1,
    customerId: ACTOR.customerId,
    configVersion: 9,
    member: member({ role: 'manager', status: 'approved', version: 5 }),
    utilization: UTILIZATION,
    audit: {
      auditId: 'audit_approval',
      action: 'approve',
      actorEmail: ACTOR.email,
      targetMemberId: 'member_123',
      occurredAt: 1788462000000
    }
  }));

  await assert.rejects(
    () => service.mutateMember(ACTOR, {
      action: 'approve',
      memberId: 'member_123',
      expectedVersion: 4,
      role: 'manager'
    }),
    /status does not match the requested transition/
  );
});
