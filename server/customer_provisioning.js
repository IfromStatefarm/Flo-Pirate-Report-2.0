import crypto from 'node:crypto';
import { ApiError } from './api_error.js';
import { validateCustomerConfig } from '../utils/customer_config.js';
import { applySubscriptionInTransaction } from './subscription_service.js';

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

function plainText(value, path, errors, maxLength) {
  if (typeof value !== 'string') {
    addError(errors, path, 'invalid_type', 'Expected plain text.');
    return '';
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) addError(errors, path, 'required', 'A value is required.');
  if (normalized.length > maxLength) addError(errors, path, 'too_long', `Must be ${maxLength} characters or fewer.`);
  if (UNSAFE_TEXT_PATTERN.test(value) || /^[=+]/.test(normalized)) {
    addError(errors, path, 'unsafe_text', 'HTML, control characters, and formula-like text are not allowed.');
  }
  return normalized.slice(0, maxLength);
}

function email(value, path, errors) {
  const normalized = plainText(value, path, errors, 254).toLowerCase();
  if (normalized && !EMAIL_PATTERN.test(normalized)) {
    addError(errors, path, 'invalid_email', 'Expected a valid email address.');
    return '';
  }
  return normalized;
}

function emailDomain(value) {
  return value.split('@')[1] || '';
}

export function validateCustomerProvisioningRequest(candidate) {
  const errors = [];
  const input = exactObject(candidate, ['config', 'initialAdministrator', 'operator'], 'setup', errors);
  const administrator = exactObject(
    input.initialAdministrator,
    ['email', 'name'],
    'initialAdministrator',
    errors
  );
  const operator = exactObject(input.operator, ['email'], 'operator', errors);
  const configResult = validateCustomerConfig(input.config);
  if (!configResult.valid) errors.push(...configResult.errors);

  const initialAdministrator = {
    email: email(administrator.email, 'initialAdministrator.email', errors),
    name: plainText(administrator.name, 'initialAdministrator.name', errors, 120)
  };
  const normalizedOperator = { email: email(operator.email, 'operator.email', errors) };

  if (
    configResult.valid
    && initialAdministrator.email
    && !configResult.config.access.allowedEmailDomains.includes(emailDomain(initialAdministrator.email))
  ) {
    addError(
      errors,
      'initialAdministrator.email',
      'domain_not_allowed',
      'The initial administrator email must use one of the customer allowed domains.'
    );
  }

  return {
    valid: errors.length === 0,
    request: errors.length === 0 ? Object.freeze({
      config: configResult.config,
      initialAdministrator: Object.freeze(initialAdministrator),
      operator: Object.freeze(normalizedOperator)
    }) : null,
    errors: Object.freeze(errors)
  };
}

export function customerMemberId(customerId, memberEmail) {
  const digest = crypto
    .createHash('sha256')
    .update(`${customerId}\n${memberEmail.toLowerCase()}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `usr_${digest}`;
}

function provisioningSummary(request, memberId) {
  const { config, initialAdministrator } = request;
  return {
    customer: {
      customerId: config.customerId,
      configVersion: config.configVersion,
      displayName: config.product.displayName,
      allowedEmailDomains: config.access.allowedEmailDomains,
      totalUserCap: config.access.totalUserCap,
      enabledRoles: config.access.enabledRoles,
      roleSeatCaps: config.access.roleSeatCaps
    },
    initialAdministrator: {
      memberId,
      email: initialAdministrator.email,
      name: initialAdministrator.name,
      role: 'admin',
      status: 'active'
    }
  };
}

function mapDatabaseConflict(error) {
  if (error?.code !== '23505') return error;
  const constraint = String(error.constraint || '');
  if (constraint === 'customers_pkey') {
    return new ApiError(409, 'customer_exists', 'A customer with this ID already exists.');
  }
  if (constraint.includes('email')) {
    return new ApiError(409, 'administrator_already_assigned', 'This administrator email already belongs to a customer.');
  }
  return new ApiError(409, 'provisioning_conflict', 'The customer setup conflicts with an existing record.');
}

export async function provisionCustomer(pool, candidate, {
  subscription,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
  retries = 2
} = {}) {
  const validation = validateCustomerProvisioningRequest(candidate);
  if (!validation.valid) {
    throw new ApiError(400, 'invalid_customer_setup', 'The customer setup contains invalid fields.', {
      validationErrors: validation.errors
    });
  }

  const request = validation.request;
  const { config, initialAdministrator, operator } = request;
  const memberId = customerMemberId(config.customerId, initialAdministrator.email);
  const occurredAt = now();
  const occurredAtDate = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.valueOf())) {
    throw new ApiError(500, 'configuration_error', 'The provisioning clock returned an invalid value.');
  }

  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

      const existingCustomer = await client.query(
        'SELECT customer_id FROM customers WHERE customer_id = $1',
        [config.customerId]
      );
      if (existingCustomer.rows.length > 0) {
        throw new ApiError(409, 'customer_exists', 'A customer with this ID already exists.');
      }

      const existingMembership = await client.query(
        'SELECT customer_id, status FROM customer_memberships WHERE lower(email) = lower($1) FOR UPDATE',
        [initialAdministrator.email]
      );
      if (existingMembership.rows.length > 0) {
        throw new ApiError(409, 'administrator_already_assigned', 'This administrator email already belongs to a customer.');
      }

      await client.query(`
        INSERT INTO customers (customer_id, active, config_version, config)
        VALUES ($1, TRUE, $2, $3)
      `, [config.customerId, config.configVersion, config]);

      await client.query(`
        INSERT INTO customer_memberships
          (member_id, customer_id, email, name, role, status, platforms, version)
        VALUES ($1, $2, $3, $4, 'admin', 'active', $5, 1)
      `, [
        memberId,
        config.customerId,
        initialAdministrator.email,
        initialAdministrator.name,
        config.capabilities.enabledPlatforms
      ]);

      const afterState = provisioningSummary(request, memberId);
      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(request), 'utf8')
        .digest('hex');
      const auditId = `audit_${randomUUID().replaceAll('-', '')}`;
      await client.query(`
        INSERT INTO customer_provisioning_audit
          (audit_id, customer_id, action, operator_email, initial_admin_member_id,
           initial_admin_email, config_version, request_hash, after_state, occurred_at)
        VALUES ($1, $2, 'customer_created', $3, $4, $5, $6, $7, $8, $9)
      `, [
        auditId,
        config.customerId,
        operator.email,
        memberId,
        initialAdministrator.email,
        config.configVersion,
        requestHash,
        afterState,
        occurredAtDate
      ]);

      const subscriptionResult = subscription ? await applySubscriptionInTransaction(client, subscription, operator.email) : null;
      await client.query('COMMIT');
      return Object.freeze({
        auditId,
        customerId: config.customerId,
        configVersion: subscriptionResult?.configVersion || config.configVersion,
        memberId,
        administratorEmail: initialAdministrator.email,
        utilization: {
          activeUsers: { used: 1, limit: config.access.totalUserCap },
          administrators: { used: 1, limit: config.access.roleSeatCaps.admin }
        }
      });
    } catch (rawError) {
      await client.query('ROLLBACK').catch(() => {});
      if (rawError?.code === '40001' && attempt < retries) continue;
      throw mapDatabaseConflict(rawError);
    } finally {
      client.release();
    }
  }
}
