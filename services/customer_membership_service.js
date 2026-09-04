export const CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION = 1;
export const CUSTOMER_MEMBERSHIP_SETTINGS_PATH = 'config/customer_bootstrap.json';

export const MEMBERSHIP_ACTIONS = Object.freeze([
  'approve',
  'activate',
  'reactivate',
  'change_role',
  'disable'
]);

export const MEMBERSHIP_ERROR_MESSAGES = Object.freeze({
  total_user_cap_exceeded: 'This change would exceed the customer active-user limit.',
  role_seat_cap_exceeded: 'This change would exceed the selected role seat limit.',
  final_admin_required: 'The customer must retain at least one active administrator.',
  cross_customer_forbidden: 'Users cannot be moved between customers from the extension.',
  stale_member_version: 'This membership changed elsewhere. Refresh and try again.',
  not_authorized: 'Only a verified administrator for this customer can make this change.',
  member_not_found: 'The selected customer member no longer exists.',
  role_disabled: 'The selected role is not enabled for this customer.',
  invalid_request: 'The membership request was rejected as invalid.',
  identity_error: 'The customer API could not verify the acting Google identity.',
  conflict: 'The membership could not be changed because of a conflicting update.'
});

const ROLE_VALUES = new Set(['waiting_approval', 'employee', 'manager', 'admin']);
const ASSIGNABLE_ROLES = new Set(['employee', 'manager', 'admin']);
const STATUS_VALUES = new Set(['pending', 'approved', 'active', 'disabled']);
const ACTION_VALUES = new Set(MEMBERSHIP_ACTIONS);
const ERROR_CODES = new Set(Object.keys(MEMBERSHIP_ERROR_MESSAGES));
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CUSTOMER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u001F\u007F]/;
const MAX_RESPONSE_BYTES = 256 * 1024;

export class MembershipApiError extends Error {
  constructor(message, code = 'membership_api_error', utilization = null) {
    super(message);
    this.name = 'MembershipApiError';
    this.code = code;
    this.utilization = utilization;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowedKeys, path) {
  if (!isPlainObject(value)) throw new MembershipApiError(`${path} must be an object.`, 'invalid_response');
  const allowed = new Set(allowedKeys);
  const supplied = Object.keys(value);
  const unsupported = supplied.find((key) => !allowed.has(key));
  if (unsupported) throw new MembershipApiError(`${path}.${unsupported} is not supported.`, 'invalid_response');
  const missing = allowedKeys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) throw new MembershipApiError(`${path}.${missing} is required.`, 'invalid_response');
  return value;
}

function readText(value, path, { required = true, maxLength = 160 } = {}) {
  if (typeof value !== 'string') throw new MembershipApiError(`${path} must be plain text.`, 'invalid_response');
  const text = value.trim().replace(/\s+/g, ' ');
  if (required && !text) throw new MembershipApiError(`${path} is required.`, 'invalid_response');
  if (text.length > maxLength || UNSAFE_TEXT_PATTERN.test(value) || /^[=+]/.test(text)) {
    throw new MembershipApiError(`${path} contains unsafe or oversized text.`, 'invalid_response');
  }
  return text;
}

function readInteger(value, path, { minimum = 0 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new MembershipApiError(`${path} must be an integer of at least ${minimum}.`, 'invalid_response');
  }
  return number;
}

function validateEndpoint(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('unsafe');
    return parsed.href;
  } catch {
    throw new MembershipApiError('Customer membership administration is not configured with a credential-free HTTPS endpoint.', 'configuration_error');
  }
}

function deriveMembershipEndpoint(settings) {
  if (!isPlainObject(settings) || Number(settings.schemaVersion) !== CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION) {
    throw new MembershipApiError('Customer API settings are invalid.', 'configuration_error');
  }
  const allowed = new Set(['schemaVersion', 'bootstrapEndpoint', 'membershipEndpoint', 'dataEndpoint']);
  if (Object.keys(settings).some((key) => !allowed.has(key))) {
    throw new MembershipApiError('Customer API settings contain unsupported fields.', 'configuration_error');
  }
  if (String(settings.membershipEndpoint || '').trim()) return validateEndpoint(settings.membershipEndpoint);
  const bootstrapEndpoint = new URL(validateEndpoint(settings.bootstrapEndpoint));
  const segments = bootstrapEndpoint.pathname.split('/').filter(Boolean);
  if (segments.length === 0) throw new MembershipApiError('A membership endpoint could not be derived.', 'configuration_error');
  segments[segments.length - 1] = 'memberships';
  bootstrapEndpoint.pathname = `/${segments.join('/')}`;
  return bootstrapEndpoint.href;
}

