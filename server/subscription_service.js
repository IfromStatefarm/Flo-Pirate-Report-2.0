import crypto from 'node:crypto';
import { assert } from './api_error.js';
import { withTransaction } from './db.js';
import { validateCustomerConfig } from '../utils/customer_config.js';

const ROLES = ['employee', 'manager', 'admin'];
export function calendarEnd(value, interval) {
  const date = new Date(value);
  assert(Number.isFinite(date.valueOf()) && ['month', 'year'].includes(interval), 400, 'invalid_subscription', 'A valid date and billing interval are required.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (interval === 'year' ? 12 : 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
function timestamp(value) {
  assert(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?Z$/.test(value) && Number.isFinite(Date.parse(value)), 400, 'invalid_subscription', 'Dates must be valid UTC timestamps.');
  const normalized = new Date(value).toISOString();
  assert(normalized.slice(0, 16) === value.slice(0, 16), 400, 'invalid_subscription', 'The calendar date does not exist.');
  return normalized;
}
function text(value, name, max) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u001f]/.test(value), 400, 'invalid_subscription', `${name} is required and must be plain text.`);
  return value.trim();
}
export function validateSubscription(candidate) {
  const keys = ['customerId', 'planKey', 'interval', 'startsAt', 'paidThrough', 'paymentKind', 'cancelAtPeriodEnd', 'totalUserCap', 'roleSeatCaps', 'enabledFeatures', 'expectedRevision', 'expectedConfigVersion', 'idempotencyKey', 'reason', 'paymentReference', 'active', 'operation', 'serviceStatus'];
  assert(candidate && typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).every(k => keys.includes(k)), 400, 'invalid_subscription', 'Unsupported subscription fields.');
  const input = structuredClone(candidate);
  assert(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.customerId || ''), 400, 'invalid_subscription', 'Invalid customer ID.');
  input.planKey = text(input.planKey, 'Package', 80);
  assert(['month', 'year'].includes(input.interval), 400, 'invalid_subscription', 'Choose monthly or yearly billing.');
  input.startsAt = timestamp(input.startsAt);
  input.paidThrough = input.paidThrough ? timestamp(input.paidThrough) : calendarEnd(input.startsAt, input.interval);
  assert(Date.parse(input.paidThrough) > Date.parse(input.startsAt), 400, 'invalid_subscription', 'Paid-through must be after the start.');
  assert(['paid', 'trial', 'complimentary'].includes(input.paymentKind), 400, 'invalid_subscription', 'Record a payment, trial, or complimentary grant.');
  assert(typeof input.cancelAtPeriodEnd === 'boolean' && typeof input.active === 'boolean', 400, 'invalid_subscription', 'Invalid subscription status.');
  for (const field of ['expectedRevision', 'expectedConfigVersion']) assert(Number.isSafeInteger(input[field]) && input[field] >= (field === 'expectedRevision' ? 0 : 1), 400, 'invalid_subscription', 'Invalid version. Reload the customer.');
  input.idempotencyKey = text(input.idempotencyKey, 'Request ID', 160);
  input.reason = text(input.reason, 'Reason', 500);
  input.paymentReference = input.paymentKind === 'paid' ? text(input.paymentReference, 'Payment reference', 128) : String(input.paymentReference || '').slice(0, 128);
  input.operation ||= 'save';
  input.serviceStatus ||= 'active';
  assert(['active', 'paused', 'revoked'].includes(input.serviceStatus), 400, 'invalid_subscription', 'Invalid service status.');
  assert(['save', 'renew'].includes(input.operation), 400, 'invalid_subscription', 'Invalid subscription action.');
  assert(input.roleSeatCaps && Object.keys(input.roleSeatCaps).length === 3 && ROLES.every(r => Number.isInteger(input.roleSeatCaps[r]) && input.roleSeatCaps[r] >= (r === 'admin' ? 1 : 0) && input.roleSeatCaps[r] <= 100000), 400, 'invalid_subscription', 'Invalid per-role limits.');
  assert(Number.isInteger(input.totalUserCap) && input.totalUserCap >= 1 && input.totalUserCap <= 100000 && ROLES.every(r => input.roleSeatCaps[r] <= input.totalUserCap), 400, 'invalid_subscription', 'Role limits cannot exceed the total user limit.');
  assert(Array.isArray(input.enabledFeatures), 400, 'invalid_subscription', 'Package features are required.');
  return input;
}

