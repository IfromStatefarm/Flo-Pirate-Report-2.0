import { ApiError, assert } from './api_error.js';
import { validateCustomerConfig } from '../utils/customer_config.js';
import { entitlementFor, requireEntitlement } from './subscription_service.js';
import { effectivePlatforms } from './platform_policy.js';
import { requirePermission, permissionsFor } from './access_policy.js';

export function domainAllowed(config, email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return config.access.allowedEmailDomains.includes(domain);
}

export async function identityRows(client, identity) {
  assert(typeof identity?.subject === 'string' && identity.subject.length > 0 &&
    typeof identity.email === 'string' && identity.email.length > 0,
    401, 'identity_error', 'A verified Google identity is required.');
  // The only pre-tenant lookup accepts server-verified identity, locks authority
  // rows, and sets the transaction scope only for a unique active membership.
  const result = await client.query('SELECT membership FROM rr_private.resolve_identity($1, $2)', [identity.subject, identity.email]);
  return { rows: result.rows.map(row => row.membership) };
}

export async function resolveInside(client, identity, { permission = null, allowOverCap = false, allowManagement = false } = {}) {
  const result = await identityRows(client, identity, { lock: true });
  if (result.rows.length === 0) throw new ApiError(403, 'not_a_member', 'No active customer membership was found.');
  if (result.rows.length !== 1) throw new ApiError(409, 'ambiguous_customer', 'The Google identity resolves to more than one active customer.');
  const row = result.rows[0];
  assert(row.email.toLowerCase() === identity.email, 401, 'identity_error', 'The verified Google email does not match the membership.');
  const canManage = permissionsFor(row.config, row.role).includes('settings.adminAccess');
  const subscription = await entitlementFor(client, row.customer_id, { allowExpired: true });
  let managementOnly = false;
  let subscriptionState = 'active';
  let entitlementExpiresAt;
  try { entitlementExpiresAt = requireEntitlement(subscription); }
  catch (error) {
    if (!allowManagement || !canManage || !['subscription_expired', 'subscription_not_started'].includes(error.code)) throw error;
    managementOnly = true;
    subscriptionState = error.code === 'subscription_expired' ? 'expired' : 'scheduled';
    entitlementExpiresAt = Date.now() + 10 * 60 * 1000;
  }
  if (!row.google_subject) {
    await client.query('UPDATE customer_memberships SET google_subject = $1, updated_at = now() WHERE customer_id = $2 AND member_id = $3', [identity.subject, row.customer_id, row.member_id]);
  }
  const configResult = validateCustomerConfig(row.config);
  assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
  assert(configResult.config.configVersion === Number(row.config_version), 500, 'configuration_error', 'Stored configuration versions do not match.');
  assert(configResult.config.access.enabledRoles.includes(row.role), 403, 'role_disabled', 'The member role is disabled for this customer.');
  assert(domainAllowed(configResult.config, row.email), 403, 'domain_not_allowed', 'The membership email domain is not approved for this customer.');
  assert(configResult.config.customerId === row.customer_id, 500, 'configuration_error', 'Stored customer identity does not match its configuration.');
  const totals = await utilization(client, configResult.config);
  const overCap = totals.activeUsers.used > totals.activeUsers.limit || Object.values(totals.roles).some(r => r.used > r.limit);
  assert(!overCap || (allowOverCap && canManage), 403, 'subscription_over_cap', 'Your administrator must disable excess users to meet the purchased limits.');
  const actor = {
    entitlementExpiresAt,
    managementOnly,
    subscriptionState,
    subscriptionPaidThrough: subscription?.paid_through ? new Date(subscription.paid_through).toISOString() : null,
    overCap,
    customerId: row.customer_id,
    memberId: row.member_id,
    googleSubject: identity.subject,
    email: row.email,
    name: row.name,
    role: row.role,
    configVersion: Number(row.config_version),
    platforms: effectivePlatforms(configResult.config, row.platforms || []),
    customerConfig: configResult.config
  };
  if (permission) requirePermission(actor, permission);
  return actor;
}

export async function utilization(client, customerConfig) {
  const counts = await client.query(`
    SELECT role, count(*)::int AS used
    FROM customer_memberships
    WHERE customer_id = $1 AND status = 'active'
    GROUP BY role
  `, [customerConfig.customerId]);
  const used = Object.fromEntries(counts.rows.map((row) => [row.role, Number(row.used)]));
  const activeUsers = Object.values(used).reduce((sum, value) => sum + value, 0);
  return {
    activeUsers: { used: activeUsers, limit: customerConfig.access.totalUserCap },
    roles: Object.fromEntries(['employee', 'manager', 'admin'].map((role) => [role, {
      used: used[role] || 0,
      limit: customerConfig.access.roleSeatCaps[role],
      enabled: customerConfig.access.enabledRoles.includes(role)
    }]))
  };
}

// Re-resolve persisted authority at each repository admission. An actor is only
// an internal snapshot, never a serialized credential or a browser-supplied object.
export async function reauthorizeActor(client, actor, permission, options = {}) {
  const current = await resolveInside(client, { subject: actor.googleSubject, email: actor.email }, options);
  assert(current.customerId === actor.customerId && current.memberId === actor.memberId,
    403, 'scope_mismatch', 'Customer membership changed. Sign in again.');
  assert(current.configVersion === actor.configVersion && current.role === actor.role,
    409, 'access_changed', 'Access changed. Refresh before retrying.');
  if (permission) requirePermission(current, permission);
  return current;
}