async function defaultLoadSettings(fetchImpl) {
  const response = await fetchImpl(chrome.runtime.getURL(CUSTOMER_MEMBERSHIP_SETTINGS_PATH), { cache: 'no-store' });
  if (!response.ok) throw new MembershipApiError('Customer API settings could not be loaded.', 'configuration_error');
  return response.json();
}

function validateCounter(value, path, { withEnabled = false } = {}) {
  const keys = withEnabled ? ['used', 'limit', 'enabled'] : ['used', 'limit'];
  const counter = assertExactKeys(value, keys, path);
  const output = {
    used: readInteger(counter.used, `${path}.used`),
    limit: readInteger(counter.limit, `${path}.limit`)
  };
  if (withEnabled) {
    if (typeof counter.enabled !== 'boolean') throw new MembershipApiError(`${path}.enabled must be boolean.`, 'invalid_response');
    output.enabled = counter.enabled;
  }
  return Object.freeze(output);
}

export function validateMembershipUtilization(value) {
  const utilization = assertExactKeys(value, ['activeUsers', 'roles'], 'utilization');
  const roles = assertExactKeys(utilization.roles, ['employee', 'manager', 'admin'], 'utilization.roles');
  return Object.freeze({
    activeUsers: validateCounter(utilization.activeUsers, 'utilization.activeUsers'),
    roles: Object.freeze({
      employee: validateCounter(roles.employee, 'utilization.roles.employee', { withEnabled: true }),
      manager: validateCounter(roles.manager, 'utilization.roles.manager', { withEnabled: true }),
      admin: validateCounter(roles.admin, 'utilization.roles.admin', { withEnabled: true })
    })
  });
}

