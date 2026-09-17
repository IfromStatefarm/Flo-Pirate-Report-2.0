import crypto from 'node:crypto';
import { ApiError } from './api_error.js';
import { CUSTOMER_ROLES, validateCustomerConfig } from '../utils/customer_config.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u001F\u007F]/;

function addError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, path, errors) {
  if (!isPlainObject(value)) {
    addError(errors, path, 'invalid_type', 'Expected an object with fixed fields.');
    return {};
  }
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    addError(errors, path, 'unsupported_field', 'Contains one or more unsupported fields.');
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addError(errors, `${path}.${key}`, 'missing_field', 'Required field is missing.');
    }
  }
  return value;
}

function operatorEmail(value, errors) {
  if (typeof value !== 'string') {
    addError(errors, 'operator.email', 'invalid_type', 'Expected a valid operator email.');
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (
    !normalized
    || normalized.length > 254
    || !EMAIL_PATTERN.test(normalized)
    || UNSAFE_TEXT_PATTERN.test(value)
    || /^[=+]/.test(normalized)
  ) {
    addError(errors, 'operator.email', 'invalid_email', 'Expected a valid operator email.');
    return '';
  }
  return normalized;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

function configurationSummary(row) {
  const validation = validateCustomerConfig(row.config);
  const versionMatches = validation.valid
    && validation.config.configVersion === Number(row.config_version);
  const config = versionMatches ? validation.config : null;
  return Object.freeze({
    customerId: String(row.customer_id),
    displayName: config?.product.displayName || String(row.customer_id),
    productName: config?.product.productName || '',
    active: row.active === true,
    configVersion: Number(row.config_version),
    configurationValid: Boolean(versionMatches),
    activeUsers: Number(row.active_users || 0),
    activeAdministrators: Number(row.active_administrators || 0),
    totalUserCap: config?.access.totalUserCap ?? null,
    administratorCap: config?.access.roleSeatCaps.admin ?? null,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at)
  });
}

const CUSTOMER_DIRECTORY_QUERY = `
  SELECT
    c.customer_id,
    c.active,
    c.config_version,
    c.config,
    c.created_at,
    c.updated_at,
    count(m.member_id) FILTER (WHERE m.status = 'active')::int AS active_users,
    count(m.member_id) FILTER (WHERE m.status = 'active' AND m.role = 'admin')::int AS active_administrators
  FROM customers c
  LEFT JOIN customer_memberships m ON m.customer_id = c.customer_id
`;

export async function listCustomers(pool) {
  const result = await pool.query(`${CUSTOMER_DIRECTORY_QUERY}
    GROUP BY c.customer_id
    ORDER BY lower(coalesce(c.config->'product'->>'displayName', c.customer_id)), c.customer_id
  `);
  return Object.freeze(result.rows.map(configurationSummary));
}

export async function loadCustomerForEdit(pool, customerId) {
  const result = await pool.query(`${CUSTOMER_DIRECTORY_QUERY}
    WHERE c.customer_id = $1
    GROUP BY c.customer_id
  `, [customerId]);
  if (result.rows.length !== 1) {
    throw new ApiError(404, 'customer_not_found', 'The selected customer was not found.');
  }
  const row = result.rows[0];
  const validation = validateCustomerConfig(row.config);
  if (!validation.valid || validation.config.configVersion !== Number(row.config_version)) {
    throw new ApiError(409, 'configuration_error', 'The stored customer configuration is invalid and cannot be edited with this tool.');
  }
  return Object.freeze({
    ...configurationSummary(row),
    config: validation.config
  });
}

export function validateCustomerUpdateRequest(candidate) {
  const errors = [];
  const input = exactObject(candidate, ['config', 'operator', 'expectedConfigVersion'], 'update', errors);
  const operator = exactObject(input.operator, ['email'], 'operator', errors);
  const configResult = validateCustomerConfig(input.config);
  if (!configResult.valid) errors.push(...configResult.errors);

  const expectedConfigVersion = Number(input.expectedConfigVersion);
  if (!Number.isInteger(expectedConfigVersion) || expectedConfigVersion < 1) {
    addError(errors, 'expectedConfigVersion', 'invalid_version', 'The current configuration version is invalid. Reload the customer before editing.');
  }
  if (
    configResult.valid
    && Number.isInteger(expectedConfigVersion)
    && configResult.config.configVersion !== expectedConfigVersion + 1
  ) {
    addError(errors, 'config.configVersion', 'invalid_version_increment', 'The configuration version must increase by exactly one.');
  }

  const normalizedOperator = { email: operatorEmail(operator.email, errors) };
  return {
    valid: errors.length === 0,
    request: errors.length === 0 ? Object.freeze({
      config: configResult.config,
      operator: Object.freeze(normalizedOperator),
      expectedConfigVersion
    }) : null,
    errors: Object.freeze(errors)
  };
}

function activeConfigurationErrors(config, members) {
  const errors = [];
  const active = members.filter((member) => member.status === 'active');
  if (active.length > config.access.totalUserCap) {
    addError(errors, 'access.totalUserCap', 'cap_below_utilization', `Cannot set the total cap below ${active.length} active users.`);
  }
  for (const role of CUSTOMER_ROLES) {
    const count = active.filter((member) => member.role === role).length;
    if (count > config.access.roleSeatCaps[role]) {
      addError(errors, `access.roleSeatCaps.${role}`, 'cap_below_utilization', `Cannot set this cap below ${count} active ${role} users.`);
    }
    if (count > 0 && !config.access.enabledRoles.includes(role)) {
      addError(errors, 'access.enabledRoles', 'active_role_disabled', `The ${role} role cannot be disabled while it has active users.`);
    }
  }
  for (const member of active) {
    const domain = String(member.email || '').toLowerCase().split('@')[1] || '';
    if (!config.access.allowedEmailDomains.includes(domain)) {
      addError(errors, 'access.allowedEmailDomains', 'active_domain_removed', `The active member ${member.email} uses a domain that would no longer be allowed.`);
    }
  }
  return errors;
}

function changedConfigurationFields(before, after, path = '') {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [path];
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => changedConfigurationFields(
      before[key],
      after[key],
      path ? `${path}.${key}` : key
    ));
  }
  return [path];
}

