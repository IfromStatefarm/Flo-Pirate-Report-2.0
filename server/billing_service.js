import crypto from 'node:crypto';
import { assert } from './api_error.js';
import { withTransaction } from './db.js';
import { applySubscriptionInTransaction } from './subscription_service.js';
import { validateCustomerConfig } from '../utils/customer_config.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// This is a server-to-server bridge protocol, NOT a native Wix JWT webhook.
// The Wix backend verifies settlement before signing an absolute order snapshot.
export function verifyBillingMessage(raw, headers, { secret, accountId, now = Date.now() }) {
  assert(typeof secret === 'string' && secret.length >= 32 && ID.test(accountId || ''), 503, 'billing_not_configured', 'Billing integration is not configured.');
  const timestamp = headers.get('x-billing-timestamp') || '';
  const signature = headers.get('x-billing-signature') || '';
  assert(/^\d{13}$/.test(timestamp) && Math.abs(now - Number(timestamp)) <= 5 * 60_000 && /^[a-f0-9]{64}$/.test(signature), 401, 'invalid_billing_signature', 'Invalid billing signature or timestamp.');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
  assert(crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')), 401, 'invalid_billing_signature', 'Invalid billing signature.');
  let data;
  try { data = JSON.parse(raw); } catch { assert(false, 400, 'invalid_billing_event', 'Invalid JSON.'); }
  const keys = ['schemaVersion', 'eventId', 'accountId', 'orderId', 'planId', 'sequence', 'state', 'periodStart', 'periodEnd', 'paymentReference', 'cancelAtPeriodEnd'];
  assert(data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === keys.length && Object.keys(data).every(k => keys.includes(k)), 400, 'invalid_billing_event', 'Invalid billing event fields.');
  assert(data.schemaVersion === 1 && data.accountId === accountId && ['eventId', 'orderId', 'planId'].every(k => ID.test(data[k] || '')), 400, 'invalid_billing_event', 'Unknown billing account or invalid identifiers.');
  assert(Number.isSafeInteger(data.sequence) && data.sequence > 0 && ['paid', 'past_due', 'canceled', 'paused', 'revoked'].includes(data.state) && typeof data.cancelAtPeriodEnd === 'boolean', 400, 'invalid_billing_event', 'Invalid billing order state.');
  assert(['periodStart', 'periodEnd'].every(k => typeof data[k] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(data[k]) && Number.isFinite(Date.parse(data[k]))) && Date.parse(data.periodEnd) > Date.parse(data.periodStart), 400, 'invalid_billing_event', 'Invalid billing period.');
  assert(typeof data.paymentReference === 'string' && data.paymentReference.length <= 128 && (data.state !== 'paid' || data.paymentReference.length > 0), 400, 'invalid_billing_event', 'Paid events require a settlement reference.');
  return data;
}
export async function acceptBillingEvent(pool, event) {
  const digest = hash(JSON.stringify(event));
  return withTransaction(async client => {
    await client.query(`INSERT INTO billing_events(provider,account_id,event_id,payload,payload_hash) VALUES ('wix',$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [event.accountId, event.eventId, event, digest]);
    const existing = (await client.query("SELECT payload_hash,status FROM billing_events WHERE provider='wix' AND account_id=$1 AND event_id=$2", [event.accountId, event.eventId])).rows[0];
    assert(existing.payload_hash === digest, 409, 'billing_event_conflict', 'Event ID was reused with different contents.');
    return { accepted: true, eventId: event.eventId, status: existing.status };
  }, { pool });
}

export async function processBillingEvents(pool, { limit = 25 } = {}) {
  let processed = 0;
  for (let i = 0; i < Math.min(limit, 100); i++) {
    const found = await withTransaction(async client => {
      const row = (await client.query("SELECT * FROM billing_events WHERE status='pending' AND next_attempt_at <= now() ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) return false;
      const event = row.payload;
      const ids = [row.account_id, row.event_id];
      await client.query('SAVEPOINT billing_job');
      try {
        // Lock customer before link, matching seller updates and seat mutations.
        const initial = (await client.query("SELECT customer_id FROM billing_order_links WHERE provider='wix' AND account_id=$1 AND order_id=$2", [row.account_id, event.orderId])).rows[0];
        assert(initial, 409, 'billing_order_unmapped', 'An operator must map this order.');
        const customer = (await client.query('SELECT * FROM customers WHERE customer_id=$1 FOR UPDATE', [initial.customer_id])).rows[0];
        const link = (await client.query("SELECT * FROM billing_order_links WHERE provider='wix' AND account_id=$1 AND order_id=$2 FOR UPDATE", [row.account_id, event.orderId])).rows[0];
        assert(link?.customer_id === customer.customer_id, 409, 'billing_mapping_changed', 'Order mapping changed.');
        if (event.sequence <= Number(link.last_sequence)) {
          await client.query("UPDATE billing_events SET status='ignored', processed_at=now() WHERE provider='wix' AND account_id=$1 AND event_id=$2", ids);
          return true;
        }
        const sub = (await client.query('SELECT * FROM customer_subscriptions WHERE customer_id=$1 FOR UPDATE', [customer.customer_id])).rows[0];
        assert(sub, 409, 'billing_subscription_missing', 'Finish customer subscription setup first.');
        const plan = (await client.query('SELECT package FROM billing_plan_mappings WHERE account_id=$1 AND provider_plan_id=$2', [row.account_id, event.planId])).rows[0]?.package;
        assert(plan, 409, 'billing_plan_unmapped', 'An operator must map this package.');
        const paid = event.state === 'paid';
        // A future package change must not replace today's seats/features early.
        // Existing paid coverage remains authoritative until the new cycle starts.
        if (paid && Date.parse(event.periodStart) > Date.now()) {
          await client.query("UPDATE billing_events SET next_attempt_at=$3 WHERE provider='wix' AND account_id=$1 AND event_id=$2", [...ids, event.periodStart]);
          return true;
        }
        // Nonpayment, cancellation and pause never grant a new period or more seats.
        const caps = paid ? plan : { totalUserCap: customer.config.access.totalUserCap, roleSeatCaps: customer.config.access.roleSeatCaps, enabledFeatures: customer.config.capabilities.enabledFeatures };
        const end = paid ? new Date(Math.max(new Date(sub.paid_through).valueOf(), Date.parse(event.periodEnd))).toISOString() : new Date(sub.paid_through).toISOString();
        await applySubscriptionInTransaction(client, {
          customerId: customer.customer_id, planKey: paid ? plan.planKey : sub.plan_key,
          interval: paid ? plan.interval : sub.billing_interval,
          startsAt: paid && Date.parse(event.periodStart) > new Date(sub.paid_through).valueOf() ? event.periodStart : new Date(sub.starts_at).toISOString(), paidThrough: end,
          paymentKind: paid ? 'paid' : sub.payment_kind,
          paymentReference: event.paymentReference || `order:${event.orderId}`,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd || event.state === 'canceled',
          serviceStatus: ['paused','revoked'].includes(event.state) ? event.state : paid ? 'active' : sub.service_status,
          totalUserCap: caps.totalUserCap, roleSeatCaps: caps.roleSeatCaps, enabledFeatures: caps.enabledFeatures,
          expectedRevision: sub.revision, expectedConfigVersion: customer.config_version,
          idempotencyKey: `billing:${hash(`${row.account_id}:${row.event_id}`)}`,
          reason: `Wix order ${event.orderId}: ${event.state}`, active: customer.active, operation: 'save'
        }, `billing:wix:${row.account_id}`, { billing: true });
        await client.query("UPDATE billing_order_links SET last_sequence=$3 WHERE provider='wix' AND account_id=$1 AND order_id=$2", [row.account_id, event.orderId, event.sequence]);
        await client.query("UPDATE billing_events SET status='processed',processed_at=now(),error_code=NULL WHERE provider='wix' AND account_id=$1 AND event_id=$2", ids);
      } catch (error) {
        if (['40001', '40P01'].includes(error.code)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT billing_job');
        await client.query(`UPDATE billing_events SET attempts=attempts+1, status=CASE WHEN attempts >= 11 THEN 'failed' ELSE 'pending' END,
          error_code=$3,next_attempt_at=now()+make_interval(secs => LEAST(3600, (30 * power(2, LEAST(attempts,7)))::int))
          WHERE provider='wix' AND account_id=$1 AND event_id=$2`, [...ids, /^[a-z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'billing_processing_failed']);
      }
      return true;
    }, { pool, isolation: 'SERIALIZABLE', retries: 3 });
    if (!found) break;
    processed++;
  }
  return { examined: processed };
}

export function saveBillingMapping(pool, { customerId, accountId, orderId, planId, expectedConfigVersion, planKey, interval, package: selectedPackage }, actor) {
  assert([accountId, orderId, planId].every(value => ID.test(value || '')), 400, 'invalid_billing_mapping', 'Use valid account, order and plan identifiers.');
  assert(typeof planKey === 'string' && planKey.length > 0 && planKey.length <= 80 && !/[<>\u0000-\u001f]/.test(planKey) && ['month','year'].includes(interval), 400, 'invalid_billing_mapping', 'Choose a package name and billing interval.');
  return withTransaction(async client => {
    const customer = (await client.query('SELECT * FROM customers WHERE customer_id=$1 FOR UPDATE', [customerId])).rows[0];
    assert(customer && customer.config_version === expectedConfigVersion, 409, 'stale_customer_config', 'Reload the customer before linking billing.');
    const sub = (await client.query('SELECT * FROM customer_subscriptions WHERE customer_id=$1', [customerId])).rows[0];
    assert(sub, 409, 'billing_subscription_missing', 'Save the initial subscription before linking billing.');
    const source = selectedPackage || { totalUserCap: customer.config.access.totalUserCap, roleSeatCaps: customer.config.access.roleSeatCaps, enabledFeatures: customer.config.capabilities.enabledFeatures };
    const validatedConfig = structuredClone(customer.config);
    validatedConfig.access.totalUserCap = source.totalUserCap;
    validatedConfig.access.roleSeatCaps = source.roleSeatCaps;
    validatedConfig.access.enabledRoles = ['employee','manager','admin'].filter(role => source.roleSeatCaps?.[role] > 0);
    validatedConfig.capabilities.enabledFeatures = source.enabledFeatures;
    const validation = validateCustomerConfig(validatedConfig);
    assert(validation.valid, 400, 'invalid_billing_mapping', 'Invalid package seats or features.', { validationErrors: validation.errors });
    const pkg = { planKey, interval, totalUserCap: validation.config.access.totalUserCap, roleSeatCaps: validation.config.access.roleSeatCaps, enabledFeatures: validation.config.capabilities.enabledFeatures };
    await client.query('INSERT INTO billing_plan_mappings(account_id,provider_plan_id,package) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [accountId, planId, pkg]);
    const existing = (await client.query('SELECT package FROM billing_plan_mappings WHERE account_id=$1 AND provider_plan_id=$2', [accountId, planId])).rows[0].package;
    assert(existing.planKey === pkg.planKey && existing.interval === pkg.interval && existing.totalUserCap === pkg.totalUserCap && ['admin','manager','employee'].every(r => existing.roleSeatCaps[r] === pkg.roleSeatCaps[r]) && JSON.stringify([...existing.enabledFeatures].sort()) === JSON.stringify([...pkg.enabledFeatures].sort()), 409, 'billing_plan_conflict', 'This provider plan is already mapped to different terms. Use a new provider plan ID.');
    await client.query("INSERT INTO billing_order_links(provider,account_id,order_id,customer_id) VALUES ('wix',$1,$2,$3) ON CONFLICT DO NOTHING", [accountId, orderId, customerId]);
    const linked = (await client.query("SELECT * FROM billing_order_links WHERE provider='wix' AND account_id=$1 AND order_id=$2", [accountId, orderId])).rows[0];
    assert(linked?.customer_id === customerId, 409, 'billing_order_conflict', 'This customer or order already has a different billing mapping.');
    await client.query(`INSERT INTO subscription_audit(audit_id,customer_id,idempotency_key,request_hash,actor,reason,after_state,result)
      VALUES ($1,$2,$3,$4,$5,'Billing mapping saved',$6,$7)`, [crypto.randomUUID(), customerId, crypto.randomUUID(), hash(JSON.stringify(pkg)), actor, { accountId, orderId, planId, package: pkg }, { linked: true }]);
    await client.query("UPDATE billing_events SET status='pending',next_attempt_at=now(),attempts=0 WHERE provider='wix' AND account_id=$1 AND payload->>'orderId'=$2 AND status IN ('pending','failed')", [accountId, orderId]);
    return { linked: true };
  }, { pool, isolation: 'SERIALIZABLE', retries: 3 });
}