function validateMember(value, path = 'member') {
  const member = assertExactKeys(value, ['memberId', 'email', 'name', 'role', 'status', 'version'], path);
  const memberId = readText(member.memberId, `${path}.memberId`, { maxLength: 128 });
  if (!MEMBER_ID_PATTERN.test(memberId)) throw new MembershipApiError(`${path}.memberId is invalid.`, 'invalid_response');
  const email = String(member.email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new MembershipApiError(`${path}.email is invalid.`, 'invalid_response');
  const role = readText(member.role, `${path}.role`, { maxLength: 32 }).toLowerCase();
  const status = readText(member.status, `${path}.status`, { maxLength: 32 }).toLowerCase();
  if (!ROLE_VALUES.has(role)) throw new MembershipApiError(`${path}.role is unsupported.`, 'invalid_response');
  if (!STATUS_VALUES.has(status)) throw new MembershipApiError(`${path}.status is unsupported.`, 'invalid_response');
  return Object.freeze({
    memberId,
    email,
    name: readText(member.name, `${path}.name`, { maxLength: 120 }),
    role,
    status,
    version: readInteger(member.version, `${path}.version`, { minimum: 1 })
  });
}

function validateCustomerEnvelope(value, expectedCustomerId, allowedKeys) {
  const envelope = assertExactKeys(value, allowedKeys, 'response');
  if (Number(envelope.protocolVersion) !== CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION) {
    throw new MembershipApiError('The membership API protocol version is unsupported.', 'invalid_response');
  }
  const customerId = readText(envelope.customerId, 'response.customerId', { maxLength: 64 }).toLowerCase();
  if (!CUSTOMER_ID_PATTERN.test(customerId) || customerId !== expectedCustomerId) {
    throw new MembershipApiError('The membership response does not match the acting administrator customer.', 'cross_customer_forbidden');
  }
  return { envelope, customerId };
}

export function validateMembershipListResponse(value, expectedCustomerId) {
  const { envelope, customerId } = validateCustomerEnvelope(
    value,
    expectedCustomerId,
    ['protocolVersion', 'customerId', 'configVersion', 'members', 'utilization']
  );
  if (!Array.isArray(envelope.members) || envelope.members.length > 1000) {
    throw new MembershipApiError('response.members must be a bounded list.', 'invalid_response');
  }
  return Object.freeze({
    protocolVersion: CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION,
    customerId,
    configVersion: readInteger(envelope.configVersion, 'response.configVersion', { minimum: 1 }),
    members: Object.freeze(envelope.members.map((member, index) => validateMember(member, `response.members.${index}`))),
    utilization: validateMembershipUtilization(envelope.utilization)
  });
}

function validateAudit(value, expectedAction, targetMemberId, expectedActorEmail = '') {
  const audit = assertExactKeys(value, ['auditId', 'action', 'actorEmail', 'targetMemberId', 'occurredAt'], 'response.audit');
  const action = readText(audit.action, 'response.audit.action', { maxLength: 32 });
  if (action !== expectedAction || audit.targetMemberId !== targetMemberId) {
    throw new MembershipApiError('The audit record does not match the requested mutation.', 'invalid_response');
  }
  const actorEmail = String(audit.actorEmail || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(actorEmail)) throw new MembershipApiError('response.audit.actorEmail is invalid.', 'invalid_response');
  if (expectedActorEmail && actorEmail !== String(expectedActorEmail).trim().toLowerCase()) {
    throw new MembershipApiError('The audit record does not match the acting administrator.', 'invalid_response');
  }
  return Object.freeze({
    auditId: readText(audit.auditId, 'response.audit.auditId', { maxLength: 128 }),
    action,
    actorEmail,
    targetMemberId: readText(audit.targetMemberId, 'response.audit.targetMemberId', { maxLength: 128 }),
    occurredAt: readInteger(audit.occurredAt, 'response.audit.occurredAt', { minimum: 1 })
  });
}

export function validateMembershipMutationResponse(value, expectedCustomerId, mutation, expectedActorEmail = '') {
  const { envelope, customerId } = validateCustomerEnvelope(
    value,
    expectedCustomerId,
    ['protocolVersion', 'customerId', 'configVersion', 'member', 'utilization', 'audit']
  );
  const member = validateMember(envelope.member, 'response.member');
  if (member.memberId !== mutation.memberId) {
    throw new MembershipApiError('The updated member does not match the requested member.', 'invalid_response');
  }
  const expectedStatus = {
    approve: 'active',
    activate: 'active',
    reactivate: 'active',
    change_role: 'active',
    disable: 'disabled'
  }[mutation.action];
  if (member.status !== expectedStatus) {
    throw new MembershipApiError('The updated member status does not match the requested transition.', 'invalid_response');
  }
  if (mutation.role && member.role !== mutation.role) {
    throw new MembershipApiError('The updated member role does not match the requested role.', 'invalid_response');
  }
  return Object.freeze({
    protocolVersion: CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION,
    customerId,
    configVersion: readInteger(envelope.configVersion, 'response.configVersion', { minimum: 1 }),
    member,
    utilization: validateMembershipUtilization(envelope.utilization),
    audit: validateAudit(envelope.audit, mutation.action, mutation.memberId, expectedActorEmail)
  });
}

export function validateMembershipMutation(value) {
  if (!isPlainObject(value)) throw new MembershipApiError('A membership mutation is required.', 'invalid_request');
  const action = readText(value.action, 'mutation.action', { maxLength: 32 });
  if (!ACTION_VALUES.has(action)) throw new MembershipApiError('The membership action is unsupported.', 'invalid_request');
  const requiredKeys = ['action', 'memberId', 'expectedVersion'];
  const acceptsRole = ['approve', 'activate', 'reactivate', 'change_role'].includes(action);
  if (acceptsRole) requiredKeys.push('role');
  assertExactKeys(value, requiredKeys, 'mutation');
  const memberId = readText(value.memberId, 'mutation.memberId', { maxLength: 128 });
  if (!MEMBER_ID_PATTERN.test(memberId)) throw new MembershipApiError('The member ID is invalid.', 'invalid_request');
  const mutation = {
    action,
    memberId,
    expectedVersion: readInteger(value.expectedVersion, 'mutation.expectedVersion', { minimum: 1 })
  };
  if (acceptsRole) {
    const role = readText(value.role, 'mutation.role', { maxLength: 32 }).toLowerCase();
    if (!ASSIGNABLE_ROLES.has(role)) throw new MembershipApiError('The selected role cannot be assigned.', 'invalid_request');
    mutation.role = role;
  }
  return Object.freeze(mutation);
}

function validateActorProfile(profile) {
  if (profile?.status !== 'ready' || profile?.verification !== 'verified' || profile?.role !== 'admin') {
    throw new MembershipApiError(MEMBERSHIP_ERROR_MESSAGES.not_authorized, 'not_authorized');
  }
  if (!CUSTOMER_ID_PATTERN.test(String(profile.customerId || ''))) {
    throw new MembershipApiError('The acting administrator customer is invalid.', 'not_authorized');
  }
  if (!EMAIL_PATTERN.test(String(profile.email || '').trim().toLowerCase())) {
    throw new MembershipApiError('The acting administrator identity is invalid.', 'not_authorized');
  }
  return profile;
}

async function parseResponse(response) {
  const body = await response.text();
  if (!body || body.length > MAX_RESPONSE_BYTES) {
    throw new MembershipApiError('The membership API returned an empty or oversized response.', 'invalid_response');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new MembershipApiError('The membership API returned invalid JSON.', 'invalid_response');
  }
}

function parseErrorEnvelope(value, status) {
  try {
    const error = assertExactKeys(value?.error, ['code', 'message', 'utilization'], 'error');
    const code = readText(error.code, 'error.code', { maxLength: 64 });
    const safeCode = ERROR_CODES.has(code) ? code : 'conflict';
    const utilization = error.utilization ? validateMembershipUtilization(error.utilization) : null;
    return new MembershipApiError(
      MEMBERSHIP_ERROR_MESSAGES[safeCode] || readText(error.message, 'error.message', { maxLength: 240 }),
      safeCode,
      utilization
    );
  } catch (error) {
    if (error instanceof MembershipApiError && ERROR_CODES.has(error.code)) return error;
    const code = status === 401 ? 'identity_error' : status === 403 ? 'not_authorized' : 'conflict';
    return new MembershipApiError(MEMBERSHIP_ERROR_MESSAGES[code], code);
  }
}

export function createCustomerMembershipService({
  getAuthToken,
  fetchImpl = fetch,
  loadSettings = () => defaultLoadSettings(fetchImpl)
}) {
  let endpointPromise = null;

  async function getEndpoint() {
    if (!endpointPromise) {
      endpointPromise = Promise.resolve(loadSettings()).then(deriveMembershipEndpoint).catch((error) => {
        endpointPromise = null;
        throw error;
      });
    }
    return endpointPromise;
  }

  async function request(actorProfile, payload, validate) {
    const actor = validateActorProfile(actorProfile);
    const [endpoint, token] = await Promise.all([getEndpoint(), getAuthToken()]);
    if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) {
      throw new MembershipApiError(MEMBERSHIP_ERROR_MESSAGES.identity_error, 'identity_error');
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    const body = await parseResponse(response);
    if (!response.ok) throw parseErrorEnvelope(body, response.status);
    return validate(body, actor.customerId, actor.email);
  }

  async function listMembers(actorProfile, query = '') {
    const normalizedQuery = readText(query, 'query', { required: false, maxLength: 120 });
    return request(
      actorProfile,
      { protocolVersion: CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION, operation: 'list_members', query: normalizedQuery },
      validateMembershipListResponse
    );
  }

  async function mutateMember(actorProfile, candidate) {
    const mutation = validateMembershipMutation(candidate);
    return request(
      actorProfile,
      { protocolVersion: CUSTOMER_MEMBERSHIP_PROTOCOL_VERSION, operation: 'mutate_membership', mutation },
      (body, customerId, actorEmail) => validateMembershipMutationResponse(body, customerId, mutation, actorEmail)
    );
  }

  return { listMembers, mutateMember };
}