function updateError(message, validationErrors) {
  return new ApiError(409, 'invalid_configuration_change', message, { validationErrors });
}

export async function updateCustomer(pool, candidate, {
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
  retries = 2
} = {}) {
  const validation = validateCustomerUpdateRequest(candidate);
  if (!validation.valid) {
    throw new ApiError(400, 'invalid_customer_update', 'The customer update contains invalid fields.', {
      validationErrors: validation.errors
    });
  }
  const request = validation.request;
  const occurredAt = now();
  const occurredAtDate = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.valueOf())) {
    throw new ApiError(500, 'configuration_error', 'The customer update clock returned an invalid value.');
  }

  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const customerResult = await client.query(
        'SELECT customer_id, active, config_version, config FROM customers WHERE customer_id = $1 FOR UPDATE',
        [request.config.customerId]
      );
      if (customerResult.rows.length !== 1) {
        throw new ApiError(404, 'customer_not_found', 'The selected customer was not found.');
      }
      const customer = customerResult.rows[0];
      const currentValidation = validateCustomerConfig(customer.config);
      if (!currentValidation.valid || currentValidation.config.configVersion !== Number(customer.config_version)) {
        throw new ApiError(409, 'configuration_error', 'The stored customer configuration is invalid and cannot be updated.');
      }
      if (Number(customer.config_version) !== request.expectedConfigVersion) {
        throw new ApiError(409, 'stale_customer_config', 'This customer was changed by another session. Reload it before editing again.', {
          currentConfigVersion: Number(customer.config_version)
        });
      }

      const membersResult = await client.query(
        'SELECT member_id, email, role, status FROM customer_memberships WHERE customer_id = $1 FOR UPDATE',
        [request.config.customerId]
      );
      const policyErrors = activeConfigurationErrors(request.config, membersResult.rows);
      if (policyErrors.length) {
        throw updateError('The new limits, roles, or domains conflict with active customer members.', policyErrors);
      }

      const changedFields = changedConfigurationFields(currentValidation.config, request.config)
        .filter((path) => path !== 'configVersion');
      if (changedFields.length === 0) {
        throw new ApiError(409, 'no_configuration_changes', 'No customer configuration values were changed.');
      }

      await client.query(`
        UPDATE customers
        SET config_version = $2, config = $3, updated_at = $4
        WHERE customer_id = $1
      `, [request.config.customerId, request.config.configVersion, request.config, occurredAtDate]);

      const auditId = `audit_${randomUUID().replaceAll('-', '')}`;
      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(request), 'utf8')
        .digest('hex');
      await client.query(`
        INSERT INTO customer_configuration_audit
          (audit_id, customer_id, action, operator_email, before_config_version,
           after_config_version, changed_fields, request_hash, before_state,
           after_state, occurred_at)
        VALUES ($1, $2, 'customer_updated', $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        auditId,
        request.config.customerId,
        request.operator.email,
        request.expectedConfigVersion,
        request.config.configVersion,
        changedFields,
        requestHash,
        currentValidation.config,
        request.config,
        occurredAtDate
      ]);
      await client.query('COMMIT');

      const activeMembers = membersResult.rows.filter((member) => member.status === 'active');
      const activeAdministrators = activeMembers.filter((member) => member.role === 'admin').length;
      return Object.freeze({
        auditId,
        customerId: request.config.customerId,
        displayName: request.config.product.displayName,
        configVersion: request.config.configVersion,
        changedFields: Object.freeze(changedFields),
        utilization: {
          activeUsers: { used: activeMembers.length, limit: request.config.access.totalUserCap },
          administrators: { used: activeAdministrators, limit: request.config.access.roleSeatCaps.admin }
        }
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error?.code === '40001' && attempt < retries) continue;
      throw error;
    } finally {
      client.release();
    }
  }
}