export function requireEntitlement(row, now = Date.now()) {
  assert(row, 403, 'subscription_required', 'Your organization needs a subscription. Contact the seller.');
  assert(!row.service_status || row.service_status === 'active', 403, 'subscription_suspended', 'Your subscription is paused or revoked. Contact your administrator.');
  assert(new Date(row.starts_at).valueOf() <= now, 403, 'subscription_not_started', 'Your subscription has not started yet.');
  assert(new Date(row.paid_through).valueOf() > now, 403, 'subscription_expired', 'Your subscription has expired. Contact your administrator to renew.');
  return new Date(row.paid_through).valueOf();
}
export async function entitlementFor(client, customerId, { now = Date.now(), allowExpired = false } = {}) {
  const result = await client.query('SELECT * FROM customer_subscriptions WHERE customer_id = $1', [customerId]);
  if (allowExpired) return result.rows[0];
  return requireEntitlement(result.rows[0], now);
}
export async function loadSubscription(pool, customerId) {
  const [subscription, links, audit] = await Promise.all([
    pool.query('SELECT * FROM customer_subscriptions WHERE customer_id = $1', [customerId]),
    pool.query('SELECT * FROM billing_order_links WHERE customer_id = $1', [customerId]),
    pool.query('SELECT actor, reason, occurred_at, after_state FROM subscription_audit WHERE customer_id = $1 ORDER BY occurred_at DESC LIMIT 20', [customerId])
  ]);
  return { subscription: subscription.rows[0] || null, billingLink: links.rows[0] || null, audit: audit.rows };
}
export async function applySubscriptionInTransaction(client, candidate, actor, { now = Date.now(), billing = false } = {}) {
  const input = validateSubscription(candidate);
  assert(typeof actor === 'string' && actor.length > 0 && actor.length <= 254, 500, 'configuration_error', 'An authenticated audit actor is required.');
  const customer = (await client.query('SELECT * FROM customers WHERE customer_id = $1 FOR UPDATE', [input.customerId])).rows[0];
  assert(customer, 404, 'customer_not_found', 'Customer not found.');
  const hash = crypto.createHash('sha256').update(JSON.stringify([input, actor])).digest('hex');
  const previous = (await client.query('SELECT request_hash, result FROM subscription_audit WHERE customer_id = $1 AND idempotency_key = $2', [input.customerId, input.idempotencyKey])).rows[0];
  if (previous) {
    assert(previous.request_hash === hash, 409, 'idempotency_conflict', 'This request ID was already used with different terms.');
    return previous.result;
  }
  const before = (await client.query('SELECT * FROM customer_subscriptions WHERE customer_id = $1 FOR UPDATE', [input.customerId])).rows[0] || null;
  assert(Number(before?.revision || 0) === input.expectedRevision && Number(customer.config_version) === input.expectedConfigVersion, 409, 'stale_subscription', 'The customer changed elsewhere. Reload before saving.');
  const link = (await client.query('SELECT * FROM billing_order_links WHERE customer_id = $1', [input.customerId])).rows[0];
  assert(billing || !link, 409, 'provider_managed_subscription', 'This subscription is managed by billing. Change paid terms through the payment provider.');
  if (input.operation === 'renew') {
    assert(before && !before.cancel_at_period_end && input.paymentKind === 'paid', 409, 'renewal_not_allowed', 'Renew an existing paid subscription with auto-renewal enabled.');
    input.paidThrough = calendarEnd(new Date(Math.max(new Date(before.paid_through).valueOf(), now)).toISOString(), input.interval);
  }
  const config = structuredClone(customer.config);
  config.access.totalUserCap = input.totalUserCap;
  config.access.roleSeatCaps = input.roleSeatCaps;
  config.access.enabledRoles = ROLES.filter(role => input.roleSeatCaps[role] > 0);
  config.capabilities.enabledFeatures = input.enabledFeatures;
  config.configVersion = Number(customer.config_version) + 1;
  const validation = validateCustomerConfig(config);
  assert(validation.valid, 400, 'invalid_subscription', 'Package limits or features are invalid.', { validationErrors: validation.errors });
  const members = (await client.query("SELECT role FROM customer_memberships WHERE customer_id = $1 AND status = 'active' FOR UPDATE", [input.customerId])).rows;
  // Provider reductions can enter over-cap mode; only admin list/disable then work.
  if (!billing) assert(members.length <= input.totalUserCap && ROLES.every(r => members.filter(m => m.role === r).length <= input.roleSeatCaps[r]), 409, 'cap_below_utilization', 'Disable excess users before reducing purchased seats.');
  await client.query(`INSERT INTO customer_subscriptions
    (customer_id, plan_key, billing_interval, starts_at, paid_through, payment_kind, cancel_at_period_end, revision, service_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (customer_id) DO UPDATE SET plan_key=$2,billing_interval=$3,starts_at=$4,paid_through=$5,payment_kind=$6,cancel_at_period_end=$7,revision=$8,service_status=$9,updated_at=now()`,
  [input.customerId, input.planKey, input.interval, input.startsAt, input.paidThrough, input.paymentKind, input.cancelAtPeriodEnd, input.expectedRevision + 1, input.serviceStatus]);
  // A provider renewal must never undo Ivan's administrative suspension.
  const active = billing ? customer.active : input.active;
  await client.query('UPDATE customers SET active=$2, config=$3, config_version=$4, updated_at=now() WHERE customer_id=$1', [input.customerId, active, validation.config, config.configVersion]);
  const result = { customerId: input.customerId, revision: input.expectedRevision + 1, configVersion: config.configVersion, paidThrough: input.paidThrough, totalUserCap: input.totalUserCap, active };
  await client.query(`INSERT INTO subscription_audit (audit_id,customer_id,idempotency_key,request_hash,actor,reason,before_state,after_state,result)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [crypto.randomUUID(), input.customerId, input.idempotencyKey, hash, actor, input.reason, { subscription: before, config: customer.config, active: customer.active }, { ...input, active }, result]);
  return result;
}
export function applySubscriptionChange(pool, input, actor, options = {}) {
  return withTransaction(client => applySubscriptionInTransaction(client, input, actor, options), { pool, isolation: 'SERIALIZABLE', retries: 3 });
}

export function setAdministrativeStatus(pool, { customerId, active, expectedConfigVersion, idempotencyKey, reason }, actor) {
  assert(typeof active === 'boolean' && Number.isInteger(expectedConfigVersion), 400, 'invalid_subscription', 'Invalid administrative status request.');
  text(reason, 'Reason', 500); text(idempotencyKey, 'Request ID', 160);
  return withTransaction(async client => {
    const customer = (await client.query('SELECT * FROM customers WHERE customer_id=$1 FOR UPDATE', [customerId])).rows[0];
    assert(customer, 404, 'customer_not_found', 'Customer not found.');
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ customerId, active, expectedConfigVersion, reason, actor })).digest('hex');
    const prior = (await client.query('SELECT request_hash,result FROM subscription_audit WHERE customer_id=$1 AND idempotency_key=$2', [customerId, idempotencyKey])).rows[0];
    if (prior) { assert(prior.request_hash === requestHash, 409, 'idempotency_conflict', 'Request ID already used.'); return prior.result; }
    assert(customer.config_version === expectedConfigVersion, 409, 'stale_customer_config', 'Reload the customer before changing its status.');
    const config = { ...customer.config, configVersion: customer.config_version + 1 };
    await client.query('UPDATE customers SET active=$2,config=$3,config_version=$4,updated_at=now() WHERE customer_id=$1', [customerId, active, config, config.configVersion]);
    const result = { active, configVersion: config.configVersion };
    await client.query('INSERT INTO subscription_audit(audit_id,customer_id,idempotency_key,request_hash,actor,reason,before_state,after_state,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [crypto.randomUUID(), customerId, idempotencyKey, requestHash, actor, reason, { active: customer.active }, result, result]);
    return result;
  }, { pool, isolation: 'SERIALIZABLE', retries: 3 });
}
