const TOP_LEVEL_KEYS = Object.freeze(['schemaVersion', 'migrationId', 'customerId', 'source', 'memberships']);
const SOURCE_KEYS = Object.freeze(['workbookId', 'worksheetGid', 'snapshotDate', 'passwordColumnsImported']);
const MEMBER_KEYS = Object.freeze([
  'memberId', 'email', 'name', 'role', 'status', 'platformAssignment', 'sourceRow'
]);
const IMPORTABLE_ROLES = new Set(['waiting_approval', 'employee', 'manager', 'admin']);
const MEMBER_STATUSES = new Set(['pending', 'active', 'disabled']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UNSAFE_KEY_PATTERN = /(password|secret|credential|access[_-]?token|refresh[_-]?token)/i;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkExactKeys(value, keys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  const allowed = new Set(keys);
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not supported.`);
  });
  keys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required.`);
  });
  return true;
}

function findUnsafeKeys(value, path = '$', output = []) {
  if (!value || typeof value !== 'object') return output;
  Object.entries(value).forEach(([key, child]) => {
    if (key !== 'passwordColumnsImported' && UNSAFE_KEY_PATTERN.test(key)) output.push(`${path}.${key}`);
    findUnsafeKeys(child, `${path}.${key}`, output);
  });
  return output;
}

function emailDomain(email) {
  return String(email).split('@')[1] || '';
}

export function validateMembershipMigration(candidate, customerConfig) {
  const errors = [];
  const warnings = [];
  const cutoverBlockers = [];
  checkExactKeys(candidate, TOP_LEVEL_KEYS, 'migration', errors);
  checkExactKeys(candidate?.source, SOURCE_KEYS, 'migration.source', errors);

  if (candidate?.schemaVersion !== 1) errors.push('migration.schemaVersion must be 1.');
  if (candidate?.customerId !== customerConfig?.customerId) errors.push('Migration customer does not match the customer configuration.');
  if (candidate?.source?.passwordColumnsImported !== false) errors.push('Legacy password columns must not be imported.');
  findUnsafeKeys(candidate).forEach((path) => errors.push(`${path} contains a forbidden secret field.`));
  if (!Array.isArray(candidate?.memberships)) errors.push('migration.memberships must be a list.');

  const configuredPlatforms = new Set(customerConfig?.capabilities?.enabledPlatforms || []);
  const allowedDomains = new Set(customerConfig?.access?.allowedEmailDomains || []);
  const seenEmails = new Set();
  const seenIds = new Set();
  const normalized = [];

  (candidate?.memberships || []).forEach((member, index) => {
    const path = `migration.memberships.${index}`;
    checkExactKeys(member, MEMBER_KEYS, path, errors);
    const email = String(member?.email || '').trim().toLowerCase();
    const name = String(member?.name || '').trim().replace(/\s+/g, ' ');
    if (!EMAIL_PATTERN.test(email)) errors.push(`${path}.email is invalid.`);
    if (!ID_PATTERN.test(String(member?.memberId || ''))) errors.push(`${path}.memberId is invalid.`);
    if (!name || /[<>\u0000-\u001F\u007F]/.test(name)) errors.push(`${path}.name is invalid.`);
    if (!IMPORTABLE_ROLES.has(member?.role)) errors.push(`${path}.role is invalid.`);
    if (!MEMBER_STATUSES.has(member?.status)) errors.push(`${path}.status is invalid.`);
    if (member?.role === 'waiting_approval' && member?.status !== 'pending') errors.push(`${path} waiting approval must remain pending.`);
    if (member?.status === 'active' && member?.role === 'waiting_approval') errors.push(`${path} an active member needs an assigned role.`);
    if (member?.role !== 'waiting_approval' && !(customerConfig?.access?.enabledRoles || []).includes(member?.role)) {
      errors.push(`${path}.role is disabled for this customer.`);
    }
    if (!Number.isSafeInteger(member?.sourceRow) || member.sourceRow < 2) errors.push(`${path}.sourceRow is invalid.`);
    if (seenEmails.has(email)) errors.push(`${path}.email duplicates another membership.`);
    if (seenIds.has(member?.memberId)) errors.push(`${path}.memberId duplicates another membership.`);
    seenEmails.add(email);
    seenIds.add(member?.memberId);

    const domainApproved = allowedDomains.has(emailDomain(email));
    if (!domainApproved) {
      const message = `${path}.email is outside the configured customer domains.`;
      if (member?.status === 'active') errors.push(message);
      else warnings.push(message);
    }
    if (member?.platformAssignment !== 'all_current') errors.push(`${path}.platformAssignment is unsupported.`);
    normalized.push({
      memberId: String(member?.memberId || ''),
      customerId: candidate?.customerId,
      email,
      name,
      role: member?.role,
      status: member?.status,
      platforms: [...configuredPlatforms],
      source: {
        migrationId: String(candidate?.migrationId || ''),
        workbookId: String(candidate?.source?.workbookId || ''),
        sheetRow: member?.sourceRow
      }
    });
  });

  const active = normalized.filter((member) => member.status === 'active');
  const activeRoleCounts = Object.fromEntries(['employee', 'manager', 'admin'].map((role) => [
    role,
    active.filter((member) => member.role === role).length
  ]));
  if (active.length > Number(customerConfig?.access?.totalUserCap || 0)) errors.push('Imported active users exceed the customer cap.');
  Object.entries(activeRoleCounts).forEach(([role, count]) => {
    if (count > Number(customerConfig?.access?.roleSeatCaps?.[role] || 0)) errors.push(`Imported ${role} seats exceed the role cap.`);
  });
  if (activeRoleCounts.admin === 0) cutoverBlockers.push('Assign and verify at least one active customer administrator.');

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    cutoverReady: errors.length === 0 && cutoverBlockers.length === 0,
    cutoverBlockers: Object.freeze(cutoverBlockers),
    utilization: Object.freeze({ activeUsers: active.length, roles: Object.freeze(activeRoleCounts) }),
    normalized: Object.freeze({
      schemaVersion: 1,
      migrationId: String(candidate?.migrationId || ''),
      customerId: String(candidate?.customerId || ''),
      memberships: Object.freeze(normalized)
    })
  });
}
